import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { ldapAuth } from '../services/ldap.js';
import { config } from '../config/config.js';
import { autoRegisterUser } from '../middleware/autoRegister.js';
import { database } from '../services/database.js';
import { redisService } from '../services/redis.js';
import { pool } from '../config/database.js';
import { generateTotpSecret, generateOtpAuthUrl, verifyTotpCode } from '../utils/totp.js';

const pendingPasskeyAuthentications = new Map();
const DEFAULT_BOOTSTRAP_ADMIN_HASH = 'scrypt$1234567890abcdef$30d5078d009e954c799fe00cb0c48210d1794ae08af401f602b3a309996d59ad998fbd746822433568d272f3f0e9d504248cae9c57d4d0c36ab58f3d62eec384';
const ADMIN_PIN_MAX_FAILED_ATTEMPTS = 5;
const ADMIN_PIN_LOCK_MINUTES = 15;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

// SECURITY FIX: Timing-safe password verification
// Always takes the same time regardless of whether user exists or password is correct
function verifyPassword(password, stored) {
  // Default dummy hash for timing-safe comparison when user doesn't exist
  const dummyHash = 'scrypt$0000000000000000$0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

  // Use stored hash if available, otherwise use dummy hash
  const hashToVerify = stored || dummyHash;

  try {
    const parts = hashToVerify.split('$');
    if (parts.length !== 3) {
      // Still compute something to maintain timing
      crypto.scryptSync(password, '0000000000000000', 64);
      return false;
    }

    const [algo, salt, hashHex] = parts;
    if (algo !== 'scrypt') {
      // Still compute something to maintain timing
      crypto.scryptSync(password, salt || '0000000000000000', 64);
      return false;
    }

    const hash = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password, salt, hash.length);

    // Use timingSafeEqual for constant-time comparison
    const isValid = crypto.timingSafeEqual(hash, derived);

    // Only return true if we had a real stored hash AND it matched
    return stored && isValid;
  } catch (err) {
    // On error, still return false after some computation
    return false;
  }
}

function hashAdminPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

function verifyAdminPin(pin, stored) {
  if (!stored) return false;
  try {
    const [algo, salt, hashHex] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(pin, salt, expected.length);
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

function normalizeOtpCode(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function isDefaultBootstrapAdminUser(user) {
  return Boolean(
    user
    && user.role === 'admin'
    && user.username === 'admin'
    && user.password_hash === DEFAULT_BOOTSTRAP_ADMIN_HASH
  );
}

function isBootstrapAdminIdentity(user) {
  return Boolean(
    user
    && user.role === 'admin'
    && user.username === 'admin'
    && user.email === 'admin@localhost'
  );
}

function generateEmailLinkToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateEmailOtp() {
  // SECURITY: crypto.randomInt is cryptographically secure, Math.random() is not
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashOtpCode(code) {
  return crypto
    .createHash('sha256')
    .update(`${config.jwtSecret}:${code}`)
    .digest('hex');
}

function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createPendingTwoFactorToken(fastify, dbUser, methods = [], extraClaims = {}) {
  return fastify.jwt.sign(
    {
      type: '2fa_pending',
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
      methods,
      ...extraClaims
    },
    { expiresIn: '10m' }
  );
}

function getTwoFactorEmailMask(email) {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const maskedLocal = local.length <= 2
    ? `${local[0] || '*'}*`
    : `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}`;
  return `${maskedLocal}@${domain}`;
}

function encryptTotpSecret(secret) {
  const key = crypto.createHash('sha256').update(config.jwtSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptTotpSecret(payload) {
  if (!payload || typeof payload !== 'string') return '';
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return '';
  const key = crypto.createHash('sha256').update(config.jwtSecret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

async function getEmail2faConfig() {
  const [notificationConfigRes, smtpStatusRes] = await Promise.all([
    pool.query('SELECT value FROM system_config WHERE key = $1', ['notification_config']),
    pool.query('SELECT value FROM system_config WHERE key = $1', ['smtp_test_status'])
  ]);

  const notificationConfig = notificationConfigRes.rows.length > 0
    ? JSON.parse(notificationConfigRes.rows[0].value || '{}')
    : {};
  const emailCfg = notificationConfig.email || {};
  const smtpStatus = smtpStatusRes.rows.length > 0
    ? JSON.parse(smtpStatusRes.rows[0].value || '{}')
    : {};

  return {
    enabled: Boolean(emailCfg.enabled),
    tested: smtpStatus?.ok === true,
    smtpHost: emailCfg.smtp_host || '',
    smtpPort: Number(emailCfg.smtp_port) || 587,
    smtpUser: emailCfg.smtp_user || '',
    smtpPassword: emailCfg.smtp_password || '',
    fromEmail: emailCfg.from_email || ''
  };
}

async function ensureEmail2faReady() {
  const cfg = await getEmail2faConfig();
  const isConfigured = cfg.enabled && cfg.smtpHost && cfg.fromEmail;
  if (!isConfigured) {
    return { ok: false, message: '2FA email is unavailable: SMTP is not configured/enabled by admin.' };
  }
  if (!cfg.tested) {
    return { ok: false, message: '2FA email is unavailable: admin must test SMTP successfully first.' };
  }
  return { ok: true, config: cfg };
}

const __auth_filename = fileURLToPath(import.meta.url);
const __auth_dirname = dirname(__auth_filename);

function renderEmailTemplate(templateName, variables) {
  const baseTemplate = readFileSync(
    join(__auth_dirname, '..', 'emails', 'partials', 'base.html'),
    'utf-8'
  );
  const contentTemplate = readFileSync(
    join(__auth_dirname, '..', 'emails', 'templates', `${templateName}.html`),
    'utf-8'
  );

  const renderVars = (tpl, vars) => {
    let out = tpl;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`{{${k}}}`, 'g'), v ?? '');
    }
    return out;
  };

  const renderedContent = renderVars(contentTemplate, variables);
  return renderVars(baseTemplate, {
    title: variables.title || 'NebulaProxy Notification',
    content: renderedContent,
    dashboardUrl: variables.dashboardUrl || process.env.DASHBOARD_URL || 'http://localhost:3000',
    supportUrl: process.env.SUPPORT_URL || 'https://support.example.com',
    year: new Date().getFullYear()
  });
}

async function sendTwoFactorEmailCode(fastify, toEmail, code, purpose = 'login', request = null) {
  const ready = await ensureEmail2faReady();
  if (!ready.ok) {
    throw new Error(ready.message);
  }

  const cfg = ready.config;
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPassword } : undefined
  });

  const purposeConfig = {
    login: {
      subject: 'NebulaProxy - Login verification code',
      template: 'verification-code',
      actionLabel: 'complete your sign-in'
    },
    enable_email: {
      subject: 'NebulaProxy - 2FA email verification code',
      template: 'verification-code',
      actionLabel: 'confirm your 2FA email setup'
    },
    disable_email: {
      subject: 'NebulaProxy - 2FA disable verification code',
      template: 'verification-code',
      actionLabel: 'disable email two-factor authentication'
    },
    admin_pin_reset: {
      subject: 'NebulaProxy - Admin PIN reset code',
      template: 'admin-pin-reset',
      actionLabel: 'reset your admin panel PIN'
    },
    password_reset: {
      subject: 'NebulaProxy - Password reset code',
      template: 'password-reset-code',
      actionLabel: 'reset your account password'
    }
  };
  const cfgPurpose = purposeConfig[purpose] || purposeConfig.enable_email;

  const dashboardUrl = (request && getAppPublicBaseUrl(request)) || process.env.DASHBOARD_URL || '';
  const html = renderEmailTemplate(cfgPurpose.template, {
    title: cfgPurpose.subject,
    code,
    actionLabel: cfgPurpose.actionLabel,
    dashboardUrl
  });

  await transporter.sendMail({
    from: cfg.fromEmail,
    to: toEmail,
    subject: cfgPurpose.subject,
    html
  });
}

function getAppPublicBaseUrl(request) {
  const configured =
    process.env.PUBLIC_APP_URL
    || process.env.APP_URL
    || process.env.FRONTEND_PUBLIC_URL
    || '';
  if (configured) {
    try {
      const configuredUrl = new URL(configured.replace(/\/+$/, ''));
      if (configuredUrl.protocol !== 'http:' && configuredUrl.protocol !== 'https:') {
        return '';
      }
      return configuredUrl.origin;
    } catch {
      return '';
    }
  }

  return '';
}

function buildAppUrl(request, path, params = {}) {
  const base = getAppPublicBaseUrl(request);
  const url = new URL(path, base || 'http://localhost');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  if (!base) {
    return `${path}${url.search}`;
  }
  return url.toString();
}

async function sendEmailActionLink(fastify, toEmail, { subject, actionLabel, actionUrl, expiresMinutes = 10 }) {
  const ready = await ensureEmail2faReady();
  if (!ready.ok) {
    throw new Error(ready.message);
  }

  const cfg = ready.config;
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPassword } : undefined
  });

  await transporter.sendMail({
    from: cfg.fromEmail,
    to: toEmail,
    subject,
    html: `
      <h2>NebulaProxy secure action</h2>
      <p>Use this link to ${actionLabel}:</p>
      <p>
        <a href="${actionUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;">
          Open secure reset page
        </a>
      </p>
      <p>If the button does not work, open this URL manually:</p>
      <p style="word-break: break-all;"><a href="${actionUrl}">${actionUrl}</a></p>
      <p>This link expires in ${expiresMinutes} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `
  });
}

async function createTwoFactorCode(userId, purpose, method, rawCode, ttlMinutes = 10) {
  await pool.query(
    `UPDATE user_two_factor_codes
     SET consumed_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND method = $3 AND consumed_at IS NULL`,
    [userId, purpose, method]
  );

  await pool.query(
    `INSERT INTO user_two_factor_codes (user_id, purpose, method, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)`,
    [userId, purpose, method, hashOtpCode(rawCode), String(ttlMinutes)]
  );
}

async function verifyTwoFactorCode(userId, purpose, method, rawCode) {
  const result = await pool.query(
    `SELECT id, code_hash, attempts, expires_at
     FROM user_two_factor_codes
     WHERE user_id = $1
       AND purpose = $2
       AND method = $3
       AND consumed_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, purpose, method]
  );

  if (result.rows.length === 0) return false;
  const row = result.rows[0];
  const incomingHash = hashOtpCode(rawCode);
  const matched = timingSafeStringEqual(row.code_hash, incomingHash);

  if (!matched) {
    const nextAttempts = Number(row.attempts || 0) + 1;
    if (nextAttempts >= 5) {
      await pool.query(
        'UPDATE user_two_factor_codes SET attempts = $1, consumed_at = NOW() WHERE id = $2',
        [nextAttempts, row.id]
      );
    } else {
      await pool.query('UPDATE user_two_factor_codes SET attempts = $1 WHERE id = $2', [nextAttempts, row.id]);
    }
    return false;
  }

  await pool.query('UPDATE user_two_factor_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
  return true;
}

async function getUserTwoFactorMethods(userId, legacyUser = null) {
  try {
    const result = await pool.query(
      `SELECT method, totp_secret
       FROM user_two_factor_methods
       WHERE user_id = $1 AND enabled = TRUE
       ORDER BY method ASC`,
      [userId]
    );

    if (result.rows.length > 0) {
      return result.rows.map((row) => ({
        method: row.method,
        totpSecret: row.totp_secret || null
      }));
    }
  } catch {
    // Backward compatibility while migration is rolling out
  }

  if (legacyUser?.two_factor_enabled && legacyUser?.two_factor_method) {
    return [{
      method: legacyUser.two_factor_method,
      totpSecret: legacyUser.two_factor_totp_secret || null
    }];
  }

  return [];
}

async function upsertUserTwoFactorMethod(userId, method, { totpSecret = null } = {}) {
  await pool.query(
    `INSERT INTO user_two_factor_methods (user_id, method, enabled, totp_secret, enabled_at, updated_at)
     VALUES ($1, $2, TRUE, $3, NOW(), NOW())
     ON CONFLICT (user_id, method)
     DO UPDATE SET
       enabled = TRUE,
       totp_secret = EXCLUDED.totp_secret,
       enabled_at = COALESCE(user_two_factor_methods.enabled_at, NOW()),
       updated_at = NOW()`,
    [userId, method, totpSecret]
  );
}

async function disableUserTwoFactorMethod(userId, method) {
  await pool.query(
    `UPDATE user_two_factor_methods
     SET enabled = FALSE, totp_secret = NULL, updated_at = NOW()
     WHERE user_id = $1 AND method = $2`,
    [userId, method]
  );
}

async function syncLegacyTwoFactorState(userId) {
  let methods = [];
  try {
    const result = await pool.query(
      `SELECT method, totp_secret
       FROM user_two_factor_methods
       WHERE user_id = $1 AND enabled = TRUE`,
      [userId]
    );
    methods = result.rows;
  } catch {
    return;
  }

  if (methods.length === 0) {
    await pool.query(
      `UPDATE users
       SET two_factor_enabled = FALSE,
           two_factor_method = NULL,
           two_factor_totp_secret = NULL,
           two_factor_enabled_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    return;
  }

  const hasTotp = methods.find((m) => m.method === 'totp');
  const primaryMethod = hasTotp ? 'totp' : methods[0].method;
  await pool.query(
    `UPDATE users
     SET two_factor_enabled = TRUE,
         two_factor_method = $1,
         two_factor_totp_secret = $2,
         two_factor_enabled_at = COALESCE(two_factor_enabled_at, NOW()),
         updated_at = NOW()
     WHERE id = $3`,
    [primaryMethod, hasTotp?.totp_secret || null, userId]
  );
}

function sendAuthSuccess(request, reply, dbUser, options = {}) {
  const tokenClaims = options.tokenClaims || {};
  const responseData = options.responseData || {};
  const token = request.server.jwt.sign(
    {
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
      displayName: dbUser.display_name,
      email: dbUser.email,
      avatarUrl: dbUser.avatar_url || null,
      adminPinVerified: dbUser.role === 'admin'
        ? (typeof tokenClaims.adminPinVerified === 'boolean' ? tokenClaims.adminPinVerified : false)
        : true,
      ...tokenClaims
    },
    { expiresIn: config.jwtExpiry }
  );

  const isSecureRequest = request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';

  // Get the host from request headers (works with reverse proxy)
  const host = request.headers.host;

  // Cookie options
  // IMPORTANT: Do NOT set explicit domain - let browser use exact host match
  // This works correctly with reverse proxies and avoids subdomain cookie issues
  const cookieOptions = {
    httpOnly: true,
    secure: config.nodeEnv === 'production' && isSecureRequest,
    sameSite: config.nodeEnv === 'production' && isSecureRequest ? 'strict' : 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  };

  if (config.logging.authDebug) {
    request.server.log.info({
      host,
      cookieOptions,
      isSecureRequest,
      protocol: request.protocol,
      forwardedProto: request.headers['x-forwarded-proto']
    }, '[AUTH DEBUG] Setting auth cookie');
  }

  reply
    .setCookie('token', token, cookieOptions)
    .send({
      success: true,
      user: {
        id: dbUser.id,
        username: dbUser.username,
        displayName: dbUser.display_name,
        email: dbUser.email,
        role: dbUser.role,
        avatarUrl: dbUser.avatar_url || null
      },
      ...responseData
    });
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

export async function authRoutes(fastify, options) {
  // Auth mode endpoint
  // SECURITY FIX: Return generic response to avoid information disclosure
  // Frontend can determine auth type from registration availability
  fastify.get('/mode', async (request, reply) => {
    let registrationEnabled = false;

    if (config.auth.mode === 'local') {
      try {
        const result = await pool.query(
          'SELECT value FROM system_config WHERE key = $1',
          ['registration_enabled']
        );
        registrationEnabled = result.rows.length > 0 ? result.rows[0].value === 'true' : true;
      } catch (error) {
        fastify.log.error({ error }, 'Failed to check registration config');
        registrationEnabled = true; // Default to enabled if check fails
      }
    }

    // Don't expose internal auth configuration
    reply.send({
      registrationEnabled,
      // Only reveal this for legitimate use case (login form behavior)
      authType: config.auth.mode === 'local' ? 'local' : 'enterprise'
    });
  });

  // SECURITY: Explicitly block GET on login endpoint
  fastify.get('/login', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Login must use POST method'
    });
  });

  // Login endpoint
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9._@-]+$'
          },
          password: {
            type: 'string',
            minLength: 1,
            maxLength: 1024
          }
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
    const { username, password } = request.body;

    const handleTwoFactorIfNeeded = async (dbUser) => {
      const methodConfigs = await getUserTwoFactorMethods(dbUser.id, dbUser);
      const methods = methodConfigs.map((m) => m.method);
      if (methods.length === 0) return false;

      if (!dbUser.email) {
        return reply.code(400).send({
          success: false,
          error: 'Email required',
          message: 'Two-factor authentication requires an email address on your account.'
        });
      }

      const pendingToken = createPendingTwoFactorToken(
        fastify,
        dbUser,
        methods,
        { bootstrapPasswordChangeRequired: isDefaultBootstrapAdminUser(dbUser) }
      );
      reply.send({
        success: true,
        requires2fa: true,
        methods,
        defaultMethod: methods.includes('totp') ? 'totp' : methods[0],
        pendingToken,
        email: methods.includes('email') ? getTwoFactorEmailMask(dbUser.email) : undefined
      });
      return true;
    };

    try {
      fastify.log.info({ username }, 'Login request received');
      if (config.auth.mode === 'local') {
        const dbUser = await database.getUserByUsername(username);
        if (!dbUser || !dbUser.password_hash) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication failed',
            message: 'Invalid credentials'
          });
        }

        const requiresBootstrapPasswordChange = isDefaultBootstrapAdminUser(dbUser);
        const allowDisabledBootstrapLogin = isBootstrapAdminIdentity(dbUser);

        if (dbUser.is_active === false && !allowDisabledBootstrapLogin) {
          return reply.code(403).send({
            success: false,
            error: 'Account disabled',
            message: 'Your account is disabled'
          });
        }

        const isValid = verifyPassword(password, dbUser.password_hash);
        if (!isValid) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication failed',
            message: 'Invalid credentials'
          });
        }

        if (dbUser.is_active === false && allowDisabledBootstrapLogin) {
          await pool.query(
            `UPDATE users
             SET is_active = TRUE, updated_at = NOW()
             WHERE id = $1`,
            [dbUser.id]
          );
          dbUser.is_active = true;
        }

        if (await handleTwoFactorIfNeeded(dbUser)) {
          return;
        }

        await database.updateUserLoginTime(dbUser.id);
        sendAuthSuccess(request, reply, dbUser, {
          tokenClaims: { bootstrapPasswordChangeRequired: requiresBootstrapPasswordChange },
          responseData: {
            mustChangePassword: requiresBootstrapPasswordChange
          }
        });
        fastify.log.info({ username: dbUser.username, role: dbUser.role }, 'User logged in (local)');
        return;
      }

      const ldapUser = await ldapAuth.authenticate(username, password);
      const dbUser = await autoRegisterUser(ldapUser);

      if (await handleTwoFactorIfNeeded(dbUser)) {
        return;
      }

      await database.updateUserLoginTime(dbUser.id);
      sendAuthSuccess(request, reply, dbUser, {
        tokenClaims: { bootstrapPasswordChangeRequired: false },
        responseData: {
          mustChangePassword: false
        }
      });
      fastify.log.info({ username: dbUser.username, role: dbUser.role }, 'User logged in (ldap)');
    } catch (error) {
      fastify.log.error({ error, username }, 'Login failed');

      reply.code(401).send({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }
  });

  // SECURITY: Explicitly block GET on register endpoint
  fastify.get('/register', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Register must use POST method'
    });
  });

  // Register endpoint (local auth only)
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9._@-]+$'
          },
          displayName: {
            type: 'string',
            minLength: 1,
            maxLength: 255
          },
          email: {
            type: 'string',
            maxLength: 255
          },
          password: {
            type: 'string',
            minLength: 8,
            maxLength: 1024
          }
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
        error: 'Registration disabled',
        message: 'Local registration is disabled'
      });
    }

    // Check if registration is enabled in config
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['registration_enabled']
      );
      const registrationEnabled = result.rows.length > 0 ? result.rows[0].value === 'true' : true;

      if (!registrationEnabled) {
        return reply.code(403).send({
          success: false,
          error: 'Registration disabled',
          message: 'Public registration is currently disabled'
        });
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to check registration config');
      // Continue anyway if config check fails
    }

    const { username, password, displayName, email } = request.body;

    try {
      const existing = await database.getUserByUsername(username);
      if (existing) {
        return reply.code(409).send({
          success: false,
          error: 'User already exists',
          message: 'Username is already taken'
        });
      }

      const passwordHash = hashPassword(password);
      const dbUser = await database.createUser({
        username,
        displayName: displayName || username,
        email,
        role: 'user',
        passwordHash
      });

      sendAuthSuccess(request, reply, dbUser);
      fastify.log.info({ username: dbUser.username }, 'User registered (local)');
    } catch (error) {
      fastify.log.error({ error, username }, 'Registration failed');
      reply.code(500).send({
        success: false,
        error: 'Registration failed',
        message: 'Unable to register user'
      });
    }
  });

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

  // SECURITY: Explicitly block GET on logout endpoint
  fastify.get('/logout', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Logout must use POST method'
    });
  });

  // Logout endpoint with JWT revocation
  fastify.post('/logout', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      // SECURITY FIX: Blacklist the JWT token so it can't be reused
      const token = request.cookies.token || request.headers.authorization?.slice(7);

      if (token && redisService.isConnected) {
        // Decode the token to get expiration time (already validated by authenticate)
        const decoded = fastify.jwt.decode(token);
        if (decoded && decoded.exp) {
          await redisService.blacklistToken(token, decoded.exp);
          fastify.log.info({ user: request.user.username }, 'JWT token blacklisted on logout');
        }
      } else if (token && !redisService.isConnected) {
        fastify.log.warn('Cannot blacklist token - Redis not connected');
      }

      reply
        .clearCookie('token', { path: '/' })
        .send({
          success: true,
          message: 'Logged out successfully'
        });
    } catch (error) {
      fastify.log.error({ error }, 'Logout error');
      // Still clear the cookie even if blacklisting fails
      reply
        .clearCookie('token', { path: '/' })
        .send({
          success: true,
          message: 'Logged out successfully'
        });
    }
  });

  // Verify token endpoint
  fastify.get('/verify', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    reply.send({
      success: true,
      user: {
        username: request.user.username,
        displayName: request.user.displayName,
        email: request.user.email,
        role: request.user.role
      }
    });
  });

  // LDAP connection test (admin only)
  fastify.get('/test-ldap', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    if (config.auth.mode !== 'ldap') {
      return reply.code(400).send({
        success: false,
        error: 'LDAP disabled',
        message: 'LDAP authentication is disabled'
      });
    }

    try {
      await ldapAuth.verifyConnection();
      reply.send({
        success: true,
        message: 'LDAP connection successful'
      });
    } catch (error) {
      reply.code(500).send({
        success: false,
        error: 'LDAP connection failed',
        message: error.message
      });
    }
  });
}
