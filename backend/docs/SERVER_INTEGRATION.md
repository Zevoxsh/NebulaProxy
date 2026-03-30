# Server Integration Guide

This guide describes the integration steps for admin audit, notifications, backups, and WebSocket services.

## 1) Add imports in `backend/server.js`
Place these after existing imports:

```javascript
// New features
import auditRoutes from './routes/admin/audit.js';
import notificationRoutes from './routes/admin/notifications.js';
import backupRoutes from './routes/admin/backups.js';
import WebSocketManager from './services/websocketManager.js';
import BackupScheduler from './services/backupScheduler.js';
import NotificationService from './services/notificationService.js';
```

## 2) Register routes
Add after:
`await fastify.register(updateRoutes, { prefix: '/api/admin/updates' });`

```javascript
// New admin routes
await fastify.register(auditRoutes, { prefix: '/api/admin' });
await fastify.register(notificationRoutes, { prefix: '/api/admin/notifications' });
await fastify.register(backupRoutes, { prefix: '/api/admin/backups' });
```

## 3) Initialize services
Place after the server starts listening and before shutdown handling:

```javascript
// Initialize WebSocket, Notifications & Backup Scheduler
let websocketManager = null;
let notificationService = null;
let backupScheduler = null;

try {
  await fastify.listen({
    port: config.port,
    host: config.host
  });

  fastify.log.info(`Backend API listening on ${config.host}:${config.port}`);
  logStep('API Listener', 'OK', `${config.host}:${config.port}`);

  websocketManager = new WebSocketManager(fastify.server, fastify.log);
  logStep('WebSocket', 'OK', '/ws/notifications');

  notificationService = new NotificationService(fastify.log, websocketManager);
  await notificationService.initialize();
  global.notificationService = notificationService;
  fastify.notificationService = notificationService;
  logStep('Notifications', 'OK', 'initialized');

  backupScheduler = new BackupScheduler(fastify.log);
  await backupScheduler.initialize();
  fastify.backupScheduler = backupScheduler;
  logStep('Backup Scheduler', 'OK', 'initialized');

} catch (error) {
  fastify.log.error('Failed to initialize services:', error);
  throw error;
}
```

## 4) Graceful shutdown
Add in the shutdown handler:

```javascript
if (websocketManager) {
  websocketManager.close();
  fastify.log.info('WebSocket manager closed');
}

if (backupScheduler) {
  backupScheduler.stop();
  fastify.log.info('Backup scheduler stopped');
}
```

## 5) Install dependencies
```bash
cd backend
npm install ws node-cron nodemailer
```

## 6) Run the migration
```bash
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f backend/migrations/011_add_notifications_backups.sql
```

## Testing
### WebSocket
Open `/admin` and check the Network tab for a WS connection.

### Notifications
```bash
curl -X POST http://localhost:3000/api/admin/notifications/test/email \
  -H "Cookie: token=YOUR_TOKEN"
```

### Automatic backup
1) Open `/admin/backups`
2) Enable the scheduler (daily, 02:00, 30 days)
3) Create a manual backup
4) Verify backups appear in the list

### Audit trail
1) Open `/admin/audit`
2) Trigger actions (create domain, update config)
3) Verify audit entries

## Monitoring events (optional)
Add to your services to send realtime notifications:

### healthCheckService.js (domain down)
```javascript
if (global.notificationService && !isHealthy) {
  await global.notificationService.sendDomainDownAlert(domain.domain, error);
}
```

### certificateManager.js (SSL expiry)
```javascript
if (global.notificationService && daysUntilExpiry <= alertDays) {
  await global.notificationService.sendCertificateExpiryAlert(domain, daysUntilExpiry);
}
```

### Monitoring (CPU/memory alerts)
```javascript
if (global.notificationService) {
  const config = await notificationService.config;
  if (cpuUsage > config.alerts.high_cpu_threshold) {
    await global.notificationService.sendResourceAlert('cpu', cpuUsage, config.alerts.high_cpu_threshold);
  }
}
```

