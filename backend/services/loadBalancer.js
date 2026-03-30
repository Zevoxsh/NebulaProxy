/**
 * LoadBalancer - Service for distributing traffic across multiple backends
 *
 * Supports multiple algorithms:
 * - round-robin: Distributes requests evenly in rotation
 * - random: Randomly selects a backend
 * - least-connections: Selects backend with fewest active connections (TODO)
 * - ip-hash: Consistent hashing based on client IP
 */

class LoadBalancer {
  constructor() {
    // Round-robin counters per domain
    this.roundRobinCounters = new Map();

    // Active connections per backend (for least-connections)
    this.activeConnections = new Map();

    // Cache for backends per domain
    this.backendCache = new Map();
    this.CACHE_TTL_MS = 30000; // 30 seconds cache (was 5s — reduces DB calls under load)
  }

  /**
   * DJB2 hash — fast pure-JS alternative to crypto.createHash('md5') for routing
   * ~10x faster than MD5 for short strings like IP addresses
   */
  _djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
      hash = hash >>> 0; // keep unsigned 32-bit
    }
    return hash;
  }

  /**
   * Select a backend for a domain based on its load balancing configuration
   * @param {Object} domain - Domain configuration
   * @param {Array} backends - Array of backend configurations
   * @param {string} clientIp - Client IP address (for ip-hash algorithm)
   * @param {Object} opts - Extra options: { stickyValue } for sticky-session
   * @returns {Object|null} Selected backend or null if none available
   */
  selectBackend(domain, backends, clientIp = null, opts = {}) {
    if (!backends || backends.length === 0) {
      return null;
    }

    // Filter active and healthy backends
    const availableBackends = backends.filter(b => b.is_active !== false);

    if (availableBackends.length === 0) {
      return null;
    }

    // If only one backend, return it directly
    if (availableBackends.length === 1) {
      return availableBackends[0];
    }

    const algorithm = domain.load_balancing_algorithm || 'round-robin';

    switch (algorithm) {
      case 'round-robin':
        return this._roundRobin(domain.id, availableBackends);
      case 'random':
        return this._random(availableBackends);
      case 'ip-hash':
        return this._ipHash(availableBackends, clientIp);
      case 'least-connections':
        return this._leastConnections(availableBackends);
      case 'sticky-session':
        return this._stickySession(availableBackends, opts.stickyValue, clientIp);
      case 'ab-test':
        return this._abTest(availableBackends);
      default:
        return this._roundRobin(domain.id, availableBackends);
    }
  }

  /**
   * Round-robin selection: rotate through backends
   */
  _roundRobin(domainId, backends) {
    let counter = this.roundRobinCounters.get(domainId) || 0;
    const backend = backends[counter % backends.length];
    this.roundRobinCounters.set(domainId, counter + 1);
    return backend;
  }

  /**
   * Random selection
   */
  _random(backends) {
    const index = Math.floor(Math.random() * backends.length);
    return backends[index];
  }

  /**
   * IP-hash selection: consistent routing based on client IP
   * Uses djb2 instead of MD5 — ~10x faster, no crypto overhead
   */
  _ipHash(backends, clientIp) {
    if (!clientIp) {
      return this._random(backends);
    }

    const index = this._djb2Hash(clientIp) % backends.length;
    return backends[index];
  }

  /**
   * Least connections: select backend with fewest active connections
   */
  _leastConnections(backends) {
    let minConnections = Infinity;
    let selectedBackend = backends[0];

    for (const backend of backends) {
      const connections = this.activeConnections.get(backend.id) || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selectedBackend = backend;
      }
    }

    return selectedBackend;
  }

  /**
   * Sticky-session: route to the backend identified by the cookie value.
   * The cookie stores the backend's id (integer) as a string.
   * Falls back to IP hash if the cookie is absent or the backend is gone.
   */
  _stickySession(backends, stickyValue, clientIp) {
    if (stickyValue) {
      const preferred = backends.find(b => String(b.id) === String(stickyValue));
      if (preferred) {
        return preferred;
      }
    }
    // Fallback: IP hash so the same client gets a consistent backend
    return this._ipHash(backends, clientIp);
  }

  /**
   * A/B test: weighted random selection using ab_weight column.
   * Each backend's probability is proportional to its ab_weight.
   * Backends with ab_weight = 0 are excluded from A/B selection.
   */
  _abTest(backends) {
    const pool = backends.filter(b => (b.ab_weight || 50) > 0);
    if (pool.length === 0) return this._random(backends);

    const totalWeight = pool.reduce((sum, b) => sum + (b.ab_weight || 50), 0);
    let rnd = Math.random() * totalWeight;

    for (const backend of pool) {
      rnd -= (backend.ab_weight || 50);
      if (rnd <= 0) {
        return backend;
      }
    }
    return pool[pool.length - 1];
  }

  /**
   * Increment active connections for a backend
   */
  incrementConnections(backendId) {
    const current = this.activeConnections.get(backendId) || 0;
    this.activeConnections.set(backendId, current + 1);
  }

  /**
   * Decrement active connections for a backend
   */
  decrementConnections(backendId) {
    const current = this.activeConnections.get(backendId) || 0;
    this.activeConnections.set(backendId, Math.max(0, current - 1));
  }

  /**
   * Get the backend URL and port for proxying
   * @param {Object} domain - Domain configuration
   * @param {Object} backend - Selected backend (or null to use domain.backend_url)
   * @param {string} defaultProtocol - Default protocol if not specified
   * @returns {Object} { hostname, port }
   */
  getBackendTarget(domain, backend, defaultProtocol = 'http') {
    // If no load balancing or no backend selected, use original domain backend_url
    if (!backend) {
      return this._parseBackendUrl(domain.backend_url, domain.backend_port, defaultProtocol);
    }

    return this._parseBackendUrl(backend.backend_url, backend.backend_port, defaultProtocol);
  }

  /**
   * Parse backend URL to extract hostname and port
   */
  _parseBackendUrl(rawUrl, overridePort, defaultProtocol) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('Invalid backend URL');
    }

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      url = new URL(`${defaultProtocol}://${rawUrl}`);
    }

    const hostname = url.hostname;
    let port;

    if (overridePort) {
      port = parseInt(overridePort);
    } else if (url.port) {
      port = parseInt(url.port);
    } else {
      // Default ports based on protocol
      switch (defaultProtocol) {
        case 'https':
          port = 443;
          break;
        case 'http':
          port = 80;
          break;
        case 'tcp':
          port = 443;
          break;
        case 'udp':
          port = 53;
          break;
        case 'minecraft':
          port = 25565;
          break;
        default:
          port = 80;
      }
    }

    return { hostname, port, protocol: url.protocol };
  }

  /**
   * Reset round-robin counter for a domain
   */
  resetCounter(domainId) {
    this.roundRobinCounters.delete(domainId);
  }

  /**
   * Clear all state (for testing or shutdown)
   */
  clear() {
    this.roundRobinCounters.clear();
    this.activeConnections.clear();
    this.backendCache.clear();
  }
}

// Export singleton instance
export const loadBalancer = new LoadBalancer();
export default loadBalancer;
