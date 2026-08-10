import { extractApiKeyFromHeaders } from '../utils/apiKey.js';
import { apiKeyAuthMiddleware } from '../middleware/apiKeyAuth.js';

const ROLE_HIERARCHY = { admin: 4, operator: 3, user: 2, viewer: 1 };
const PIN_TTL_MS = 4 * 60 * 60 * 1000;

function extractTokenFromCookieHeader(rawHeader) {
  if (!rawHeader) return null;
  const tokens = rawHeader
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('token='))
    .map((p) => p.slice('token='.length))
    .filter(Boolean);
  if (!tokens.length) return null;
  const raw = tokens[tokens.length - 1];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/**
 * Registers authenticate, authorize, requireAdmin decorators and the onSend security hook.
 * Must be called after JWT plugin is registered.
 */
export function setupAuthDecorators(fastify, verifyJwt, config, { redisService, publicTunnelPaths, bootstrapPasswordChangeAllowedPaths }) {
  fastify.decorate('authenticate', async function authenticate(request, reply) {
    const rawPath = String(request.raw.url || '').split('?')[0];
    if (publicTunnelPaths.has(rawPath)) return;

    const apiKey = extractApiKeyFromHeaders(request.headers);
    if (apiKey) return apiKeyAuthMiddleware(request, reply);

    try {
      let token;
      const authHeader   = request.headers.authorization;
      const cookieHeader = request.headers.cookie || '';

      if (config.logging.authDebug) {
        fastify.log.info({ path: request.raw.url, hasCookie: !!request.cookies.token, hasAuthHeader: !!authHeader }, '[AUTH DEBUG] Checking credentials');
      }

      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
        request.user = verifyJwt(token);
      } else {
        const rawToken = extractTokenFromCookieHeader(cookieHeader);
        if (rawToken) {
          try {
            token = rawToken;
            request.user = verifyJwt(token);
          } catch (err) {
            const parsedToken = request.cookies.token;
            if (parsedToken && parsedToken !== rawToken) {
              token = parsedToken;
              request.user = verifyJwt(token);
            } else {
              throw err;
            }
          }
        } else {
          await request.jwtVerify();
          token = request.cookies.token;
        }
      }

      if (token && redisService.isConnected) {
        if (await redisService.isTokenBlacklisted(token)) {
          fastify.log.warn({ path: request.raw.url }, 'Token has been revoked');
          return reply.code(401).send({ error: 'Unauthorized', message: 'Token has been revoked' });
        }
      } else if (token && !redisService.isConnected && config.security.strictTokenRevocation) {
        return reply.code(503).send({ error: 'Service Unavailable', message: 'Session validation is temporarily unavailable' });
      } else if (token && !redisService.isConnected) {
        fastify.log.warn({ path: request.raw.url }, '[SECURITY] Redis unavailable — token revocation check bypassed');
      }

      if (request.user?.bootstrapPasswordChangeRequired === true) {
        if (!bootstrapPasswordChangeAllowedPaths.has(rawPath)) {
          return reply.code(428).send({
            success: false,
            error: 'Password change required',
            code: 'BOOTSTRAP_PASSWORD_CHANGE_REQUIRED',
            message: 'You must change the default admin password before accessing the proxy.'
          });
        }
      }
    } catch {
      fastify.log.warn({ path: request.raw.url }, 'Unauthorized request');
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
  });

  fastify.decorate('authorize', (roles) => async function(request, reply) {
    await fastify.authenticate(request, reply);
    if (!request.user) return;

    const userLevel = ROLE_HIERARCHY[request.user.role] ?? 0;
    const allowed = roles.some((required) => {
      if (required === 'admin')    return request.user.role === 'admin';
      if (required === 'operator') return userLevel >= ROLE_HIERARCHY.operator;
      if (required === 'viewer')   return userLevel >= ROLE_HIERARCHY.viewer;
      if (required === 'user')     return userLevel >= ROLE_HIERARCHY.user;
      return false;
    });

    if (!allowed) {
      return reply.code(403).send({ error: 'Forbidden', message: `Role '${request.user.role}' is not allowed to perform this action` });
    }

    if (request.user.role === 'admin' && roles.includes('admin')) {
      const verifiedAt = request.user.adminPinVerifiedAt ?? (request.user.iat ? request.user.iat * 1000 : null);
      if (request.user.adminPinVerified !== true || !verifiedAt || (Date.now() - verifiedAt) > PIN_TTL_MS) {
        return reply.code(423).send({
          error: 'Admin PIN required',
          message: (verifiedAt && (Date.now() - verifiedAt) > PIN_TTL_MS)
            ? 'Admin session expired (4 h). Please re-enter your admin PIN.'
            : 'Admin PIN verification is required to access admin features.'
        });
      }
    }
  });

  fastify.decorate('requireAdmin', async function(request, reply) {
    await fastify.authenticate(request, reply);
    if (!request.user) return;
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }
    const verifiedAt = request.user.adminPinVerifiedAt ?? (request.user.iat ? request.user.iat * 1000 : null);
    if (request.user.adminPinVerified !== true || !verifiedAt || (Date.now() - verifiedAt) > PIN_TTL_MS) {
      return reply.code(423).send({
        error: 'Admin PIN required',
        message: (verifiedAt && (Date.now() - verifiedAt) > PIN_TTL_MS)
          ? 'Admin session expired (4 h). Please re-enter your admin PIN.'
          : 'Admin PIN verification is required to access admin features.'
      });
    }
  });

  fastify.addHook('onSend', async (request, reply) => {
    reply.removeHeader('X-Powered-By');
    reply.removeHeader('Server');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');

    if (config.nodeEnv === 'production') {
      if (config.security.hstsEnabled) {
        const directives = [`max-age=${config.security.hstsMaxAgeSeconds}`];
        if (config.security.hstsIncludeSubDomains) directives.push('includeSubDomains');
        if (config.security.hstsPreload) directives.push('preload');
        reply.header('Strict-Transport-Security', directives.join('; '));
      } else {
        reply.header('Strict-Transport-Security', 'max-age=0');
      }
    }

    const isDev = config.nodeEnv === 'development';
    reply.header('Content-Security-Policy', [
      "default-src 'self'",
      isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; '));

    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });
}
