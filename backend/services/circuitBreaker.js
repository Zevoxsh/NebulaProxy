/**
 * CircuitBreaker — Per-backend circuit breaker for NebulaProxy
 *
 * States:
 *  CLOSED    → Normal operation. Failures increment counter.
 *  OPEN      → Backend is presumed down. All requests fail fast.
 *  HALF_OPEN → One probe request allowed to test recovery.
 *
 * Récupération instantanée : dès qu'un circuit passe OPEN, un probe TCP
 * actif tourne en arrière-plan toutes les 2 s. Dès que le backend répond,
 * le circuit est remis en CLOSED immédiatement sans attendre de requête
 * utilisateur ni de timeout.
 *
 * Usage:
 *   const key = `${domainId}:${host}:${port}`;
 *   if (!circuitBreaker.isAvailable(key)) { ... use fallback ... }
 *   try {
 *     // make request
 *     circuitBreaker.onSuccess(key);
 *   } catch (err) {
 *     circuitBreaker.onFailure(key);
 *     throw err;
 *   }
 */

import net from 'net';

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor() {
    // Map: key → { state, failures, successes, lastFailure, openedAt }
    this.breakers = new Map();

    // Active background TCP probes: key → intervalId
    this._probeIntervals = new Map();

    // Configuration
    this.FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD || '5', 10);
    this.SUCCESS_THRESHOLD = parseInt(process.env.CB_SUCCESS_THRESHOLD || '1', 10); // 1 suffit : le probe TCP a déjà confirmé que le backend est up
    this.TIMEOUT_MS = parseInt(process.env.CB_TIMEOUT_MS || '10000', 10);           // fallback si le probe actif ne peut pas tourner
    this.HALF_OPEN_MAX_CALLS = 1;
    this.PROBE_INTERVAL_MS = parseInt(process.env.CB_PROBE_INTERVAL_MS || '2000', 10); // probe TCP toutes les 2 s
    this.PROBE_TIMEOUT_MS = 1500; // timeout du probe TCP

    // Cleanup stale breakers every 5 minutes
    setInterval(() => this._cleanup(), 5 * 60 * 1000);
  }

  /**
   * Parse host + port from a breaker key ("domainId:host:port").
   * Fonctionne aussi avec des adresses IPv6 dans le host.
   */
  _parseKey(key) {
    const parts = key.split(':');
    if (parts.length < 3) return null;
    const port = parseInt(parts[parts.length - 1], 10);
    const host = parts.slice(1, -1).join(':'); // tout entre le 1er et le dernier ":"
    if (!host || isNaN(port) || port < 1 || port > 65535) return null;
    return { host, port };
  }

  /**
   * Lance un probe TCP en arrière-plan pour le backend identifié par `key`.
   * Dès que le backend accepte la connexion, le circuit repasse en CLOSED
   * instantanément et le probe s'arrête.
   */
  _startActiveProbe(key) {
    if (this._probeIntervals.has(key)) return; // déjà en cours

    const parsed = this._parseKey(key);
    if (!parsed) return; // clé non parseable, on laisse le fallback timeout gérer

    const { host, port } = parsed;

    const intervalId = setInterval(() => {
      const breaker = this.breakers.get(key);

      // Arrêter le probe si le circuit n'est plus OPEN
      if (!breaker || breaker.state !== STATES.OPEN) {
        clearInterval(intervalId);
        this._probeIntervals.delete(key);
        return;
      }

      // Probe TCP : on essaie juste d'ouvrir une connexion
      const socket = net.createConnection({ host, port, timeout: this.PROBE_TIMEOUT_MS });

      socket.once('connect', () => {
        socket.destroy();
        // Backend répond → reset immédiat en CLOSED
        console.log(`[CircuitBreaker] ${key} → CLOSED (probe TCP actif réussi, récupération instantanée)`);
        this._forceClose(key);
        clearInterval(intervalId);
        this._probeIntervals.delete(key);
      });

      socket.once('timeout', () => socket.destroy());
      socket.once('error', () => socket.destroy());
    }, this.PROBE_INTERVAL_MS);

    this._probeIntervals.set(key, intervalId);
  }

  /**
   * Force le passage en CLOSED sans passer par HALF_OPEN.
   * Utilisé uniquement par le probe TCP actif.
   */
  _forceClose(key) {
    const breaker = this._get(key);
    breaker.state = STATES.CLOSED;
    breaker.failures = 0;
    breaker.successes = 0;
    breaker.halfOpenCalls = 0;
    breaker.openedAt = null;
  }

  /**
   * Get or create breaker state for a backend key
   */
  _get(key) {
    if (!this.breakers.has(key)) {
      this.breakers.set(key, {
        state: STATES.CLOSED,
        failures: 0,
        successes: 0,
        lastFailure: null,
        openedAt: null,
        halfOpenCalls: 0
      });
    }
    return this.breakers.get(key);
  }

  /**
   * Check whether a backend is available for use.
   * Returns true if the circuit is CLOSED or HALF_OPEN (probe allowed).
   * Returns false if OPEN and timeout hasn't elapsed yet.
   */
  isAvailable(key) {
    const breaker = this._get(key);

    switch (breaker.state) {
      case STATES.CLOSED:
        return true;

      case STATES.OPEN: {
        const elapsed = Date.now() - breaker.openedAt;
        if (elapsed >= this.TIMEOUT_MS) {
          // Transition to HALF_OPEN to allow one probe request
          breaker.state = STATES.HALF_OPEN;
          breaker.halfOpenCalls = 0;
          breaker.successes = 0;
          console.log(`[CircuitBreaker] ${key} → HALF_OPEN (probe allowed)`);
          return true;
        }
        return false;
      }

      case STATES.HALF_OPEN:
        if (breaker.halfOpenCalls < this.HALF_OPEN_MAX_CALLS) {
          breaker.halfOpenCalls++;
          return true;
        }
        // Additional requests during probe: keep rejecting
        return false;

      default:
        return true;
    }
  }

  /**
   * Record a successful backend call.
   * If in HALF_OPEN state, counts successes to decide whether to CLOSE.
   */
  onSuccess(key) {
    const breaker = this._get(key);

    if (breaker.state === STATES.HALF_OPEN) {
      breaker.successes++;
      if (breaker.successes >= this.SUCCESS_THRESHOLD) {
        console.log(`[CircuitBreaker] ${key} → CLOSED (recovered after ${breaker.successes} successes)`);
        breaker.state = STATES.CLOSED;
        breaker.failures = 0;
        breaker.successes = 0;
        breaker.halfOpenCalls = 0;
        breaker.openedAt = null;
      } else {
        // FIX: réinitialiser halfOpenCalls pour permettre le prochain probe
        // Sans ça, le circuit restait bloqué en HALF_OPEN indéfiniment après
        // un premier probe réussi (halfOpenCalls = 1 = HALF_OPEN_MAX_CALLS → tout bloqué)
        breaker.halfOpenCalls = 0;
        console.log(`[CircuitBreaker] ${key} probe ok (${breaker.successes}/${this.SUCCESS_THRESHOLD}), waiting for next probe`);
      }
    } else if (breaker.state === STATES.CLOSED) {
      // Reset failure counter on success in CLOSED state
      breaker.failures = 0;
    }
  }

  /**
   * Record a failed backend call.
   * Increments failure counter and opens the circuit if threshold reached.
   */
  onFailure(key) {
    const breaker = this._get(key);

    if (breaker.state === STATES.HALF_OPEN) {
      // Probe failed → go back to OPEN
      console.log(`[CircuitBreaker] ${key} → OPEN (probe failed)`);
      breaker.state = STATES.OPEN;
      breaker.openedAt = Date.now();
      breaker.halfOpenCalls = 0;
      // Relancer le probe TCP actif
      this._startActiveProbe(key);
      return;
    }

    if (breaker.state === STATES.CLOSED) {
      breaker.failures++;
      breaker.lastFailure = Date.now();

      if (breaker.failures >= this.FAILURE_THRESHOLD) {
        console.warn(`[CircuitBreaker] ${key} → OPEN (${breaker.failures} consecutive failures)`);
        breaker.state = STATES.OPEN;
        breaker.openedAt = Date.now();
        // Démarrer le probe TCP actif pour récupération instantanée
        this._startActiveProbe(key);
      }
    }
  }

  /**
   * Return current state summary for all backends (used by monitoring)
   */
  getStatus() {
    const result = {};
    for (const [key, breaker] of this.breakers) {
      result[key] = {
        state: breaker.state,
        failures: breaker.failures,
        openedAt: breaker.openedAt
      };
    }
    return result;
  }

  /**
   * Manually reset a specific backend's circuit to CLOSED.
   */
  reset(key) {
    const breaker = this._get(key);
    breaker.state = STATES.CLOSED;
    breaker.failures = 0;
    breaker.successes = 0;
    breaker.halfOpenCalls = 0;
    breaker.openedAt = null;
    breaker.lastFailure = null;
    console.log(`[CircuitBreaker] ${key} manually reset to CLOSED`);
  }

  /**
   * Remove breakers that have been CLOSED for a long time with no activity
   */
  _cleanup() {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [key, breaker] of this.breakers) {
      if (
        breaker.state === STATES.CLOSED &&
        breaker.failures === 0 &&
        breaker.lastFailure &&
        now - breaker.lastFailure > staleThreshold
      ) {
        this.breakers.delete(key);
      }
    }
  }
}

export const circuitBreaker = new CircuitBreaker();
