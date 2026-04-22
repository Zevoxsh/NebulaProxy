import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import csrf from '@fastify/csrf-protection';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import httpProxy from 'http-proxy';
import fastifyHttpProxy from '@fastify/http-proxy';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces } from 'os';
import { isIP } from 'net';
import { config, initializeConfig } from './config/config.js';
import { ldapAuth } from './services/ldap.js';
import { database } from './services/database.js';
import { redisService } from './services/redis.js';
import { geoIpService } from './services/geoIpService.js';
import { ddosProtectionService } from './services/ddosProtectionService.js';
import { testPostgresConnection, closePool } from './config/database.js';
import { authRoutes } from './routes/auth/index.js';
import { proxyRoutes } from './routes/proxy.js';
import { userRoutes } from './routes/user.js';
import { domainRoutes } from './routes/domains.js';
import { adminRoutes } from './routes/admin/index.js';
import { analyticsRoutes } from './routes/analytics.js';
import { logsRoutes } from './routes/logs.js';
import { monitoringRoutes } from './routes/monitoring.js';
import { statusRoutes } from './routes/status.js';
import { sslRoutes } from './routes/ssl.js';
import { settingsRoutes } from './routes/settings.js';
import { teamRoutes } from './routes/teams.js';
import { redirectionRoutes } from './routes/redirections.js';
import { domainGroupRoutes } from './routes/domainGroups.js';
import { apiKeysRoutes } from './routes/apiKeys.js';
import { updateRoutes } from './routes/updates.js';
import { liveTrafficService } from './services/liveTrafficService.js';
import { tunnelRoutes } from './routes/tunnels.js';
import { notificationRoutes as userNotificationRoutes } from './routes/notifications.js';
import { notificationPreferencesRoutes } from './routes/notificationPreferences.js';
import urlBlockingRoutes from './routes/urlBlockingRules.js';
import { smtpProxyRoutes } from './routes/smtpProxy.js';
import BackupScheduler from './services/backupScheduler.js';
import { proxyManager } from './services/proxyManager.js';
import { acmeManager } from './services/acmeManager.js';
import { queueService } from './services/queueService.js';
import { retryWorker } from './services/retryWorker.js';
import updateService from './services/updateService.js';
import { healthCheckService } from './services/healthCheckService.js';
import WebSocketManager from './services/websocketManager.js';
import NotificationService from './services/notificationService.js';
import { urlFilterService } from './services/urlFilterService.js';
import { logBroadcastService } from './services/logBroadcastService.js';
import { smtpProxyService } from './services/smtpProxyService.js';
import { tunnelRelayService } from './services/tunnelRelayService.js';
import { apiKeyAuthMiddleware } from './middleware/apiKeyAuth.js';
import { extractApiKeyFromHeaders } from './utils/apiKey.js';
import { applyLogFilter } from './utils/logFilter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await initializeConfig();

const fastify = Fastify({
  logger: {
    level: config.logging.level,
    // pino-pretty only in development — JSON in production for performance + log aggregators
    ...(config.nodeEnv !== 'production' && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      }
    })
  },
  disableRequestLogging: true, // Disable automatic request logging
  trustProxy: config.security.trustedProxies,
  bodyLimit: 10485760 // 10MB
});

let frontendServer = null;
const bootstrapPasswordChangeAllowedPaths = new Set([
  '/api/auth/bootstrap/change-password',
  '/api/auth/logout',
  '/api/auth/verify'
]);

const publicTunnelPaths = new Set([
  '/api/tunnels/install.sh',
  '/api/tunnels/install.ps1',
  '/api/tunnels/agent-script',
  '/api/tunnels/agent-script.js'
]);

function normalizeHost(host) {
  let value = String(host || '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }
  return value;
}

function getServerInterfaceHosts() {
  const hosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
  const interfaces = networkInterfaces();

  Object.values(interfaces).forEach((iface) => {
    (iface || []).forEach((entry) => {
      const addr = normalizeHost(entry?.address);
      if (addr) hosts.add(addr);
    });
  });

  return hosts;
}

function isDynamicAllowedOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = normalizeHost(parsed.hostname);
    if (!hostname) return false;

    // Always allow direct IP-based access (LAN/public) for proxy UI/API deployments.
    if (isIP(hostname)) return true;

    const interfaceHosts = getServerInterfaceHosts();
    return interfaceHosts.has(hostname);
  } catch {
    return false;
  }
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number.parseInt(part, 10));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) >>> 0) + ((nums[1] << 16) >>> 0) + ((nums[2] << 8) >>> 0) + (nums[3] >>> 0);
}

function isIpTrustedByRule(ip, rule) {
  const rawRule = String(rule || '').trim();
  if (!rawRule) return false;
  if (rawRule === '127.0.0.1' || rawRule === '::1') {
    return ip === rawRule;
  }

  if (!rawRule.includes('/')) {
    return ip === rawRule;
  }

  const [cidrIp, prefixRaw] = rawRule.split('/');
  const prefix = Number.parseInt(prefixRaw, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const cidrInt = ipv4ToInt(cidrIp);
  if (ipInt === null || cidrInt === null) return false;

  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipInt & mask) === (cidrInt & mask);
}

function isTrustedProxyIp(clientIp, trustedProxies = []) {
  if (!clientIp) return false;
  if (!Array.isArray(trustedProxies) || trustedProxies.length === 0) return false;
  return trustedProxies.some((rule) => isIpTrustedByRule(clientIp, rule));
}

const runFrontendBuild = async () => {
  if (!config.frontend.buildOnStart) {
    return;
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const frontendDir = join(__dirname, '..', 'frontend');

  await new Promise((resolve, reject) => {
    const child = spawn(npmCmd, ['run', 'build'], {
      cwd: frontendDir,
      stdio: 'inherit',
      shell: true
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Frontend build failed with exit code ${code}`));
    });
  });
};

const startFrontendServer = async () => {
  const frontend = Fastify({ logger: false });
  const backendTarget = `http://127.0.0.1:${config.port}`;

  // Register the proxy for API routes using @fastify/http-proxy
  await frontend.register(fastifyHttpProxy, {
    upstream: backendTarget,
    prefix: '/api',
    rewritePrefix: '/api',
    http2: false,
    httpMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
  });

  frontend.server.on('upgrade', (request, socket, head) => {
    const rawPath = String(request.url || '').split('?')[0];
    if (!rawPath.startsWith('/ws/')) {
      socket.destroy();
      return;
    }

    proxy.ws(request, socket, head, {
      target: backendTarget,
      changeOrigin: true
    });
  });

  // Manual proxy for redirection routes (to avoid conflicts with fastify-http-proxy)
  frontend.get('/r/:shortCode', async (request, reply) => {
    fastify.log.debug({ shortCode: request.params.shortCode, host: request.headers.host || '' }, '[Frontend] /r proxy request');
    try {
      const axios = await import('axios');
      const response = await axios.default.get(`${backendTarget}/r/${request.params.shortCode}`, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400
      });

      // If backend returns a redirect, follow it
      if (response.status === 301 || response.status === 302) {
        fastify.log.debug({ shortCode: request.params.shortCode, location: response.headers.location }, '[Frontend] /r redirect');
        return reply.redirect(response.status, response.headers.location);
      }

      return reply.send(response.data);
    } catch (error) {
      // Check if it's a redirect error (axios throws on 3xx by default)
      if (error.response && (error.response.status === 301 || error.response.status === 302)) {
        fastify.log.debug({ shortCode: request.params.shortCode, location: error.response.headers.location }, '[Frontend] /r redirect');
        return reply.redirect(error.response.status, error.response.headers.location);
      }

      // For 404 or other errors, return the error response
      if (error.response) {
        fastify.log.warn({ shortCode: request.params.shortCode, status: error.response.status }, '[Frontend] /r error');
        return reply.code(error.response.status).send(error.response.data);
      }

      fastify.log.error({ shortCode: request.params.shortCode, err: error }, '[Frontend] /r unexpected error');
      return reply.code(500).send({ error: 'Failed to process redirection' });
    }
  });

  // Serve static files
  await frontend.register(fastifyStatic, {
    root: config.frontend.distPath,
    index: ['index.html']
  });

  // SPA fallback
  frontend.setNotFoundHandler((request, reply) => {
    reply.sendFile('index.html');
  });

  await frontend.listen({
    port: config.frontend.port,
    host: config.host
  });

  frontendServer = frontend;
  fastify.log.info(`Frontend server listening on ${config.host}:${config.frontend.port}`);
};

// Proxy instance for high performance
// SECURITY FIX: Reduced timeouts to prevent resource exhaustion
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  proxyTimeout: 4000,
  timeout: 4000
});

// Error handling for proxy
proxy.on('error', (err, req, res) => {
  fastify.log.error({ err, url: req.url }, 'Proxy error');
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
  }
});

// Make proxy available globally
fastify.decorate('proxy', proxy);

// Register plugins
// SECURITY FIX: Strict CORS configuration to prevent credential theft
await fastify.register(cors, {
  origin: function (origin, callback) {
    // Get allowed origins from config
    const allowedOrigins = Array.isArray(config.allowedOrigins)
      ? config.allowedOrigins
      : config.allowedOrigins.split(',').map(o => o.trim()).filter(Boolean);

    // No origin = same-origin request (browser security)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Check if origin is in whitelist
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    if (isDynamicAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    fastify.log.warn({ origin, allowedOrigins }, 'CORS: Origin not allowed');
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600 // 10 minutes
});

await fastify.register(cookie, {
  secret: config.jwtSecret, // Sign cookies for CSRF protection
  parseOptions: {}
});

await fastify.register(jwt, {
  secret: config.jwtSecret,
  cookie: {
    cookieName: 'token',
    signed: false
  }
});

// Multipart support for file uploads
await fastify.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  }
});

// CSRF Protection (if enabled)
if (config.security.csrfEnabled) {
  await fastify.register(csrf, {
    cookieOpts: {
      signed: true,
      sameSite: 'strict',
      httpOnly: true,
      secure: config.nodeEnv === 'production'
    },
    sessionPlugin: '@fastify/cookie'
  });

  fastify.log.info('[Security] CSRF protection enabled');
}

// Secure rate limit with trusted proxy validation
await fastify.register(rateLimit, {
  max: config.rateLimit.max,
  timeWindow: config.rateLimit.timeWindow,
  cache: 10000,
  allowList: [], // Do not bypass rate limits by default
  skipOnError: false,
  keyGenerator: (request) => {
    // SECURITY FIX: Only trust X-Forwarded-For from trusted proxies
    const forwardedFor = request.headers['x-forwarded-for'];
    const clientIp = request.ip;

    // Check if request comes from trusted proxy
    const trustedProxies = config.security.trustedProxies || [];
    const isTrustedProxy = isTrustedProxyIp(clientIp, trustedProxies);

    if (forwardedFor && isTrustedProxy) {
      // Use first IP in X-Forwarded-For chain
      return forwardedFor.split(',')[0].trim();
    }

    // Default to actual connection IP
    return clientIp;
  }
});

// Serve uploaded files (team logos, etc.)
await fastify.register(fastifyStatic, {
  root: join(__dirname, 'uploads'),
  prefix: '/uploads/',
  decorateReply: false
});

// Authentication decorator with JWT revocation check AND API key support
fastify.decorate('authenticate', async function(request, reply) {
  const rawPath = String(request.raw.url || '').split('?')[0];

  if (publicTunnelPaths.has(rawPath)) {
    return;
  }

  // Check if request contains an API key
  const apiKey = extractApiKeyFromHeaders(request.headers);

  if (apiKey) {
    // Use API key authentication
    return apiKeyAuthMiddleware(request, reply);
  }

  // Otherwise use JWT authentication
  try {
    let token;
    const authHeader = request.headers.authorization;
    const cookieHeader = request.headers.cookie || '';

    if (config.logging.authDebug) {
      fastify.log.info({
        path: request.raw.url,
        hasCookie: !!request.cookies.token,
        hasAuthHeader: !!authHeader,
        cookieHeader
      }, '[AUTH DEBUG] Checking credentials');
    }

    const extractTokenFromCookieHeader = (rawHeader) => {
      if (!rawHeader) return null;

      const tokens = rawHeader
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.startsWith('token='))
        .map((part) => part.slice('token='.length))
        .filter(Boolean);

      if (tokens.length === 0) return null;

      const rawToken = tokens[tokens.length - 1];
      try {
        return decodeURIComponent(rawToken);
      } catch (err) {
        return rawToken;
      }
    };

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
      request.user = fastify.jwt.verify(token);
    } else {
      const rawToken = extractTokenFromCookieHeader(cookieHeader);

      if (rawToken) {
        try {
          token = rawToken;
          request.user = fastify.jwt.verify(token);
        } catch (err) {
          // Fallback to parsed cookie if different (handles duplicate token cookies)
          const parsedToken = request.cookies.token;
          if (parsedToken && parsedToken !== rawToken) {
            token = parsedToken;
            request.user = fastify.jwt.verify(token);
          } else {
            throw err;
          }
        }
      } else {
        await request.jwtVerify();
        token = request.cookies.token;
      }
    }

    // SECURITY FIX: Check if token is blacklisted (revoked)
    if (token && redisService.isConnected) {
      const isBlacklisted = await redisService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        fastify.log.warn({ path: request.raw.url }, 'Token has been revoked');
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Token has been revoked'
        });
      }
    } else if (token && !redisService.isConnected) {
      if (config.security.strictTokenRevocation) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Session validation is temporarily unavailable'
        });
      } else {
        // SECURITY WARNING: Redis is down — revoked tokens cannot be checked.
        // Set strictTokenRevocation=true in config to enforce rejection instead.
        fastify.log.warn({ path: request.raw.url }, '[SECURITY] Redis unavailable — token revocation check bypassed');
      }
    }

    if (request.user?.bootstrapPasswordChangeRequired === true) {
      const rawPath = String(request.raw.url || '').split('?')[0];
      if (!bootstrapPasswordChangeAllowedPaths.has(rawPath)) {
        return reply.code(428).send({
          success: false,
          error: 'Password change required',
          code: 'BOOTSTRAP_PASSWORD_CHANGE_REQUIRED',
          message: 'You must change the default admin password before accessing the proxy.'
        });
      }
    }
  } catch (err) {
    fastify.log.warn({ path: request.raw.url }, 'Unauthorized request');
    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing token' });
  }
});

// Role-based authorization decorator
fastify.decorate('authorize', (roles) => {
  return async function(request, reply) {
    await fastify.authenticate(request, reply);

    if (!request.user) {
      return;
    }

    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      });
    }

    if (request.user.role === 'admin' && roles.includes('admin') && request.user.adminPinVerified !== true) {
      return reply.code(423).send({
        error: 'Admin PIN required',
        message: 'Admin PIN verification is required to access admin features.'
      });
    }
  };
});

// Admin-only decorator
fastify.decorate('requireAdmin', async function(request, reply) {
  await fastify.authenticate(request, reply);

  if (!request.user) {
    return;
  }

  if (request.user.role !== 'admin') {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'Admin access required'
    });
  }

  if (request.user.adminPinVerified !== true) {
    return reply.code(423).send({
      error: 'Admin PIN required',
      message: 'Admin PIN verification is required to access admin features.'
    });
  }
});

// SECURITY FIX: Remove sensitive headers and add comprehensive security headers
fastify.addHook('onSend', async (request, reply) => {
  // Remove fingerprinting headers
  reply.removeHeader('X-Powered-By');
  reply.removeHeader('Server');

  // Security headers
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');  // Changed from SAMEORIGIN to DENY for max protection
  reply.header('X-XSS-Protection', '1; mode=block');

  // HSTS (HTTP Strict Transport Security)
  if (config.nodeEnv === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Content-Security-Policy
  // In development, we need to relax CSP for Vite HMR and inline scripts
  const isDevelopment = config.nodeEnv === 'development';
  const csp = [
    "default-src 'self'",
    isDevelopment ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",  // unsafe-inline needed for React and CSS frameworks
    "img-src 'self' data: https:",
    "font-src 'self'",
    isDevelopment ? "connect-src 'self' ws: wss:" : "connect-src 'self'",  // ws for Vite HMR
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
  reply.header('Content-Security-Policy', csp);

  // Permissions Policy (formerly Feature-Policy)
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Referrer Policy
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Only return server errors in production as generic messages
  if (config.nodeEnv === 'production' && reply.statusCode >= 500) {
    // Don't expose internal error details in production
    return;
  }
});

// Health check
fastify.get('/health', async () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'NebulaProxy'
  };
});

// ── DDoS Challenge endpoints (served by the proxy itself for challenge mode) ──
// These are hit on the proxied domain, not on the panel port.
// The proxyManager intercepts /__ddos_challenge/* before forwarding to the backend.
// These Fastify routes handle the panel-port fallback only.
fastify.get('/__ddos_challenge', async (request, reply) => {
  const { ddosProtectionService } = await import('./services/ddosProtectionService.js');
  const ip  = request.headers['x-real-ip'] || request.ip;
  const ret = request.query.return || '/';
  reply.header('Content-Type', 'text/html; charset=utf-8');
  return reply.send(ddosProtectionService.generateChallengePage(ip, ret));
});

fastify.post('/__ddos_challenge/verify', async (request, reply) => {
  const { ddosProtectionService } = await import('./services/ddosProtectionService.js');
  const ip    = request.headers['x-real-ip'] || request.ip;
  const scope = String(request.headers.host || '').split(':')[0].toLowerCase();
  const { token, answer, return: ret = '/' } = request.body || {};
  if (!token || answer === undefined) return reply.code(400).send({ error: 'Invalid' });
  if (!ddosProtectionService.verifyMathToken(ip, token, answer)) {
    return reply.code(403).send({ error: 'Challenge failed' });
  }
  const cookie = ddosProtectionService.generateVerifiedCookie(ip, scope);
  reply.header('Set-Cookie', `__ddos_bypass=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
  return reply.send({ ok: true, return: ret });
});

// Config status endpoint (for setup redirect)
fastify.get('/api/config-status', async (request, reply) => {
  return {
    configured: true,
    setupRequired: false
  };
});

// Register routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(userRoutes, { prefix: '/api/user' });
await fastify.register(domainRoutes, { prefix: '/api/domains' });
await fastify.register(redirectionRoutes, { prefix: '/api/redirections' });
await fastify.register(adminRoutes, { prefix: '/api/admin' });
await fastify.register(teamRoutes, { prefix: '/api/teams' });
await fastify.register(domainGroupRoutes, { prefix: '/api/domain-groups' });
await fastify.register(apiKeysRoutes, { prefix: '/api/api-keys' });
await fastify.register(tunnelRoutes, { prefix: '/api/tunnels' });
await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
await fastify.register(logsRoutes, { prefix: '/api/logs' });
await fastify.register(monitoringRoutes, { prefix: '/api/monitoring' });
await fastify.register(statusRoutes,    { prefix: '/api/status' });
await fastify.register(sslRoutes, { prefix: '/api/ssl' });
await fastify.register(settingsRoutes, { prefix: '/api/settings' });
await fastify.register(userNotificationRoutes, { prefix: '/api/notifications' });
await fastify.register(notificationPreferencesRoutes, { prefix: '/api/notification-preferences' });
await fastify.register(proxyRoutes, { prefix: '/proxy' });

// Update system routes (admin only)
await fastify.register(updateRoutes, { prefix: '/api/admin/updates' });

// URL blocking rules routes
await fastify.register(urlBlockingRoutes, { prefix: '/api/url-blocking' });

// SMTP Proxy routes
await fastify.register(smtpProxyRoutes, { prefix: '/api/smtp-proxy' });

// Public redirection route (must be defined after other routes to avoid conflicts)
// SECURITY FIX: Add rate limiting to prevent abuse
  fastify.get('/r/:shortCode', {
    config: {
      rateLimit: {
        max: 100,           // Max 100 requests
        timeWindow: '1 minute', // Per minute
        keyGenerator: (request) => {
          // Rate limit per IP for public endpoint
          return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip;
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { shortCode } = request.params;

      fastify.log.debug({ shortCode }, '[Backend] /r lookup');
      const redirection = await database.getRedirectionByShortCode(shortCode);

      if (!redirection) {
        fastify.log.debug({ shortCode }, '[Backend] /r not found');
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      // Increment click count
      try {
        await database.incrementRedirectionClicks(redirection.id);
      } catch (error) {
        fastify.log.warn({ err: error }, '[Backend] Failed to increment redirection clicks');
      }

      // Redirect to target URL
      fastify.log.debug({ shortCode, target: redirection.target_url }, '[Backend] /r hit');
      return reply.redirect(301, redirection.target_url);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to process redirection');
      return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to process redirection'
    });
  }
});

// Start server
const start = async () => {
  try {
    // Initialize configuration from Redis
    await initializeConfig();
    applyLogFilter();

    const startTime = Date.now();
    const logLine = (line) => console.log(line);
    const logStep = (label, status, details = '') => {
      const padded = label.padEnd(34, ' ');
      const suffix = details ? ` - ${details}` : '';
      logLine(`  ${padded} [${status}]${suffix}`);
    };

    if (config.logging.startupSummary) {
      logLine('');
      logLine('===================================================================');
      logLine('  NebulaProxy :: Startup');
      logLine('===================================================================');
      logStep('Environment', 'OK', `${config.nodeEnv}`);
      logStep('Host/Port', 'OK', `${config.host}:${config.port}`);
      logStep('Frontend Port', 'OK', `${config.frontend.port}`);
      logStep('DB Engine', 'OK', `${config.database.type}`);
      logStep('Proxy Enabled', config.proxy.enabled ? 'OK' : 'OFF');
    }

    // 1. Test PostgreSQL connection if using PostgreSQL
    if (config.database.type === 'postgresql') {
      if (config.logging.startupSummary) {
        console.log('\n[DB] Testing PostgreSQL connection...');
      }

      try {
        await testPostgresConnection();
        if (config.logging.startupSummary) {
          console.log('[DB] PostgreSQL connection successful\n');
        }
      } catch (err) {
        console.error('\n[DB] PostgreSQL connection failed!');
        console.error(`Error: ${err.message}`);

        if (err.code === 'ECONNREFUSED') {
          console.error('\n[DB] PostgreSQL server is not running or not accessible');
          console.error(`   Host: ${process.env.DB_HOST || 'localhost'}`);
          console.error(`   Port: ${process.env.DB_PORT || '5432'}`);
          console.error('\nSolutions:');
          console.error('   1. Start PostgreSQL: sudo systemctl start postgresql');
          console.error('   2. Check firewall rules');
          console.error('   3. Verify DB_HOST and DB_PORT in .env');
        } else if (err.code === '28P01') {
          console.error('\n[DB] Authentication failed');
          console.error('\nSolutions:');
          console.error('   1. Verify DB_PASSWORD in .env');
          console.error('   2. Check PostgreSQL user permissions');
        } else if (err.code === '3D000') {
          console.error('\n[DB] Database does not exist');
          console.error('\nSolutions:');
          console.error(`   1. Create database: CREATE DATABASE ${process.env.DB_NAME || 'nebula_proxy'};`);
          console.error('   2. Run migrations in backend/migrations');
        }

        console.error('\n[DB] PostgreSQL is required. Check DB_TYPE and connection settings.\n');
        process.exit(1);
      }
    }

    // 2. Initialize database
    try {
      await database.init();
      fastify.log.info('Database initialized');
      if (config.logging.startupSummary) {
        logStep('Database', 'OK', 'initialized');
      }
    } catch (error) {
      fastify.log.error({ error }, 'Database initialization failed');
      if (config.logging.startupSummary) {
        logStep('Database', 'FAIL', error.message);
      }
      if (error.code === 'SCHEMA_MISSING') {
        console.error('Auto-migrations ran but required tables are still missing.');
      }
      if (error.code === 'MIGRATION_READ_FAILED') {
        console.error('Failed to read migrations directory. Check permissions and path.');
      }
      process.exit(1);
    }

    // 2.5. Initialize Redis (for JWT blacklist and enhanced security)
    try {
      await redisService.init();
      if (redisService.isConnected) {
        fastify.log.info('Redis connected successfully');
        if (config.logging.startupSummary) {
          logStep('Redis', 'OK', 'connected');
        }
        // Initialize GeoIP service with Redis for caching
        geoIpService.init(redisService.client);
        // Initialize live traffic service with Redis
        liveTrafficService.init(redisService.client);
        // Initialize DDoS protection service with Redis
        await ddosProtectionService.init(redisService.client);
      } else {
        fastify.log.warn('Redis not connected - running in degraded mode');
        if (config.logging.startupSummary) {
          logStep('Redis', 'WARN', 'not connected (JWT revocation disabled)');
        }
      }
    } catch (error) {
      fastify.log.warn({ error }, 'Redis initialization failed - running in degraded mode');
      if (config.logging.startupSummary) {
        logStep('Redis', 'WARN', 'connection failed (degraded mode)');
      }
    }

    // 3. Initialize ACME manager
    acmeManager.init();
    acmeManager.startRenewalCron();
    fastify.log.info('ACME manager initialized');
    if (config.logging.startupSummary) {
      logStep('ACME Manager', 'OK', 'cron scheduled');
    }

    // 4. Initialize proxy manager
    await proxyManager.init(acmeManager);
    fastify.log.info('Proxy manager initialized');
    if (config.logging.startupSummary) {
      logStep('Proxy Manager', 'OK', 'initialized');
    }

    // 5. Start all active proxies
    const activeDomains = await database.getAllActiveDomains();
    let successCount = 0;
    let errorCount = 0;

    for (const domain of activeDomains) {
      try {
        await proxyManager.startProxy(domain);
        successCount++;
      } catch (error) {
        fastify.log.error({ error, domainId: domain.id, hostname: domain.hostname }, 'Failed to start proxy on startup');
        errorCount++;
      }
    }

    fastify.log.info(`Started ${successCount}/${activeDomains.length} proxies (${errorCount} errors)`);
    if (config.logging.startupSummary) {
      logStep('Active Proxies', errorCount === 0 ? 'OK' : 'WARN', `${successCount}/${activeDomains.length}`);
    }

    // 6. Start retry worker (if enabled)
    if (config.queue.enabled) {
      await queueService.init();
      await retryWorker.start();
      fastify.log.info(`Retry worker started (interval: 30s, max attempts: ${config.queue.maxAttempts})`);
      if (config.logging.startupSummary) {
        logStep('Retry Worker', 'OK', 'running');
      }
    } else {
      fastify.log.info('Retry worker disabled (QUEUE_ENABLED=false)');
      if (config.logging.startupSummary) {
        logStep('Retry Worker', 'SKIP', 'disabled');
      }
    }

    // 6.6. Start SMTP proxy service (if enabled)
    try {
      await smtpProxyService.start();
      const stats = smtpProxyService.getStats();
      if (stats.isRunning) {
        const ports = stats.servers.map(s => `${s.name}:${s.port}`).join(', ');
        fastify.log.info(`SMTP proxy service started (${ports})`);
        if (config.logging.startupSummary) {
          logStep('SMTP Proxy', 'OK', `${ports} -> ${config.smtpProxy.backendHost}:${config.smtpProxy.backendPort}`);
        }
      } else {
        fastify.log.info('SMTP proxy service disabled');
        if (config.logging.startupSummary) {
          logStep('SMTP Proxy', 'SKIP', 'disabled in config');
        }
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to start SMTP proxy service');
      if (config.logging.startupSummary) {
        logStep('SMTP Proxy', 'WARN', `startup failed: ${error.message}`);
      }
    }

    // 6.7. Initialize update service
    await updateService.init(fastify);
    fastify.log.info('Update service initialized');
    if (config.logging.startupSummary) {
      logStep('Update Service', 'OK', 'initialized');
    }

    // 7. Start Fastify API server
    await fastify.listen({
      port: config.port,
      host: config.host
    });

    fastify.log.info(`Backend API listening on ${config.host}:${config.port}`);
    if (config.logging.startupSummary) {
      logStep('API Listener', 'OK', `${config.host}:${config.port}`);
    }

    // 7.5. Initialize WebSocket & Notifications
    let websocketManager = null;
    let notificationService = null;

    try {
      // Initialize WebSocket Manager
      websocketManager = new WebSocketManager(fastify.server, fastify.log);
      fastify.websocketManager = websocketManager;
      fastify.log.info('WebSocket manager initialized on /ws/notifications');
      if (config.logging.startupSummary) {
        logStep('WebSocket', 'OK', '/ws/notifications');
      }

      // Initialize Notification Service
      notificationService = new NotificationService(fastify.log, websocketManager);
      await notificationService.initialize();
      global.notificationService = notificationService;
      fastify.notificationService = notificationService;
      fastify.log.info('Notification service initialized');
      if (config.logging.startupSummary) {
        logStep('Notifications', 'OK', 'email/client-webhooks/websocket');
      }

      try {
        await notificationService.sendProxyLifecycleNotification('started', {
          host: config.host,
          port: config.port,
          source: 'startup'
        });
      } catch (error) {
        fastify.log.warn({ error }, 'Failed to send proxy startup notification');
      }

      // Initialize Log Broadcast Service
      logBroadcastService.setWebSocketManager(websocketManager);
      fastify.log.info('Log broadcast service initialized');
      if (config.logging.startupSummary) {
        logStep('Log Broadcast', 'OK', 'real-time traffic logs');
      }

      await tunnelRelayService.init(fastify.server, fastify.log);
      fastify.tunnelRelayService = tunnelRelayService;
      if (config.logging.startupSummary) {
        logStep('Tunnel Relay', 'OK', '/ws/tunnels/agent + tcp listeners');
      }

      const wsUpgradeRouter = (request, socket, head) => {
        try {
          if (fastify.tunnelRelayService?.shouldHandleUpgrade(request)) {
            fastify.tunnelRelayService.handleUpgrade(request, socket, head);
            return;
          }

          if (fastify.websocketManager?.shouldHandleUpgrade(request)) {
            fastify.websocketManager.handleUpgrade(request, socket, head);
            return;
          }

          socket.destroy();
        } catch (err) {
          fastify.log.warn({ err, url: request?.url }, 'WebSocket upgrade routing failed');
          socket.destroy();
        }
      };

      fastify.server.on('upgrade', wsUpgradeRouter);
      fastify.wsUpgradeRouter = wsUpgradeRouter;
    } catch (error) {
      fastify.log.error({ error }, 'Failed to initialize WebSocket/Notifications');
      if (config.logging.startupSummary) {
        logStep('WebSocket/Notifications', 'WARN', 'initialization failed');
      }
    }

    // 7.6. Start health check service
    try {
      await healthCheckService.start();
      fastify.log.info('Health check service started');
      if (config.logging.startupSummary) {
        logStep('Health Checks', 'OK', `interval ${config.healthChecks.intervalSeconds}s`);
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to start health check service');
      if (config.logging.startupSummary) {
        logStep('Health Checks', 'WARN', `start failed: ${error.message}`);
      }
    }

    // 7.7. Initialize automatic backup scheduler (every 24h by default)
    try {
      const backupScheduler = new BackupScheduler(fastify.log);
      await backupScheduler.initialize();
      fastify.backupScheduler = backupScheduler;
      fastify.log.info('Backup scheduler initialized');
      if (config.logging.startupSummary) {
        logStep('Backup Scheduler', 'OK', 'automatic DB + S3 backups');
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to initialize backup scheduler');
      if (config.logging.startupSummary) {
        logStep('Backup Scheduler', 'WARN', `init failed: ${error.message}`);
      }
    }

    // 8. Frontend is handled by separate Docker container
    // (runFrontendBuild and startFrontendServer disabled)

    if (config.logging.startupSummary) {
      logLine('-------------------------------------------------------------------');
      logLine(`  Startup complete in ${Date.now() - startTime}ms`);
      logLine('===================================================================');
      logLine('');
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

let logCleanupTimer = null;
const startLogCleanup = () => {
  const intervalMs = config.logs.cleanupIntervalHours * 60 * 60 * 1000;
  const runCleanup = async () => {
    try {
      const result = await database.cleanOldRequestLogs(config.logs.retentionDays);
      fastify.log.info({ deleted: result.deleted }, 'Old request logs cleaned');
    } catch (error) {
      fastify.log.error({ error }, 'Failed to clean old request logs');
    }
  };

  runCleanup();
  logCleanupTimer = setInterval(async () => {
    await runCleanup();
  }, intervalMs);
};

const stopLogCleanup = () => {
  if (logCleanupTimer) {
    clearInterval(logCleanupTimer);
    logCleanupTimer = null;
  }
};

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received, shutting down gracefully');

  try {
    if (global.notificationService) {
      await global.notificationService.sendProxyLifecycleNotification('stopping', {
        signal: 'SIGTERM',
        source: 'shutdown'
      }, {
        fastShutdown: true
      }).catch((error) => {
        fastify.log.warn({ error }, 'Failed to send proxy shutdown notification');
      });
    }

    // Stop DDoS protection service
    ddosProtectionService.destroy();

    // Stop health check service
    healthCheckService.stop();
    // Stop retry worker
    if (config.queue.enabled) {
      await retryWorker.stop();
      fastify.log.info('Retry worker stopped');
    }

    // Stop all proxies
    await proxyManager.stopAll();
    fastify.log.info('All proxies stopped');

    // Stop SMTP proxy service
    await smtpProxyService.stop();
    fastify.log.info('SMTP proxy service stopped');

    // Stop ACME renewal cron
    acmeManager.stopRenewalCron();

    // Stop update service cron
    updateService.stopCron();
    fastify.log.info('Update service stopped');

    // Stop WebSocket manager
    if (fastify.wsUpgradeRouter) {
      fastify.server.off('upgrade', fastify.wsUpgradeRouter);
      fastify.wsUpgradeRouter = null;
    }

    if (fastify.websocketManager) {
      fastify.websocketManager.close();
      fastify.log.info('WebSocket manager closed');
    }

    if (fastify.tunnelRelayService) {
      await fastify.tunnelRelayService.stop();
      fastify.log.info('Tunnel relay service stopped');
    }

    // Stop backup scheduler
    if (fastify.backupScheduler) {
      fastify.backupScheduler.stop();
      fastify.log.info('Backup scheduler stopped');
    }

    // frontendServer handled by separate Docker container

    // Close Fastify server
    await fastify.close();
    fastify.log.info('Fastify server closed');

    // Close database
    database.close();
    fastify.log.info('Database closed');

    // Close PostgreSQL pool if using PostgreSQL
    if (config.database.type === 'postgresql') {
      await closePool();
      fastify.log.info('PostgreSQL pool closed');
    }

    // Close Redis connection
    await redisService.close();
    fastify.log.info('Redis closed');

    stopLogCleanup();
    process.exit(0);
  } catch (error) {
    fastify.log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  fastify.log.info('SIGINT received, shutting down gracefully');

  try {
    if (global.notificationService) {
      await global.notificationService.sendProxyLifecycleNotification('stopping', {
        signal: 'SIGINT',
        source: 'shutdown'
      }, {
        fastShutdown: true
      }).catch((error) => {
        fastify.log.warn({ error }, 'Failed to send proxy shutdown notification');
      });
    }

    if (config.queue.enabled) {
      await retryWorker.stop();
    }
    await proxyManager.stopAll();
    acmeManager.stopRenewalCron();
    updateService.stopCron();

    // Stop backup scheduler
    if (fastify.backupScheduler) {
      fastify.backupScheduler.stop();
    }

    // Stop WebSocket manager
    if (fastify.wsUpgradeRouter) {
      fastify.server.off('upgrade', fastify.wsUpgradeRouter);
      fastify.wsUpgradeRouter = null;
    }

    if (fastify.websocketManager) {
      fastify.websocketManager.close();
    }

    if (fastify.tunnelRelayService) {
      await fastify.tunnelRelayService.stop();
    }

    // frontendServer handled by separate Docker container
    await fastify.close();
    database.close();

    // Close PostgreSQL pool if using PostgreSQL
    if (config.database.type === 'postgresql') {
      await closePool();
    }

    // Close Redis connection
    await redisService.close();

    stopLogCleanup();
    process.exit(0);
  } catch (error) {
    fastify.log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
});

await start();
startLogCleanup();
