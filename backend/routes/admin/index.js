import { adminUserRoutes } from './users.js';
import { adminConfigRoutes } from './config.js';
import { adminSystemRoutes } from './system.js';
import notificationRoutes from './notifications.js';
import { ddosAdminRoutes } from './ddos.js';
import { trafficAdminRoutes } from './traffic.js';
import { backupRoutes } from './backups.js';

export async function adminRoutes(fastify, options) {
  // User management: users, domains, teams, redirections, api-keys, audit-logs, stats
  await fastify.register(adminUserRoutes);

  // System configuration: branding, config, redis config, registration settings
  await fastify.register(adminConfigRoutes);

  // System info & ops: monitoring, queue/DLQ, database backup, docker services
  await fastify.register(adminSystemRoutes);

  // Notification management (admin)
  await fastify.register(notificationRoutes, { prefix: '/notifications' });

  // DDoS protection admin routes
  await fastify.register(ddosAdminRoutes, { prefix: '/ddos' });

  // Live traffic admin routes
  await fastify.register(trafficAdminRoutes, { prefix: '/traffic' });

  // Database backup management + S3 cloud backup routes
  await fastify.register(backupRoutes, { prefix: '/backups' });
}
