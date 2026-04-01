import { ddosProtectionService } from '../../services/ddosProtectionService.js';

export async function ddosAdminRoutes(fastify) {

  // ── Challenge type selection ───────────────────────────────────────────────

  fastify.get('/challenge-types', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    const all     = ddosProtectionService.constructor.ALL_CHALLENGE_TYPES;
    const enabled = ddosProtectionService.getEnabledChallengeTypes(); // null = all
    const result  = all.map(t => ({
      ...t,
      enabled: enabled === null ? true : enabled.includes(t.id),
    }));
    return reply.send({ types: result, allEnabled: enabled === null });
  });

  fastify.put('/challenge-types', { preHandler: fastify.authorize(['admin']) }, async (req, reply) => {
    try {
      const { enabledIds } = req.body || {};
      if (!Array.isArray(enabledIds)) return reply.code(400).send({ error: 'enabledIds must be an array' });
      if (enabledIds.length === 0) return reply.code(400).send({ error: 'Au moins un type doit rester actif' });
      const valid    = ddosProtectionService.constructor.ALL_CHALLENGE_TYPES.map(t => t.id);
      const filtered = enabledIds.filter(id => valid.includes(id));
      if (filtered.length === 0) return reply.code(400).send({ error: 'Aucun type valide fourni' });
      await ddosProtectionService.setEnabledChallengeTypes(
        filtered.length === valid.length ? null : filtered
      );
      return reply.send({ success: true, active: filtered.length });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });
}
