import { authRoutes }                    from '../routes/auth/index.js';
import { userRoutes }                    from '../routes/user.js';
import { domainRoutes }                  from '../routes/domains.js';
import { redirectionRoutes }             from '../routes/redirections.js';
import { adminRoutes }                   from '../routes/admin/index.js';
import { teamRoutes }                    from '../routes/teams.js';
import { domainGroupRoutes }             from '../routes/domainGroups.js';
import { apiKeysRoutes }                 from '../routes/apiKeys.js';
import { tunnelRoutes }                  from '../routes/tunnels.js';
import { analyticsRoutes }               from '../routes/analytics.js';
import { logsRoutes }                    from '../routes/logs.js';
import { monitoringRoutes }              from '../routes/monitoring.js';
import { statusRoutes }                  from '../routes/status.js';
import { sslRoutes }                     from '../routes/ssl.js';
import { settingsRoutes }                from '../routes/settings.js';
import { notificationRoutes as userNotificationRoutes } from '../routes/notifications.js';
import { notificationPreferencesRoutes } from '../routes/notificationPreferences.js';
import { proxyRoutes }                   from '../routes/proxy.js';
import { updateRoutes }                  from '../routes/updates.js';
import urlBlockingRoutes                 from '../routes/urlBlockingRules.js';
import { smtpProxyRoutes }               from '../routes/smtpProxy.js';

/**
 * Registers all application routes. Call after all plugins and decorators are set up.
 */
export async function registerRoutes(fastify) {
  await fastify.register(authRoutes,                    { prefix: '/api/auth' });
  await fastify.register(userRoutes,                    { prefix: '/api/user' });
  await fastify.register(domainRoutes,                  { prefix: '/api/domains' });
  await fastify.register(redirectionRoutes,             { prefix: '/api/redirections' });
  await fastify.register(adminRoutes,                   { prefix: '/api/admin' });
  await fastify.register(teamRoutes,                    { prefix: '/api/teams' });
  await fastify.register(domainGroupRoutes,             { prefix: '/api/domain-groups' });
  await fastify.register(apiKeysRoutes,                 { prefix: '/api/api-keys' });
  await fastify.register(tunnelRoutes,                  { prefix: '/api/tunnels' });
  await fastify.register(analyticsRoutes,               { prefix: '/api/analytics' });
  await fastify.register(logsRoutes,                    { prefix: '/api/logs' });
  await fastify.register(monitoringRoutes,              { prefix: '/api/monitoring' });
  await fastify.register(statusRoutes,                  { prefix: '/api/status' });
  await fastify.register((await import('../routes/metrics.js')).metricsRoutes, { prefix: '' });
  await fastify.register(sslRoutes,                     { prefix: '/api/ssl' });
  await fastify.register(settingsRoutes,                { prefix: '/api/settings' });
  await fastify.register(userNotificationRoutes,        { prefix: '/api/notifications' });
  await fastify.register(notificationPreferencesRoutes, { prefix: '/api/notification-preferences' });
  await fastify.register(proxyRoutes,                   { prefix: '/proxy' });
  await fastify.register(updateRoutes,                  { prefix: '/api/admin/updates' });
  await fastify.register(urlBlockingRoutes,             { prefix: '/api/url-blocking' });
  await fastify.register(smtpProxyRoutes,               { prefix: '/api/smtp-proxy' });
}
