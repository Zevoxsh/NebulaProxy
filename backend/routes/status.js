/**
 * Public status endpoint — no authentication required.
 * Returns the health status of all active domains without exposing
 * any backend URLs, IPs, or internal configuration.
 */
import { database } from '../services/database.js';

export async function statusRoutes(fastify, options) {
  fastify.get('/', {
    handler: async (request, reply) => {
      try {
        const allDomains = await database.getAllActiveDomains();

        const services = await Promise.all(allDomains.map(async (domain) => {
          const healthStatus  = await database.getDomainHealthStatus(domain.id);
          const latestCheck   = await database.getLatestHealthCheck(domain.id);
          const recentChecks  = await database.getHealthChecksByDomain(domain.id, 10);

          // Only consider checks from the last 2 hours as "active monitoring"
          const TWO_HOURS_AGO = Date.now() - 2 * 60 * 60 * 1000;
          const freshChecks  = recentChecks.filter(c => new Date(c.checked_at).getTime() > TWO_HOURS_AGO);

          const totalChecks      = freshChecks.length;
          const successfulChecks = freshChecks.filter(c => c.status === 'success').length;
          const uptime = totalChecks > 0
            ? parseFloat(((successfulChecks / totalChecks) * 100).toFixed(2))
            : 100;

          const avgResponseTime = totalChecks > 0
            ? Math.round(freshChecks.reduce((sum, c) => sum + (c.response_time || 0), 0) / totalChecks)
            : 0;

          let status = 'healthy';
          if (!domain.is_active) {
            status = 'down';
          } else if (healthStatus?.current_status === 'down') {
            status = 'down';
          } else if (healthStatus?.current_status === 'up') {
            status = (latestCheck?.response_time > 1000) ? 'degraded' : 'healthy';
          }

          const monitored    = totalChecks > 0;
          const checkHistory = [...freshChecks]
            .reverse()
            .map(c => c.status === 'success' ? 'up' : 'down');

          return {
            hostname:     domain.hostname,
            proxyType:    domain.proxy_type || 'http',
            status,
            monitored,
            uptime:       monitored ? uptime : null,
            responseTime: monitored ? avgResponseTime : null,
            lastChecked:  latestCheck ? new Date(latestCheck.checked_at).toISOString() : null,
            history:      checkHistory,
          };
        }));

        // Sort: down first, then degraded, then healthy — alphabetical within each group
        const ORDER = { down: 0, degraded: 1, healthy: 2 };
        services.sort((a, b) => {
          const od = (ORDER[a.status] ?? 2) - (ORDER[b.status] ?? 2);
          return od !== 0 ? od : a.hostname.localeCompare(b.hostname);
        });

        const summary = {
          total:    services.length,
          healthy:  services.filter(s => s.status === 'healthy').length,
          degraded: services.filter(s => s.status === 'degraded').length,
          down:     services.filter(s => s.status === 'down').length,
        };

        return {
          services,
          summary,
          generatedAt: new Date().toISOString(),
        };
      } catch (error) {
        fastify.log.error({ error }, 'Error generating public status');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });
}
