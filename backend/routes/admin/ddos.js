import { ddosProtectionService } from '../../services/ddosProtectionService.js';

export async function ddosAdminRoutes(fastify) {

  // ── Stats ─────────────────────────────────────────────────────────────────

  fastify.get('/stats', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const stats = await ddosProtectionService.getBanStats();
      return reply.send(stats);
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── Active bans ───────────────────────────────────────────────────────────

  fastify.get('/bans', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const { ip, domainId, limit = 100, offset = 0 } = req.query;
      const bans = await ddosProtectionService.getActiveBans({
        ip,
        domainId: domainId ? parseInt(domainId) : undefined,
        limit: Math.min(parseInt(limit) || 100, 500),
        offset: parseInt(offset) || 0
      });
      return reply.send({ bans });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.post('/bans', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const { ip, reason = 'manual-ban', durationSec = 3600, domainId } = req.body || {};
      if (!ip) return reply.code(400).send({ error: 'ip is required' });
      await ddosProtectionService.banIp(ip, domainId || null, reason, 'admin', durationSec);
      return reply.send({ success: true });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.delete('/bans/:id', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      await ddosProtectionService.unbanIp(parseInt(req.params.id));
      return reply.send({ success: true });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── Blocklists ────────────────────────────────────────────────────────────

  fastify.get('/blocklists', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const meta = await ddosProtectionService.getBlocklistMeta();
      return reply.send({ blocklists: meta });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.post('/blocklists/sync', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    reply.code(202).send({ message: 'Sync started' });
    ddosProtectionService.syncAllBlocklists().catch(err =>
      fastify.log.error({ error: err }, 'Manual blocklist sync failed')
    );
  });

  // ── Whitelist ─────────────────────────────────────────────────────────────

  fastify.get('/whitelist', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const entries = await ddosProtectionService.getWhitelist();
      return reply.send({ whitelist: entries });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.post('/whitelist', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const { cidr, description } = req.body || {};
      if (!cidr) return reply.code(400).send({ error: 'cidr is required' });
      const valid = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(cidr.trim());
      if (!valid) return reply.code(400).send({ error: 'Invalid IP or CIDR (IPv4 only)' });
      await ddosProtectionService.addWhitelist(cidr.trim(), description || '');
      return reply.code(201).send({ success: true });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.delete('/whitelist/:id', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      await ddosProtectionService.removeWhitelist(parseInt(req.params.id));
      return reply.send({ success: true });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── Attack events ─────────────────────────────────────────────────────────

  fastify.get('/events', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const { limit = 100, domainId, attackType } = req.query;
      const events = await ddosProtectionService.getAttackEvents({
        limit: Math.min(parseInt(limit) || 100, 500),
        domainId: domainId ? parseInt(domainId) : undefined,
        attackType
      });
      return reply.send({ events });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.get('/events/stats', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const stats = await ddosProtectionService.getAttackStats();
      return reply.send({ stats });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });
}
