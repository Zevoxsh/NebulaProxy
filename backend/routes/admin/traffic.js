import { liveTrafficService } from '../../services/liveTrafficService.js';
import { database } from '../../services/database.js';

export async function trafficAdminRoutes(fastify) {

  // GET /api/admin/traffic/live  — all domains
  fastify.get('/live', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const connections = await liveTrafficService.getAll();

      // Enrich with domain hostname + proxy_type
      const domainIds = [...new Set(connections.map(c => c.domainId))];
      let domainMap = {};
      if (domainIds.length) {
        const rows = await database.pgPool.query(
          'SELECT id, hostname, proxy_type FROM domains WHERE id = ANY($1)',
          [domainIds]
        );
        for (const r of rows.rows) domainMap[r.id] = r;
      }

      const enriched = connections.map(c => ({
        ...c,
        hostname:  domainMap[c.domainId]?.hostname  || null,
        proxyType: domainMap[c.domainId]?.proxy_type || null,
      }));

      const stats = await liveTrafficService.getStats();
      return reply.send({ connections: enriched, total: enriched.length, stats });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // DELETE /api/admin/traffic/live  — clear all
  fastify.delete('/live', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      await liveTrafficService.clearAll();
      return reply.send({ success: true });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });
}
