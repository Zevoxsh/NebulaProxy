/**
 * Prometheus / OpenMetrics compatible metrics endpoint.
 *
 * GET /metrics
 *
 * Output: text/plain; version=0.0.4  (Prometheus exposition format)
 *
 * Security: protected by an optional bearer token (env METRICS_TOKEN).
 * If METRICS_TOKEN is not set, the endpoint is public — suitable for
 * internal networks. Set it for internet-exposed instances.
 *
 * Scrape config example:
 *   - job_name: nebulaproxy
 *     static_configs:
 *       - targets: ['proxy.example.com:3000']
 *     metrics_path: /metrics
 *     bearer_token: <METRICS_TOKEN>
 */

import { database } from '../services/database.js';
import { monitoringService } from '../services/monitoringService.js';
import { pool } from '../config/database.js';
import { config } from '../config/config.js';

const METRICS_TOKEN = process.env.METRICS_TOKEN || '';

function gauge(name, help, labels, value) {
  if (value == null || isNaN(value)) return '';
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join(',');
  const labelPart = labelStr ? `{${labelStr}}` : '';
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${labelPart} ${value}\n`;
}

function gaugeSet(name, help, rows) {
  if (!rows.length) return '';
  let out = `# HELP ${name} ${help}\n# TYPE ${name} gauge\n`;
  for (const { labels, value } of rows) {
    if (value == null || isNaN(value)) continue;
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
      .join(',');
    out += `${name}{${labelStr}} ${value}\n`;
  }
  return out;
}

export async function metricsRoutes(fastify) {
  fastify.get('/metrics', async (request, reply) => {
    // Token auth (optional)
    if (METRICS_TOKEN) {
      const auth = request.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== METRICS_TOKEN) {
        return reply.code(401).header('WWW-Authenticate', 'Bearer').send('Unauthorized');
      }
    }

    const lines = [];

    // ── System metrics ────────────────────────────────────────────────────────
    try {
      const m = await monitoringService.getSystemMetrics();

      lines.push(gauge(
        'nebula_system_cpu_usage_percent',
        'Current CPU usage percentage (0-100)',
        {},
        parseFloat(m.cpu)
      ));

      if (m.memory?.percentage != null) {
        lines.push(gauge(
          'nebula_system_memory_usage_percent',
          'Current memory usage percentage (0-100)',
          {},
          parseFloat(m.memory.percentage)
        ));
      }

      if (m.disk?.percentage != null) {
        lines.push(gauge(
          'nebula_system_disk_usage_percent',
          'Current disk usage percentage (0-100)',
          {},
          parseFloat(m.disk.percentage)
        ));
      }

      // Uptime in seconds
      try {
        const { rows } = await pool.query("SELECT EXTRACT(EPOCH FROM (NOW() - pg_postmaster_start_time()))::int AS up");
        if (rows[0]?.up) {
          lines.push(gauge('nebula_proxy_uptime_seconds', 'Seconds since the proxy backend started', {}, rows[0].up));
        }
      } catch { /* ignore */ }
    } catch { /* skip system metrics on error */ }

    // ── Domain health ─────────────────────────────────────────────────────────
    try {
      const allDomains = await database.getAllActiveDomains();

      // Counts
      let totalDomains = 0, domainsUp = 0, domainsDown = 0, domainsDegraded = 0;

      const statusRows = [];
      const responseTimeRows = [];
      const uptimeRows = [];

      for (const domain of allDomains) {
        totalDomains++;
        const hs = await database.getDomainHealthStatus(domain.id);
        const latest = await database.getLatestHealthCheck(domain.id);

        let statusVal = 1; // healthy
        if (!domain.is_active) {
          statusVal = 0;
          domainsDown++;
        } else if (hs?.current_status === 'down') {
          statusVal = 0;
          domainsDown++;
        } else if (latest?.response_time > 1000) {
          statusVal = 0.5; // degraded
          domainsDegraded++;
        } else {
          domainsUp++;
        }

        const lbl = { hostname: domain.hostname, proxy_type: domain.proxy_type || 'http' };

        statusRows.push({ labels: lbl, value: statusVal });

        if (latest?.response_time != null) {
          responseTimeRows.push({ labels: lbl, value: latest.response_time });
        }

        // Uptime % from last 10 checks
        const recent = await database.getHealthChecksByDomain(domain.id, 10);
        if (recent.length > 0) {
          const successes = recent.filter(c => c.status === 'success').length;
          uptimeRows.push({ labels: lbl, value: parseFloat(((successes / recent.length) * 100).toFixed(2)) });
        }
      }

      lines.push(gauge('nebula_domains_total',    'Total number of active domains',          {}, totalDomains));
      lines.push(gauge('nebula_domains_up',        'Domains currently healthy',               {}, domainsUp));
      lines.push(gauge('nebula_domains_down',      'Domains currently down',                  {}, domainsDown));
      lines.push(gauge('nebula_domains_degraded',  'Domains with degraded response time',     {}, domainsDegraded));
      lines.push(gaugeSet('nebula_domain_up',           'Domain health (1=up, 0.5=degraded, 0=down)',         statusRows));
      lines.push(gaugeSet('nebula_domain_response_time_ms', 'Latest health check response time in milliseconds', responseTimeRows));
      lines.push(gaugeSet('nebula_domain_uptime_percent',    'Uptime percentage over the last 10 checks',         uptimeRows));
    } catch { /* skip domain metrics on error */ }

    // ── SSL certificates ──────────────────────────────────────────────────────
    try {
      const { rows } = await pool.query(`
        SELECT hostname, ssl_expires_at
        FROM domains
        WHERE is_active = TRUE
          AND ssl_enabled = TRUE
          AND ssl_expires_at IS NOT NULL
      `);

      const sslRows = rows.map(r => {
        const days = Math.floor((new Date(r.ssl_expires_at) - Date.now()) / 86400000);
        return { labels: { hostname: r.hostname }, value: days };
      });

      lines.push(gaugeSet('nebula_ssl_expires_in_days', 'Days until SSL certificate expiry (negative = expired)', sslRows));
    } catch { /* skip */ }

    // ── Request throughput (last hour from DB) ────────────────────────────────
    try {
      const { rows } = await pool.query(`
        SELECT d.hostname, COUNT(*) AS requests
        FROM request_logs rl
        JOIN domains d ON d.id = rl.domain_id
        WHERE rl.created_at > NOW() - INTERVAL '1 hour'
        GROUP BY d.hostname
      `);

      lines.push(gaugeSet(
        'nebula_domain_requests_last_hour',
        'Number of proxied requests in the last 60 minutes',
        rows.map(r => ({ labels: { hostname: r.hostname }, value: parseInt(r.requests, 10) }))
      ));
    } catch { /* skip */ }

    const body = lines.filter(Boolean).join('');

    reply
      .code(200)
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(body);
  });
}
