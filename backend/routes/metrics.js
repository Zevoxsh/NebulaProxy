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

import { pool } from '../config/database.js';
import { monitoringService } from '../services/monitoringService.js';

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

    reply
      .code(200)
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(out.filter(Boolean).join(''));
  });
}
