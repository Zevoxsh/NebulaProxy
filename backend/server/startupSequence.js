import { testPostgresConnection } from '../config/database.js';
import { database }              from '../services/database.js';
import { redisService }          from '../services/redis.js';
import { geoIpService }          from '../services/geoIpService.js';
import { liveTrafficService }    from '../services/liveTrafficService.js';
import { ddosProtectionService } from '../services/ddosProtectionService.js';
import { acmeManager }           from '../services/acmeManager.js';
import { proxyManager }          from '../services/proxyManager.js';
import { multiProxySyncService } from '../services/multiProxySyncService.js';
import { logBatchQueue }         from '../services/logBatchQueue.js';
import { queueService }          from '../services/queueService.js';
import { retryWorker }           from '../services/retryWorker.js';
import { smtpProxyService }      from '../services/smtpProxyService.js';
import updateService             from '../services/updateService.js';
import { healthCheckService }    from '../services/healthCheckService.js';
import WebSocketManager          from '../services/websocketManager.js';
import NotificationService       from '../services/notificationService.js';
import { resourceMonitor }       from '../services/resourceMonitor.js';
import { bandwidthTracker }      from '../services/bandwidthTracker.js';
import { logBroadcastService }   from '../services/logBroadcastService.js';
import { tunnelRelayService }    from '../services/tunnelRelayService.js';
import { container }             from '../services/container.js';
import BackupScheduler           from '../services/backupScheduler.js';

/**
 * Full startup sequence. Returns after the Fastify HTTP server is listening.
 * Logs each step via fastify.log so output format follows LOG_LEVEL / transport config.
 */
export async function startupSequence(fastify, config) {
  const startTime = Date.now();

  const step = (label, status, detail = '') => {
    if (!config.logging.startupSummary) return;
    const suffix = detail ? ` — ${detail}` : '';
    process.stdout.write(`  ${label.padEnd(34)}[${status}]${suffix}\n`);
  };

  if (config.logging.startupSummary) {
    process.stdout.write('\n===================================================================\n');
    process.stdout.write('  NebulaProxy :: Startup\n');
    process.stdout.write('===================================================================\n');
    step('Environment',    'OK', config.nodeEnv);
    step('Host/Port',      'OK', `${config.host}:${config.port}`);
    step('DB Engine',      'OK', config.database.type);
    step('Proxy Enabled',  config.proxy.enabled ? 'OK' : 'OFF');
  }

  // 1. Test PostgreSQL connection
  if (config.database.type === 'postgresql') {
    try {
      await testPostgresConnection();
      fastify.log.info('PostgreSQL connection OK');
    } catch (err) {
      fastify.log.fatal({ err, code: err.code }, 'PostgreSQL connection failed — cannot start');

      const hints = {
        ECONNREFUSED: `Check that PostgreSQL is running on ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}`,
        '28P01':      'Authentication failed — verify DB_PASSWORD',
        '3D000':      `Database does not exist — run: CREATE DATABASE ${process.env.DB_NAME || 'nebula_proxy'};`,
      };
      if (hints[err.code]) fastify.log.fatal(hints[err.code]);
      process.exit(1);
    }
  }

  // 2. Initialize database (runs migrations)
  try {
    await database.init();
    fastify.log.info('Database initialized');
    step('Database', 'OK', 'migrations applied');
  } catch (error) {
    fastify.log.fatal({ error }, 'Database initialization failed');
    step('Database', 'FAIL', error.message);
    process.exit(1);
  }

  // 2.5. Redis
  try {
    await redisService.init();
    if (redisService.isConnected) {
      fastify.log.info('Redis connected');
      step('Redis', 'OK', 'connected');
      geoIpService.init(redisService.client);
      liveTrafficService.init(redisService.client);
      await ddosProtectionService.init(redisService.client);
    } else {
      fastify.log.warn('Redis not connected — degraded mode (JWT revocation disabled)');
      step('Redis', 'WARN', 'not connected');
    }
  } catch (error) {
    fastify.log.warn({ error }, 'Redis init failed — degraded mode');
    step('Redis', 'WARN', 'connection failed');
  }

  // 3. ACME
  acmeManager.init();
  acmeManager.startRenewalCron();
  step('ACME Manager', 'OK', 'cron scheduled');

  // 4. Proxy manager
  await proxyManager.init(acmeManager);
  step('Proxy Manager', 'OK', 'initialized');

  // 4.5. Multi-proxy sync
  multiProxySyncService.init(proxyManager, database);
  try {
    await multiProxySyncService.startListening();
    step('Multi-Proxy Sync', 'OK', 'listening');
  } catch {
    step('Multi-Proxy Sync', 'INFO', 'single-instance mode');
  }

  // 4.6. Log batch queue
  logBatchQueue.start();
  step('Log Batch Queue', 'OK', 'started');

  // 5. Start active proxies
  const activeDomains = await database.getAllActiveDomains();
  let ok = 0, failed = 0;
  for (const domain of activeDomains) {
    try { await proxyManager.startProxy(domain); ok++; }
    catch (error) { fastify.log.error({ error, domainId: domain.id, hostname: domain.hostname }, 'Failed to start proxy'); failed++; }
  }
  fastify.log.info(`Started ${ok}/${activeDomains.length} proxies (${failed} errors)`);
  step('Active Proxies', failed === 0 ? 'OK' : 'WARN', `${ok}/${activeDomains.length}`);

  // 6. Retry worker
  if (config.queue.enabled) {
    await queueService.init();
    await retryWorker.start();
    step('Retry Worker', 'OK', 'running');
  } else {
    step('Retry Worker', 'SKIP', 'disabled');
  }

  // 6.6. SMTP proxy
  try {
    await smtpProxyService.start();
    const stats = smtpProxyService.getStats();
    if (stats.isRunning) {
      const ports = stats.servers.map(s => `${s.name}:${s.port}`).join(', ');
      step('SMTP Proxy', 'OK', ports);
    } else {
      step('SMTP Proxy', 'SKIP', 'disabled');
    }
  } catch (error) {
    fastify.log.error({ error }, 'SMTP proxy start failed');
    step('SMTP Proxy', 'WARN', error.message);
  }

  // 6.7. Update service
  await updateService.init(fastify);
  step('Update Service', 'OK', 'initialized');

  // 7. Start Fastify listener
  // Always bind to all interfaces inside the container so the healthcheck
  // (wget localhost:3000) always works, regardless of the configured external HOST.
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`API listening on ${config.host}:${config.port}`);
  step('API Listener', 'OK', `${config.host}:${config.port}`);

  // 7.5. WebSocket + notifications
  try {
    const wsManager = new WebSocketManager(fastify.server, fastify.log);
    fastify.websocketManager = wsManager;

    const notifService = new NotificationService(fastify.log, wsManager);
    await notifService.initialize();
    container.set('notifications', notifService);
    fastify.notificationService = notifService;

    try { await notifService.sendProxyLifecycleNotification('started', { host: config.host, port: config.port, source: 'startup' }); }
    catch { /* non-fatal */ }

    resourceMonitor.start();
    bandwidthTracker.start();
    logBroadcastService.setWebSocketManager(wsManager);

    await tunnelRelayService.init(fastify.server, fastify.log);
    fastify.tunnelRelayService = tunnelRelayService;

    fastify.server.on('upgrade', (request, socket, head) => {
      try {
        if (fastify.tunnelRelayService?.shouldHandleUpgrade(request)) { fastify.tunnelRelayService.handleUpgrade(request, socket, head); return; }
        if (fastify.websocketManager?.shouldHandleUpgrade(request))   { fastify.websocketManager.handleUpgrade(request, socket, head);   return; }
        socket.destroy();
      } catch (err) {
        fastify.log.warn({ err, url: request?.url }, 'WebSocket upgrade routing failed');
        socket.destroy();
      }
    });

    step('WebSocket',    'OK', '/ws/notifications');
    step('Notifications','OK', 'email/webhooks/websocket');
    step('Tunnel Relay', 'OK', '/ws/tunnels/agent');
    step('Log Broadcast','OK', 'real-time logs');
  } catch (error) {
    fastify.log.error({ error }, 'WebSocket/Notifications init failed');
    step('WebSocket/Notifications', 'WARN', 'init failed');
  }

  // 7.6. Health checks
  try {
    await healthCheckService.start();
    step('Health Checks', 'OK', `interval ${config.healthChecks.intervalSeconds}s`);
  } catch (error) {
    fastify.log.error({ error }, 'Health check service failed to start');
    step('Health Checks', 'WARN', error.message);
  }

  // 7.7. Backup scheduler
  try {
    const backupScheduler = new BackupScheduler(fastify.log);
    await backupScheduler.initialize();
    fastify.backupScheduler = backupScheduler;
    step('Backup Scheduler', 'OK', 'automatic DB backups');
  } catch (error) {
    fastify.log.error({ error }, 'Backup scheduler init failed');
    step('Backup Scheduler', 'WARN', error.message);
  }

  if (config.logging.startupSummary) {
    process.stdout.write('-------------------------------------------------------------------\n');
    process.stdout.write(`  Startup complete in ${Date.now() - startTime}ms\n`);
    process.stdout.write('===================================================================\n\n');
  }
}
