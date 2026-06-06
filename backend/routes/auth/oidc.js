// @ts-check
/**
 * OIDC Authentication Routes
 * GET  /auth/oidc/login      — redirect to provider authorization URL
 * GET  /auth/oidc/callback   — handle code exchange + issue JWT
 */
import { oidcService } from '../../services/oidcService.js';
import { sendAuthSuccess } from './helpers.js';
import { pool } from '../../config/database.js';

const STATE_COOKIE = 'oidc_state';

export async function oidcRoutes(fastify) {
  // Redirect user to IdP
  fastify.get('/oidc/login', async (request, reply) => {
    if (!await oidcService.isEnabled()) {
      return reply.code(503).send({ error: 'OIDC is not configured on this instance' });
    }

    const cfg   = await oidcService.loadConfig();
    const state = oidcService.generateState();
    const url   = await oidcService.getAuthorizationUrl(cfg, state);

    reply
      .setCookie(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'lax',
        path:     '/api/auth/oidc',
        maxAge:   600   // 10 min — enough to complete the flow
      })
      .redirect(url);
  });

  // Provider redirects back here with ?code=...&state=...
  fastify.get('/oidc/callback', async (request, reply) => {
    const { code, state, error: oidcError } = request.query;

    if (oidcError) {
      return reply.redirect(`/login?error=${encodeURIComponent(oidcError)}`);
    }

    const savedState = request.cookies?.[STATE_COOKIE];
    if (!state || state !== savedState) {
      return reply.redirect('/login?error=invalid_state');
    }

    reply.clearCookie(STATE_COOKIE, { path: '/api/auth/oidc' });

    try {
      const { user, isNew } = await oidcService.handleCallback(code);
      const cfg = await oidcService.loadConfig();

      fastify.log.info({ userId: user.id, email: user.email, isNew }, 'OIDC login successful');

      // Audit log — every SSO login is recorded
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, $2, 'user', $1, $3, $4)`,
        [
          user.id,
          isNew ? 'oidc_signup' : 'oidc_login',
          JSON.stringify({ email: user.email, provider: cfg?.issuer_url, isNew }),
          request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip
        ]
      ).catch(err => fastify.log.warn({ err }, 'OIDC audit log failed'));

      sendAuthSuccess(request, reply, user, {
        tokenClaims: { authMethod: 'oidc' }
      });

      // sendAuthSuccess sends the response — but the cookie + JSON body land on /api/auth/oidc/callback.
      // The login page expects a redirect to /dashboard after SSO. We override here.
      reply.redirect('/dashboard');
    } catch (err) {
      fastify.log.warn({ err }, 'OIDC callback error');
      reply.redirect(`/login?error=${encodeURIComponent(err.message)}`);
    }
  });

  // Public endpoint: is OIDC enabled? (used by login page to show/hide SSO button)
  fastify.get('/oidc/status', async (request, reply) => {
    const enabled = await oidcService.isEnabled();
    let providerName = 'SSO';
    if (enabled) {
      try {
        const cfg = await oidcService.loadConfig();
        const disc = await oidcService.getDiscovery(cfg.issuer_url);
        providerName = disc.issuer?.replace(/^https?:\/\//, '').split('/')[0] || 'SSO';
      } catch { /* ignore */ }
    }
    reply.send({ enabled, providerName });
  });
}
