// @ts-check
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from '../../config/database.js';
import { config } from '../../config/config.js';
import ldap from 'ldapjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, '..', '..', '.env');

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

const getLdapConfig = () => ({
  authMode: config.auth.mode,
  url: process.env.LDAP_URL || '',
  baseDN: process.env.LDAP_BASE_DN || '',
  bindDN: process.env.LDAP_BIND_DN || '',
  bindPasswordSet: Boolean(process.env.LDAP_BIND_PASSWORD),
  adminGroup: process.env.LDAP_ADMIN_GROUP || '',
  userGroup: process.env.LDAP_USER_GROUP || '',
  requireGroup: process.env.LDAP_REQUIRE_GROUP === 'true',
});

const testLdapConnection = (url, bindDN, bindPassword, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url,
      timeout: timeoutMs,
      connectTimeout: timeoutMs,
    });

    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('Connection timeout'));
    }, timeoutMs + 1000);

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(err.message || 'Connection error'));
    });

    client.bind(bindDN, bindPassword, (err) => {
      clearTimeout(timer);
      if (err) {
        client.destroy();
        return reject(new Error(err.message || 'Bind failed'));
      }
      client.unbind();
      resolve(true);
    });
  });

export async function adminLdapRoutes(fastify, _options) {

  // GET current LDAP config
  fastify.get('/config/ldap', {
    preHandler: fastify.authorize(['admin']),
  }, async (request, reply) => {
    reply.send({ config: getLdapConfig() });
  });

  // PUT save LDAP config
  fastify.put('/config/ldap', {
    preHandler: fastify.authorize(['admin']),
  }, async (request, reply) => {
    const { authMode, url, baseDN, bindDN, bindPassword, adminGroup, userGroup, requireGroup } = request.body || {};

    const updates = {};

    if (authMode !== undefined) {
      if (authMode !== 'local' && authMode !== 'ldap') {
        return reply.code(400).send({ error: 'authMode must be "local" or "ldap"' });
      }
      updates.AUTH_MODE = authMode;
      process.env.AUTH_MODE = authMode;
    }

    if (url !== undefined) { updates.LDAP_URL = url; process.env.LDAP_URL = url; }
    if (baseDN !== undefined) { updates.LDAP_BASE_DN = baseDN; process.env.LDAP_BASE_DN = baseDN; }
    if (bindDN !== undefined) { updates.LDAP_BIND_DN = bindDN; process.env.LDAP_BIND_DN = bindDN; }
    if (bindPassword !== undefined && bindPassword !== '') {
      updates.LDAP_BIND_PASSWORD = bindPassword;
      process.env.LDAP_BIND_PASSWORD = bindPassword;
    }
    if (adminGroup !== undefined) { updates.LDAP_ADMIN_GROUP = adminGroup; process.env.LDAP_ADMIN_GROUP = adminGroup; }
    if (userGroup !== undefined) { updates.LDAP_USER_GROUP = userGroup; process.env.LDAP_USER_GROUP = userGroup; }
    if (requireGroup !== undefined) {
      const val = String(Boolean(requireGroup));
      updates.LDAP_REQUIRE_GROUP = val;
      process.env.LDAP_REQUIRE_GROUP = val;
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    updateEnvFile(updates);

    reply.send({
      success: true,
      message: 'Configuration LDAP sauvegardée. Redémarrez le serveur pour appliquer.',
      restartRequired: true,
      config: getLdapConfig(),
    });
  });

  // POST test LDAP connection (with provided values, no save)
  fastify.post('/config/ldap/test', {
    preHandler: fastify.authorize(['admin']),
  }, async (request, reply) => {
    const { url, bindDN, bindPassword } = request.body || {};

    const testUrl = url || process.env.LDAP_URL || '';
    const testBindDN = bindDN || process.env.LDAP_BIND_DN || '';
    const testPassword = bindPassword || process.env.LDAP_BIND_PASSWORD || '';

    if (!testUrl || !testBindDN) {
      return reply.code(400).send({ error: 'URL et Bind DN sont requis' });
    }

    try {
      await testLdapConnection(testUrl, testBindDN, testPassword);
      reply.send({ success: true, message: 'Connexion LDAP réussie.' });
    } catch (err) {
      reply.code(400).send({ success: false, error: err.message || 'Connexion échouée' });
    }
  });

  // GET list users eligible for domain transfer (all users with their domain count)
  fastify.get('/ldap/users-for-transfer', {
    preHandler: fastify.authorize(['admin']),
  }, async (request, reply) => {
    try {
      const res = await pool.query(`
        SELECT u.id, u.username, u.display_name, u.email, u.role, u.is_active,
               COUNT(d.id) AS domain_count
        FROM users u
        LEFT JOIN domains d ON d.user_id = u.id
        GROUP BY u.id
        ORDER BY u.username ASC
      `);
      reply.send({ users: res.rows });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to list users for transfer');
      reply.code(500).send({ error: 'Failed to list users' });
    }
  });

  // POST transfer all domains from one user to another
  fastify.post('/users/:fromId/transfer-domains', {
    preHandler: fastify.authorize(['admin']),
    schema: {
      params: {
        type: 'object',
        required: ['fromId'],
        properties: { fromId: { type: 'integer' } },
      },
      body: {
        type: 'object',
        required: ['toUserId'],
        properties: { toUserId: { type: 'integer' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const fromId = parseInt(request.params.fromId, 10);
    const { toUserId } = request.body;

    if (fromId === toUserId) {
      return reply.code(400).send({ error: 'Source et destination identiques' });
    }

    try {
      // Verify both users exist
      const usersRes = await pool.query(
        'SELECT id, username FROM users WHERE id = ANY($1)',
        [[fromId, toUserId]]
      );
      if (usersRes.rows.length < 2) {
        return reply.code(404).send({ error: 'Un ou plusieurs utilisateurs introuvables' });
      }

      const result = await pool.query(
        `UPDATE domains SET user_id = $1 WHERE user_id = $2 AND team_id IS NULL RETURNING id`,
        [toUserId, fromId]
      );

      reply.send({
        success: true,
        transferred: result.rowCount,
        message: `${result.rowCount} domaine(s) transféré(s).`,
      });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to transfer domains');
      reply.code(500).send({ error: 'Échec du transfert' });
    }
  });
}
