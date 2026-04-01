import { config } from '../../config/config.js';
import { database } from '../../services/database.js';
import { pool } from '../../config/database.js';
import {
  hashPassword,
  normalizeOtpCode,
  hashOtpCode,
  generateEmailLinkToken,
  ensureEmail2faReady,
  createTwoFactorCode,
  sendEmailActionLink,
  buildAppUrl,
  sendAuthSuccess
} from './helpers.js';

export async function passwordRoutes(fastify, options) {
  // SECURITY: Explicitly block GET on password reset endpoints
  fastify.get('/password-reset/request', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Password reset must use POST method'
    });
  });

  // Request local password reset link (email token URL)
  fastify.post('/password-reset/request', {
    schema: {
      body: {
        type: 'object',
        required: ['identifier'],
        properties: {
          identifier: { type: 'string', minLength: 1, maxLength: 255 }
        },
        additionalProperties: false
      }
    },
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    if (config.auth.mode !== 'local') {
      return reply.code(400).send({
        success: false,
        error: 'Unsupported mode',
        message: 'Password reset is available only in local authentication mode.'
      });
    }

    const ready = await ensureEmail2faReady();
    if (!ready.ok) {
      return reply.code(400).send({
        success: false,
        error: 'Email reset unavailable',
        message: ready.message
      });
    }

    const identifier = String(request.body.identifier || '').trim().toLowerCase();
    if (!identifier) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid request',
        message: 'Identifier is required.'
      });
    }

    // Security: do not leak if account exists
    const genericMessage = 'If the account exists and is eligible, a reset link has been sent.';

    try {
      const userRes = await pool.query(
        `SELECT id, email, is_active, password_hash
         FROM users
         WHERE LOWER(username) = $1 OR LOWER(email) = $1
         ORDER BY id ASC
         LIMIT 1`,
        [identifier]
      );

      if (userRes.rows.length === 0) {
        return reply.send({ success: true, message: genericMessage });
      }

      const user = userRes.rows[0];
      if (!user?.email || user.is_active === false || !user.password_hash) {
        return reply.send({ success: true, message: genericMessage });
      }

      const token = generateEmailLinkToken();
      await createTwoFactorCode(user.id, 'password_reset', 'link', token);
      const resetUrl = buildAppUrl(request, '/reset-password', { token });
      await sendEmailActionLink(fastify, user.email, {
        subject: 'NebulaProxy - Password reset link',
        actionLabel: 'reset your account password',
        actionUrl: resetUrl
      });

      return reply.send({ success: true, message: genericMessage });
    } catch (error) {
      fastify.log.error({ error }, 'Password reset request failed');
      return reply.send({ success: true, message: genericMessage });
    }
  });

  // SECURITY: Explicitly block GET on password reset confirm endpoint
  fastify.get('/password-reset/confirm', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Password reset confirmation must use POST method'
    });
  });

  // Confirm local password reset with email link token
  fastify.post('/password-reset/confirm', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: {
          token: { type: 'string', minLength: 16, maxLength: 512 },
          newPassword: { type: 'string', minLength: 8, maxLength: 1024 }
        },
        additionalProperties: false
      }
    },
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    if (config.auth.mode !== 'local') {
      return reply.code(400).send({
        success: false,
        error: 'Unsupported mode',
        message: 'Password reset is available only in local authentication mode.'
      });
    }

    const token = normalizeOtpCode(request.body.token);
    const newPassword = String(request.body.newPassword || '');
    const tokenHash = hashOtpCode(token);

    const resetRes = await pool.query(
      `SELECT c.id AS code_id, u.id, u.email, u.is_active, u.password_hash
       FROM user_two_factor_codes c
       JOIN users u ON u.id = c.user_id
       WHERE c.purpose = 'password_reset'
         AND c.method = 'link'
         AND c.code_hash = $1
         AND c.consumed_at IS NULL
         AND c.expires_at > NOW()
       ORDER BY c.created_at DESC
       LIMIT 1`,
      [tokenHash]
    );

    if (resetRes.rows.length === 0) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid reset',
        message: 'Invalid or expired reset link.'
      });
    }

    const user = resetRes.rows[0];
    if (!user?.email || user.is_active === false || !user.password_hash) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid reset',
        message: 'Invalid or expired reset link.'
      });
    }

    const consumeRes = await pool.query(
      `UPDATE user_two_factor_codes
       SET consumed_at = NOW(), attempts = attempts + 1
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING id`,
      [user.code_id]
    );
    if (consumeRes.rows.length === 0) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid reset',
        message: 'Invalid or expired reset link.'
      });
    }

    const passwordHash = hashPassword(newPassword);
    await pool.query(
      `UPDATE users
       SET password_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    return reply.send({
      success: true,
      message: 'Password reset successful. You can now sign in with your new password.'
    });
  });

  // SECURITY: Explicitly block GET on bootstrap password change endpoint
  fastify.get('/bootstrap/change-password', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Bootstrap password change must use POST method'
    });
  });

  // Change default bootstrap admin password immediately after login.
  fastify.post('/bootstrap/change-password', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: {
          newPassword: { type: 'string', minLength: 8, maxLength: 1024 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    if (request.user?.bootstrapPasswordChangeRequired !== true) {
      return reply.code(400).send({
        success: false,
        error: 'Not required',
        message: 'Bootstrap password change is not required for this session.'
      });
    }

    const newPassword = String(request.body.newPassword || '');
    if (newPassword.length < 8) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid password',
        message: 'New password must be at least 8 characters.'
      });
    }

    if (newPassword === 'admin') {
      return reply.code(400).send({
        success: false,
        error: 'Weak password',
        message: 'The default password cannot be reused.'
      });
    }

    const dbUser = await database.getUserById(request.user.id);
    if (!dbUser) {
      return reply.code(404).send({
        success: false,
        error: 'User not found',
        message: 'Unable to update password for this user.'
      });
    }

    const passwordHash = hashPassword(newPassword);
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           is_active = TRUE,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, dbUser.id]
    );

    const updatedUser = await database.getUserById(dbUser.id);
    sendAuthSuccess(request, reply, updatedUser, {
      tokenClaims: { bootstrapPasswordChangeRequired: false },
      responseData: {
        mustChangePassword: false,
        message: 'Password updated successfully.'
      }
    });
  });
}
