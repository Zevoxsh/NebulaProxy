import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { database } from '../../services/database.js';
import { pool } from '../../config/database.js';
import { getWebauthnContext, sendAuthSuccess } from './helpers.js';

const pendingPasskeyAuthentications = new Map();

export async function passkeyRoutes(fastify, options) {
  // Begin passkey authentication (supports username-less autofill)
  fastify.post('/passkey/options', {
    schema: {
      body: {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 255 }
        },
        additionalProperties: false
      }
    },
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const username = request.body?.username?.trim();
    const { rpID, origin } = getWebauthnContext(request);

    if (!rpID) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid host',
        message: 'Unable to determine passkey RP ID.'
      });
    }

    let allowCredentials = [];
    if (username) {
      const dbUser = await database.getUserByUsername(username);
      if (!dbUser || dbUser.is_active === false) {
        return reply.code(401).send({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid credentials'
        });
      }

      const credsRes = await pool.query(
        'SELECT credential_id FROM user_passkeys WHERE user_id = $1',
        [dbUser.id]
      );
      allowCredentials = credsRes.rows.map((row) => ({
        id: row.credential_id,
        type: 'public-key'
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      timeout: 60000,
      userVerification: 'preferred'
    });

    pendingPasskeyAuthentications.set(options.challenge, {
      origin,
      rpID,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    reply.send({
      success: true,
      options
    });
  });

  // Verify passkey authentication and create session
  fastify.post('/passkey/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['response'],
        properties: {
          response: { type: 'object' }
        },
        additionalProperties: false
      }
    },
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const responsePayload = request.body.response;
    const challenge = responsePayload?.response?.clientDataJSON
      ? undefined
      : responsePayload?.challenge;

    const credentialId = responsePayload?.id;
    if (!credentialId) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid response',
        message: 'Invalid passkey response payload.'
      });
    }

    const credRes = await pool.query(
      `SELECT p.id, p.user_id, p.credential_id, p.public_key, p.counter, p.transports, u.*
       FROM user_passkeys p
       JOIN users u ON u.id = p.user_id
       WHERE p.credential_id = $1
       LIMIT 1`,
      [credentialId]
    );

    if (credRes.rows.length === 0) {
      return reply.code(401).send({
        success: false,
        error: 'Authentication failed',
        message: 'Unknown passkey.'
      });
    }

    const row = credRes.rows[0];
    if (row.is_active === false) {
      return reply.code(403).send({
        success: false,
        error: 'Account disabled',
        message: 'Your account is disabled'
      });
    }

    const clientDataJSON = responsePayload?.response?.clientDataJSON;
    if (!clientDataJSON) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid response',
        message: 'Missing passkey client data.'
      });
    }

    const decodedClientData = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
    const pending = pendingPasskeyAuthentications.get(decodedClientData.challenge);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingPasskeyAuthentications.delete(decodedClientData.challenge);
      return reply.code(400).send({
        success: false,
        error: 'Expired challenge',
        message: 'Passkey challenge expired. Please retry.'
      });
    }

    try {
      const verification = await verifyAuthenticationResponse({
        response: responsePayload,
        expectedChallenge: decodedClientData.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpID,
        credential: {
          id: row.credential_id,
          publicKey: Buffer.from(row.public_key, 'base64'),
          counter: Number(row.counter || 0),
          transports: Array.isArray(row.transports) ? row.transports : undefined
        },
        requireUserVerification: false
      });

      if (!verification.verified) {
        return reply.code(401).send({
          success: false,
          error: 'Authentication failed',
          message: 'Passkey verification failed.'
        });
      }

      pendingPasskeyAuthentications.delete(decodedClientData.challenge);
      await pool.query(
        'UPDATE user_passkeys SET counter = $1, last_used_at = NOW() WHERE id = $2',
        [Number(verification.authenticationInfo.newCounter || row.counter || 0), row.id]
      );
      await database.updateUserLoginTime(row.user_id);

      sendAuthSuccess(request, reply, row);
    } catch (error) {
      fastify.log.error({ error }, 'Passkey authentication failed');
      return reply.code(401).send({
        success: false,
        error: 'Authentication failed',
        message: 'Passkey authentication failed.'
      });
    }
  });
}
