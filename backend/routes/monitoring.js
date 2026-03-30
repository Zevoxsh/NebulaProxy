import { database } from '../services/database.js';

export async function monitoringRoutes(fastify, options) {
  // Get service health status
  fastify.get('/services', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;

        // Get user's domains + team domains
        const userDomains = await database.getDomainsByUserIdWithTeams(userId);

        // Calculate stats for each domain using real-time health status
        const services = await Promise.all(userDomains.map(async (domain) => {
          // Get real-time health status
          const healthStatus = await database.getDomainHealthStatus(domain.id);
          const latestCheck = await database.getLatestHealthCheck(domain.id);

          // Get recent health checks for uptime calculation (last 10 checks)
          const recentChecks = await database.getHealthChecksByDomain(domain.id, 10);

          const totalChecks = recentChecks.length;
          const successfulChecks = recentChecks.filter(c => c.status === 'success').length;
          const failedChecks = recentChecks.filter(c => c.status === 'failed').length;

          // Calculate uptime percentage based on last 10 checks
          const uptime = totalChecks > 0
            ? ((successfulChecks / totalChecks) * 100).toFixed(2)
            : 100;

          // Get average response time from recent checks
          const avgResponseTime = totalChecks > 0
            ? Math.round(recentChecks.reduce((sum, c) => sum + (c.response_time || 0), 0) / totalChecks)
            : 0;

          // Determine status based on real-time health status (not historical stats)
          let status = 'healthy';
          if (!domain.is_active) {
            status = 'down';
          } else if (healthStatus) {
            // Use real-time status from domain_health_status table
            if (healthStatus.current_status === 'down') {
              status = 'down';
            } else if (healthStatus.current_status === 'up') {
              // Check if response time is degraded (last check > 1000ms = degraded)
              if (latestCheck && latestCheck.response_time > 1000) {
                status = 'degraded';
              } else {
                status = 'healthy';
              }
            } else {
              // Unknown status
              status = 'healthy';
            }
          } else {
            // No health status yet - assume healthy if domain is active
            status = 'healthy';
          }

          // SSL info
          const sslValid = domain.ssl_status === 'active';
          const sslStatus = domain.ssl_status || 'disabled';
          let sslExpiresIn = null;

          if (domain.ssl_expires_at) {
            const expiryDate = new Date(domain.ssl_expires_at);
            const now = new Date();
            const diffTime = expiryDate - now;
            sslExpiresIn = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          }

          return {
            id: domain.id,
            name: domain.hostname,
            ownershipType: domain.ownership_type,
            teamName: domain.team_name,
            proxyType: domain.proxy_type || 'http',
            status,
            uptime: parseFloat(uptime),
            responseTime: avgResponseTime,
            lastCheck: latestCheck ? new Date(latestCheck.checked_at) : new Date(),
            ssl: {
              valid: sslValid,
              status: sslStatus,
              expiresIn: sslExpiresIn
            },
            checks: {
              passed: successfulChecks,
              failed: failedChecks
            }
          };
        }));

        return { services };
      } catch (error) {
        fastify.log.error({ error }, 'Error getting service health');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Get monitoring stats
  fastify.get('/stats', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;

        // Get user's domains + team domains
        const userDomains = await database.getDomainsByUserIdWithTeams(userId);
        const domainIds = userDomains.map(d => d.id);

        if (domainIds.length === 0) {
          return {
            healthy: 0,
            degraded: 0,
            down: 0
          };
        }

        // Calculate overall stats using real-time health status
        let healthyCount = 0;
        let degradedCount = 0;
        let downCount = 0;

        for (const domain of userDomains) {
          const healthStatus = await database.getDomainHealthStatus(domain.id);
          const latestCheck = await database.getLatestHealthCheck(domain.id);

          if (!domain.is_active) {
            downCount++;
          } else if (healthStatus) {
            // Use real-time status
            if (healthStatus.current_status === 'down') {
              downCount++;
            } else if (healthStatus.current_status === 'up') {
              // Check if degraded (response time > 1000ms)
              if (latestCheck && latestCheck.response_time > 1000) {
                degradedCount++;
              } else {
                healthyCount++;
              }
            } else {
              healthyCount++;
            }
          } else {
            // No health status yet, assume healthy if active
            healthyCount++;
          }
        }

        return {
          healthy: healthyCount,
          degraded: degradedCount,
          down: downCount
        };
      } catch (error) {
        fastify.log.error({ error }, 'Error getting monitoring stats');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Refresh service status (manual health check) - DISABLED
  fastify.post('/refresh', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      return {
        success: false,
        message: 'Health checks are disabled.'
      };
    }
  });
}
