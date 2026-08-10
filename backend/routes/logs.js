// @ts-check
import { database } from '../services/database.js';
import { escapeLikePattern } from '../utils/security.js';

export async function logsRoutes(fastify, _options) {
  // Get proxy logs
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { limit = 100, offset = 0, level = null, search = '' } = request.query;

        // Get user's domains
        const userDomains = await database.getDomainsByUserId(userId);
        const domainIds = userDomains.map(d => d.id);

        if (domainIds.length === 0) {
          return { logs: [], total: 0 };
        }

        // Build query
        let query = `
          SELECT * FROM proxy_logs
          WHERE domain_id = ANY(?)
        `;
        const params = [domainIds];

        if (level) {
          query += ` AND level = ?`;
          params.push(level);
        }

        if (search) {
          const escapedSearch = escapeLikePattern(search);
          query += ` AND (hostname LIKE ? OR path LIKE ? OR ip_address LIKE ?)`;
          params.push(`%${escapedSearch}%`, `%${escapedSearch}%`, `%${escapedSearch}%`);
        }

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit, 10), parseInt(offset, 10));

        const logs = await database.queryAll(query, params);

        // Get total count
        let countQuery = `
          SELECT COUNT(*) as total FROM proxy_logs
          WHERE domain_id = ANY(?)
        `;
        const countParams = [domainIds];

        if (level) {
          countQuery += ` AND level = ?`;
          countParams.push(level);
        }

        if (search) {
          const escapedSearch = escapeLikePattern(search);
          countQuery += ` AND (hostname LIKE ? OR path LIKE ? OR ip_address LIKE ?)`;
          countParams.push(`%${escapedSearch}%`, `%${escapedSearch}%`, `%${escapedSearch}%`);
        }

        const { total } = await database.queryOne(countQuery, countParams) || { total: 0 };

        // Format logs
        const formattedLogs = logs.map(log => ({
          id: log.id,
          timestamp: new Date(log.created_at),
          level: log.level,
          domain: log.hostname,
          method: log.method,
          path: log.path,
          status: log.status,
          responseTime: log.response_time,
          ip: log.ip_address
        }));

        return {
          logs: formattedLogs,
          total: Number(total || 0)
        };
      } catch (error) {
        fastify.log.error({ error }, 'Error getting logs');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Get log statistics
  fastify.get('/stats', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;

        // Get user's domains
        const userDomains = await database.getDomainsByUserId(userId);
        const domainIds = userDomains.map(d => d.id);

        if (domainIds.length === 0) {
          return {
            total: 0,
            success: 0,
            info: 0,
            warning: 0,
            error: 0
          };
        }

        // Get stats by level
        const stats = await database.queryAll(`
          SELECT
            level,
            COUNT(*) as count
          FROM proxy_logs
          WHERE domain_id = ANY(?)
          GROUP BY level
        `, [domainIds]);

        const result = {
          total: 0,
          success: 0,
          info: 0,
          warning: 0,
          error: 0
        };

        stats.forEach(stat => {
          const count = Number(stat.count || 0);
          result[stat.level] = count;
          result.total += count;
        });

        return result;
      } catch (error) {
        fastify.log.error({ error }, 'Error getting log stats');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Cross-domain activity log (request_logs)
  fastify.get('/activity', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const {
          domainId,
          method,
          statusRange,
          startDate,
          search,
          limit = 200,
          offset = 0
        } = request.query;

        const userDomains = await database.getDomainsByUserIdWithTeams(userId);
        const domainIds = userDomains.map(d => d.id);

        if (domainIds.length === 0) {
          return reply.send({ logs: [], total: 0, domains: [] });
        }

        const safeLimit  = Math.min(Math.max(parseInt(limit,  10) || 200, 1), 500);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        // Default time window: last 24h
        const effectiveStart = startDate || new Date(Date.now() - 86400000).toISOString();

        const params = [domainIds];
        const countParams = [domainIds];
        let where = 'WHERE rl.domain_id = ANY(?)';

        if (domainId) {
          where += ' AND rl.domain_id = ?';
          params.push(parseInt(domainId, 10));
          countParams.push(parseInt(domainId, 10));
        }

        if (method) {
          where += ' AND rl.method = ?';
          params.push(method.toUpperCase());
          countParams.push(method.toUpperCase());
        }

        if (statusRange) {
          switch (statusRange) {
            case '2xx': where += ' AND rl.status_code >= 200 AND rl.status_code < 300'; break;
            case '3xx': where += ' AND rl.status_code >= 300 AND rl.status_code < 400'; break;
            case '4xx': where += ' AND rl.status_code >= 400 AND rl.status_code < 500'; break;
            case '5xx': where += ' AND rl.status_code >= 500'; break;
            case 'errors': where += ' AND rl.status_code >= 400'; break;
          }
        }

        where += ' AND rl.timestamp >= ?';
        params.push(effectiveStart);
        countParams.push(effectiveStart);

        if (search) {
          const s = escapeLikePattern(search);
          where += ' AND (rl.path ILIKE ? OR rl.ip_address ILIKE ?)';
          params.push(`%${s}%`, `%${s}%`);
          countParams.push(`%${s}%`, `%${s}%`);
        }

        const [logs, countRow] = await Promise.all([
          database.queryAll(
            `SELECT rl.id, rl.domain_id, rl.hostname, rl.method, rl.path,
                    rl.status_code, rl.response_time, rl.response_size,
                    rl.ip_address, rl.country, rl.error_message, rl.timestamp
             FROM request_logs rl ${where}
             ORDER BY rl.timestamp DESC LIMIT ? OFFSET ?`,
            [...params, safeLimit, safeOffset]
          ),
          database.queryOne(
            `SELECT COUNT(*) as total FROM request_logs rl ${where}`,
            countParams
          )
        ]);

        return reply.send({
          logs,
          total: Number(countRow?.total || 0),
          domains: userDomains.map(d => ({ id: d.id, hostname: d.hostname }))
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting activity logs');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Cross-domain health events
  fastify.get('/health-events', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const {
          domainId,
          status,
          startDate,
          transitionsOnly = 'false',
          limit = 200,
          offset = 0
        } = request.query;

        const userDomains = await database.getDomainsByUserIdWithTeams(userId);
        const domainIds = userDomains.map(d => d.id);

        if (domainIds.length === 0) {
          return reply.send({ events: [], total: 0 });
        }

        const safeLimit  = Math.min(Math.max(parseInt(limit,  10) || 200, 1), 500);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
        const onlyTransitions = transitionsOnly === 'true';
        const effectiveStart = startDate || new Date(Date.now() - 7 * 86400000).toISOString();

        const innerParams = [domainIds, effectiveStart];
        let innerWhere = 'WHERE hc.domain_id = ANY(?) AND hc.checked_at >= ?';

        if (domainId) {
          innerWhere += ' AND hc.domain_id = ?';
          innerParams.push(parseInt(domainId, 10));
        }
        if (status) {
          innerWhere += ' AND hc.status = ?';
          innerParams.push(status);
        }

        const outerWhere = onlyTransitions ? 'WHERE prev_status IS DISTINCT FROM status' : '';
        const countOuterWhere = onlyTransitions ? 'AND prev_status IS DISTINCT FROM status' : '';

        const [events, countRow] = await Promise.all([
          database.queryAll(
            `SELECT * FROM (
               SELECT hc.id, hc.domain_id, d.hostname, hc.status,
                      hc.response_time, hc.status_code, hc.error_message, hc.checked_at,
                      LAG(hc.status) OVER (PARTITION BY hc.domain_id ORDER BY hc.checked_at) AS prev_status
               FROM health_checks hc
               JOIN domains d ON hc.domain_id = d.id
               ${innerWhere}
             ) ranked ${outerWhere}
             ORDER BY checked_at DESC LIMIT ? OFFSET ?`,
            [...innerParams, safeLimit, safeOffset]
          ),
          database.queryOne(
            `SELECT COUNT(*) as total FROM (
               SELECT hc.status,
                      LAG(hc.status) OVER (PARTITION BY hc.domain_id ORDER BY hc.checked_at) AS prev_status
               FROM health_checks hc ${innerWhere}
             ) ranked WHERE 1=1 ${countOuterWhere}`,
            innerParams
          )
        ]);

        const formatted = events.map(e => ({
          ...e,
          isTransition: e.prev_status !== null && e.prev_status !== e.status
        }));

        return reply.send({ events: formatted, total: Number(countRow?.total || 0) });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting health events');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Export logs
  fastify.get('/export', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { level = null, search = '', format = 'json' } = request.query;

        // Get user's domains
        const userDomains = await database.getDomainsByUserId(userId);
        const domainIds = userDomains.map(d => d.id);

        if (domainIds.length === 0) {
          if (format === 'csv') {
            return reply
              .header('Content-Disposition', `attachment; filename="logs-${new Date().toISOString()}.csv"`)
              .type('text/csv')
              .send('timestamp,level,domain,method,path,status,responseTime,ip,userAgent\n');
          }
          return reply.type('application/json').send('[]');
        }

        // Build query
        let query = `
          SELECT * FROM proxy_logs
          WHERE domain_id = ANY(?)
        `;
        const params = [domainIds];

        if (level) {
          query += ` AND level = ?`;
          params.push(level);
        }

        if (search) {
          const escapedSearch = escapeLikePattern(search);
          query += ` AND (hostname LIKE ? OR path LIKE ? OR ip_address LIKE ?)`;
          params.push(`%${escapedSearch}%`, `%${escapedSearch}%`, `%${escapedSearch}%`);
        }

        query += ` ORDER BY created_at DESC LIMIT 10000`;

        const logs = await database.queryAll(query, params);

        const filename = `logs-${new Date().toISOString()}`;

        if (format === 'csv') {
          // Build CSV
          const escCsv = (v) => {
            if (v == null) return '';
            const s = String(v);
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
              return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
          };

          const header = 'timestamp,level,domain,method,path,status,responseTime,ip,userAgent\n';
          const rows = logs.map(log => [
            log.created_at,
            log.level,
            log.hostname,
            log.method,
            log.path,
            log.status,
            log.response_time,
            log.ip_address,
            log.user_agent
          ].map(escCsv).join(','));

          const csv = header + rows.join('\n');

          return reply
            .header('Content-Disposition', `attachment; filename="${filename}.csv"`)
            .type('text/csv; charset=utf-8')
            .send(csv);
        }

        // Default: JSON export
        const formattedLogs = logs.map(log => ({
          timestamp: log.created_at,
          level: log.level,
          domain: log.hostname,
          method: log.method,
          path: log.path,
          status: log.status,
          responseTime: log.response_time,
          ip: log.ip_address,
          userAgent: log.user_agent
        }));

        return reply
          .header('Content-Disposition', `attachment; filename="${filename}.json"`)
          .type('application/json')
          .send(JSON.stringify(formattedLogs, null, 2));
      } catch (error) {
        fastify.log.error({ error }, 'Error exporting logs');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });
}
