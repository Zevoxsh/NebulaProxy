import { database } from '../../services/database.js';
import { pool } from '../../config/database.js';
import {
  hashAdminPin,
  verifyAdminPin,
  normalizeOtpCode,
  hashOtpCode,
  generateEmailLinkToken,
  getTwoFactorEmailMask,
  ensureEmail2faReady,
  createTwoFactorCode,
  sendEmailActionLink,
  buildAppUrl,
  sendAuthSuccess,
  ADMIN_PIN_MAX_FAILED_ATTEMPTS,
  ADMIN_PIN_LOCK_MINUTES
} from './helpers.js';

export async function adminPinRoutes(fastify, options) {
  // Admin PIN status (required to enter admin panel)
  fastify.get('/admin-pin/status', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden',
        message: 'Admin access required.'
      });
    }

    const user = await database.getUserById(request.user.id);
    reply.send({
      success: true,
      adminPin: {
        setupRequired: !user?.admin_pin_hash,
        verified: request.user.adminPinVerified === true,
        hasEmail: Boolean(user?.email)
      }
    });
  });

  // SECURITY: Explicitly block GET on admin-pin setup endpoint
  fastify.get('/admin-pin/setup', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Admin PIN setup must use POST method'
    });
  });

  // Setup admin PIN (first-time)
  fastify.post('/admin-pin/setup', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['pin'],
        properties: {
          pin: { type: 'string', pattern: '^[0-9]{4}$' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden',
        message: 'Admin access required.'
      });
    }

    const user = await database.getUserById(request.user.id);
    if (user?.admin_pin_hash) {
      return reply.code(409).send({
        success: false,
        error: 'PIN already configured',
        message: 'Admin PIN is already configured. Use reset if needed.'
      });
    }

    const pinHash = hashAdminPin(request.body.pin);
    await pool.query(
      `UPDATE users
       SET admin_pin_hash = $1,
           admin_pin_set_at = NOW(),
           admin_pin_failed_attempts = 0,
           admin_pin_locked_until = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [pinHash, request.user.id]
    );

    const updatedUser = await database.getUserById(request.user.id);
    sendAuthSuccess(request, reply, updatedUser, {
      tokenClaims: { adminPinVerified: true },
      responseData: { message: 'Admin PIN created and verified.' }
    });
  });

  // SECURITY: Explicitly block GET on admin-pin verify endpoint
  fastify.get('/admin-pin/verify', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Admin PIN verification must use POST method'
    });
  });

  // Verify admin PIN for current session
  fastify.post('/admin-pin/verify', {
    preHandler: fastify.authenticate,
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['pin'],
        properties: {
          pin: { type: 'string', pattern: '^[0-9]{4}$' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden',
        message: 'Admin access required.'
      });
    }

    const user = await database.getUserById(request.user.id);
    if (!user?.admin_pin_hash) {
      return reply.code(400).send({
        success: false,
        error: 'PIN not set',
        message: 'Admin PIN is not configured yet.'
      });
    }

    if (user.admin_pin_locked_until && new Date(user.admin_pin_locked_until) > new Date()) {
      return reply.code(423).send({
        success: false,
        error: 'PIN locked',
        message: 'Too many failed PIN attempts. Please try again later.'
      });
    }

    if (!verifyAdminPin(request.body.pin, user.admin_pin_hash)) {
      const nextAttempts = Number(user.admin_pin_failed_attempts || 0) + 1;
      const lockUntil = nextAttempts >= ADMIN_PIN_MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + ADMIN_PIN_LOCK_MINUTES * 60 * 1000)
        : null;
      await pool.query(
        `UPDATE users
         SET admin_pin_failed_attempts = $1,
             admin_pin_locked_until = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [nextAttempts, lockUntil, user.id]
      );

      return reply.code(400).send({
        success: false,
        error: 'Invalid PIN',
        message: 'The admin PIN is incorrect.'
      });
    }

    await pool.query(
      `UPDATE users
       SET admin_pin_failed_attempts = 0,
           admin_pin_locked_until = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    sendAuthSuccess(request, reply, user, {
      tokenClaims: { adminPinVerified: true },
      responseData: { message: 'Admin PIN verified.' }
    });
  });

  // SECURITY: Explicitly block GET on admin-pin reset request endpoint
  fastify.get('/admin-pin/reset/request', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Admin PIN reset request must use POST method'
    });
  });

  // Request reset link for admin PIN via email
  fastify.post('/admin-pin/reset/request', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden',
        message: 'Admin access required.'
      });
    }

    const user = await database.getUserById(request.user.id);
    if (!user?.email) {
      return reply.code(400).send({
        success: false,
        error: 'Email required',
        message: 'Add an email address before resetting admin PIN.'
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

    const token = generateEmailLinkToken();
    await createTwoFactorCode(user.id, 'admin_pin_reset', 'link', token);
    const resetUrl = buildAppUrl(request, '/admin/pin-reset', { token });
    await sendEmailActionLink(fastify, user.email, {
      subject: 'NebulaProxy - Admin PIN reset link',
      actionLabel: 'reset your admin panel PIN',
      actionUrl: resetUrl
    });

    reply.send({
      success: true,
      message: `Reset link sent to ${getTwoFactorEmailMask(user.email)}`
    });
  });

  // SECURITY: Explicitly block GET on admin-pin reset confirm endpoint
  fastify.get('/admin-pin/reset/confirm', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Admin PIN reset confirmation must use POST method'
    });
  });

  // Confirm reset link token and set new admin PIN
  fastify.post('/admin-pin/reset/confirm', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'pin'],
        properties: {
          token: { type: 'string', minLength: 16, maxLength: 512 },
          pin: { type: 'string', pattern: '^[0-9]{4}$' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const token = normalizeOtpCode(request.body.token);
    const tokenHash = hashOtpCode(token);
    const resetRes = await pool.query(
      `SELECT c.id AS code_id, u.id, u.email, u.role
       FROM user_two_factor_codes c
       JOIN users u ON u.id = c.user_id
       WHERE c.purpose = 'admin_pin_reset'
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
        error: 'Invalid link',
        message: 'Invalid or expired reset link.'
      });
    }

    const user = resetRes.rows[0];
    if (user.role !== 'admin' || !user.email) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid link',
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
        error: 'Invalid link',
        message: 'Invalid or expired reset link.'
      });
    }

    const pinHash = hashAdminPin(request.body.pin);
    await pool.query(
      `UPDATE users
       SET admin_pin_hash = $1,
           admin_pin_set_at = NOW(),
           admin_pin_failed_attempts = 0,
           admin_pin_locked_until = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [pinHash, user.id]
    );

    reply.send({
      success: true,
      message: 'Admin PIN reset successful. You can now open the admin panel.'
    });
  });
}
