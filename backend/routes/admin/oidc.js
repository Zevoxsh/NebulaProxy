// @ts-check
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, '..', '..', '.env');

// Same direct .env + process.env write as routes/admin/ldap.js — bypasses
// the Redis-backed configManager entirely so a saved value is both visible
// immediately in this process (getConfig() checks process.env) and durable
// across a restart (re-read via dotenv at boot).
const updateEnvFile = (entries) => {
  const content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
  const lines = content.split('\n');
  const updatedKeys = new Set();

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return line;
    const eqIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIndex).trim();
    if (!Object.prototype.hasOwnProperty.call(entries, key)) return line;
    updatedKeys.add(key);
    return `${key}=${entries[key]}`;
  });

  Object.keys(entries).forEach((key) => {
    if (!updatedKeys.has(key)) newLines.push(`${key}=${entries[key]}`);
  });

  writeFileSync(ENV_PATH, newLines.join('\n'), 'utf-8');
};

const getOidcConfig = () => ({
  authMode: config.auth.mode,
  issuer: config.oidc.issuer,
  clientId: config.oidc.clientId,
  clientSecretSet: Boolean(config.oidc.clientSecret),
  scopes: config.oidc.scopes,
  redirectUri: config.oidc.redirectUri,
  usernameClaim: config.oidc.usernameClaim,
  groupsClaim: config.oidc.groupsClaim,
  adminGroup: config.oidc.adminGroup,
  userGroup: config.oidc.userGroup,
  requireGroup: config.oidc.requireGroup
});

export async function adminOidcRoutes(fastify, _options) {
  // GET current OIDC config
  fastify.get('/config/oidc', {
    preHandler: fastify.authorize(['admin']),
  }, async (request, reply) => {
    reply.send({ config: getOidcConfig() });
  });

  // PUT save OIDC config (authMode itself stays owned by PUT /config/ldap —
  // this endpoint only touches OIDC-specific fields)
  fastify.put('/config/oidc', {
    preHandler: fastify.authorize(['admin']),
  }, async (request, reply) => {
    const {
      issuer, clientId, clientSecret, scopes, redirectUri,
      usernameClaim, groupsClaim, adminGroup, userGroup, requireGroup
    } = request.body || {};

    const updates = {};

    if (issuer !== undefined) { updates.OIDC_ISSUER = issuer; process.env.OIDC_ISSUER = issuer; }
    if (clientId !== undefined) { updates.OIDC_CLIENT_ID = clientId; process.env.OIDC_CLIENT_ID = clientId; }
    if (clientSecret !== undefined && clientSecret !== '') {
      updates.OIDC_CLIENT_SECRET = clientSecret;
      process.env.OIDC_CLIENT_SECRET = clientSecret;
    }
    if (scopes !== undefined) { updates.OIDC_SCOPES = scopes; process.env.OIDC_SCOPES = scopes; }
    if (redirectUri !== undefined) { updates.OIDC_REDIRECT_URI = redirectUri; process.env.OIDC_REDIRECT_URI = redirectUri; }
    if (usernameClaim !== undefined) { updates.OIDC_USERNAME_CLAIM = usernameClaim; process.env.OIDC_USERNAME_CLAIM = usernameClaim; }
    if (groupsClaim !== undefined) { updates.OIDC_GROUPS_CLAIM = groupsClaim; process.env.OIDC_GROUPS_CLAIM = groupsClaim; }
    if (adminGroup !== undefined) { updates.OIDC_ADMIN_GROUP = adminGroup; process.env.OIDC_ADMIN_GROUP = adminGroup; }
    if (userGroup !== undefined) { updates.OIDC_USER_GROUP = userGroup; process.env.OIDC_USER_GROUP = userGroup; }
    if (requireGroup !== undefined) {
      const val = String(Boolean(requireGroup));
      updates.OIDC_REQUIRE_GROUP = val;
      process.env.OIDC_REQUIRE_GROUP = val;
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    updateEnvFile(updates);

    reply.send({
      success: true,
      message: 'Configuration OIDC sauvegardée. Redémarrez le serveur pour appliquer.',
      restartRequired: true,
      config: getOidcConfig(),
    });
  });

  // POST test OIDC discovery (with provided values, no save)
  fastify.post('/config/oidc/test', {
    preHandler: fastify.authorize(['admin']),
  }, async (request, reply) => {
    const { issuer } = request.body || {};
    const testIssuer = issuer || config.oidc.issuer;

    if (!testIssuer) {
      return reply.code(400).send({ error: 'Issuer requis' });
    }

    try {
      const cleanIssuer = testIssuer.replace(/\/+$/, '');
      const res = await fetch(`${cleanIssuer}/.well-known/openid-configuration`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const doc = await res.json();
      if (!doc.authorization_endpoint || !doc.token_endpoint) {
        throw new Error('Document de découverte invalide (endpoints manquants)');
      }
      reply.send({
        success: true,
        message: 'Découverte OIDC réussie.',
        endpoints: {
          authorization_endpoint: doc.authorization_endpoint,
          token_endpoint: doc.token_endpoint,
          userinfo_endpoint: doc.userinfo_endpoint || null
        }
      });
    } catch (err) {
      reply.code(400).send({ success: false, error: err.message || 'Découverte échouée' });
    }
  });
}
