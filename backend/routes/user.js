import validator from 'validator';
import { database } from '../services/database.js';
import { config } from '../config/config.js';
import { pool } from '../config/database.js';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';

async function getUserPasskeyCount(userId) {
  const tableCandidates = ['user_passkeys', 'webauthn_credentials', 'passkeys'];

  for (const tableName of tableCandidates) {
    const existsRes = await pool.query('SELECT to_regclass($1) AS regclass', [`public.${tableName}`]);
    if (!existsRes.rows[0]?.regclass) continue;

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM ${tableName} WHERE user_id = $1`, [userId]);
    return Number(countRes.rows[0]?.count || 0);
  }

  return 0;
}

function getWebauthnContext(request) {
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || request.headers.host || '';
  const cleanHost = String(host).split(',')[0].trim();
  const rpID = cleanHost.split(':')[0];
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || request.protocol || 'http';
  const origin = `${proto}://${cleanHost}`;
  return { rpID, origin };
}

const pendingPasskeyRegistrations = new Map();

export async function userRoutes(fastify, options) {
  // Get current user info
  fastify.get('/me', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const userRecord = await database.getUserById(request.user.id);
    reply.send({
      success: true,
      user: {
        username: userRecord?.username || request.user.username,
        displayName: userRecord?.display_name || request.user.displayName,
        email: userRecord?.email || request.user.email,
        role: userRecord?.role || request.user.role,
        avatarUrl: userRecord?.avatar_url || null,
        avatarUpdatedAt: userRecord?.avatar_updated_at || null
      }
    });
  });

  // Update user profile
  fastify.put('/profile', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          displayName: { type: 'string', minLength: 1, maxLength: 255 },
          email: { type: 'string', maxLength: 255 },
          avatarUrl: { type: 'string', maxLength: 2048 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const { displayName, email, avatarUrl } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim() : email;

      if (normalizedEmail && !validator.isEmail(normalizedEmail)) {
        return reply.code(400).send({
          error: 'Invalid email',
          message: 'Email must be a valid address'
        });
      }

      if (avatarUrl && !validator.isURL(avatarUrl, { require_protocol: true })) {
        return reply.code(400).send({
          error: 'Invalid avatar URL',
          message: 'Avatar URL must be a valid URL'
        });
      }

      if (email !== undefined) {
        const currentUser = await database.getUserById(request.user.id);
        if (currentUser?.two_factor_enabled && !normalizedEmail) {
          return reply.code(400).send({
            error: 'Email required',
            message: 'You must keep an email address while two-factor authentication is enabled.'
          });
        }
      }

      const updated = await database.updateUserProfile(request.user.id, {
        displayName: displayName?.trim(),
        email: normalizedEmail || null,
        avatarUrl: avatarUrl?.trim()
      });

      const token = fastify.jwt.sign(
        {
          id: updated.id,
          username: updated.username,
          role: updated.role,
          displayName: updated.display_name,
          email: updated.email,
          avatarUrl: updated.avatar_url || null,
          adminPinVerified: request.user?.adminPinVerified === true
        },
        { expiresIn: config.jwtExpiry }
      );

      const isSecureRequest = request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';

      reply
        .setCookie('token', token, {
          httpOnly: true,
          secure: config.nodeEnv === 'production' && isSecureRequest,
          sameSite: config.nodeEnv === 'production' && isSecureRequest ? 'strict' : 'lax',
          path: '/',
          maxAge: 24 * 60 * 60 * 1000
        })
        .send({
          success: true,
          user: {
            username: updated.username,
            displayName: updated.display_name,
            email: updated.email,
            role: updated.role,
            avatarUrl: updated.avatar_url || null,
            avatarUpdatedAt: updated.avatar_updated_at || null
          }
        });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update profile');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update profile'
      });
    }
  });

  // Get user permissions
  fastify.get('/permissions', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const permissions = {
      canProxy: true,
      canViewLogs: request.user.role === 'admin',
      canManageUsers: request.user.role === 'admin',
      canModifySettings: request.user.role === 'admin',
      maxConcurrentConnections: request.user.role === 'admin' ? -1 : 10,
      allowedDomains: request.user.role === 'admin' ? [] : fastify.config?.proxy?.allowedDomains || []
    };

    reply.send({
      success: true,
      permissions
    });
  });

  // Get passkey prompt status (post-login nudge)
  fastify.get('/passkey-prompt/status', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const passkeyCount = await getUserPasskeyCount(request.user.id);
      if (passkeyCount > 0) {
        return reply.send({
          success: true,
          shouldPrompt: false,
          hasPasskey: true,
          passkeyCount
        });
      }

      const stateRes = await pool.query(
        'SELECT next_prompt_at FROM user_passkey_prompt_state WHERE user_id = $1',
        [request.user.id]
      );
      const nextPromptAt = stateRes.rows[0]?.next_prompt_at || null;
      const now = new Date();
      const shouldPrompt = !nextPromptAt || new Date(nextPromptAt) <= now;

      reply.send({
        success: true,
        shouldPrompt,
        hasPasskey: false,
        passkeyCount: 0,
        nextPromptAt
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch passkey prompt status');
      reply.code(500).send({
        success: false,
        error: 'Internal Server Error',
        message: 'Unable to fetch passkey prompt status'
      });
    }
  });

  // Save passkey prompt response
  fastify.post('/passkey-prompt/response', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['later', 'setup_now'] }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const { action } = request.body;
      const snoozeDays = action === 'later' ? 30 : 1;

      await pool.query(
        `INSERT INTO user_passkey_prompt_state (user_id, next_prompt_at, last_prompted_at, last_dismissed_at, updated_at)
         VALUES ($1, NOW() + ($2 || ' days')::interval, NOW(), CASE WHEN $3 = 'later' THEN NOW() ELSE NULL END, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           next_prompt_at = EXCLUDED.next_prompt_at,
           last_prompted_at = NOW(),
           last_dismissed_at = CASE WHEN EXCLUDED.last_dismissed_at IS NULL THEN user_passkey_prompt_state.last_dismissed_at ELSE EXCLUDED.last_dismissed_at END,
           updated_at = NOW()`,
        [request.user.id, String(snoozeDays), action]
      );

      reply.send({
        success: true,
        nextPromptInDays: snoozeDays
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to save passkey prompt response');
      reply.code(500).send({
        success: false,
        error: 'Internal Server Error',
        message: 'Unable to save passkey prompt response'
      });
    }
  });

  // List user's passkeys
  fastify.get('/passkeys', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const result = await pool.query(
      `SELECT id, name, created_at, last_used_at, device_type, backed_up
       FROM user_passkeys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [request.user.id]
    );

    reply.send({
      success: true,
      passkeys: result.rows.map((row) => ({
        id: row.id,
        name: row.name || 'Passkey',
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        deviceType: row.device_type,
        backedUp: row.backed_up
      }))
    });
  });

  // Begin WebAuthn passkey registration
  fastify.post('/passkeys/register/options', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const existing = await pool.query(
      'SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1',
      [request.user.id]
    );

    const { rpID, origin } = getWebauthnContext(request);
    if (!rpID) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid host',
        message: 'Unable to determine RP ID for passkey registration.'
      });
    }

    const options = await generateRegistrationOptions({
      rpName: 'NebulaProxy',
      rpID,
      userID: Buffer.from(`user:${request.user.id}`, 'utf8'),
      userName: request.user.username,
      userDisplayName: request.user.displayName || request.user.username,
      timeout: 60000,
      attestationType: 'none',
      excludeCredentials: existing.rows.map((row) => ({
        id: row.credential_id,
        type: 'public-key',
        transports: Array.isArray(row.transports) ? row.transports : undefined
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      }
    });

    pendingPasskeyRegistrations.set(request.user.id, {
      challenge: options.challenge,
      rpID,
      origin,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    reply.send({
      success: true,
      options
    });
  });

  // Verify WebAuthn passkey registration
  fastify.post('/passkeys/register/verify', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['response'],
        properties: {
          name: { type: 'string', maxLength: 255 },
          response: { type: 'object' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const pending = pendingPasskeyRegistrations.get(request.user.id);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingPasskeyRegistrations.delete(request.user.id);
      return reply.code(400).send({
        success: false,
        error: 'Registration expired',
        message: 'Passkey registration challenge expired. Retry setup.'
      });
    }

    try {
      const verification = await verifyRegistrationResponse({
        response: request.body.response,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpID,
        requireUserVerification: false
      });

      if (!verification.verified || !verification.registrationInfo?.credential) {
        return reply.code(400).send({
          success: false,
          error: 'Verification failed',
          message: 'Unable to verify passkey registration.'
        });
      }

      const credential = verification.registrationInfo.credential;
      await pool.query(
        `INSERT INTO user_passkeys (user_id, name, credential_id, public_key, counter, transports, device_type, backed_up)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (credential_id) DO NOTHING`,
        [
          request.user.id,
          (request.body.name || '').trim() || 'Passkey',
          credential.id,
          Buffer.from(credential.publicKey).toString('base64'),
          Number(credential.counter || 0),
          JSON.stringify(Array.isArray(credential.transports) ? credential.transports : []),
          verification.registrationInfo.credentialDeviceType || null,
          verification.registrationInfo.credentialBackedUp ?? null
        ]
      );

      await pool.query(
        `INSERT INTO user_passkey_prompt_state (user_id, next_prompt_at, updated_at)
         VALUES ($1, NOW() + INTERVAL '365 days', NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET next_prompt_at = EXCLUDED.next_prompt_at, updated_at = NOW()`,
        [request.user.id]
      );

      pendingPasskeyRegistrations.delete(request.user.id);
      reply.send({
        success: true,
        message: 'Passkey created successfully.'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Passkey verification failed');
      return reply.code(400).send({
        success: false,
        error: 'Verification failed',
        message: 'Passkey verification failed.'
      });
    }
  });

  // Delete passkey
  fastify.delete('/passkeys/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const passkeyId = Number(request.params.id);
    if (!Number.isInteger(passkeyId) || passkeyId <= 0) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid id',
        message: 'Invalid passkey id.'
      });
    }

    await pool.query('DELETE FROM user_passkeys WHERE id = $1 AND user_id = $2', [passkeyId, request.user.id]);
    reply.send({ success: true });
  });
}
