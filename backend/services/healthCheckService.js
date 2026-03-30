/**
 * Health Check Service
 * Pings all active domain backends at a regular interval and records results.
 *
 * - HTTP/HTTPS: HEAD / — any response (even 4xx/5xx) = UP, connection error = DOWN
 * - TCP / Minecraft: net.createConnection — connect success = UP, error = DOWN
 * - UDP: skipped (no protocol to verify)
 */

import http  from 'http';
import https from 'https';
import net   from 'net';
import { database } from './database.js';
import { config   } from '../config/config.js';

// Minimum interval regardless of config (avoid hammering backends)
const MIN_INTERVAL_MS = 30_000; // 30s

function parseBackend(rawUrl, overridePort, defaultProto = 'http', defaultPort = 80) {
  let url;
  try   { url = new URL(rawUrl); }
  catch { url = new URL(`${defaultProto}://${rawUrl}`); }

  const host  = url.hostname;
  const port  = parseInt(
    overridePort || url.port || (url.protocol === 'https:' ? '443' : String(defaultPort)),
    10
  );
  const proto = (url.protocol.replace(':', '') || defaultProto).toLowerCase();
  return { host, port, proto };
}

/**
 * Check one HTTP/HTTPS backend.
 * @returns {{ success: boolean, responseTime: number, statusCode: number|null, error: string|null }}
 */
function checkHttp(host, port, proto, timeoutMs) {
  return new Promise((resolve) => {
    const transport = proto === 'https' ? https : http;
    const start     = Date.now();

    const req = transport.request(
      { hostname: host, port, path: '/', method: 'HEAD', timeout: timeoutMs, rejectUnauthorized: false },
      (res) => {
        res.resume(); // drain
        resolve({
          success:      true,
          responseTime: Date.now() - start,
          statusCode:   res.statusCode,
          error:        null,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success:      false,
        responseTime: Date.now() - start,
        statusCode:   null,
        error:        'timeout',
      });
    });

    req.on('error', (err) => {
      resolve({
        success:      false,
        responseTime: Date.now() - start,
        statusCode:   null,
        error:        err.code || err.message,
      });
    });

    req.end();
  });
}

/**
 * Check one TCP backend.
 */
function checkTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const start  = Date.now();
    let   done   = false;

    const socket = net.createConnection({ host, port });

    // Manual connection-phase timeout (socket 'timeout' only fires on inactivity, not initial connect)
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ success: false, responseTime: Date.now() - start, statusCode: null, error: 'timeout' });
    }, timeoutMs);

    socket.once('connect', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ success: true, responseTime: Date.now() - start, statusCode: null, error: null });
    });

    socket.once('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ success: false, responseTime: Date.now() - start, statusCode: null, error: err.code || err.message });
    });
  });
}

class HealthCheckService {
  constructor() {
    this._timer      = null;
    this._running    = false;
    this._checkCount = 0; // total checks performed, used for cleanup scheduling
  }

  async start() {
    if (this._running) return;
    this._running = true;

    // First check immediately on startup
    await this.runOnce();

    const intervalMs = Math.max(
      config.healthChecks.intervalSeconds * 1000,
      MIN_INTERVAL_MS
    );

    this._timer = setInterval(() => this.runOnce(), intervalMs);
    // Don't block Node exit on this timer
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async runOnce() {
    if (!this._running) return;

    let domains;
    try {
      domains = await database.getAllActiveDomains();
    } catch (err) {
      console.error('[HealthCheck] Failed to fetch domains:', err.message);
      return;
    }

    if (!domains?.length) return;

    const concurrency  = config.healthChecks.concurrency || 10;
    const timeoutMs    = config.healthChecks.timeoutMs    || 10_000;
    const t0           = Date.now();

    // Simple semaphore
    let active  = 0;
    let idx     = 0;
    let checked = 0;

    await new Promise((resolveAll) => {
      const next = () => {
        if (idx >= domains.length && active === 0) {
          resolveAll();
          return;
        }
        while (active < concurrency && idx < domains.length) {
          const domain = domains[idx++];
          active++;
          this._checkDomain(domain, timeoutMs)
            .catch(() => {}) // never throws
            .finally(() => {
              checked++;
              active--;
              next();
            });
        }
      };
      next();
    });

    this._checkCount += checked;

    // Periodic cleanup
    const cleanupEvery = config.healthChecks.cleanupEvery || 100;
    if (this._checkCount >= cleanupEvery) {
      this._checkCount = 0;
      database.cleanOldHealthChecks(100).catch(() => {});
    }

    const elapsed = Date.now() - t0;
    console.log(`[HealthCheck] Checked ${checked} domains in ${elapsed}ms`);
  }

  async _checkDomain(domain, timeoutMs) {
    const proxyType = (domain.proxy_type || 'http').toLowerCase();

    // UDP — not checkable without application protocol
    if (proxyType === 'udp') return;

    const backendUrl  = domain.backend_url  || domain.target_url || '';
    const backendPort = domain.backend_port || null;

    if (!backendUrl) return;

    let result;
    try {
      if (proxyType === 'tcp' || proxyType === 'minecraft') {
        const defaultPort = proxyType === 'minecraft' ? 25565 : 443;
        const { host, port } = parseBackend(backendUrl, backendPort, 'tcp', defaultPort);
        result = await checkTcp(host, port, timeoutMs);
      } else {
        // Determine if backend_url has an explicit scheme
        const hasExplicitScheme = /^https?:\/\//i.test(backendUrl);
        const defaultProto = proxyType === 'https' ? 'https' : 'http';
        const { host, port, proto } = parseBackend(backendUrl, backendPort, defaultProto, 80);
        result = await checkHttp(host, port, proto, timeoutMs);

        // If check failed with a connection/protocol error (not an HTTP error),
        // retry with the opposite scheme — handles backends that only accept HTTPS
        // even when the proxy type is HTTP (e.g. Proxmox, Plesk, MinIO)
        if (!result.success && !hasExplicitScheme) {
          const altProto = proto === 'https' ? 'http' : 'https';
          const altResult = await checkHttp(host, port, altProto, timeoutMs);
          if (altResult.success) result = altResult;
        }
      }
    } catch (err) {
      result = { success: false, responseTime: null, statusCode: null, error: err.message };
    }

    const status = result.success ? 'success' : 'failed';

    console.log(
      `[HealthCheck] ${domain.hostname} (${proxyType}) → ${result.success ? 'UP' : 'DOWN'}`
      + (result.error ? ` [${result.error}]` : '')
      + (result.responseTime != null ? ` ${result.responseTime}ms` : '')
    );

    try {
      await database.recordHealthCheck(
        domain.id,
        status,
        result.responseTime,
        result.statusCode,
        result.error
      );
      await database.upsertDomainHealthStatus(domain.id, status, result.success);
    } catch (err) {
      console.error(`[HealthCheck] DB write failed for domain ${domain.id}:`, err.message);
    }
  }
}

export const healthCheckService = new HealthCheckService();
