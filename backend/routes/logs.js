import { database } from '../services/database.js';
import { escapeLikePattern } from '../utils/security.js';

export async function logsRoutes(fastify, options) {
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
