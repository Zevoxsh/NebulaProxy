// @ts-check
import { adminUserRoutes } from './users.js';
import { adminConfigRoutes } from './config.js';
import { adminSystemRoutes } from './system.js';
import notificationRoutes from './notifications.js';
import { ddosAdminRoutes } from './ddos.js';
import { trafficAdminRoutes } from './traffic.js';
import { backupRoutes } from './backups.js';

export async function adminRoutes(fastify, _options) {
  await fastify.register(adminUserRoutes);
  await fastify.register(adminConfigRoutes);
  await fastify.register(adminSystemRoutes);
  await fastify.register(notificationRoutes, { prefix: '/notifications' });
  await fastify.register(ddosAdminRoutes,    { prefix: '/ddos' });
  await fastify.register(trafficAdminRoutes, { prefix: '/traffic' });
  await fastify.register(backupRoutes,       { prefix: '/backups' });
}
