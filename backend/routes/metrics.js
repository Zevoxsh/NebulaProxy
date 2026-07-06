// @ts-check
/**
 * Prometheus / OpenMetrics compatible metrics endpoint.
 *
 * GET /metrics
 *
 * Output: text/plain; version=0.0.4  (Prometheus exposition format)
 *
 * Security: protected by an optional bearer token (env METRICS_TOKEN).
 * If METRICS_TOKEN is not set the endpoint is public — fine for internal
 * networks. Set it for internet-exposed instances.
 *
 * Scrape config example (prometheus.yml):
 *   - job_name: nebulaproxy
 *     static_configs:
 *       - targets: ['proxy.example.com:3000']
 *     metrics_path: /metrics
 *     bearer_token: <METRICS_TOKEN>
 */

import { pool, getPgPool } from '../config/database.js';
import { monitoringService } from '../services/monitoringService.js';
import { eventLoopMonitor } from '../services/eventLoopMonitor.js';
import { proxyMetrics } from '../services/proxyMetrics.js';
import { circuitBreaker } from '../services/circuitBreaker.js';
import { httpKeepAliveAgent, httpsKeepAliveAgent } from '../services/proxy/http/requestProxy.js';

const METRICS_TOKEN    = process.env.METRICS_TOKEN || '';
// Allow 1 scrape per 10s per IP (Prometheus default interval is 15s).
// Prevents the LATERAL-JOIN SQL query from being used as a DoS vector.
const SCRAPE_WINDOW_MS = 10_000;
const scrapeLastSeen   = new Map(); // ip → timestamp

function isRateLimited(ip) {
  const now  = Date.now();
  const last = scrapeLastSeen.get(ip) ?? 0;
  if (now - last < SCRAPE_WINDOW_MS) return true;
  scrapeLastSeen.set(ip, now);
  // Prune old entries every ~100 requests so the Map doesn't grow forever
  if (scrapeLastSeen.size > 500) {
    for (const [k, v] of scrapeLastSeen) {
      if (now - v > SCRAPE_WINDOW_MS * 6) scrapeLastSeen.delete(k);
    }
  }
  return false;
}

// ── Prometheus text-format helpers ────────────────────────────────────────────

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(obj) {
  const pairs = Object.entries(obj).map(([k, v]) => `${k}="${esc(v)}"`).join(',');
  return pairs ? `{${pairs}}` : '';
}

function gaugeHead(name, help, type = 'gauge') {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n`;
}

function line(name, lbl, value) {
  if (value == null || (typeof value === 'number' && isNaN(value))) return '';
  return `${name}${labels(lbl)} ${value}\n`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function metricsRoutes(fastify) {
  fastify.get('/metrics', async (request, reply) => {

    // Optional bearer token auth
    if (METRICS_TOKEN) {
      const auth = (request.headers.authorization || '');
      if (auth.slice(7) !== METRICS_TOKEN) {
        return reply.code(401).header('WWW-Authenticate', 'Bearer').send('Unauthorized');
      }
    }

    // Rate limit: 1 scrape per 10s per source IP
    const clientIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || request.ip
      || 'unknown';
    if (isRateLimited(clientIp)) {
      return reply
        .code(429)
        .header('Retry-After', '10')
        .header('Content-Type', 'text/plain; version=0.0.4')
        .send('# Too many requests — wait 10s between scrapes\n');
    }

    const out = [];

    // ── 1. System metrics (non-blocking) ─────────────────────────────────────
    try {
      const m = await monitoringService.getSystemMetrics();

      out.push(
        gaugeHead('nebula_system_cpu_usage_percent', 'CPU usage %'),
        line('nebula_system_cpu_usage_percent', {}, parseFloat(m.cpu) || 0)
      );

      if (m.memory?.percentage != null) {
        out.push(
          gaugeHead('nebula_system_memory_usage_percent', 'Memory usage %'),
          line('nebula_system_memory_usage_percent', {}, parseFloat(m.memory.percentage))
        );
      }

      if (m.disk?.percentage != null) {
        out.push(
          gaugeHead('nebula_system_disk_usage_percent', 'Disk usage %'),
          line('nebula_system_disk_usage_percent', {}, parseFloat(m.disk.percentage))
        );
      }
    } catch { /* skip if monitoring service fails */ }

    // ── 1.5. Event loop lag — per-process (see cluster note below) ───────────
    // Rises before request latency does for any CPU-bound stall (large sync
    // JSON, big regex, GC pressure) — the earliest cheap signal a worker is
    // starting to degrade, well before it's bad enough to fail a healthcheck.
    // NOTE: with CLUSTER_ENABLED, this reflects only whichever worker
    // happened to answer this particular scrape (shared port, SCHED_NONE) —
    // not a cluster-wide aggregate. Watch for it looking suspiciously good
    // if you know a worker is struggling; you may be scraping its healthy
    // sibling instead.
    {
      const elStats = eventLoopMonitor.getStats();
      if (elStats) {
        out.push(
          gaugeHead('nebula_eventloop_lag_ms', 'Event loop lag in ms (this worker only)'),
          line('nebula_eventloop_lag_ms', { stat: 'mean' }, elStats.mean),
          line('nebula_eventloop_lag_ms', { stat: 'p50' },  elStats.p50),
          line('nebula_eventloop_lag_ms', { stat: 'p95' },  elStats.p95),
          line('nebula_eventloop_lag_ms', { stat: 'p99' },  elStats.p99),
          line('nebula_eventloop_lag_ms', { stat: 'max' },  elStats.max)
        );
      }
    }

    // ── 1.6. Postgres pool — pg.Pool already tracks these, just read them ────
    // A saturating pool (waitingCount rising, idleCount near 0) shows up
    // today only as unexplained latency creep — nothing pointed at the pool
    // itself as the cause.
    try {
      const pgPool = getPgPool();
      out.push(
        gaugeHead('nebula_pg_pool_total',   'Total PostgreSQL pool connections (in use + idle)'),
        line('nebula_pg_pool_total',   {}, pgPool.totalCount),
        gaugeHead('nebula_pg_pool_idle',    'Idle PostgreSQL pool connections'),
        line('nebula_pg_pool_idle',    {}, pgPool.idleCount),
        gaugeHead('nebula_pg_pool_waiting', 'Queries waiting for a free PostgreSQL connection'),
        line('nebula_pg_pool_waiting', {}, pgPool.waitingCount)
      );
    } catch { /* skip if pool not initialized (e.g. non-postgresql DB_TYPE) */ }

    // ── 2. Domain metrics — ONE query instead of N×3 ─────────────────────────
    try {
      const { rows } = await pool.query(`
        SELECT
          d.id,
          d.hostname,
          COALESCE(d.proxy_type, 'http')  AS proxy_type,
          d.ssl_enabled,
          d.ssl_expires_at,
          hs.current_status,
          lc.response_time                AS latest_response_time,
          COALESCE(rc.success_count, 0)   AS success_count,
          COALESCE(rc.total_count,   0)   AS total_count
        FROM domains d
        LEFT JOIN domain_health_status hs
               ON hs.domain_id = d.id
        LEFT JOIN LATERAL (
          SELECT response_time
          FROM   domain_health_checks
          WHERE  domain_id = d.id
          ORDER  BY checked_at DESC
          LIMIT  1
        ) lc ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE status = 'success') AS success_count,
            COUNT(*)                                    AS total_count
          FROM (
            SELECT status
            FROM   domain_health_checks
            WHERE  domain_id = d.id
            ORDER  BY checked_at DESC
            LIMIT  10
          ) r
        ) rc ON true
        WHERE d.is_active = TRUE
      `);

      let totalUp = 0, totalDown = 0, totalDegraded = 0;

      out.push(
        gaugeHead('nebula_domain_up',
          'Domain health: 1=healthy, 0.5=degraded (response_time>1s), 0=down'),
        gaugeHead('nebula_domain_response_time_ms',
          'Latest health-check response time in milliseconds'),
        gaugeHead('nebula_domain_uptime_percent',
          'Uptime percentage over the last 10 health checks')
      );

      for (const r of rows) {
        const lbl = { hostname: r.hostname, proxy_type: r.proxy_type };

        let statusVal = 1;
        if (r.current_status === 'down') {
          statusVal = 0;
          totalDown++;
        } else if (r.latest_response_time > 1000) {
          statusVal = 0.5;
          totalDegraded++;
        } else {
          totalUp++;
        }

        out.push(line('nebula_domain_up', lbl, statusVal));

        if (r.latest_response_time != null) {
          out.push(line('nebula_domain_response_time_ms', lbl, r.latest_response_time));
        }

        if (r.total_count > 0) {
          const pct = parseFloat(((r.success_count / r.total_count) * 100).toFixed(2));
          out.push(line('nebula_domain_uptime_percent', lbl, pct));
        }
      }

      out.push(
        gaugeHead('nebula_domains_total',   'Total active domains'),
        line('nebula_domains_total',   {}, rows.length),
        gaugeHead('nebula_domains_up',      'Domains currently healthy'),
        line('nebula_domains_up',      {}, totalUp),
        gaugeHead('nebula_domains_down',    'Domains currently down'),
        line('nebula_domains_down',    {}, totalDown),
        gaugeHead('nebula_domains_degraded','Domains with degraded response time'),
        line('nebula_domains_degraded', {}, totalDegraded)
      );

      // SSL expiry
      const sslRows = rows.filter(r => r.ssl_enabled && r.ssl_expires_at);
      if (sslRows.length) {
        out.push(gaugeHead('nebula_ssl_expires_in_days',
          'Days until SSL certificate expiry (negative = expired)'));
        for (const r of sslRows) {
          const days = Math.floor((new Date(r.ssl_expires_at) - Date.now()) / 86_400_000);
          out.push(line('nebula_ssl_expires_in_days', { hostname: r.hostname }, days));
        }
      }
    } catch { /* skip domain metrics on DB error */ }

    // ── 3. Request throughput — single aggregate query ────────────────────────
    try {
      const { rows } = await pool.query(`
        SELECT d.hostname, COUNT(*) AS requests
        FROM   request_logs rl
        JOIN   domains d ON d.id = rl.domain_id
        WHERE  rl.created_at > NOW() - INTERVAL '1 hour'
        GROUP  BY d.hostname
      `);

      if (rows.length) {
        out.push(gaugeHead('nebula_domain_requests_last_hour',
          'HTTP requests proxied in the last 60 minutes'));
        for (const r of rows) {
          out.push(line('nebula_domain_requests_last_hour',
            { hostname: r.hostname }, parseInt(r.requests, 10)));
        }
      }
    } catch { /* skip */ }

    // ── 4. Proxy hot-path metrics — real proxied traffic, not health probes ──
    // (per-process; see the cluster note on the event loop section above)
    try {
      const pm = proxyMetrics.snapshot();

      out.push(gaugeHead('nebula_proxy_responses_total', 'Proxied responses by status class (this worker only)', 'counter'));
      for (const [statusClass, count] of Object.entries(pm.statusClasses)) {
        out.push(line('nebula_proxy_responses_total', { status_class: statusClass }, count));
      }

      out.push(
        gaugeHead('nebula_proxy_retries_total', 'Times a request was retried against a different backend after a connect-level error', 'counter'),
        line('nebula_proxy_retries_total', {}, pm.retries),
        gaugeHead('nebula_proxy_upstream_errors_total', 'Requests that ended in a final upstream error (502)', 'counter'),
        line('nebula_proxy_upstream_errors_total', {}, pm.upstreamErrors),
        gaugeHead('nebula_proxy_circuit_breaker_rejects_total', 'Requests fast-failed (503) because a backend circuit breaker was open', 'counter'),
        line('nebula_proxy_circuit_breaker_rejects_total', {}, pm.circuitBreakerRejects)
      );
    } catch { /* skip */ }

    // ── 5. Circuit breaker state per backend ─────────────────────────────────
    try {
      const statuses = circuitBreaker.getStatus();
      const keys = Object.keys(statuses);
      if (keys.length) {
        out.push(gaugeHead('nebula_circuit_breaker_state',
          'Circuit breaker state per backend: 0=closed, 1=half_open, 2=open'));
        const STATE_VAL = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 };
        let openCount = 0;
        for (const [key, s] of Object.entries(statuses)) {
          out.push(line('nebula_circuit_breaker_state', { backend: key }, STATE_VAL[s.state] ?? 0));
          if (s.state === 'OPEN') openCount++;
        }
        out.push(
          gaugeHead('nebula_circuit_breakers_open', 'Number of backends with an OPEN circuit breaker right now'),
          line('nebula_circuit_breakers_open', {}, openCount)
        );
      }
    } catch { /* skip */ }

    // ── 6. Keep-alive connection pool usage (per backend host:port) ──────────
    try {
      const sumLen = (obj) => Object.values(obj || {}).reduce((s, arr) => s + (arr?.length || 0), 0);
      const httpStats  = { active: sumLen(httpKeepAliveAgent.sockets),  free: sumLen(httpKeepAliveAgent.freeSockets),  pending: sumLen(httpKeepAliveAgent.requests) };
      const httpsStats = { active: sumLen(httpsKeepAliveAgent.sockets), free: sumLen(httpsKeepAliveAgent.freeSockets), pending: sumLen(httpsKeepAliveAgent.requests) };

      out.push(gaugeHead('nebula_proxy_keepalive_sockets', 'Keep-alive agent sockets to backends (this worker only)'));
      for (const [state, val] of Object.entries(httpStats)) {
        out.push(line('nebula_proxy_keepalive_sockets', { agent: 'http', state }, val));
      }
      for (const [state, val] of Object.entries(httpsStats)) {
        out.push(line('nebula_proxy_keepalive_sockets', { agent: 'https', state }, val));
      }
    } catch { /* skip */ }

    reply
      .code(200)
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(out.filter(Boolean).join(''));
  });
}
