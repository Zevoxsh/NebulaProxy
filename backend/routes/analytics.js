import { database }             from '../services/database.js';
import { redisService }         from '../services/redis.js';
import { trafficStatsService }  from '../services/trafficStatsService.js';

/**
 * Build a time-range start date from the timeRange query parameter.
 */
function buildStartDate(timeRange) {
  const now   = new Date();
  const start = new Date();
  switch (timeRange) {
    case '1h':  start.setHours(now.getHours() - 1);   break;
    case '24h': start.setDate(now.getDate()   - 1);   break;
    case '7d':  start.setDate(now.getDate()   - 7);   break;
    case '30d': start.setDate(now.getDate()   - 30);  break;
    default:    start.setDate(now.getDate()   - 1);
  }
  return start;
}

/** Format bytes to a human-readable string */
function formatBandwidth(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + ' KB';
  return bytes + ' B';
}

/** Cache TTL in seconds based on time range */
function cacheTTL(timeRange) {
  switch (timeRange) {
    case '1h':  return 30;
    case '24h': return 120;
    case '7d':  return 600;
    case '30d': return 1800;
    default:    return 120;
  }
}

/**
 * Try to read from Redis cache; if miss, compute and store.
 * Falls back to plain fn() if Redis is unavailable.
 */
async function withCache(cacheKey, ttl, fn) {
  const client = redisService.isConnected ? redisService.getClient() : null;
  if (client) {
    try {
      const cached = await client.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (_) { /* cache miss – continue */ }
  }

  const result = await fn();

  if (client) {
    try {
      await client.setex(cacheKey, ttl, JSON.stringify(result));
    } catch (_) {}
  }

  return result;
}

export async function analyticsRoutes(fastify, options) {

  // ────────────────── GET /stats ──────────────────
  fastify.get('/stats', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId    = request.user.id;
        const { timeRange = '24h' } = request.query;
        const cacheKey  = `analytics:stats:${userId}:${timeRange}`;

        return await withCache(cacheKey, cacheTTL(timeRange), async () => {
          const startDate = buildStartDate(timeRange);

          const userDomains = await database.getDomainsByUserId(userId);
          const domainIds   = userDomains.map(d => d.id);

          if (domainIds.length === 0) {
            return {
              totalRequests: 0, bandwidth: 0, bandwidthFormatted: '0 B',
              avgResponseTime: 0, uptime: 100, activeConnections: 0,
              errorRate: 0, timeRange
            };
          }

          const stats = await database.queryOne(`
            SELECT
              COUNT(*)                              AS total_requests,
              SUM(COALESCE(response_size, 0))       AS total_bytes,
              AVG(response_time)                    AS avg_response_time,
              COUNT(*) FILTER (WHERE status_code >= 500) AS error_requests
            FROM request_logs
            WHERE domain_id = ANY(?)
              AND created_at >= ?
          `, [domainIds, startDate.toISOString()]);

          const totalRequests = Number(stats?.total_requests || 0);
          const totalBytes    = Number(stats?.total_bytes    || 0);
          const avgRT         = Math.round(Number(stats?.avg_response_time || 0));
          const errorRequests = Number(stats?.error_requests || 0);
          const errorRate     = totalRequests > 0
            ? parseFloat(((errorRequests / totalRequests) * 100).toFixed(2))
            : 0;

          const rangeSeconds  = (Date.now() - startDate.getTime()) / 1000;
          const uptimeSeconds = Math.min(process.uptime(), rangeSeconds);
          const uptime        = rangeSeconds > 0
            ? parseFloat(((uptimeSeconds / rangeSeconds) * 100).toFixed(3))
            : 100;

          const activeConnections = (await database.getAllActiveDomains()).length;

          return {
            totalRequests, bandwidth: totalBytes,
            bandwidthFormatted: formatBandwidth(totalBytes),
            avgResponseTime: avgRT, uptime, activeConnections, errorRate, timeRange
          };
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting analytics stats');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ────────────────── GET /traffic ──────────────────
  fastify.get('/traffic', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId   = request.user.id;
        const { timeRange = '24h' } = request.query;
        const cacheKey = `analytics:traffic:${userId}:${timeRange}`;

        return await withCache(cacheKey, cacheTTL(timeRange), async () => {
          const userDomains = await database.getDomainsByUserId(userId);
          const domainIds   = userDomains.map(d => d.id);

          if (domainIds.length === 0) return { data: [] };

          let intervals = 24, intervalMinutes = 60;
          switch (timeRange) {
            case '1h':  intervals = 12; intervalMinutes = 5;    break;
            case '24h': intervals = 24; intervalMinutes = 60;   break;
            case '7d':  intervals = 14; intervalMinutes = 720;  break;
            case '30d': intervals = 15; intervalMinutes = 2880; break;
          }

          const now         = new Date();
          const trafficData = [];

          for (let i = intervals - 1; i >= 0; i--) {
            const endTime   = new Date(now.getTime() - (i * intervalMinutes * 60 * 1000));
            const startTime = new Date(endTime.getTime() - (intervalMinutes * 60 * 1000));

            const row = await database.queryOne(`
              SELECT
                COUNT(*)                        AS req_count,
                SUM(COALESCE(response_size, 0)) AS bytes
              FROM request_logs
              WHERE domain_id = ANY(?)
                AND created_at >= ? AND created_at < ?
            `, [domainIds, startTime.toISOString(), endTime.toISOString()]);

            trafficData.push({
              time:      endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
              requests:  Number(row?.req_count || 0),
              bandwidth: Number(row?.bytes     || 0),
              bandwidthFormatted: formatBandwidth(Number(row?.bytes || 0))
            });
          }

          return { data: trafficData };
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting traffic data');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ────────────────── GET /top-domains ──────────────────
  fastify.get('/top-domains', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId   = request.user.id;
        const { timeRange = '24h', limit = 10 } = request.query;
        const cacheKey = `analytics:top-domains:${userId}:${timeRange}:${limit}`;

        return await withCache(cacheKey, cacheTTL(timeRange), async () => {
          const startDate   = buildStartDate(timeRange);
          const userDomains = await database.getDomainsByUserId(userId);
          const domainIds   = userDomains.map(d => d.id);

          if (domainIds.length === 0) return { domains: [] };

          const domainStats = await database.queryAll(`
            SELECT
              hostname,
              COUNT(*)                              AS requests,
              SUM(COALESCE(response_size, 0))       AS bytes,
              AVG(response_time)                    AS avg_response_time,
              COUNT(*) FILTER (WHERE status_code >= 400) AS errors
            FROM request_logs
            WHERE domain_id = ANY(?)
              AND created_at >= ?
            GROUP BY hostname
            ORDER BY requests DESC
            LIMIT ?
          `, [domainIds, startDate.toISOString(), parseInt(limit, 10)]);

          return {
            domains: domainStats.map(d => ({
              domain:    d.hostname,
              requests:  Number(d.requests || 0),
              bytes:     Number(d.bytes    || 0),
              bandwidth: formatBandwidth(Number(d.bytes || 0)),
              avgTime:   Math.round(Number(d.avg_response_time || 0)),
              errors:    Number(d.errors   || 0)
            }))
          };
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting top domains');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ────────────────── GET /top-ips ──────────────────
  fastify.get('/top-ips', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId   = request.user.id;
        const { timeRange = '24h', limit = 20 } = request.query;
        const cacheKey = `analytics:top-ips:${userId}:${timeRange}:${limit}`;

        return await withCache(cacheKey, cacheTTL(timeRange), async () => {
          const startDate   = buildStartDate(timeRange);
          const userDomains = await database.getDomainsByUserId(userId);
          const domainIds   = userDomains.map(d => d.id);

          if (domainIds.length === 0) return { ips: [] };

          const rows = await database.queryAll(`
            SELECT
              ip_address,
              COUNT(*)                              AS requests,
              SUM(COALESCE(response_size, 0))       AS bytes,
              COUNT(*) FILTER (WHERE status_code >= 400) AS errors
            FROM request_logs
            WHERE domain_id = ANY(?)
              AND created_at >= ?
              AND ip_address IS NOT NULL
            GROUP BY ip_address
            ORDER BY requests DESC
            LIMIT ?
          `, [domainIds, startDate.toISOString(), parseInt(limit, 10)]);

          return {
            ips: rows.map(r => ({
              ip:       r.ip_address,
              requests: Number(r.requests || 0),
              bytes:    Number(r.bytes    || 0),
              errors:   Number(r.errors   || 0)
            }))
          };
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting top IPs');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ────────────────── GET /top-paths ──────────────────
  fastify.get('/top-paths', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId   = request.user.id;
        const { timeRange = '24h', limit = 20 } = request.query;
        const cacheKey = `analytics:top-paths:${userId}:${timeRange}:${limit}`;

        return await withCache(cacheKey, cacheTTL(timeRange), async () => {
          const startDate   = buildStartDate(timeRange);
          const userDomains = await database.getDomainsByUserId(userId);
          const domainIds   = userDomains.map(d => d.id);

          if (domainIds.length === 0) return { paths: [] };

          const rows = await database.queryAll(`
            SELECT
              path,
              method,
              COUNT(*)                              AS requests,
              AVG(response_time)                    AS avg_response_time,
              COUNT(*) FILTER (WHERE status_code >= 400) AS errors
            FROM request_logs
            WHERE domain_id = ANY(?)
              AND created_at >= ?
            GROUP BY path, method
            ORDER BY requests DESC
            LIMIT ?
          `, [domainIds, startDate.toISOString(), parseInt(limit, 10)]);

          return {
            paths: rows.map(r => ({
              path:     r.path,
              method:   r.method,
              requests: Number(r.requests || 0),
              avgTime:  Math.round(Number(r.avg_response_time || 0)),
              errors:   Number(r.errors   || 0)
            }))
          };
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting top paths');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ────────────────── GET /status-codes ──────────────────
  fastify.get('/status-codes', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId   = request.user.id;
        const { timeRange = '24h' } = request.query;
        const cacheKey = `analytics:status-codes:${userId}:${timeRange}`;

        return await withCache(cacheKey, cacheTTL(timeRange), async () => {
          const startDate   = buildStartDate(timeRange);
          const userDomains = await database.getDomainsByUserId(userId);
          const domainIds   = userDomains.map(d => d.id);

          if (domainIds.length === 0) {
            return { distribution: [], groups: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 } };
          }

          const rows = await database.queryAll(`
            SELECT
              status_code,
              COUNT(*) AS count
            FROM request_logs
            WHERE domain_id = ANY(?)
              AND created_at >= ?
              AND status_code IS NOT NULL
            GROUP BY status_code
            ORDER BY status_code
          `, [domainIds, startDate.toISOString()]);

          const groups = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
          const distribution = rows.map(r => {
            const code  = Number(r.status_code);
            const count = Number(r.count || 0);
            if      (code >= 200 && code < 300) groups['2xx'] += count;
            else if (code >= 300 && code < 400) groups['3xx'] += count;
            else if (code >= 400 && code < 500) groups['4xx'] += count;
            else if (code >= 500)               groups['5xx'] += count;
            return { code, count };
          });

          return { distribution, groups };
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting status code distribution');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ────────────────── GET /top-user-agents ──────────────────
  fastify.get('/top-user-agents', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId   = request.user.id;
        const { timeRange = '24h', limit = 15 } = request.query;
        const cacheKey = `analytics:top-user-agents:${userId}:${timeRange}:${limit}`;

        return await withCache(cacheKey, cacheTTL(timeRange), async () => {
          const startDate   = buildStartDate(timeRange);
          const userDomains = await database.getDomainsByUserId(userId);
          const domainIds   = userDomains.map(d => d.id);

          if (domainIds.length === 0) return { agents: [] };

          const rows = await database.queryAll(`
            SELECT
              COALESCE(user_agent, 'Unknown') AS agent,
              COUNT(*) AS requests
            FROM request_logs
            WHERE domain_id = ANY(?)
              AND created_at >= ?
            GROUP BY agent
            ORDER BY requests DESC
            LIMIT ?
          `, [domainIds, startDate.toISOString(), parseInt(limit, 10)]);

          return {
            agents: rows.map(r => ({
              agent:    r.agent,
              requests: Number(r.requests || 0)
            }))
          };
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting top user agents');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ────────────────── GET /realtime-history (Redis) ──────────────────
  // Returns the last 60 seconds of per-second request counts, keyed by domainId.
  // Used by the Live Traffic page to pre-populate the chart after a page refresh.
  fastify.get('/realtime-history', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId      = request.user.id;
        const userDomains = await database.getDomainsByUserId(userId);
        const domainIds   = userDomains.map(d => d.id);

        const history = await trafficStatsService.getRealtimeHistory(domainIds);
        return { history };
      } catch (error) {
        fastify.log.error({ error }, 'Error getting realtime history');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ────────────────── GET /traffic-24h (Redis) ──────────────────
  // Returns the last 24h of per-hour request counts (aggregated across all domains).
  // Used by the Live Traffic page to display a persistent 24h chart.
  fastify.get('/traffic-24h', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId      = request.user.id;
        const userDomains = await database.getDomainsByUserId(userId);
        const domainIds   = userDomains.map(d => d.id);

        const data = await trafficStatsService.get24hHistory(domainIds);
        return { data };
      } catch (error) {
        fastify.log.error({ error }, 'Error getting 24h traffic history');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });
}
