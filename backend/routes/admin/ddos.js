import { ddosProtectionService } from '../../services/ddosProtectionService.js';

export async function ddosAdminRoutes(fastify, options) {
  // GET /api/admin/ddos/bans
  fastify.get('/bans', { preHandler: fastify.authorize(['admin']) }, async (request, reply) => {
    try {
      const { ip, domainId, limit = 50, offset = 0 } = request.query;
      const bans = await ddosProtectionService.getActiveBans({
        ip,
        domainId: domainId ? parseInt(domainId) : undefined,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
      return reply.send({ bans });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get DDoS bans');
      return reply.code(500).send({ error: 'Internal Server Error', message: error.message });
    }
  });

  // POST /api/admin/ddos/bans
  fastify.post('/bans', { preHandler: fastify.authorize(['admin']) }, async (request, reply) => {
    try {
      const { ip, domainId, reason = 'manual-ban', durationSec } = request.body;
      if (!ip) return reply.code(400).send({ error: 'Bad Request', message: 'ip is required' });
      await ddosProtectionService.banIp(ip, domainId || null, reason, 'admin', durationSec || null);
      return reply.send({ success: true, message: `IP ${ip} banned` });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create DDoS ban');
      return reply.code(500).send({ error: 'Internal Server Error', message: error.message });
    }
  });

  // DELETE /api/admin/ddos/bans/:id
  fastify.delete('/bans/:id', { preHandler: fastify.authorize(['admin']) }, async (request, reply) => {
    try {
      const id = parseInt(request.params.id);
      await ddosProtectionService.unbanIp(id);
      return reply.send({ success: true, message: 'IP unbanned' });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to unban IP');
      return reply.code(500).send({ error: 'Internal Server Error', message: error.message });
    }
  });

  // GET /api/admin/ddos/stats
  fastify.get('/stats', { preHandler: fastify.authorize(['admin']) }, async (request, reply) => {
    try {
      const stats = await ddosProtectionService.getBanStats();
      const blocklistSize = ddosProtectionService._blocklistCache.size;
      return reply.send({ ...stats, blocklist_ips: blocklistSize });
    } catch (error) {
      return reply.code(500).send({ error: 'Internal Server Error', message: error.message });
    }
  });

  // GET /api/admin/ddos/blocklists
  fastify.get('/blocklists', { preHandler: fastify.authorize(['admin']) }, async (request, reply) => {
    try {
      const meta = await ddosProtectionService.getBlocklistMeta();
      return reply.send({ blocklists: meta });
    } catch (error) {
      return reply.code(500).send({ error: 'Internal Server Error', message: error.message });
    }
  });

  // POST /api/admin/ddos/blocklists/sync
  fastify.post('/blocklists/sync', { preHandler: fastify.authorize(['admin']) }, async (request, reply) => {
    // Async - return 202 immediately
    reply.code(202).send({ message: 'Blocklist sync started' });
    ddosProtectionService.syncAllBlocklists().catch(err =>
      fastify.log.error({ error: err }, 'Manual blocklist sync failed')
    );
  });
}
