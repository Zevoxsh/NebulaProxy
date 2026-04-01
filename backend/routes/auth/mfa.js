import { database } from '../../services/database.js';
import { generateTotpSecret, generateOtpAuthUrl, verifyTotpCode } from '../../utils/totp.js';
import {
  normalizeOtpCode,
  createPendingTwoFactorToken,
  getTwoFactorEmailMask,
  encryptTotpSecret,
  decryptTotpSecret,
  ensureEmail2faReady,
  generateEmailOtp,
  createTwoFactorCode,
  verifyTwoFactorCode,
  getUserTwoFactorMethods,
  upsertUserTwoFactorMethod,
  disableUserTwoFactorMethod,
  syncLegacyTwoFactorState,
  sendTwoFactorEmailCode,
  sendAuthSuccess
} from './helpers.js';

export async function mfaRoutes(fastify, options) {
  // Initiate selected second-factor challenge for pending login
  fastify.post('/2fa/challenge', {
    schema: {
      body: {
        type: 'object',
        required: ['pendingToken', 'method'],
        properties: {
          pendingToken: { type: 'string', minLength: 10, maxLength: 4096 },
          method: { type: 'string', enum: ['email', 'totp'] }
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
    const { pendingToken, method } = request.body;
    try {
      const payload = fastify.jwt.verify(pendingToken);
      const methods = Array.isArray(payload?.methods) ? payload.methods : [];
      if (payload?.type !== '2fa_pending' || !payload?.id || !methods.includes(method)) {
        return reply.code(401).send({
          success: false,
          error: 'Invalid challenge',
          message: 'Invalid or expired 2FA challenge.'
        });
      }

      const dbUser = await database.getUserById(payload.id);
      if (!dbUser || dbUser.is_active === false) {
        return reply.code(401).send({
          success: false,
          error: 'Invalid challenge',
          message: 'Invalid or expired 2FA challenge.'
        });
      }

      if (method === 'email') {
        if (!dbUser.email) {
          return reply.code(400).send({
            success: false,
            error: 'Email required',
            message: 'No email address found for this account.'
          });
        }
        const code = generateEmailOtp();
        await createTwoFactorCode(dbUser.id, 'login', 'email', code);
        await sendTwoFactorEmailCode(fastify, dbUser.email, code, 'login', request);
      }

      reply.send({
        success: true,
        method,
        email: method === 'email' ? getTwoFactorEmailMask(dbUser.email) : undefined,
        message: method === 'email' ? 'Verification code sent by email.' : 'Use your authenticator code to continue.'
      });
    } catch {
      return reply.code(401).send({
        success: false,
        error: 'Invalid challenge',
        message: 'Invalid or expired 2FA challenge.'
      });
    }
  });

  // SECURITY: Explicitly block GET on 2FA verify endpoint
  fastify.get('/2fa/verify', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: '2FA verification must use POST method'
    });
  });

  // Verify second factor for pending login
  fastify.post('/2fa/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['pendingToken', 'method', 'code'],
        properties: {
          pendingToken: { type: 'string', minLength: 10, maxLength: 4096 },
          method: { type: 'string', enum: ['email', 'totp'] },
          code: { type: 'string', minLength: 4, maxLength: 16 }
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
    const { pendingToken, method, code } = request.body;
    const normalizedCode = normalizeOtpCode(code);

    try {
      const payload = fastify.jwt.verify(pendingToken);
      const methods = Array.isArray(payload?.methods) ? payload.methods : [];
      if (payload?.type !== '2fa_pending' || !payload?.id || !methods.includes(method)) {
        return reply.code(401).send({
          success: false,
          error: 'Invalid challenge',
          message: 'Invalid or expired 2FA challenge.'
        });
      }

      const dbUser = await database.getUserById(payload.id);
      if (!dbUser || dbUser.is_active === false) {
        return reply.code(401).send({
          success: false,
          error: 'Invalid challenge',
          message: 'Invalid or expired 2FA challenge.'
        });
      }

      let verified = false;
      if (method === 'email') {
        verified = await verifyTwoFactorCode(dbUser.id, 'login', 'email', normalizedCode);
      } else if (method === 'totp') {
        const methodConfigs = await getUserTwoFactorMethods(dbUser.id, dbUser);
        const totpConfig = methodConfigs.find((m) => m.method === 'totp');
        const secret = decryptTotpSecret(totpConfig?.totpSecret || dbUser.two_factor_totp_secret || '');
        verified = verifyTotpCode(secret, normalizedCode);
      }

      if (!verified) {
        return reply.code(401).send({
          success: false,
          error: 'Invalid code',
          message: 'The verification code is invalid or expired.'
        });
      }

      await database.updateUserLoginTime(dbUser.id);
      sendAuthSuccess(request, reply, dbUser);
    } catch {
      return reply.code(401).send({
        success: false,
        error: 'Invalid challenge',
        message: 'Invalid or expired 2FA challenge.'
      });
    }
  });

  // Get current 2FA status
  fastify.get('/2fa/status', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const user = await database.getUserById(request.user.id);
    const methodConfigs = await getUserTwoFactorMethods(request.user.id, user);
    const methods = methodConfigs.map((m) => m.method);
    const smtpReady = await ensureEmail2faReady();
    reply.send({
      success: true,
      twoFactor: {
        enabled: methods.length > 0,
        method: methods[0] || null,
        methods,
        hasEmail: Boolean(user?.email),
        email2faReady: smtpReady.ok
      }
    });
  });

  // TOTP setup init
  fastify.post('/2fa/totp/init', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const user = await database.getUserById(request.user.id);
    if (!user?.email) {
      return reply.code(400).send({
        success: false,
        error: 'Email required',
        message: 'Add an email address before setting up 2FA.'
      });
    }

    const secret = generateTotpSecret();
    const otpauthUrl = generateOtpAuthUrl({
      issuer: 'NebulaProxy',
      accountName: user.email || user.username,
      secret
    });

    reply.send({
      success: true,
      setup: {
        secret,
        otpauthUrl
      }
    });
  });

  // TOTP setup confirm
  fastify.post('/2fa/totp/enable', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['secret', 'code'],
        properties: {
          secret: { type: 'string', minLength: 16, maxLength: 256 },
          code: { type: 'string', minLength: 4, maxLength: 16 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { secret, code } = request.body;
    const user = await database.getUserById(request.user.id);

    if (!user?.email) {
      return reply.code(400).send({
        success: false,
        error: 'Email required',
        message: 'Add an email address before setting up 2FA.'
      });
    }

    if (!verifyTotpCode(secret, normalizeOtpCode(code))) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid code',
        message: 'Invalid TOTP code. Check your authenticator app and try again.'
      });
    }

    await upsertUserTwoFactorMethod(request.user.id, 'totp', {
      totpSecret: encryptTotpSecret(secret)
    });
    await syncLegacyTwoFactorState(request.user.id);

    reply.send({
      success: true,
      message: 'TOTP two-factor authentication enabled.'
    });
  });

  // Email 2FA setup init
  fastify.post('/2fa/email/enable/init', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const user = await database.getUserById(request.user.id);
    if (!user?.email) {
      return reply.code(400).send({
        success: false,
        error: 'Email required',
        message: 'Add an email address before setting up 2FA.'
      });
    }

    const ready = await ensureEmail2faReady();
    if (!ready.ok) {
      return reply.code(400).send({
        success: false,
        error: 'Email 2FA unavailable',
        message: ready.message
      });
    }

    const code = generateEmailOtp();
    await createTwoFactorCode(user.id, 'enable_email', 'email', code);
    await sendTwoFactorEmailCode(fastify, user.email, code, 'enable_email', request);

    reply.send({
      success: true,
      message: `Verification code sent to ${getTwoFactorEmailMask(user.email)}`
    });
  });

  // Email 2FA setup verify
  fastify.post('/2fa/email/enable/verify', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 4, maxLength: 16 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const user = await database.getUserById(request.user.id);
    if (!user?.email) {
      return reply.code(400).send({
        success: false,
        error: 'Email required',
        message: 'Add an email address before setting up 2FA.'
      });
    }

    const valid = await verifyTwoFactorCode(user.id, 'enable_email', 'email', normalizeOtpCode(request.body.code));
    if (!valid) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid code',
        message: 'Invalid or expired verification code.'
      });
    }

    await upsertUserTwoFactorMethod(request.user.id, 'email');
    await syncLegacyTwoFactorState(request.user.id);

    reply.send({
      success: true,
      message: 'Email two-factor authentication enabled.'
    });
  });

  // Send disable code for email 2FA
  fastify.post('/2fa/email/disable/init', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const user = await database.getUserById(request.user.id);
    const methodConfigs = await getUserTwoFactorMethods(request.user.id, user);
    const hasEmail2fa = methodConfigs.some((m) => m.method === 'email');
    if (!hasEmail2fa) {
      return reply.code(400).send({
        success: false,
        error: 'Email 2FA not enabled',
        message: 'Email-based 2FA is not enabled on this account.'
      });
    }
    if (!user?.email) {
      return reply.code(400).send({
        success: false,
        error: 'Email required',
        message: 'No email available for verification.'
      });
    }

    const code = generateEmailOtp();
    await createTwoFactorCode(user.id, 'disable_email', 'email', code);
    await sendTwoFactorEmailCode(fastify, user.email, code, 'disable_email', request);
    reply.send({ success: true, message: 'Disable code sent to your email.' });
  });

  // Disable 2FA (TOTP code or email disable code)
  fastify.post('/2fa/disable', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['method', 'code'],
        properties: {
          method: { type: 'string', enum: ['email', 'totp'] },
          code: { type: 'string', minLength: 4, maxLength: 16 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const user = await database.getUserById(request.user.id);
    const methodConfigs = await getUserTwoFactorMethods(request.user.id, user);
    const enabledMethods = methodConfigs.map((m) => m.method);
    const { method } = request.body;
    if (enabledMethods.length === 0 || !enabledMethods.includes(method)) {
      return reply.code(400).send({
        success: false,
        error: '2FA not enabled',
        message: 'Selected two-factor method is not enabled.'
      });
    }

    const normalizedCode = normalizeOtpCode(request.body.code);
    let valid = false;

    if (method === 'totp') {
      const totpConfig = methodConfigs.find((m) => m.method === 'totp');
      const secret = decryptTotpSecret(totpConfig?.totpSecret || user.two_factor_totp_secret || '');
      valid = verifyTotpCode(secret, normalizedCode);
    } else if (method === 'email') {
      valid = await verifyTwoFactorCode(user.id, 'disable_email', 'email', normalizedCode);
    }

    if (!valid) {
      return reply.code(400).send({
        success: false,
        error: 'Invalid code',
        message: 'Invalid verification code.'
      });
    }

    await disableUserTwoFactorMethod(user.id, method);
    await syncLegacyTwoFactorState(user.id);

    reply.send({
      success: true,
      message: `${method.toUpperCase()} two-factor method disabled.`
    });
  });
}
