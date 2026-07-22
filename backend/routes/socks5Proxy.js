// @ts-check
import crypto from 'crypto';
import { config } from '../config/config.js';
import { database } from '../services/database.js';
import { hashApiKey } from '../utils/apiKey.js';

function generateSocks5Password() {
  return crypto.randomBytes(16).toString('hex');
}

function canManageCredential(credential, userId, isAdmin) {
  if (isAdmin) return true;
  return String(credential.user_id) === String(userId);
}

function clampThrottleBps(value) {
  const max = config.socks5Proxy.maxThrottleBps;
  const fallback = config.socks5Proxy.defaultThrottleBps;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function socks5ProxyRoutes(fastify, _options) {
  fastify.get('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const credentials = isAdmin
        ? await database.getAllSocks5Credentials()
        : await database.getSocks5CredentialsByUserId(userId);

      const safeCredentials = credentials.map(({ password_hash, ...rest }) => rest);

      reply.send({
        success: true,
        credentials: safeCredentials,
        count: safeCredentials.length,
        settings: {
          port: config.socks5Proxy.port,
          publicHost: config.socks5Proxy.publicHost,
          enabled: config.socks5Proxy.enabled,
          maxThrottleBps: config.socks5Proxy.maxThrottleBps,
          defaultThrottleBps: config.socks5Proxy.defaultThrottleBps,
          maxCredentialsPerUser: config.socks5Proxy.maxCredentialsPerUser
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch SOCKS5 credentials');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch SOCKS5 credentials' });
    }
  });

  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['label'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 255 },
          throttleBps: { type: 'integer', minimum: 1 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const { label, throttleBps } = request.body;

      const existingCount = await database.countSocks5CredentialsByUserId(userId);
      if (existingCount >= config.socks5Proxy.maxCredentialsPerUser) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Maximum number of SOCKS5 credentials reached (${config.socks5Proxy.maxCredentialsPerUser})`
        });
      }

      const username = await database.getUniqueSocks5Username();
      const password = generateSocks5Password();
      const passwordHash = await hashApiKey(password);
      const resolvedThrottleBps = clampThrottleBps(throttleBps);

      const credential = await database.createSocks5Credential({
        userId,
        label,
        username,
        passwordHash,
        throttleBps: resolvedThrottleBps
      });

      await database.createAuditLog({
        userId,
        action: 'socks5_credential_created',
        entityType: 'socks5_credential',
        entityId: credential.id,
        details: { label, username, throttle_bps: resolvedThrottleBps },
        ipAddress: request.ip
      });

      const { password_hash, ...safeCredential } = credential;

      reply.code(201).send({
        success: true,
        credential: safeCredential,
        // Returned once — never retrievable again, same contract as API keys.
        password,
        connection: { host: config.socks5Proxy.publicHost || request.hostname, port: config.socks5Proxy.port }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create SOCKS5 credential');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to create SOCKS5 credential' });
    }
  });

  fastify.patch('/:id', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 255 },
          throttleBps: { type: 'integer', minimum: 1 },
          isEnabled: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const credentialId = Number.parseInt(request.params.id, 10);
      const credential = await database.getSocks5CredentialById(credentialId);

      if (!credential) {
        return reply.code(404).send({ error: 'Not Found', message: 'SOCKS5 credential not found' });
      }
      if (!canManageCredential(credential, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to modify this credential' });
      }

      const { label, throttleBps, isEnabled } = request.body;
      const resolvedThrottleBps = throttleBps !== undefined ? clampThrottleBps(throttleBps) : null;

      const updated = await database.updateSocks5Credential(credentialId, {
        label: label ?? null,
        throttleBps: resolvedThrottleBps,
        isEnabled: isEnabled !== undefined ? isEnabled : null
      });

      await database.createAuditLog({
        userId: request.user.id,
        action: 'socks5_credential_updated',
        entityType: 'socks5_credential',
        entityId: credentialId,
        details: { label, throttle_bps: resolvedThrottleBps, is_enabled: isEnabled },
        ipAddress: request.ip
      });

      const { password_hash, ...safeCredential } = updated;
      reply.send({ success: true, credential: safeCredential });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update SOCKS5 credential');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to update SOCKS5 credential' });
    }
  });

  fastify.post('/:id/rotate-password', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const credentialId = Number.parseInt(request.params.id, 10);
      const credential = await database.getSocks5CredentialById(credentialId);

      if (!credential) {
        return reply.code(404).send({ error: 'Not Found', message: 'SOCKS5 credential not found' });
      }
      if (!canManageCredential(credential, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to modify this credential' });
      }

      const password = generateSocks5Password();
      const passwordHash = await hashApiKey(password);
      await database.updateSocks5CredentialPasswordHash(credentialId, passwordHash);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'socks5_credential_password_rotated',
        entityType: 'socks5_credential',
        entityId: credentialId,
        details: { username: credential.username },
        ipAddress: request.ip
      });

      reply.send({ success: true, password });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to rotate SOCKS5 credential password');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to rotate SOCKS5 credential password' });
    }
  });

  fastify.delete('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const credentialId = Number.parseInt(request.params.id, 10);
      const credential = await database.getSocks5CredentialById(credentialId);

      if (!credential) {
        return reply.code(404).send({ error: 'Not Found', message: 'SOCKS5 credential not found' });
      }
      if (!canManageCredential(credential, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to delete this credential' });
      }

      await database.deleteSocks5Credential(credentialId);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'socks5_credential_deleted',
        entityType: 'socks5_credential',
        entityId: credentialId,
        details: { username: credential.username, label: credential.label },
        ipAddress: request.ip
      });

      reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete SOCKS5 credential');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete SOCKS5 credential' });
    }
  });
}
