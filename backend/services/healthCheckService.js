// @ts-check
/**
 * Health Check Service
 * Pings all active domain backends at a regular interval and records results.
 *
 * - HTTP/HTTPS: HEAD / — any response (even 4xx/5xx) = UP, connection error = DOWN
 * - TCP / Minecraft: net.createConnection — connect success = UP, error = DOWN
 * - UDP: best-effort — UDP is connectionless, so there is no equivalent of a
 *   TCP handshake to confirm anything is listening. We send a small probe
 *   and only treat it as DOWN if the OS delivers back an ICMP port-
 *   unreachable (surfaces as socket 'error', typically ECONNREFUSED) within
 *   the check timeout. No rejection within that window is treated as UP —
 *   a service that silently drops unrecognised packets looks identical to
 *   one that was never reachable at all, so this can't be fully reliable,
 *   only "not actively refusing". Disable via HEALTHCHECK_SKIP_UDP=true.
 */

import http  from 'http';
import https from 'https';
import net   from 'net';
import dgram from 'dgram';
import { database } from './database.js';
import { config   } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { clusterCoordinator } from './clusterCoordinator.js';
import { container } from './container.js';
import { pool } from '../config/database.js';

// Minimum interval — 5s is safe for most setups, avoids hammering backends
// while still allowing fast failover detection.
const MIN_INTERVAL_MS = 5_000;

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

/**
 * Best-effort UDP reachability probe (see module doc comment for caveats).
 * `socket.connect()` on a dgram socket doesn't touch the network — it just
 * tells the OS to route ICMP errors for this destination back to us, so we
 * can tell "definitely refused" apart from "no answer either way".
 */
function checkUdp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    const socket = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');

    const finish = (success, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve({ success, responseTime: Date.now() - start, statusCode: null, error: error || null });
    };

    const timer = setTimeout(() => {
      // No ICMP rejection arrived in time — best we can say is "not
      // actively refused", treated as UP.
      finish(true, null);
    }, timeoutMs);

    socket.once('error', (err) => {
      finish(false, err.code || err.message);
    });

    try {
      socket.connect(port, host, () => {
        socket.send(Buffer.from('nebula-health-check'), (err) => {
          if (err) finish(false, err.code || err.message);
          // else: wait for either 'error' (rejected) or the timeout (assumed up)
        });
      });
    } catch (err) {
      finish(false, err.code || err.message);
    }
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
    // CLUSTER: gate here (not just at the setInterval call site) so both the
    // immediate startup check and every interval tick are covered — running
    // this per-worker would multiply active health-probe traffic against
    // every backend by the worker count.
    if (!clusterCoordinator.isLeader()) return;

    let domains;
    try {
      domains = await database.getAllActiveDomains();
    } catch (err) {
      logger.error('[HealthCheck] Failed to fetch domains:', err.message);
      return;
    }

    // Domain owners can opt a domain out of up/down monitoring entirely —
    // no probes, no health_checks rows, no up/down notifications for it.
    domains = domains?.filter((domain) => domain.health_check_enabled !== false);

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

    const _elapsed = Date.now() - t0;
    // Disabled verbose summary logging to reduce console clutter
    // logger.info(`[HealthCheck] Checked ${checked} domains in ${elapsed}ms`);
  }

  async _checkDomain(domain, timeoutMs) {
    const proxyType = (domain.proxy_type || 'http').toLowerCase();

    // HEALTHCHECK_SKIP_UDP=true opts back out — off by default now that
    // UDP has a (best-effort) check implemented, see checkUdp() above.
    if (proxyType === 'udp' && config.healthChecks.skipUdp) return;

    const backendUrl  = domain.backend_url  || domain.target_url || '';
    const backendPort = domain.backend_port || null;

    if (!backendUrl) return;

    let result;
    try {
      if (proxyType === 'udp') {
        const { host, port } = parseBackend(backendUrl, backendPort, 'udp', 0);
        if (!port) throw new Error('No UDP port configured for this domain');
        result = await checkUdp(host, port, timeoutMs);
      } else if (proxyType === 'tcp' || proxyType === 'minecraft') {
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

    // Disabled verbose health check logging to reduce console clutter
    // Uncomment below to see individual health check results
    // logger.info(
    //   `[HealthCheck] ${domain.hostname} (${proxyType}) → ${result.success ? 'UP' : 'DOWN'}`
    //   + (result.error ? ` [${result.error}]` : '')
    //   + (result.responseTime != null ? ` ${result.responseTime}ms` : '')
    // );

    try {
      const { statusChanged, currentStatus } = await database.upsertDomainHealthStatus(domain.id, status, result.success);

      // Record every check (not just transitions) — /status and /monitoring
      // read the last 10 rows here for uptime%, latency and "last checked",
      // so a transition-only log makes those go stale/misleading between
      // transitions. cleanOldHealthChecks() already prunes this to the last
      // 10 rows per domain, so this stays bounded regardless of interval.
      await database.recordHealthCheck(
        domain.id,
        status,
        result.responseTime,
        result.statusCode,
        result.error
      );

      // Notifications only fire on an actual state transition (UP→DOWN or DOWN→UP) —
      // intermediate failing/succeeding checks that haven't crossed the threshold yet
      // don't page anyone.
      if (statusChanged) {
        this._notifyOwner(domain, result.success, result.error).catch(() => {});
      }
    } catch (err) {
      logger.error({ error: err }, `[HealthCheck] DB write failed for domain ${domain.id}:`);
    }
  }

  async _notifyOwner(domain, isUp, error) {
    if (!container.has('notifications')) return;

    const notifService = container.get('notifications');
    const event    = isUp ? 'domain_up'   : 'domain_down';
    const severity = isUp ? 'success'     : 'error';
    const title    = isUp
      ? `✅ ${domain.hostname} est de nouveau accessible`
      : `🔴 ${domain.hostname} est inaccessible`;
    const message  = isUp
      ? `Le domaine ${domain.hostname} a été rétabli.`
      : `Le domaine ${domain.hostname} ne répond plus${error ? ` (${error})` : ''}.`;

    const notification = { title, message, severity, event, metadata: { domain: domain.hostname } };

    // Collect owner user IDs
    let ownerIds = [];
    if (domain.user_id) {
      ownerIds = [domain.user_id];
    } else if (domain.team_id) {
      try {
        const res = await pool.query('SELECT user_id FROM team_members WHERE team_id = $1', [domain.team_id]);
        ownerIds = res.rows.map(r => r.user_id);
      } catch { /* non-fatal */ }
    }

    if (!ownerIds.length) return;

    // Notify each owner according to their preferences
    const prefCols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user_notification_preferences'`
    ).then(r => new Set(r.rows.map(row => row.column_name))).catch(() => new Set());

    for (const userId of ownerIds) {
      try {
        // Create in-app notification (always)
        await pool.query(
          `INSERT INTO notifications (user_id, action_type, entity_type, entity_id, entity_name, message)
           VALUES ($1, $2, 'domain', $3, $4, $5)`,
          [userId, event, domain.id, domain.hostname, message]
        );

        // Real-time WebSocket push if user is connected
        notifService.websocketManager?.sendToUser(String(userId), notification);

        // Webhook (Discord or generic) if configured
        let prefs = null;
        if (prefCols.has('webhook_enabled')) {
          const row = await pool.query(
            `SELECT webhook_enabled, webhook_url, webhook_secret, domain_down_enabled, domain_up_enabled
             FROM user_notification_preferences WHERE user_id = $1`,
            [userId]
          ).then(r => r.rows[0]).catch(() => null);
          prefs = row;
        } else if (prefCols.has('preferences')) {
          const row = await pool.query(
            'SELECT preferences FROM user_notification_preferences WHERE user_id = $1',
            [userId]
          ).then(r => r.rows[0]).catch(() => null);
          prefs = row?.preferences || null;
        }

        if (prefs?.webhook_enabled && prefs?.webhook_url) {
          const prefKey = isUp ? 'domain_up_enabled' : 'domain_down_enabled';
          if (prefs[prefKey] !== false) {
            await notifService.sendWebhookToTarget(prefs.webhook_url, prefs.webhook_secret || '', notification);
          }
        }
      } catch (err) {
        logger.error(`[HealthCheck] Notification failed for user ${userId}:`, err.message);
      }
    }
  }
}

export const healthCheckService = new HealthCheckService();
