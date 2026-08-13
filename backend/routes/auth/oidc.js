// @ts-check
import crypto from 'crypto';
import { oidcAuth } from '../../services/oidc.js';
import { config } from '../../config/config.js';
import { autoRegisterUser } from '../../middleware/autoRegister.js';
import { database } from '../../services/database.js';
import { createPendingChallengeStore } from '../../services/pendingChallengeStore.js';
import { issueAuthCookie } from './helpers.js';

// State/nonce are short-lived and only need to survive the round trip to the
// IdP and back — Redis-backed (cluster-safe, same rationale as the WebAuthn
// challenge store: /login and /callback can land on different cluster
// workers) with an in-process Map fallback.
const stateStore = createPendingChallengeStore('oidc_state', 600);

export async function oidcRoutes(fastify, _options) {
  // Plain browser navigation, not an API call — the frontend sets
  // window.location to this URL so the 302 actually reaches the IdP.
  fastify.get('/oidc/login', async (request, reply) => {
    if (config.auth.mode !== 'oidc') {
      return reply.code(400).send({ error: 'OIDC disabled', message: 'OIDC authentication is not enabled' });
    }
    if (!config.oidc.issuer || !config.oidc.clientId || !config.oidc.clientSecret) {
      return reply.code(500).send({ error: 'OIDC misconfigured', message: 'OIDC is not fully configured' });
    }

    try {
      const state = crypto.randomBytes(24).toString('base64url');
      const nonce = crypto.randomBytes(24).toString('base64url');
      await stateStore.set(state, { nonce, createdAt: Date.now() });

      const authUrl = await oidcAuth.buildAuthorizationUrl(request, state, nonce);
      reply.redirect(authUrl);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to start OIDC login');
      reply.code(502).send({ error: 'OIDC unavailable', message: error.message || 'Unable to reach the identity provider' });
    }
  });

  // NOTE: no 2FA step here, unlike local/LDAP login (see basic.js). Trust
  // for an OIDC login already comes from the enterprise IdP the user just
  // authenticated against — layering this app's own 2FA on top would be
  // redundant with whatever MFA policy the IdP itself enforces.
  fastify.get('/oidc/callback', async (request, reply) => {
    const { code, state, error: idpError, error_description: idpErrorDescription } = request.query || {};

    const failLogin = (message) => reply.redirect(`/login?error=${encodeURIComponent(message)}`);

    if (idpError) {
      return failLogin(idpErrorDescription || idpError);
    }
    if (!code || !state) {
      return failLogin('Missing authorization code');
    }

    try {
      const pending = await stateStore.get(state);
      await stateStore.delete(state);
      if (!pending) {
        return failLogin('Login session expired, please try again');
      }

      const tokens = await oidcAuth.exchangeCode(request, code);
      const claims = await oidcAuth.fetchUserInfo(tokens.access_token);
      const oidcUser = oidcAuth.mapClaims(claims);
      const dbUser = await autoRegisterUser(oidcUser);

      if (dbUser.is_active === false) {
        return failLogin('Account disabled');
      }

      await database.updateUserLoginTime(dbUser.id);
      issueAuthCookie(request, reply, dbUser, { adminPinVerified: dbUser.role !== 'admin' });
      fastify.log.info({ username: dbUser.username, role: dbUser.role }, 'User logged in (oidc)');
      reply.redirect('/dashboard');
    } catch (error) {
      fastify.log.error({ error }, 'OIDC callback failed');
      failLogin(error.message || 'Authentication failed');
    }
  });
}
