// @ts-check
/**
 * Admin OIDC Configuration Routes
 * GET  /api/admin/oidc/config  — read OIDC config
 * PUT  /api/admin/oidc/config  — save OIDC config
 * POST /api/admin/oidc/test    — test discovery endpoint
 */
import { pool } from '../../config/database.js';
import { oidcService } from '../../services/oidcService.js';

const DEFAULT = {
  enabled:           false,
  issuer_url:        '',
  client_id:         '',
  client_secret:     '',
  redirect_uri:      '',
  scope:             'openid email profile',
  role_claim:        '',
  admin_group:       '',
  auto_create_users: true,
  sync_roles:        false
};

export async function oidcAdminRoutes(fastify) {
  fastify.get('/config', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const { rows } = await pool.query(
      "SELECT value FROM system_config WHERE key = 'oidc_config' LIMIT 1"
    );
    const config = rows.length ? { ...DEFAULT, ...JSON.parse(rows[0].value) } : { ...DEFAULT };
    reply.send({ config });
  });

  fastify.put('/config', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const body = request.body || {};
    const config = { ...DEFAULT, ...body };

    await pool.query(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ('oidc_config', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(config)]
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address)
       VALUES ($1, 'update_oidc_config', 'system_config', 'Updated OIDC/SSO configuration', $2)`,
      [request.user.id, request.ip]
    );

    reply.send({ success: true });
  });

  // Test: fetch discovery document to validate issuer URL
  fastify.post('/test', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const { issuer_url } = request.body || {};
    if (!issuer_url) {
      return reply.code(400).send({ message: 'issuer_url is required' });
    }

    try {
      const disc = await oidcService.getDiscovery(issuer_url);
      reply.send({
        success:     true,
        issuer:      disc.issuer,
        authUrl:     disc.authorization_endpoint,
        tokenUrl:    disc.token_endpoint,
        userinfoUrl: disc.userinfo_endpoint,
        scopes:      disc.scopes_supported
      });
    } catch (err) {
      reply.code(500).send({ message: `Discovery failed: ${err.message}` });
    }
  });
}
