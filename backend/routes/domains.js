import { database } from '../services/database.js';
import { liveTrafficService } from '../services/liveTrafficService.js';
import { checkDomainQuota } from '../middleware/quotaCheck.js';
import { proxyManager } from '../services/proxyManager.js';
import { acmeManager } from '../services/acmeManager.js';
import { validateBackendUrlWithDNS, sanitizeHostname } from '../utils/security.js';
import { PermissionChecker } from '../utils/permissions.js';
import { config } from '../config/config.js';
import { allocateAvailablePort, isPortAvailable, validateExternalPort, MIN_EXTERNAL_PORT, MAX_EXTERNAL_PORT } from '../services/portAllocator.js';
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import validator from 'validator';

const ROUTE_CHECK_PATH = '/.well-known/nebula-proxy';
const ROUTE_CHECK_TIMEOUT_MS = 5000;

const getBackendUrlPortError = (backendUrl) => {
  try {
    const parsedUrl = new URL(backendUrl);
    if (parsedUrl.port) {
      return 'Backend URL must not include a port. Use the backendPort field instead.';
    }
  } catch {
    return null;
  }
  return null;
};

const parsePortNumber = (value) => {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port)) {
    return null;
  }
  if (port < MIN_EXTERNAL_PORT || port > MAX_EXTERNAL_PORT) {
    return null;
  }
  return port;
};

const resolveDns = async (hostname) => {
  const results = { a: [], aaaa: [], cname: [] };
  const [a, aaaa, cname] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
    dns.resolveCname(hostname)
  ]);

  if (a.status === 'fulfilled') results.a = a.value;
  if (aaaa.status === 'fulfilled') results.aaaa = aaaa.value;
  if (cname.status === 'fulfilled') results.cname = cname.value;

  return results;
};

const probeUrl = (url, hostname) => new Promise((resolve) => {
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    timeout: ROUTE_CHECK_TIMEOUT_MS,
    headers: {
      Host: hostname,
      'User-Agent': 'NebulaProxy-RouteCheck/1.0'
    }
  };

  if (isHttps) {
    options.rejectUnauthorized = !config.proxy.allowInsecureBackends;
  }

  const req = client.request(options, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk;
      if (body.length > 512) {
        body = body.slice(0, 512);
      }
    });
    res.on('end', () => {
      const headerToken = res.headers['x-nebula-proxy'];
      const ok = headerToken === config.proxy.checkToken || body.trim() === config.proxy.checkToken;
      resolve({ ok, statusCode: res.statusCode });
    });
  });

  req.on('error', (error) => {
    resolve({ ok: false, error: error.message });
  });
  req.on('timeout', () => {
    req.destroy();
    resolve({ ok: false, error: 'timeout' });
  });
  req.end();
});


// Helper function to check if user can access a domain (view only)
async function canAccessDomain(domain, userId, isAdmin) {
  // Owner can always access
  if (domain.user_id === userId) return true;

  // Team members can access team domains
  if (domain.team_id && await database.isTeamMember(domain.team_id, userId)) return true;

  return false;
}

// Helper function to check if user can modify a domain
async function canModifyDomain(domain, userId, isAdmin) {
  // Owner can always modify
  if (domain.user_id === userId) return true;

  // For team domains, check if user has can_manage_domains permission
  if (domain.team_id) {
    const hasPermission = await database.hasTeamPermission(domain.team_id, userId, 'can_manage_domains');
    return hasPermission;
  }

  return false;
}

export async function domainRoutes(fastify, options) {
  // Admin: check if an external port is available (TCP/UDP only)
  fastify.get('/ports/check', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { port, protocol } = request.query;
      const parsedPort = parsePortNumber(port);
      const normalizedProtocol = (protocol || '').toLowerCase();

      if (!parsedPort) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Port must be an integer between ${MIN_EXTERNAL_PORT} and ${MAX_EXTERNAL_PORT}`
        });
      }

      if (!['tcp', 'udp'].includes(normalizedProtocol)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Protocol must be tcp or udp'
        });
      }

      const assigned = await database.isPortAssigned(parsedPort, normalizedProtocol);
      const available = await isPortAvailable(parsedPort, normalizedProtocol);

      return reply.send({
        port: parsedPort,
        protocol: normalizedProtocol,
        assigned,
        available,
        free: !assigned && available
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to check port availability');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to check port availability'
      });
    }
  });

  fastify.get('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      // All users (including admins) only see their own domains + team domains
      // To see all domains, use the admin panel endpoint /api/admin/domains
      const domains = await database.getDomainsByUserIdWithTeams(userId);

      reply.send({
        success: true,
        domains,
        count: domains.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch domains');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch domains'
      });
    }
  });

  fastify.get('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canAccessDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this domain'
        });
      }

      reply.send({
        success: true,
        domain
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch domain');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch domain'
      });
    }
  });

  fastify.post('/', {
    preHandler: [fastify.authenticate, checkDomainQuota],
    schema: {
      body: {
        type: 'object',
        required: ['hostname', 'backendUrl'],
        properties: {
          hostname: {
            type: 'string',
            minLength: 1,
            maxLength: 255
          },
          backendUrl: {
            type: 'string',
            minLength: 1,
            maxLength: 2048
          },
          backendPort: {
            type: 'string',
            pattern: '^[0-9]+$',
            minLength: 1,
            maxLength: 5
          },
          externalPort: {
            type: 'integer',
            minimum: 1,
            maximum: 65535
          },
          description: {
            type: 'string',
            maxLength: 500
          },
          proxyType: {
            type: 'string',
            enum: ['http', 'tcp', 'udp', 'minecraft']
          },
          sslEnabled: {
            type: 'boolean'
          },
          challengeType: {
            type: 'string',
            enum: ['http-01', 'dns-01']
          },
          teamId: {
            type: 'integer',
            minimum: 1
          },
          minecraftEdition: {
            type: 'string',
            enum: ['java', 'bedrock']
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const { hostname, backendUrl, backendPort, description, proxyType = 'http', sslEnabled, externalPort, minecraftEdition = 'java' } = request.body;
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      // Check for wildcard domain (HTTP only)
      const isWildcard = hostname.startsWith('*.');
      let challengeType = request.body.challengeType || 'http-01';

      if (proxyType === 'http') {
        if (isWildcard) {
          // Validate wildcard format: *.example.com
          const wildcardRegex = /^\*\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
          if (!wildcardRegex.test(hostname)) {
            return reply.code(400).send({
              error: 'Invalid wildcard domain',
              message: 'Wildcard must be in format: *.example.com'
            });
          }

          // Wildcard domains MUST use DNS-01 challenge
          if (sslEnabled && challengeType !== 'dns-01') {
            return reply.code(400).send({
              error: 'Invalid configuration',
              message: 'Wildcard domains require DNS-01 challenge type'
            });
          }

          // Force DNS-01 for wildcard
          challengeType = 'dns-01';
        } else {
          // Regular domain validation
          const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
          if (!hostnameRegex.test(hostname)) {
            return reply.code(400).send({
              error: 'Invalid hostname',
              message: 'Hostname must be a valid DNS name (e.g., example.com or subdomain.example.com)'
            });
          }
        }
      }

      // Validate based on proxy type
      if (proxyType === 'http') {
        if (externalPort !== undefined && externalPort !== null) {
          return reply.code(400).send({
            error: 'Invalid configuration',
            message: 'External port is only supported for TCP/UDP proxies'
          });
        }
        if (!validator.isURL(backendUrl, { require_protocol: true, protocols: ['http', 'https'], require_tld: false })) {
          return reply.code(400).send({
            error: 'Invalid backend URL',
            message: 'Backend URL must be a valid HTTP or HTTPS URL'
          });
        }
        const portError = getBackendUrlPortError(backendUrl);
        if (portError) {
          return reply.code(400).send({
            error: 'Invalid backend URL',
            message: portError
          });
        }

        // Additional SSRF protection: block private IPs and metadata endpoints
        try {
          await validateBackendUrlWithDNS(backendUrl);
        } catch (err) {
          return reply.code(400).send({
            error: 'Invalid backend URL',
            message: err.message
          });
        }
      } else if (proxyType === 'minecraft' && minecraftEdition === 'bedrock' && externalPort !== undefined && externalPort !== null) {
        if (!isAdmin) {
          return reply.code(403).send({ error: 'Forbidden', message: 'Only admins can choose a custom external port' });
        }
        try {
          await validateExternalPort(externalPort, 'udp');
        } catch (e) {
          return reply.code(e.code).send({ error: e.code === 409 ? 'Port unavailable' : 'Invalid external port', message: e.message });
        }
      } else if (proxyType === 'tcp' || proxyType === 'udp') {
        if (!validator.isURL(backendUrl, { require_protocol: true, protocols: ['tcp', 'udp'], require_tld: false })) {
          return reply.code(400).send({
            error: 'Invalid backend URL',
            message: `Backend URL must be a valid ${proxyType.toUpperCase()} URL`
          });
        }
        const portError = getBackendUrlPortError(backendUrl);
        if (portError) {
          return reply.code(400).send({ error: 'Invalid backend URL', message: portError });
        }

        if (externalPort !== undefined && externalPort !== null) {
          if (!isAdmin) {
            return reply.code(403).send({ error: 'Forbidden', message: 'Only admins can choose a custom external port' });
          }
          try {
            await validateExternalPort(externalPort, proxyType);
          } catch (e) {
            return reply.code(e.code).send({ error: e.code === 409 ? 'Port unavailable' : 'Invalid external port', message: e.message });
          }
        }

        // Additional SSRF protection for TCP/UDP
        try {
          await validateBackendUrlWithDNS(backendUrl);
        } catch (err) {
          return reply.code(400).send({ error: 'Invalid backend URL', message: err.message });
        }
      }

      const existingDomain = await database.getDomainByHostnameAndType(hostname, proxyType);
      if (existingDomain) {
        return reply.code(409).send({
          error: 'Conflict',
          message: `Domain ${hostname} is already registered with proxy type ${proxyType}`
        });
      }

      let resolvedExternalPort = null;
      const needsExternalPort = proxyType === 'tcp' || proxyType === 'udp' ||
        (proxyType === 'minecraft' && minecraftEdition === 'bedrock');
      if (needsExternalPort) {
        if (externalPort !== undefined && externalPort !== null) {
          resolvedExternalPort = externalPort;
        } else {
          resolvedExternalPort = await allocateAvailablePort(proxyType === 'minecraft' ? 'udp' : proxyType);
        }
      }

      const domain = await database.createDomain({
        userId,
        hostname,
        backendUrl,
        backendPort,
        description,
        proxyType,
        externalPort: resolvedExternalPort,
        sslEnabled: sslEnabled || false,
        acmeChallengeType: challengeType,
        isWildcard: isWildcard,
        minecraftEdition: proxyType === 'minecraft' ? minecraftEdition : undefined
      });

      await database.createAuditLog({
        userId,
        action: 'domain_created',
        entityType: 'domain',
        entityId: domain.id,
        details: {
          hostname,
          backendUrl,
          backendPort,
          description,
          proxyType,
          sslEnabled: sslEnabled || false
        },
        ipAddress: request.ip
      });



      fastify.log.info({ username: request.user.username, hostname }, 'Domain created');

      // Start proxy if domain is active
      if (domain.is_active) {
        try {
          await proxyManager.startProxy(domain);
          fastify.log.info({ domainId: domain.id, hostname }, 'Proxy started');
        } catch (error) {
          fastify.log.error({ error, domainId: domain.id }, 'Failed to start proxy');
          // Don't fail the request - proxy can be started manually
        }
      }

      reply.code(201).send({
        success: true,
        domain,
        quota: request.quota
      });
    } catch (error) {
      fastify.log.error({
        error: error.message,
        stack: error.stack,
        code: error.code
      }, 'Failed to create domain');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to create domain'
      });
    }
  });

  fastify.put('/:id', {
    preHandler: fastify.authenticate,
    schema: {
      params: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            pattern: '^[0-9]+$'
          }
        },
        required: ['id']
      },
      body: {
        type: 'object',
        properties: {
          hostname: {
            type: 'string',
            minLength: 1,
            maxLength: 255
          },
          backendUrl: {
            type: 'string',
            minLength: 1,
            maxLength: 2048
          },
          backendPort: {
            type: 'string',
            pattern: '^[0-9]+$',
            minLength: 1,
            maxLength: 5
          },
          externalPort: {
            type: 'integer',
            minimum: 1,
            maximum: 65535
          },
          description: {
            type: 'string',
            maxLength: 500
          },
          proxyType: {
            type: 'string',
            enum: ['http', 'tcp', 'udp']
          },
          sslEnabled: {
            type: 'boolean'
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const { hostname, backendUrl, backendPort, description, proxyType, sslEnabled, externalPort, bungeecordForwarding } = request.body;
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this domain'
        });
      }

      const checkProxyType = proxyType || domain.proxy_type || 'http';

      if (hostname && hostname !== domain.hostname) {
        if (checkProxyType === 'http') {
          const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
          if (!hostnameRegex.test(hostname)) {
            return reply.code(400).send({
              error: 'Invalid hostname',
              message: 'Hostname must be a valid DNS name'
            });
          }
        }

        const existingDomain = await database.getDomainByHostnameAndType(hostname, checkProxyType);
        if (existingDomain && existingDomain.id !== domainId) {
          return reply.code(409).send({
            error: 'Conflict',
            message: `Domain ${hostname} is already registered with proxy type ${checkProxyType}`
          });
        }
      }

      if (externalPort !== undefined && externalPort !== null) {
        if (checkProxyType === 'http') {
          return reply.code(400).send({
            error: 'Invalid configuration',
            message: 'External port is only supported for TCP/UDP proxies'
          });
        }
        if (!isAdmin) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'Only admins can choose a custom external port'
          });
        }
        if (externalPort !== domain.external_port) {
          try {
            await validateExternalPort(externalPort, checkProxyType);
          } catch (e) {
            return reply.code(e.code).send({ error: e.code === 409 ? 'Port unavailable' : 'Invalid external port', message: e.message });
          }
        }
      }

      if (backendUrl) {
        if (checkProxyType === 'http') {
          if (!validator.isURL(backendUrl, { require_protocol: true, protocols: ['http', 'https'], require_tld: false })) {
            return reply.code(400).send({
              error: 'Invalid backend URL',
              message: 'Backend URL must be a valid HTTP or HTTPS URL'
            });
          }
          const portError = getBackendUrlPortError(backendUrl);
          if (portError) {
            return reply.code(400).send({
              error: 'Invalid backend URL',
              message: portError
            });
          }

          // Additional SSRF protection
          try {
            await validateBackendUrlWithDNS(backendUrl);
          } catch (err) {
            return reply.code(400).send({
              error: 'Invalid backend URL',
              message: err.message
            });
          }
        } else if (checkProxyType === 'tcp' || checkProxyType === 'udp') {
          if (!validator.isURL(backendUrl, { require_protocol: true, protocols: ['tcp', 'udp'], require_tld: false })) {
            return reply.code(400).send({
              error: 'Invalid backend URL',
              message: `Backend URL must be a valid ${checkProxyType.toUpperCase()} URL`
            });
          }
          const portError = getBackendUrlPortError(backendUrl);
          if (portError) {
            return reply.code(400).send({
              error: 'Invalid backend URL',
              message: portError
            });
          }

          // Additional SSRF protection
          try {
            await validateBackendUrlWithDNS(backendUrl);
          } catch (err) {
            return reply.code(400).send({
              error: 'Invalid backend URL',
              message: err.message
            });
          }
        }
      }

      let externalPortUpdate;
      let externalPortUpdateSet = false;

      if (checkProxyType === 'http' && domain.external_port) {
        externalPortUpdate = null;
        externalPortUpdateSet = true;
      }

      if (checkProxyType === 'tcp' || checkProxyType === 'udp') {
        if (externalPort !== undefined && externalPort !== null) {
          externalPortUpdate = externalPort;
          externalPortUpdateSet = true;
        } else if (!domain.external_port) {
          externalPortUpdate = await allocateAvailablePort(checkProxyType);
          externalPortUpdateSet = true;
        }
      }

      const updatedDomain = await database.updateDomain(domainId, {
        hostname,
        backendUrl,
        backendPort,
        description,
        proxyType,
        sslEnabled,
        ...(externalPortUpdateSet ? { externalPort: externalPortUpdate } : {}),
        ...(bungeecordForwarding !== undefined ? { bungeecordForwarding } : {})
      });

      await database.createAuditLog({
        userId,
        action: 'domain_updated',
        entityType: 'domain',
        entityId: domainId,
        details: {
          old_hostname: domain.hostname,
          new_hostname: hostname,
          old_backend_url: domain.backend_url,
          new_backend_url: backendUrl,
          ssl_enabled: sslEnabled
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, domainId, hostname: updatedDomain.hostname }, 'Domain updated');

      // Reload proxy if active
      if (updatedDomain.is_active) {
        try {
          await proxyManager.reloadProxy(domainId);
          fastify.log.info({ domainId, hostname: updatedDomain.hostname }, 'Proxy reloaded');
        } catch (error) {
          fastify.log.error({ error, domainId }, 'Failed to reload proxy');
        }
      } else {
        // Stop proxy if domain was deactivated
        try {
          await proxyManager.stopProxy(domainId);
        } catch (error) {
          fastify.log.error({ error, domainId }, 'Failed to stop proxy');
        }
      }

      reply.send({
        success: true,
        domain: updatedDomain
      });
    } catch (error) {
      fastify.log.error({
        error: error.message,
        stack: error.stack,
        code: error.code
      }, 'Failed to update domain');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to update domain'
      });
    }
  });

  fastify.delete('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      // Check if user has permission to delete this domain
      if (!await PermissionChecker.canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to delete this domain'
        });
      }

      // Stop proxy before deleting
      try {
        await proxyManager.stopProxy(domainId);
        fastify.log.info({ domainId }, 'Proxy stopped before deletion');
      } catch (error) {
        fastify.log.warn({ error, domainId }, 'Failed to stop proxy before deletion');
      }

      // Cancel any pending DNS challenges
      if (domain.ssl_enabled && domain.acme_challenge_type === 'dns-01') {
        try {
          const { acmeManager } = await import('../services/acmeManager.js');
          await acmeManager.cancelDNSChallenge(domainId);
          fastify.log.info({ domainId, hostname: domain.hostname }, 'Cancelled pending DNS challenge');
        } catch (error) {
          fastify.log.warn({ error, domainId }, 'Failed to cancel DNS challenge');
        }
      }

      // Optional: cleanup local ACME certs when running on the ACME node
      if (domain.ssl_enabled && domain.ssl_fullchain && domain.ssl_cert_type === 'acme') {
        try {
          const { spawn } = await import('child_process');
          fastify.log.info({ hostname: domain.hostname }, 'Deleting ACME certificate');

          const safeHostname = sanitizeHostname(domain.hostname);
          const certbotDelete = spawn('certbot', [
            'delete',
            '--cert-name', safeHostname,
            '--non-interactive'
          ]);

          await new Promise((resolve) => {
            certbotDelete.on('close', (code) => {
              if (code === 0) {
                fastify.log.info({ hostname: domain.hostname }, 'ACME certificate deleted');
              } else {
                fastify.log.warn({ hostname: domain.hostname, code }, 'Failed to delete ACME certificate via certbot');
              }
              resolve();
            });

            certbotDelete.on('error', (error) => {
              fastify.log.warn({ error, hostname: domain.hostname }, 'Error spawning certbot delete');
              resolve();
            });
          });
        } catch (error) {
          fastify.log.warn({ error, domainId, hostname: domain.hostname }, 'Error deleting ACME certificates');
        }
      }

      await database.deleteDomain(domainId);

      await database.createAuditLog({
        userId,
        action: 'domain_deleted',
        entityType: 'domain',
        entityId: domainId,
        details: {
          hostname: domain.hostname,
          backend_url: domain.backend_url
        },
        ipAddress: request.ip
      });



      fastify.log.info({ username: request.user.username, domainId, hostname: domain.hostname }, 'Domain deleted');

      reply.send({
        success: true,
        message: 'Domain deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete domain');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete domain'
      });
    }
  });

  fastify.post('/:id/toggle', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to toggle this domain'
        });
      }

      const updatedDomain = await database.toggleDomainActive(domainId);

      await database.createAuditLog({
        userId,
        action: updatedDomain.is_active ? 'domain_enabled' : 'domain_disabled',
        entityType: 'domain',
        entityId: domainId,
        details: {
          hostname: domain.hostname,
          is_active: updatedDomain.is_active
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, domainId, isActive: updatedDomain.is_active }, 'Domain toggled');

      // Start or stop proxy based on new status
      try {
        if (updatedDomain.is_active) {
          await proxyManager.startProxy(updatedDomain);
          fastify.log.info({ domainId }, 'Proxy started');
        } else {
          await proxyManager.stopProxy(domainId);
          fastify.log.info({ domainId }, 'Proxy stopped');
        }
      } catch (error) {
        fastify.log.error({ error, domainId }, 'Failed to toggle proxy');
      }

      reply.send({
        success: true,
        domain: updatedDomain
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to toggle domain');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to toggle domain'
      });
    }
  });

  fastify.post('/:id/ssl/enable', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this domain'
        });
      }

      const updatedDomain = await database.updateDomain(domainId, {
        sslEnabled: true
      });

      await database.updateDomainSSLStatus(domainId, 'pending');

      await database.createAuditLog({
        userId,
        action: 'ssl_enabled',
        entityType: 'domain',
        entityId: domainId,
        details: {
          hostname: domain.hostname
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, domainId, hostname: domain.hostname }, 'SSL enabled for domain');

      if (updatedDomain.is_active) {
        try {
          await proxyManager.reloadProxy(domainId);
          fastify.log.info({ domainId, hostname: updatedDomain.hostname }, 'Proxy reloaded after SSL enable');
        } catch (reloadError) {
          fastify.log.error({ error: reloadError, domainId }, 'Failed to reload proxy after SSL enable');
        }
      }

      reply.send({
        success: true,
        domain: updatedDomain,
        message: 'SSL certificate generation has been initiated. This may take a few minutes.'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to enable SSL');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to enable SSL'
      });
    }
  });

  // Request SSL certificate via ACME
  fastify.post('/:id/ssl/request', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this domain'
        });
      }

      if (domain.proxy_type !== 'http') {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'SSL certificates are only available for HTTP proxies'
        });
      }

      if (net.isIP(domain.hostname)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'ACME certificates require a DNS hostname (IP addresses are not supported). Use a custom certificate instead.'
        });
      }

      // Request certificate from Let's Encrypt
      try {
        await acmeManager.ensureCert(domain.hostname);

        // Update database with certificate info
        const expiry = await acmeManager.getCertExpiry(domain.hostname);

        // Reload proxy to use new certificate
        if (domain.is_active) {
          await proxyManager.reloadProxy(domainId);
        }

        await database.createAuditLog({
          userId,
          action: 'ssl_certificate_requested',
          entityType: 'domain',
          entityId: domainId,
          details: {
            hostname: domain.hostname,
            expiry: expiry ? expiry.toISOString() : null
          },
          ipAddress: request.ip
        });

        reply.send({
          success: true,
          message: 'SSL certificate obtained successfully',
          certificate: {
            domain: domain.hostname,
            expiry: expiry ? expiry.toISOString() : null
          }
        });
      } catch (error) {
        fastify.log.error({ error, domainId }, 'Failed to obtain SSL certificate');
        reply.code(500).send({
          error: 'Internal Server Error',
          message: `Failed to obtain certificate: ${error.message}`
        });
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to request SSL certificate');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to request SSL certificate'
      });
    }
  });

  // Get SSL certificate status
  fastify.get('/:id/ssl/status', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canAccessDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view this domain'
        });
      }

        const status = await acmeManager.getCertStatus(domain.hostname);

      reply.send({
        success: true,
        status
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get SSL status');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get SSL status'
      });
    }
  });

  // Get request logs for a domain
  fastify.get('/:id/logs', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canAccessDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view logs for this domain'
        });
      }

      const { limit = 100, offset = 0, method, statusCode, search, startDate, endDate } = request.query;

      const logs = await database.getRequestLogsByDomain(domainId, {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        method,
        statusCode: statusCode ? parseInt(statusCode, 10) : null,
        search,
        startDate,
        endDate
      });

      reply.send({
        success: true,
        logs
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get request logs');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get request logs'
      });
    }
  });

  // Get request log statistics for a domain
  fastify.get('/:id/logs/stats', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canAccessDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view stats for this domain'
        });
      }

      const { days = 7 } = request.query;

      const stats = await database.getRequestLogStats(domainId, parseInt(days, 10));
      const methodDist = await database.getMethodDistribution(domainId, parseInt(days, 10));
      const statusDist = await database.getStatusCodeDistribution(domainId, parseInt(days, 10));

      reply.send({
        success: true,
        stats: {
          ...stats,
          method_distribution: methodDist,
          status_code_distribution: statusDist
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get log stats');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get log stats'
      });
    }
  });

  // Get recent errors for a domain
  fastify.get('/:id/logs/errors', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canAccessDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view errors for this domain'
        });
      }

      const { limit = 20 } = request.query;

      const errors = await database.getRecentErrorLogs(domainId, parseInt(limit, 10));

      reply.send({
        success: true,
        errors
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get error logs');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get error logs'
      });
    }
  });

  fastify.get('/:id/check-routing', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canAccessDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this domain'
        });
      }

      if (domain.proxy_type === 'tcp' || domain.proxy_type === 'udp') {
        return reply.send({
          success: true,
          ok: false,
          message: 'Routing check is only available for HTTP/HTTPS domains',
          resolved: { a: [], aaaa: [], cname: [] }
        });
      }

      const resolved = await resolveDns(domain.hostname);

      const httpsUrl = new URL(`https://${domain.hostname}${ROUTE_CHECK_PATH}`);
      const httpUrl = new URL(`http://${domain.hostname}${ROUTE_CHECK_PATH}`);

      const [httpsResult, httpResult] = await Promise.allSettled([
        probeUrl(httpsUrl, domain.hostname),
        probeUrl(httpUrl, domain.hostname)
      ]);

      const httpsData = httpsResult.status === 'fulfilled' ? httpsResult.value : { ok: false };
      const httpData = httpResult.status === 'fulfilled' ? httpResult.value : { ok: false };
      const ok = httpsData.ok || httpData.ok;

      let message = 'Domain does not point to this proxy';
      if (ok) {
        message = 'Domain points to this proxy';
      } else if (httpsData.error || httpData.error) {
        message = 'Domain is not reachable from this proxy';
      }

      reply.send({
        success: true,
        ok,
        message,
        resolved,
        checks: {
          https: httpsData,
          http: httpData
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to check routing');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to check routing'
      });
    }
  });

  // ==================== LOAD BALANCING ROUTES ====================

  // Get all backends for a domain
  fastify.get('/:id/backends', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canAccessDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this domain'
        });
      }

      const backends = await database.getBackendsByDomainId(domainId);

      reply.send({
        success: true,
        backends,
        load_balancing_enabled: domain.load_balancing_enabled || false,
        load_balancing_algorithm: domain.load_balancing_algorithm || 'round-robin'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch backends');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch backends'
      });
    }
  });

  // Add a new backend to a domain
  fastify.post('/:id/backends', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';
      const { backendUrl, backendPort, weight, priority } = request.body;

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this domain'
        });
      }

      // Validate backend URL
      if (!backendUrl) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Backend URL is required'
        });
      }

      const portError = getBackendUrlPortError(backendUrl);
      if (portError) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: portError
        });
      }
      try {
        await validateBackendUrlWithDNS(backendUrl);
      } catch (err) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: err.message
        });
      }

      // Validate port if provided
      if (backendPort !== undefined && backendPort !== null) {
        const port = parseInt(backendPort, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'Invalid port number (must be 1-65535)'
          });
        }
      }

      const backend = await database.createBackend({
        domainId,
        backendUrl,
        backendPort: backendPort || null,
        weight: weight || 1,
        priority: priority || 0
      });

      // Reload proxy if active
      if (domain.is_active) {
        await proxyManager.reloadProxy(domainId);
      }

      reply.code(201).send({
        success: true,
        backend
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create backend');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create backend'
      });
    }
  });

  // Update a backend
  fastify.put('/:id/backends/:backendId', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const backendId = parseInt(request.params.backendId, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';
      const { backendUrl, backendPort, weight, priority, isActive } = request.body;

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this domain'
        });
      }

      const existingBackend = await database.getBackendById(backendId);
      if (!existingBackend || existingBackend.domain_id !== domainId) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Backend not found'
        });
      }

      // Validate backend URL if provided
      if (backendUrl) {
        const portError = getBackendUrlPortError(backendUrl);
        if (portError) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: portError
          });
        }
        try {
          await validateBackendUrlWithDNS(backendUrl);
        } catch (err) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: err.message
          });
        }
      }

      const backend = await database.updateBackend(backendId, {
        backendUrl,
        backendPort,
        weight,
        priority,
        isActive
      });

      // Reload proxy if active
      if (domain.is_active) {
        await proxyManager.reloadProxy(domainId);
      }

      reply.send({
        success: true,
        backend
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update backend');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update backend'
      });
    }
  });

  // Delete a backend
  fastify.delete('/:id/backends/:backendId', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const backendId = parseInt(request.params.backendId, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this domain'
        });
      }

      const existingBackend = await database.getBackendById(backendId);
      if (!existingBackend || existingBackend.domain_id !== domainId) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Backend not found'
        });
      }

      await database.deleteBackend(backendId);

      // Reload proxy if active
      if (domain.is_active) {
        await proxyManager.reloadProxy(domainId);
      }

      reply.send({
        success: true,
        message: 'Backend deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete backend');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete backend'
      });
    }
  });

  // Toggle backend active status
  fastify.post('/:id/backends/:backendId/toggle', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const backendId = parseInt(request.params.backendId, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this domain'
        });
      }

      const existingBackend = await database.getBackendById(backendId);
      if (!existingBackend || existingBackend.domain_id !== domainId) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Backend not found'
        });
      }

      const backend = await database.toggleBackendActive(backendId);

      // Reload proxy if active
      if (domain.is_active) {
        await proxyManager.reloadProxy(domainId);
      }

      reply.send({
        success: true,
        backend
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to toggle backend');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to toggle backend'
      });
    }
  });

  // Update load balancing settings for a domain
  fastify.put('/:id/load-balancing', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';
      const { enabled, algorithm } = request.body;

      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this domain'
        });
      }

      // Validate algorithm
      const validAlgorithms = ['round-robin', 'random', 'least-connections', 'ip-hash'];
      if (algorithm && !validAlgorithms.includes(algorithm)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Invalid algorithm. Must be one of: ${validAlgorithms.join(', ')}`
        });
      }

      const updatedDomain = await database.updateDomainLoadBalancing(
        domainId,
        enabled !== undefined ? enabled : domain.load_balancing_enabled,
        algorithm || domain.load_balancing_algorithm || 'round-robin'
      );

      // Reload proxy if active
      if (domain.is_active) {
        await proxyManager.reloadProxy(domainId);
      }

      reply.send({
        success: true,
        domain: updatedDomain
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update load balancing settings');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update load balancing settings'
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // V3 FEATURE ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Maintenance Mode ──────────────────────────────────────────────────────
  fastify.put('/:domainId/maintenance', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { domainId } = request.params;
        const { enabled, message, endTime, customPage } = request.body || {};
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';

        const domain = await database.getDomainById(domainId);
        if (!domain) return reply.code(404).send({ error: 'Domain not found' });
        if (!await canModifyDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        await database.execute(`
          UPDATE domains SET
            maintenance_mode = COALESCE(?, maintenance_mode),
            maintenance_message = COALESCE(?, maintenance_message),
            maintenance_end_time = ?,
            custom_maintenance_page = CASE WHEN ? THEN ? ELSE custom_maintenance_page END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          enabled !== undefined ? enabled : null,
          message ?? null,
          endTime !== undefined ? endTime : domain.maintenance_end_time,
          customPage !== undefined,
          customPage !== undefined ? (customPage || null) : null,
          domainId
        ]);

        const updated = await database.getDomainById(domainId);

        // Reload proxy to pick up new maintenance status
        if (domain.is_active) {
          await proxyManager.reloadProxy(domainId);
        }

        return reply.send({ success: true, domain: updated });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update maintenance settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── Custom Error Pages ─────────────────────────────────────────────────────
  fastify.put('/:domainId/error-pages', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { domainId } = request.params;
        const { custom404, custom502, custom503 } = request.body || {};
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';

        const domain = await database.getDomainById(domainId);
        if (!domain) return reply.code(404).send({ error: 'Domain not found' });
        if (!await canModifyDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        await database.execute(`
          UPDATE domains SET
            custom_404_page = COALESCE(?, custom_404_page),
            custom_502_page = COALESCE(?, custom_502_page),
            custom_503_page = COALESCE(?, custom_503_page),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          custom404 !== undefined ? custom404 : null,
          custom502 !== undefined ? custom502 : null,
          custom503 !== undefined ? custom503 : null,
          domainId
        ]);

        const updated = await database.getDomainById(domainId);

        if (domain.is_active) {
          await proxyManager.reloadProxy(domainId);
        }

        return reply.send({ success: true, domain: updated });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update error pages');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── Per-Domain Rate Limiting ───────────────────────────────────────────────
  fastify.put('/:domainId/rate-limit', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { domainId } = request.params;
        const { enabled, max, window } = request.body || {};
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';

        const domain = await database.getDomainById(domainId);
        if (!domain) return reply.code(404).send({ error: 'Domain not found' });
        if (!await canModifyDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        // Validate
        if (max !== undefined && (max < 1 || max > 100000)) {
          return reply.code(400).send({ error: 'Bad Request', message: 'max must be between 1 and 100000' });
        }
        if (window !== undefined && (window < 1 || window > 86400)) {
          return reply.code(400).send({ error: 'Bad Request', message: 'window must be between 1 and 86400 seconds' });
        }

        await database.execute(`
          UPDATE domains SET
            rate_limit_enabled = COALESCE(?, rate_limit_enabled),
            rate_limit_max = COALESCE(?, rate_limit_max),
            rate_limit_window = COALESCE(?, rate_limit_window),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          enabled !== undefined ? enabled : null,
          max !== undefined ? max : null,
          window !== undefined ? window : null,
          domainId
        ]);

        const updated = await database.getDomainById(domainId);

        if (domain.is_active) {
          await proxyManager.reloadProxy(domainId);
        }

        return reply.send({ success: true, domain: updated });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update rate limit settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── Traffic Mirroring ─────────────────────────────────────────────────────
  fastify.put('/:domainId/mirror', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { domainId } = request.params;
        const { enabled, backendUrl } = request.body || {};
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';

        const domain = await database.getDomainById(domainId);
        if (!domain) return reply.code(404).send({ error: 'Domain not found' });
        if (!await canModifyDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        // Validate mirror URL if provided
        if (backendUrl) {
          try { new URL(backendUrl); } catch {
            return reply.code(400).send({ error: 'Bad Request', message: 'Invalid mirror backend URL' });
          }
        }

        await database.execute(`
          UPDATE domains SET
            mirror_enabled = COALESCE(?, mirror_enabled),
            mirror_backend_url = COALESCE(?, mirror_backend_url),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          enabled !== undefined ? enabled : null,
          backendUrl !== undefined ? backendUrl : null,
          domainId
        ]);

        const updated = await database.getDomainById(domainId);

        if (domain.is_active) {
          await proxyManager.reloadProxy(domainId);
        }

        return reply.send({ success: true, domain: updated });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update mirror settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── GeoIP Blocking ────────────────────────────────────────────────────────
  fastify.put('/:domainId/geoip', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { domainId } = request.params;
        const { enabled, blockedCountries, allowedCountries } = request.body || {};
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';

        const domain = await database.getDomainById(domainId);
        if (!domain) return reply.code(404).send({ error: 'Domain not found' });
        if (!await canModifyDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        // Normalise country codes to uppercase
        const normBlocked  = blockedCountries  ? blockedCountries.map(c => c.toUpperCase()) : null;
        const normAllowed  = allowedCountries  ? allowedCountries.map(c => c.toUpperCase()) : null;

        await database.execute(`
          UPDATE domains SET
            geoip_blocking_enabled = COALESCE(?, geoip_blocking_enabled),
            geoip_blocked_countries = COALESCE(?, geoip_blocked_countries),
            geoip_allowed_countries = COALESCE(?, geoip_allowed_countries),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          enabled !== undefined ? enabled : null,
          normBlocked,
          normAllowed,
          domainId
        ]);

        const updated = await database.getDomainById(domainId);

        if (domain.is_active) {
          await proxyManager.reloadProxy(domainId);
        }

        return reply.send({ success: true, domain: updated });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update GeoIP settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── Sticky Sessions ───────────────────────────────────────────────────────
  fastify.put('/:domainId/sticky-sessions', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { domainId } = request.params;
        const { enabled, ttl } = request.body || {};
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';

        const domain = await database.getDomainById(domainId);
        if (!domain) return reply.code(404).send({ error: 'Domain not found' });
        if (!await canModifyDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        if (ttl !== undefined && (ttl < 60 || ttl > 86400 * 30)) {
          return reply.code(400).send({ error: 'Bad Request', message: 'ttl must be between 60 and 2592000 seconds' });
        }

        await database.execute(`
          UPDATE domains SET
            sticky_sessions_enabled = COALESCE(?, sticky_sessions_enabled),
            sticky_sessions_ttl = COALESCE(?, sticky_sessions_ttl),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          enabled !== undefined ? enabled : null,
          ttl !== undefined ? ttl : null,
          domainId
        ]);

        const updated = await database.getDomainById(domainId);

        if (domain.is_active) {
          await proxyManager.reloadProxy(domainId);
        }

        return reply.send({ success: true, domain: updated });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update sticky session settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── PROXY Protocol ────────────────────────────────────────────────────────
  fastify.put('/:domainId/proxy-protocol', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { domainId } = request.params;
        const { enabled } = request.body || {};
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';

        const domain = await database.getDomainById(domainId);
        if (!domain) return reply.code(404).send({ error: 'Domain not found' });
        if (!await canModifyDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }
        if (domain.proxy_type !== 'minecraft' && domain.proxy_type !== 'tcp') {
          return reply.code(400).send({ error: 'Bad Request', message: 'PROXY Protocol is only available for Minecraft and TCP domains' });
        }

        await database.execute(`
          UPDATE domains SET
            proxy_protocol = COALESCE(?, proxy_protocol),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [enabled !== undefined ? enabled : null, domainId]);

        const updated = await database.getDomainById(domainId);
        if (domain.is_active) await proxyManager.reloadProxy(domainId);
        return reply.send({ success: true, domain: updated });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update PROXY Protocol settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── Geyser PROXY Protocol v2 (UDP only) ───────────────────────────────────
  fastify.put('/:domainId/geyser-proxy-protocol', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { domainId } = request.params;
        const { enabled } = request.body || {};
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';

        const domain = await database.getDomainById(domainId);
        if (!domain) return reply.code(404).send({ error: 'Domain not found' });
        if (!await canModifyDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }
        const isBedrockDomain = domain.proxy_type === 'udp' ||
          (domain.proxy_type === 'minecraft' && domain.minecraft_edition === 'bedrock');
        if (!isBedrockDomain) {
          return reply.code(400).send({ error: 'Bad Request', message: 'Geyser PROXY Protocol is only available for Bedrock (UDP) domains' });
        }

        await database.execute(`
          UPDATE domains SET
            geyser_proxy_protocol = COALESCE(?, geyser_proxy_protocol),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [enabled !== undefined ? enabled : null, domainId]);

        const updated = await database.getDomainById(domainId);
        if (domain.is_active) await proxyManager.reloadProxy(domainId);
        return reply.send({ success: true, domain: updated });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update Geyser PROXY Protocol settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── DDoS Protection ───────────────────────────────────────────────────────
  fastify.put('/:id/ddos-protection', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';
      const {
        enabled, reqPerSecond, connectionsPerMinute, banDurationSec,
        maxConnectionsPerIp, challengeMode, banOn4xxRate
      } = request.body;

      const domain = await database.getDomainById(domainId);
      if (!domain) return reply.code(404).send({ error: 'Not Found', message: 'Domain not found' });
      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to modify this domain' });
      }

      await database.execute(
        `UPDATE domains SET
          ddos_protection_enabled     = $1,
          ddos_req_per_second         = $2,
          ddos_connections_per_minute = $3,
          ddos_ban_duration_sec       = $4,
          ddos_max_connections_per_ip = $5,
          ddos_challenge_mode         = $6,
          ddos_ban_on_4xx_rate        = $7,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $8`,
        [
          enabled !== undefined ? enabled : domain.ddos_protection_enabled,
          reqPerSecond             ?? domain.ddos_req_per_second           ?? 100,
          connectionsPerMinute     ?? domain.ddos_connections_per_minute   ?? 60,
          banDurationSec           ?? domain.ddos_ban_duration_sec         ?? 3600,
          maxConnectionsPerIp      ?? domain.ddos_max_connections_per_ip   ?? 50,
          challengeMode            ?? domain.ddos_challenge_mode           ?? false,
          banOn4xxRate             ?? domain.ddos_ban_on_4xx_rate          ?? false,
          domainId
        ]
      );

      if (domain.is_active) {
        try { await proxyManager.reloadProxy(domainId); } catch (_) {}
      }

      return reply.send({ success: true, message: 'DDoS protection settings updated' });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update DDoS protection settings');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to update DDoS protection settings' });
    }
  });

  // ── Live Traffic ──────────────────────────────────────────────────────────

  fastify.get('/:id/traffic/live', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId   = request.user.id;
      const isAdmin  = request.user.role === 'admin';
      const domain   = await database.getDomainById(domainId);
      if (!domain) return reply.code(404).send({ error: 'Not Found', message: 'Domain not found' });
      if (!await canAccessDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Access denied' });
      }
      const connections = await liveTrafficService.getForDomain(domainId);
      return reply.send({ connections, total: connections.length });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get live traffic');
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.delete('/:id/traffic/live', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const userId   = request.user.id;
      const isAdmin  = request.user.role === 'admin';
      const domain   = await database.getDomainById(domainId);
      if (!domain) return reply.code(404).send({ error: 'Not Found', message: 'Domain not found' });
      if (!await canModifyDomain(domain, userId, isAdmin)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Access denied' });
      }
      await liveTrafficService.clearDomain(domainId);
      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to clear live traffic');
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  // ── Circuit Breaker Status ─────────────────────────────────────────────────
  fastify.get('/circuit-breaker/status', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const { circuitBreaker } = await import('../services/circuitBreaker.js');
        const status = circuitBreaker.getStatus();
        return reply.send({ status });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to get circuit breaker status');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // ── Circuit Breaker Reset ──────────────────────────────────────────────────
  fastify.post('/circuit-breaker/reset/:key', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const isAdmin = request.user.role === 'admin';
        if (!isAdmin) return reply.code(403).send({ error: 'Admin only' });

        const { circuitBreaker } = await import('../services/circuitBreaker.js');
        circuitBreaker.reset(request.params.key);
        return reply.send({ success: true, message: `Circuit breaker reset for: ${request.params.key}` });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to reset circuit breaker');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });
}
