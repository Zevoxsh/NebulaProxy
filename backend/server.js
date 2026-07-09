import Fastify from 'fastify';
import pino from 'pino';
import pretty from 'pino-pretty';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import csrf from '@fastify/csrf-protection';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import httpProxy from 'http-proxy';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config, initializeConfig } from './config/config.js';
import { database } from './services/database.js';
import { redisService } from './services/redis.js';
import { container } from './services/container.js';
import { closePool } from './config/database.js';
import { proxyManager } from './services/proxyManager.js';
import { acmeManager } from './services/acmeManager.js';
import { logBatchQueue } from './services/logBatchQueue.js';
import { queueService } from './services/queueService.js';
import { retryWorker } from './services/retryWorker.js';
import { smtpProxyService } from './services/smtpProxyService.js';
import updateService from './services/updateService.js';
import { healthCheckService } from './services/healthCheckService.js';
import { resourceMonitor } from './services/resourceMonitor.js';
import { bandwidthTracker } from './services/bandwidthTracker.js';
import { multiProxySyncService } from './services/multiProxySyncService.js';
import { applyLogFilter } from './utils/logFilter.js';
import { clusterCoordinator } from './services/clusterCoordinator.js';
import { eventLoopMonitor } from './services/eventLoopMonitor.js';

// Start as early as possible — cheap (native histogram, no timers to await)
// and we want lag captured from boot, including during startup itself.
eventLoopMonitor.start();

// ── Sub-modules ──────────────────────────────────────────────────────────────
import { isDynamicAllowedOrigin, isTrustedProxyIp } from './server/networkHelpers.js';
import { createVerifyJwt } from './server/jwtHelpers.js';
import { setupAuthDecorators } from './server/authDecorator.js';
import { registerRoutes } from './server/routeSetup.js';
import { startupSequence } from './server/startupSequence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

await initializeConfig();

// pino-pretty via `transport:` spawns a worker thread through thread-stream,
// which crashes at startup on some Node versions ("this should not happen:
// undefined"). Building the pretty stream in-process and handing Fastify a
// ready-made pino instance avoids the worker entirely.
const fastifyLoggerStream = config.nodeEnv !== 'production'
  ? pretty({ colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' })
  : undefined;

const fastifyLogger = pino(
  {
    level: config.logging.level,
    // See utils/logger.js for why: pino only auto-serializes an Error under
    // `err` by default — the 232+ `fastify.log.error({ error }, ...)` call
    // sites across this codebase (including gracefulShutdown's own catch
    // block) were silently logging `"error":{}` instead of the actual
    // message/stack. This is a SEPARATE pino instance from utils/logger.js
    // (Fastify builds its own from this options object), so it needs the
    // same fix independently.
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err
    }
  },
  fastifyLoggerStream
);

// ── Fastify instance ─────────────────────────────────────────────────────────
const fastify = Fastify({
  logger: fastifyLogger,
  disableRequestLogging: true,
  trustProxy: config.security.trustedProxies,
  bodyLimit: 10485760 // 10 MB
});

// ── Well-known path sets ─────────────────────────────────────────────────────
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

// ── HTTP proxy (for frontend WebSocket relay if running embedded) ─────────────
const proxy = httpProxy.createProxyServer({ changeOrigin: true, proxyTimeout: 4000, timeout: 4000 });
proxy.on('error', (err, req, res) => {
  fastify.log.error({ err, url: req.url }, 'Proxy error');
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
  }
});
fastify.decorate('proxy', proxy);

// ── Plugins ──────────────────────────────────────────────────────────────────
await fastify.register(cors, {
  origin: (origin, callback) => {
    if (!origin) { callback(null, true); return; }
    const allowed = Array.isArray(config.allowedOrigins)
      ? config.allowedOrigins
      : config.allowedOrigins.split(',').map(o => o.trim()).filter(Boolean);
    if (allowed.includes(origin) || isDynamicAllowedOrigin(origin)) { callback(null, true); return; }
    fastify.log.warn({ origin }, 'CORS: Origin not allowed');
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600
});

await fastify.register(cookie, { secret: config.jwtSecret, parseOptions: {} });

if (config.nodeEnv !== 'production') {
  await fastify.register(swagger, {
    openapi: {
      info: { title: 'NebulaProxy API', version: '3.0.0', description: 'Reverse proxy control plane API' },
      components: {
        securitySchemes: {
          cookieAuth:    { type: 'apiKey', in: 'cookie', name: 'token' },
          bearerAuth:    { type: 'http', scheme: 'bearer' },
          apiKeyHeader:  { type: 'apiKey', in: 'header', name: 'X-API-Key' }
        }
      },
      security: [{ cookieAuth: [] }]
    }
  });
  await fastify.register(swaggerUi, { routePrefix: '/api-docs', uiConfig: { docExpansion: 'list', deepLinking: true } });
}

await fastify.register(jwt, {
  secret: config.jwtSecret,
  cookie: { cookieName: 'token', signed: false }
});

await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

if (config.security.csrfEnabled) {
  await fastify.register(csrf, {
    cookieOpts: { signed: true, sameSite: 'strict', httpOnly: true, secure: config.nodeEnv === 'production' },
    sessionPlugin: '@fastify/cookie'
  });
  fastify.log.info('[Security] CSRF protection enabled');
}

await fastify.register(rateLimit, {
  max: config.rateLimit.max,
  timeWindow: config.rateLimit.timeWindow,
  cache: 10000,
  skipOnError: false,
  keyGenerator: (request) => {
    const forwardedFor = request.headers['x-forwarded-for'];
    const clientIp     = request.ip;
    if (forwardedFor && isTrustedProxyIp(clientIp, config.security.trustedProxies || [])) {
      return forwardedFor.split(',')[0].trim();
    }
    return clientIp;
  }
});

await fastify.register(fastifyStatic, {
  root: join(__dirname, 'uploads'),
  prefix: '/uploads/',
  decorateReply: false
});

// ── JWT rotation helpers + auth decorators ────────────────────────────────────
const verifyJwt = createVerifyJwt(fastify, config);
setupAuthDecorators(fastify, verifyJwt, config, { redisService, publicTunnelPaths, bootstrapPasswordChangeAllowedPaths });

// ── Built-in endpoints ────────────────────────────────────────────────────────
fastify.get('/health', async () => ({ status: 'healthy', timestamp: new Date().toISOString(), service: 'NebulaProxy' }));
fastify.get('/api/config-status', async () => ({ configured: true, setupRequired: false }));

fastify.get('/__ddos_challenge', async (request, reply) => {
  const { ddosProtectionService: ddos } = await import('./services/ddosProtectionService.js');
  const ip  = request.headers['x-real-ip'] || request.ip;
  reply.header('Content-Type', 'text/html; charset=utf-8');
  return reply.send(ddos.generateChallengePage(ip, request.query.return || '/'));
});

fastify.post('/__ddos_challenge/verify', async (request, reply) => {
  const { ddosProtectionService: ddos } = await import('./services/ddosProtectionService.js');
  const ip    = request.headers['x-real-ip'] || request.ip;
  const scope = String(request.headers.host || '').split(':')[0].toLowerCase();
  const { token, answer, return: ret = '/' } = request.body || {};
  if (!token || answer === undefined) return reply.code(400).send({ error: 'Invalid' });
  if (!ddos.verifyMathToken(ip, token, answer)) return reply.code(403).send({ error: 'Challenge failed' });
  reply.header('Set-Cookie', `__ddos_bypass=${ddos.generateVerifiedCookie(ip, scope)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
  return reply.send({ ok: true, return: ret });
});

// ── Application routes ────────────────────────────────────────────────────────
await registerRoutes(fastify);

// Short-code redirections (rate-limited public endpoint)
fastify.get('/r/:shortCode', {
  config: {
    rateLimit: {
      max: 100,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip
    }
  }
}, async (request, reply) => {
  try {
    const redirection = await database.getRedirectionByShortCode(request.params.shortCode);
    if (!redirection) return reply.code(404).send({ error: 'Not Found', message: 'Redirection not found' });
    await database.incrementRedirectionClicks(redirection.id).catch((err) => fastify.log.warn({ err }, 'Failed to increment clicks'));
    return reply.redirect(301, redirection.target_url);
  } catch (error) {
    fastify.log.error({ error }, 'Failed to process redirection');
    return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to process redirection' });
  }
});

// ── SSL expiry check (daily) ──────────────────────────────────────────────────
const SSL_EXPIRY_WARN_DAYS = 14;
let sslExpiryTimer = null;

const runSslExpiryCheck = async () => {
  // CLUSTER: cert expiry is cluster-wide data — without this every worker
  // would independently send the same expiry-warning email.
  if (!clusterCoordinator.isLeader()) return;
  try {
    const expiring = await database.getExpiringCertificates(SSL_EXPIRY_WARN_DAYS);
    if (!expiring?.length) return;
    const notifSvc = container.has('notifications') ? container.get('notifications') : null;
    if (!notifSvc) return;
    for (const domain of expiring) {
      const days = domain.days_until_expiry ?? 0;
      fastify.log.warn({ hostname: domain.hostname, daysLeft: days }, 'SSL certificate expiring soon');
      await notifSvc.sendCertificateExpiryAlert(domain.hostname, days).catch(() => {});
    }
  } catch (err) { fastify.log.error({ err }, 'SSL expiry check failed'); }
};

const startSslExpiryCheck = () => { runSslExpiryCheck(); sslExpiryTimer = setInterval(runSslExpiryCheck, 24 * 60 * 60 * 1000); };
const stopSslExpiryCheck  = () => { if (sslExpiryTimer) { clearInterval(sslExpiryTimer); sslExpiryTimer = null; } };

// ── Log cleanup (configurable interval) ──────────────────────────────────────
let logCleanupTimer = null;

const startLogCleanup = () => {
  const intervalMs = config.logs.cleanupIntervalHours * 60 * 60 * 1000;
  const run = async () => {
    // CLUSTER: avoid every worker running the same DELETE scan redundantly.
    if (!clusterCoordinator.isLeader()) return;
    try {
      const result = await database.cleanOldRequestLogs(config.logs.retentionDays);
      fastify.log.info({ deleted: result.deleted }, 'Old request logs cleaned');
    } catch (error) { fastify.log.error({ error }, 'Failed to clean old request logs'); }
  };
  run();
  logCleanupTimer = setInterval(run, intervalMs);
};

const stopLogCleanup = () => { if (logCleanupTimer) { clearInterval(logCleanupTimer); logCleanupTimer = null; } };

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// STABILITY: this sequence awaits ~15 independent services in order. If any
// one of them hangs (e.g. fastify.close() waiting on an in-flight request
// that never finishes, a stuck Redis/Postgres close), the whole sequence
// would silently hang past stop_grace_period (45s) and Docker would send an
// abrupt SIGKILL — no log line, no chance to flush anything, no exit code
// under our control. Race it against a hard timeout well under the grace
// period so a stuck step forces our own logged, deliberate exit instead.
const SHUTDOWN_TIMEOUT_MS = 30000;

async function gracefulShutdown(signal) {
  fastify.log.info(`${signal} received — shutting down gracefully`);

  const timeout = new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS);
    if (t.unref) t.unref();
  });

  const result = await Promise.race([shutdownSteps(signal).then(() => 'done'), timeout]);

  if (result === 'timeout') {
    fastify.log.error(`Graceful shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
    process.exit(1);
  }
}

async function shutdownSteps(signal) {
  try {
    await clusterCoordinator.stop();
    resourceMonitor.stop();
    bandwidthTracker.stop();

    if (container.has('notifications')) {
      await container.get('notifications')
        .sendProxyLifecycleNotification('stopping', { signal, source: 'shutdown' }, { fastShutdown: true })
        .catch((err) => fastify.log.warn({ err }, 'Failed to send shutdown notification'));
    }

    healthCheckService.stop();
    if (config.queue.enabled) { await retryWorker.stop(); await queueService.cleanup?.(); }
    await proxyManager.stopAll();
    await logBatchQueue.stop();
    await smtpProxyService.stop();
    acmeManager.stopRenewalCron();
    updateService.stopCron();

    // MUST run before closePool(): this holds a dedicated Postgres client
    // checked out of the pool for LISTEN/NOTIFY (never released back to the
    // pool while listening, by design). Without this, pool.end() waits
    // forever for that client to be released — it never was, so every
    // graceful shutdown silently hung for the full 30s force-exit timeout.
    await multiProxySyncService.stopListening().catch((err) => fastify.log.warn({ err }, 'Failed to stop multi-proxy sync listener'));

    if (fastify.tunnelRelayService)  await fastify.tunnelRelayService.stop();
    if (fastify.websocketManager)    fastify.websocketManager.close();
    if (fastify.backupScheduler)     fastify.backupScheduler.stop();

    await fastify.close();
    database.close();
    if (config.database.type === 'postgresql') await closePool();
    await redisService.close();

    stopLogCleanup();
    stopSslExpiryCheck();
    process.exit(0);
  } catch (error) {
    fastify.log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Crash safety net ──────────────────────────────────────────────────────────
// STABILITY: there was previously no process-level uncaughtException /
// unhandledRejection handler anywhere. Since the backend runs as a single
// process (network_mode: host) proxying every configured domain, ANY
// unhandled error anywhere (an 'error' event on a stream with no listener,
// a rejected promise with no .catch()) took down the whole proxy for every
// domain simultaneously with Node's default behavior. Most known sources of
// unhandled stream errors in the HTTP proxy path have been fixed directly
// (see requestProxy.js), but this stays as a last-resort net against
// whatever wasn't — it's not safe to keep running after an uncaught
// exception, so we shut down cleanly and let `restart: unless-stopped`
// bring the container back instead of silently corrupting state.
process.on('unhandledRejection', (reason) => {
  fastify.log.error({ err: reason }, '[FATAL-SAFETY-NET] Unhandled promise rejection — missing a .catch() somewhere. Process keeps running; investigate this.');
});

process.on('uncaughtException', (error, origin) => {
  fastify.log.error({ err: error, origin }, '[FATAL-SAFETY-NET] Uncaught exception — shutting down for a clean restart (continuing after this is unsafe).');
  const forceExitTimer = setTimeout(() => process.exit(1), 10000);
  forceExitTimer.unref();
  gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    applyLogFilter();
    await startupSequence(fastify, config);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

await start();
startLogCleanup();
startSslExpiryCheck();
