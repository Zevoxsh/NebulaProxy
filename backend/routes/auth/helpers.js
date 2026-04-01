import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../../config/config.js';
import { database } from '../../services/database.js';
import { pool } from '../../config/database.js';

export const DEFAULT_BOOTSTRAP_ADMIN_HASH = 'scrypt$1234567890abcdef$30d5078d009e954c799fe00cb0c48210d1794ae08af401f602b3a309996d59ad998fbd746822433568d272f3f0e9d504248cae9c57d4d0c36ab58f3d62eec384';
export const ADMIN_PIN_MAX_FAILED_ATTEMPTS = 5;
export const ADMIN_PIN_LOCK_MINUTES = 15;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

// SECURITY FIX: Timing-safe password verification
// Always takes the same time regardless of whether user exists or password is correct
export function verifyPassword(password, stored) {
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

export function hashAdminPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export function verifyAdminPin(pin, stored) {
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

export function normalizeOtpCode(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function isDefaultBootstrapAdminUser(user) {
  return Boolean(
    user
    && user.role === 'admin'
    && user.username === 'admin'
    && user.password_hash === DEFAULT_BOOTSTRAP_ADMIN_HASH
  );
}

export function isBootstrapAdminIdentity(user) {
  return Boolean(
    user
    && user.role === 'admin'
    && user.username === 'admin'
    && user.email === 'admin@localhost'
  );
}

export function generateEmailLinkToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateEmailOtp() {
  // SECURITY: crypto.randomInt is cryptographically secure, Math.random() is not
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtpCode(code) {
  return crypto
    .createHash('sha256')
    .update(`${config.jwtSecret}:${code}`)
    .digest('hex');
}

export function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function createPendingTwoFactorToken(fastify, dbUser, methods = [], extraClaims = {}) {
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

export function getTwoFactorEmailMask(email) {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const maskedLocal = local.length <= 2
    ? `${local[0] || '*'}*`
    : `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}`;
  return `${maskedLocal}@${domain}`;
}

export function encryptTotpSecret(secret) {
  const key = crypto.createHash('sha256').update(config.jwtSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptTotpSecret(payload) {
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

export async function getEmail2faConfig() {
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

export async function ensureEmail2faReady() {
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

export function renderEmailTemplate(templateName, variables) {
  const baseTemplate = readFileSync(
    join(__auth_dirname, '..', '..', 'emails', 'partials', 'base.html'),
    'utf-8'
  );
  const contentTemplate = readFileSync(
    join(__auth_dirname, '..', '..', 'emails', 'templates', `${templateName}.html`),
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

export async function sendTwoFactorEmailCode(fastify, toEmail, code, purpose = 'login', request = null) {
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

export function getAppPublicBaseUrl(request) {
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

export function buildAppUrl(request, path, params = {}) {
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

export async function sendEmailActionLink(fastify, toEmail, { subject, actionLabel, actionUrl, expiresMinutes = 10 }) {
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

export async function createTwoFactorCode(userId, purpose, method, rawCode, ttlMinutes = 10) {
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

export async function verifyTwoFactorCode(userId, purpose, method, rawCode) {
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

export async function getUserTwoFactorMethods(userId, legacyUser = null) {
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

export async function upsertUserTwoFactorMethod(userId, method, { totpSecret = null } = {}) {
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

export async function disableUserTwoFactorMethod(userId, method) {
  await pool.query(
    `UPDATE user_two_factor_methods
     SET enabled = FALSE, totp_secret = NULL, updated_at = NOW()
     WHERE user_id = $1 AND method = $2`,
    [userId, method]
  );
}

export async function syncLegacyTwoFactorState(userId) {
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

export function sendAuthSuccess(request, reply, dbUser, options = {}) {
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

export function getWebauthnContext(request) {
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || request.headers.host || '';
  const cleanHost = String(host).split(',')[0].trim();
  const rpID = cleanHost.split(':')[0];
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || request.protocol || 'http';
  const origin = `${proto}://${cleanHost}`;
  return { rpID, origin };
}
