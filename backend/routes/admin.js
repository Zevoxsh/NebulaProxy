import { database } from '../services/database.js';
import { proxyManager } from '../services/proxyManager.js';
import { validateBackendUrlWithDNS, sanitizeHostname } from '../utils/security.js';
import { isPortAvailable, allocateAvailablePort, validateExternalPort, MIN_EXTERNAL_PORT, MAX_EXTERNAL_PORT } from '../services/portAllocator.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import configManager from '../config/config-manager.js';
import validator from 'validator';
import { monitoringService } from '../services/monitoringService.js';
import { databaseBackupService } from '../services/databaseBackupService.js';
import { dockerService } from '../services/dockerService.js';
import crypto from 'crypto';
import { pool } from '../config/database.js';
import { config } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, '..', '.env');
const ENV_EXAMPLE_PATH = join(__dirname, '..', '.env.example');


const getCurrentRedisConfig = () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || '6379',
  db: process.env.REDIS_DB || '0',
  passwordSet: Boolean(process.env.REDIS_PASSWORD)
});

const updateEnvFile = (entries) => {
  const content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
  const lines = content.split('\n');
  const updatedKeys = new Set();

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      return line;
    }
    const eqIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIndex).trim();
    if (!Object.prototype.hasOwnProperty.call(entries, key)) {
      return line;
    }
    updatedKeys.add(key);
    return `${key}=${entries[key]}`;
  });

  Object.keys(entries).forEach((key) => {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${entries[key]}`);
    }
  });

  writeFileSync(ENV_PATH, newLines.join('\n'), 'utf-8');
};

const parseEnvExample = () => {
  if (!existsSync(ENV_EXAMPLE_PATH)) {
    return [];
  }
  const content = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  const lines = content.split('\n');
  const sections = [];
  let currentSection = { name: 'General', variables: [] };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      if (trimmed.startsWith('# ') && trimmed.length > 2) {
        if (currentSection.variables.length > 0) {
          sections.push(currentSection);
        }
        currentSection = { name: trimmed.substring(2).trim(), variables: [] };
      }
      return;
    }

    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts.join('=');
    if (key) {
      currentSection.variables.push({ key: key.trim(), value: value || '' });
    }
  });

  if (currentSection.variables.length > 0) {
    sections.push(currentSection);
  }
  return sections;
};


export async function adminRoutes(fastify, options) {

  // ── Branding (GET is public — accessible by login page) ──────────────────
  fastify.get('/branding', async (request, reply) => {
    try {
      const appName = await configManager.getAppName();
      reply.send({ appName });
    } catch (error) {
      reply.send({ appName: 'NebulaProxy' });
    }
  });

  fastify.put('/branding', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { appName } = request.body || {};
      if (!appName || typeof appName !== 'string' || !appName.trim()) {
        return reply.code(400).send({ error: 'appName is required and must be a non-empty string' });
      }
      const saved = await configManager.setAppName(appName);
      reply.send({ success: true, appName: saved });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to save branding');
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.get('/config', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      await configManager.init();
      const currentConfig = configManager.getAll();
      const sections = parseEnvExample();

      sections.forEach(section => {
        section.variables.forEach(variable => {
          if (currentConfig[variable.key] !== undefined) {
            variable.value = currentConfig[variable.key];
          }
        });
      });

      reply.send({ sections });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to load configuration');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to load configuration'
      });
    }
  });

  fastify.post('/config/validate', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const config = request.body || {};
      const errors = configManager.validateConfig(config);
      reply.send({ valid: errors.length === 0, errors });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to validate configuration');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to validate configuration'
      });
    }
  });

  fastify.put('/config', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const config = request.body || {};
      const errors = configManager.validateConfig(config);
      if (errors.length > 0) {
        return reply.code(400).send({ success: false, errors });
      }

      await configManager.saveToRedis(config);

      reply.send({
        success: true,
        message: 'Configuration saved. Restart required to apply changes.',
        restartRequired: true
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to save configuration');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to save configuration'
      });
    }
  });

  fastify.get('/config/redis', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      reply.send({ redis: getCurrentRedisConfig() });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get Redis config');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to load Redis configuration'
      });
    }
  });

  fastify.put('/config/redis', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { host, port, db, password } = request.body || {};
      const updates = {};

      if (host !== undefined) {
        if (typeof host !== 'string' || host.trim().length === 0) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'REDIS_HOST must be a non-empty string'
          });
        }
        updates.REDIS_HOST = host.trim();
      }

      if (port !== undefined) {
        const parsedPort = Number.parseInt(port, 10);
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'REDIS_PORT must be an integer between 1 and 65535'
          });
        }
        updates.REDIS_PORT = String(parsedPort);
      }

      if (db !== undefined) {
        const parsedDb = Number.parseInt(db, 10);
        if (!Number.isInteger(parsedDb) || parsedDb < 0) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'REDIS_DB must be a non-negative integer'
          });
        }
        updates.REDIS_DB = String(parsedDb);
      }

      if (password !== undefined) {
        if (typeof password !== 'string') {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'REDIS_PASSWORD must be a string'
          });
        }
        updates.REDIS_PASSWORD = password;
      }

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'No valid Redis configuration fields provided'
        });
      }

      updateEnvFile(updates);
      Object.entries(updates).forEach(([key, value]) => {
        process.env[key] = value;
      });

      reply.send({
        success: true,
        message: 'Redis configuration updated. Restart required to apply changes.',
        redis: getCurrentRedisConfig(),
        restartRequired: true
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update Redis config');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update Redis configuration'
      });
    }
  });

  fastify.get('/users', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const users = await database.getAllUsers();

      reply.send({
        success: true,
        users,
        count: users.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch users');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch users'
      });
    }
  });

  fastify.get('/users/:id', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const userId = parseInt(request.params.id, 10);
      const user = await database.getUserById(userId);

      if (!user) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'User not found'
        });
      }

      const domains = await database.getDomainsByUserId(userId);
      const domainCount = domains.length;

      reply.send({
        success: true,
        user: {
          ...user,
          domain_count: domainCount,
          domains
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch user');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch user'
      });
    }
  });

  fastify.put('/users/:id/quotas', {
    preHandler: fastify.authorize(['admin']),
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
        required: ['maxDomains'],
        properties: {
          maxDomains: {
            type: 'integer',
            minimum: 0,
            maximum: 10000
          },
          maxRedirections: {
            type: 'integer',
            minimum: 0,
            maximum: 10000
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const userId = parseInt(request.params.id, 10);
      const { maxDomains, maxRedirections } = request.body;
      const adminId = request.user.id;

      const user = await database.getUserById(userId);

      if (!user) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'User not found'
        });
      }

      const updatedUser = await database.updateUserQuotas(userId, maxDomains, user.max_proxies);

      // Update redirection quota if provided
      if (maxRedirections !== undefined) {
        await database.updateUserRedirectionQuota(userId, maxRedirections);
      }

      await database.createAuditLog({
        userId: adminId,
        action: 'quota_updated',
        entityType: 'user',
        entityId: userId,
        details: {
          target_username: user.username,
          old_max_domains: user.max_domains,
          new_max_domains: maxDomains,
          old_max_redirections: user.max_redirections,
          new_max_redirections: maxRedirections
        },
        ipAddress: request.ip
      });



      fastify.log.info({ admin: request.user.username, targetUser: user.username, maxDomains, maxRedirections }, 'User quotas updated');

      reply.send({
        success: true,
        user: await database.getUserById(userId)
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update user quotas');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update user quotas'
      });
    }
  });

  fastify.post('/users/:id/toggle', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const userId = parseInt(request.params.id, 10);
      const adminId = request.user.id;

      const user = await database.getUserById(userId);

      if (!user) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'User not found'
        });
      }

      const updatedUser = await database.toggleUserActive(userId);

      await database.createAuditLog({
        userId: adminId,
        action: updatedUser.is_active ? 'user_enabled' : 'user_disabled',
        entityType: 'user',
        entityId: userId,
        details: {
          target_username: user.username,
          is_active: updatedUser.is_active
        },
        ipAddress: request.ip
      });



      fastify.log.info({ admin: request.user.username, targetUser: user.username, isActive: updatedUser.is_active }, 'User toggled');

      reply.send({
        success: true,
        user: updatedUser
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to toggle user');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to toggle user'
      });
    }
  });

  fastify.get('/stats', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const stats = await database.getStats();

      reply.send({
        success: true,
        stats
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch stats');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch stats'
      });
    }
  });

  // Admin endpoint to view ALL domains (for platform management)
  fastify.get('/domains', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const domains = await database.getAllDomains();

      reply.send({
        success: true,
        domains,
        count: domains.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch all domains');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch all domains'
      });
    }
  });

  // Admin endpoint to view ALL teams (for platform management)
  fastify.get('/teams', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const teams = await database.getAllTeams();

      // Enrich with stats
      const enrichedTeams = await Promise.all(teams.map(async (team) => {
        const members = await database.getTeamMembers(team.id);
        const domainCount = await database.getTeamDomainCount(team.id);
        const quota = await database.getTeamDomainQuota(team.id);

        return {
          ...team,
          member_count: members.length,
          domain_count: domainCount,
          domain_quota: quota
        };
      }));

      reply.send({
        success: true,
        teams: enrichedTeams,
        count: enrichedTeams.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch all teams');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch all teams'
      });
    }
  });

  fastify.delete('/users/:id', {
    preHandler: fastify.authorize(['admin']),
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
      }
    }
  }, async (request, reply) => {
    try {
      const userId = parseInt(request.params.id, 10);
      const adminId = request.user.id;

      if (userId === adminId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'You cannot delete your own account'
        });
      }

      const user = await database.getUserById(userId);

      if (!user) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'User not found'
        });
      }

      const domains = await database.getDomainsByUserId(userId);

      for (const domain of domains) {
        try {
          await proxyManager.stopProxy(domain.id);
          fastify.log.info({ domainId: domain.id }, 'Proxy stopped before user deletion');
        } catch (error) {
          fastify.log.warn({ error, domainId: domain.id }, 'Failed to stop proxy before user deletion');
        }

        if (domain.ssl_enabled && domain.acme_challenge_type === 'dns-01') {
          try {
            const { acmeManager } = await import('../services/acmeManager.js');
            await acmeManager.cancelDNSChallenge(domain.id);
            fastify.log.info({ domainId: domain.id, hostname: domain.hostname }, 'Cancelled pending DNS challenge');
          } catch (error) {
            fastify.log.warn({ error, domainId: domain.id }, 'Failed to cancel DNS challenge');
          }
        }

        if (domain.ssl_enabled && domain.ssl_fullchain && domain.ssl_cert_type === 'acme') {
          try {
            const { spawn } = await import('child_process');
            fastify.log.info({ hostname: domain.hostname }, 'Deleting ACME certificate');

            const certbotDelete = spawn('certbot', [
              'delete',
              '--cert-name', domain.hostname,
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
            fastify.log.warn({ error, domainId: domain.id, hostname: domain.hostname }, 'Error deleting ACME certificates');
          }
        }

        await database.deleteDomain(domain.id);
      }

      await database.deleteUser(userId);

      await database.createAuditLog({
        userId: adminId,
        action: 'user_deleted',
        entityType: 'user',
        entityId: userId,
        details: {
          target_username: user.username,
          domains_deleted: domains.length
        },
        ipAddress: request.ip
      });



      fastify.log.info({ admin: request.user.username, targetUser: user.username }, 'User deleted');

      reply.send({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete user');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete user'
      });
    }
  });

  // Admin endpoint to update any domain fields
  fastify.put('/domains/:id', {
    preHandler: fastify.authorize(['admin']),
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
            type: ['integer', 'null'],
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
          acmeChallengeType: {
            type: 'string',
            enum: ['http-01', 'dns-01']
          },
          isActive: {
            type: 'boolean'
          },
          ownerId: {
            type: 'integer',
            minimum: 1
          },
          teamId: {
            type: ['integer', 'null'],
            minimum: 1
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const adminId = request.user.id;
      const {
        hostname,
        backendUrl,
        backendPort,
        description,
        proxyType,
        externalPort,
        sslEnabled,
        isActive,
        ownerId,
        teamId
      } = request.body;

      let challengeType = request.body.challengeType ?? request.body.acmeChallengeType;

      const domain = await database.getDomainById(domainId);
      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      const nextProxyType = proxyType || domain.proxy_type || 'http';
      const nextSslEnabled = nextProxyType === 'http'
        ? (sslEnabled !== undefined && sslEnabled !== null ? sslEnabled : domain.ssl_enabled)
        : false;
      const nextHostname = hostname || domain.hostname;
      const effectiveChallengeType = challengeType || domain.acme_challenge_type;

      if (nextProxyType === 'http') {
        const wildcardRegex = /^\*\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
        const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

        if (nextHostname.startsWith('*.')) {
          if (!wildcardRegex.test(nextHostname)) {
            return reply.code(400).send({
              error: 'Invalid hostname',
              message: 'Wildcard must be in format: *.example.com'
            });
          }
          if (nextSslEnabled && effectiveChallengeType !== 'dns-01') {
            challengeType = 'dns-01';
          }
        } else if (hostname && !hostnameRegex.test(hostname)) {
          return reply.code(400).send({
            error: 'Invalid hostname',
            message: 'Hostname must be a valid DNS name'
          });
        }
      }

      if (hostname && hostname !== domain.hostname) {
        const existing = await database.queryOne(
          'SELECT id FROM domains WHERE hostname = ? AND id != ?',
          [hostname, domainId]
        );
        if (existing) {
          return reply.code(409).send({
            error: 'Conflict',
            message: `Domain ${hostname} is already registered`
          });
        }
      }

      if (ownerId) {
        const owner = await database.getUserById(ownerId);
        if (!owner) {
          return reply.code(404).send({
            error: 'Not Found',
            message: 'Owner user not found'
          });
        }
      }

      if (Object.prototype.hasOwnProperty.call(request.body, 'teamId')) {
        if (teamId !== null) {
          const team = await database.getTeamById(teamId);
          if (!team) {
            return reply.code(404).send({
              error: 'Not Found',
              message: 'Team not found'
            });
          }
        }
      }

      const normalizeBackendUrlForProtocol = (rawUrl, protocol) => {
        if (!rawUrl || typeof rawUrl !== 'string') {
          return rawUrl;
        }
        try {
          // Already a valid absolute URL
          // eslint-disable-next-line no-new
          new URL(rawUrl);
          return rawUrl;
        } catch {
          return `${protocol}://${rawUrl}`;
        }
      };

      const effectiveBackendUrl = (nextProxyType === 'tcp' || nextProxyType === 'udp' || nextProxyType === 'minecraft')
        ? normalizeBackendUrlForProtocol(backendUrl || domain.backend_url, nextProxyType)
        : (backendUrl || domain.backend_url);

      const backendUrlForUpdate = (backendUrl !== undefined && backendUrl !== null)
        ? ((nextProxyType === 'tcp' || nextProxyType === 'udp' || nextProxyType === 'minecraft')
          ? normalizeBackendUrlForProtocol(backendUrl, nextProxyType)
          : backendUrl)
        : undefined;

      if (nextProxyType === 'http') {
        if (!validator.isURL(effectiveBackendUrl, { require_protocol: true, protocols: ['http', 'https'], require_tld: false })) {
          return reply.code(400).send({
            error: 'Invalid backend URL',
            message: 'Backend URL must be a valid HTTP or HTTPS URL'
          });
        }
        if (backendUrl) {
          try {
            if (new URL(effectiveBackendUrl).port) {
              return reply.code(400).send({
                error: 'Invalid backend URL',
                message: 'Backend URL must not include a port. Use the backendPort field instead.'
              });
            }
          } catch {
            // URL parsing errors handled by validator above
          }
        }
        try {
          await validateBackendUrlWithDNS(effectiveBackendUrl);
        } catch (err) {
          return reply.code(400).send({
            error: 'Invalid backend URL',
            message: err.message
          });
        }
      } else if (nextProxyType === 'tcp' || nextProxyType === 'udp' || nextProxyType === 'minecraft') {
        const allowedProtocols = nextProxyType === 'minecraft' ? ['minecraft', 'tcp', 'udp'] : ['tcp', 'udp'];
        if (!validator.isURL(effectiveBackendUrl, { require_protocol: true, protocols: allowedProtocols, require_tld: false })) {
          return reply.code(400).send({
            error: 'Invalid backend URL',
            message: nextProxyType === 'minecraft'
              ? 'Backend URL must be a valid Minecraft/TCP URL'
              : `Backend URL must be a valid ${nextProxyType.toUpperCase()} URL`
          });
        }
        if (backendUrl) {
          try {
            if (new URL(effectiveBackendUrl).port) {
              return reply.code(400).send({
                error: 'Invalid backend URL',
                message: 'Backend URL must not include a port. Use the backendPort field instead.'
              });
            }
          } catch {
            // URL parsing errors handled by validator above
          }
        }
        try {
          await validateBackendUrlWithDNS(effectiveBackendUrl);
        } catch (err) {
          return reply.code(400).send({
            error: 'Invalid backend URL',
            message: err.message
          });
        }
      }

      let externalPortUpdateSet = false;
      let externalPortUpdate = undefined;

      if (nextProxyType === 'http') {
        if (externalPort !== undefined && externalPort !== null) {
          return reply.code(400).send({
            error: 'Invalid configuration',
            message: 'External port is only supported for TCP/UDP proxies'
          });
        }
        if (domain.external_port) {
          externalPortUpdateSet = true;
          externalPortUpdate = null;
        }
      } else if (nextProxyType === 'tcp' || nextProxyType === 'udp') {
        if (externalPort !== undefined) {
          if (externalPort === null) {
            externalPortUpdate = await allocateAvailablePort(nextProxyType);
            externalPortUpdateSet = true;
          } else {
            if (externalPort !== domain.external_port) {
              try {
                await validateExternalPort(externalPort, nextProxyType);
              } catch (e) {
                return reply.code(e.code).send({ error: e.code === 409 ? 'Port unavailable' : 'Invalid external port', message: e.message });
              }
            }
            externalPortUpdate = externalPort;
            externalPortUpdateSet = true;
          }
        } else if (!domain.external_port) {
          externalPortUpdate = await allocateAvailablePort(nextProxyType);
          externalPortUpdateSet = true;
        }
      }

      const updatePayload = {
        hostname,
        backendUrl: backendUrlForUpdate,
        backendPort,
        description,
        proxyType: nextProxyType,
        sslEnabled: nextProxyType === 'http' ? sslEnabled : false,
        isActive,
        userId: ownerId,
        teamId,
        ...(externalPortUpdateSet ? { externalPort: externalPortUpdate } : {})
      };

      if (challengeType) {
        updatePayload.acmeChallengeType = challengeType;
      }

      const updatedDomain = await database.updateDomainAdmin(domainId, updatePayload);

      await database.createAuditLog({
        userId: adminId,
        action: 'admin_domain_updated',
        entityType: 'domain',
        entityId: domainId,
        details: {
          hostname: updatedDomain.hostname,
          owner_id: updatedDomain.user_id,
          team_id: updatedDomain.team_id,
          proxy_type: updatedDomain.proxy_type,
          ssl_enabled: updatedDomain.ssl_enabled,
          is_active: updatedDomain.is_active
        },
        ipAddress: request.ip
      });

      // Send webhook notification
      const changes = [];
      if (ownerId !== undefined) changes.push('Owner');
      if (teamId !== undefined) changes.push('Team');
      if (proxyType !== undefined) changes.push('Proxy Type');
      if (sslEnabled !== undefined) changes.push('SSL');
      if (isActive !== undefined) changes.push('Status');
      if (challengeType !== undefined) changes.push('ACME Challenge');



      if (updatedDomain.is_active) {
        try {
          await proxyManager.reloadProxy(domainId);
        } catch (error) {
          fastify.log.error({ error, domainId }, 'Failed to reload proxy after admin update');
        }
      } else {
        try {
          await proxyManager.stopProxy(domainId);
        } catch (error) {
          fastify.log.error({ error, domainId }, 'Failed to stop proxy after admin update');
        }
      }

      reply.send({
        success: true,
        domain: updatedDomain
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update domain (admin)');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to update domain'
      });
    }
  });

  // Admin endpoint to delete any domain
  fastify.delete('/domains/:id', {
    preHandler: fastify.authorize(['admin']),
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
      }
    }
  }, async (request, reply) => {
    try {
      const domainId = parseInt(request.params.id, 10);
      const adminId = request.user.id;

      const domain = await database.getDomainById(domainId);
      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      try {
        await proxyManager.stopProxy(domainId);
      } catch (error) {
        fastify.log.warn({ error, domainId }, 'Failed to stop proxy before admin domain deletion');
      }

      if (domain.ssl_enabled && domain.acme_challenge_type === 'dns-01') {
        try {
          const { acmeManager } = await import('../services/acmeManager.js');
          await acmeManager.cancelDNSChallenge(domainId);
        } catch (error) {
          fastify.log.warn({ error, domainId }, 'Failed to cancel DNS challenge before admin domain deletion');
        }
      }

      if (domain.ssl_enabled && domain.ssl_fullchain && domain.ssl_cert_type === 'acme') {
        try {
          const { spawn } = await import('child_process');
          const safeHostname = sanitizeHostname(domain.hostname);
          const certbotDelete = spawn('certbot', [
            'delete',
            '--cert-name', safeHostname,
            '--non-interactive'
          ]);

          await new Promise((resolve) => {
            certbotDelete.on('close', () => resolve());
            certbotDelete.on('error', () => resolve());
          });
        } catch (error) {
          fastify.log.warn({ error, domainId, hostname: domain.hostname }, 'Failed to cleanup ACME certificate on admin domain deletion');
        }
      }

      await database.deleteDomain(domainId);

      await database.createAuditLog({
        userId: adminId,
        action: 'admin_domain_deleted',
        entityType: 'domain',
        entityId: domainId,
        details: {
          hostname: domain.hostname,
          backend_url: domain.backend_url,
          owner_id: domain.user_id
        },
        ipAddress: request.ip
      });

      reply.send({
        success: true,
        message: 'Domain deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete domain (admin)');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to delete domain'
      });
    }
  });

  // Admin endpoint to update team quota
  fastify.put('/teams/:id/quotas', {
    preHandler: fastify.authorize(['admin']),
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
        required: ['maxDomains'],
        properties: {
          maxDomains: {
            type: 'integer',
            minimum: 0
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const { maxDomains } = request.body;
      const adminId = request.user.id;

      const team = await database.getTeamById(teamId);
      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      const updatedTeam = await database.updateTeam(teamId, {
        name: team.name,
        maxDomains
      });

      await database.createAuditLog({
        userId: adminId,
        action: 'team_quota_updated',
        entityType: 'team',
        entityId: teamId,
        details: {
          team_name: team.name,
          old_max_domains: team.max_domains,
          new_max_domains: maxDomains
        },
        ipAddress: request.ip
      });



      reply.send({
        success: true,
        team: updatedTeam
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update team quotas');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update team quotas'
      });
    }
  });

  fastify.get('/audit-logs', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const {
        user = '',
        action = '',
        startDate = '',
        endDate = '',
        page = 1,
        limit = 100
      } = request.query;

      const offset = (page - 1) * limit;
      const params = [];
      const conditions = [];

      // Build WHERE conditions
      let paramIndex = 1;

      if (user) {
        conditions.push(`u.username ILIKE $${paramIndex}`);
        params.push(`%${user}%`);
        paramIndex++;
      }

      if (action) {
        conditions.push(`al.action ILIKE $${paramIndex}`);
        params.push(`%${action}%`);
        paramIndex++;
      }

      if (startDate) {
        conditions.push(`al.created_at >= $${paramIndex}`);
        params.push(new Date(startDate));
        paramIndex++;
      }

      if (endDate) {
        conditions.push(`al.created_at <= $${paramIndex}`);
        params.push(new Date(endDate));
        paramIndex++;
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereClause}
      `;
      const countResult = await database.pgPool.query(countQuery, params);
      const total = parseInt(countResult.rows[0].total);

      // Get paginated logs
      const logsQuery = `
        SELECT
          al.*,
          u.username
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(limit, offset);

      const logsResult = await database.pgPool.query(logsQuery, params);

      reply.send({
        logs: logsResult.rows,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch audit logs');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch audit logs'
      });
    }
  });

  // Admin endpoint to view ALL redirections (for platform management)
  fastify.get('/redirections', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const redirections = await database.getAllRedirections();

      reply.send({
        success: true,
        redirections,
        count: redirections.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch all redirections');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch all redirections'
      });
    }
  });

  // Admin endpoint to update any redirection
  fastify.put('/redirections/:id', {
    preHandler: fastify.authorize(['admin']),
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
          targetUrl: {
            type: 'string',
            minLength: 1,
            maxLength: 2048
          },
          description: {
            type: 'string',
            maxLength: 500
          },
          isActive: {
            type: 'boolean'
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const redirectionId = parseInt(request.params.id, 10);
      const adminId = request.user.id;
      const { targetUrl, description, isActive } = request.body;

      const redirection = await database.getRedirectionById(redirectionId);
      if (!redirection) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      if (targetUrl && !validator.isURL(targetUrl, { require_protocol: true, protocols: ['http', 'https'], require_tld: false })) {
        return reply.code(400).send({
          error: 'Invalid target URL',
          message: 'Target URL must be a valid HTTP or HTTPS URL'
        });
      }

      const updatePayload = {};
      if (targetUrl !== undefined) updatePayload.targetUrl = targetUrl;
      if (description !== undefined) updatePayload.description = description;
      if (isActive !== undefined) updatePayload.isActive = isActive;

      const updatedRedirection = await database.updateRedirection(redirectionId, updatePayload);

      await database.createAuditLog({
        userId: adminId,
        action: 'admin_redirection_updated',
        entityType: 'redirection',
        entityId: redirectionId,
        details: {
          short_code: updatedRedirection.short_code,
          target_url: updatedRedirection.target_url,
          is_active: updatedRedirection.is_active
        },
        ipAddress: request.ip
      });

      reply.send({
        success: true,
        redirection: updatedRedirection
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update redirection (admin)');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to update redirection'
      });
    }
  });

  // Admin endpoint to toggle redirection status
  fastify.post('/redirections/:id/toggle', {
    preHandler: fastify.authorize(['admin']),
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
      }
    }
  }, async (request, reply) => {
    try {
      const redirectionId = parseInt(request.params.id, 10);
      const adminId = request.user.id;

      const redirection = await database.getRedirectionById(redirectionId);
      if (!redirection) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      const updatedRedirection = await database.toggleRedirection(redirectionId);

      await database.createAuditLog({
        userId: adminId,
        action: updatedRedirection.is_active ? 'redirection_enabled' : 'redirection_disabled',
        entityType: 'redirection',
        entityId: redirectionId,
        details: {
          short_code: redirection.short_code,
          is_active: updatedRedirection.is_active
        },
        ipAddress: request.ip
      });

      reply.send({
        success: true,
        redirection: updatedRedirection
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to toggle redirection');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to toggle redirection'
      });
    }
  });

  // Admin endpoint to delete any redirection
  fastify.delete('/redirections/:id', {
    preHandler: fastify.authorize(['admin']),
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
      }
    }
  }, async (request, reply) => {
    try {
      const redirectionId = parseInt(request.params.id, 10);
      const adminId = request.user.id;

      const redirection = await database.getRedirectionById(redirectionId);
      if (!redirection) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      await database.deleteRedirection(redirectionId);

      await database.createAuditLog({
        userId: adminId,
        action: 'admin_redirection_deleted',
        entityType: 'redirection',
        entityId: redirectionId,
        details: {
          short_code: redirection.short_code,
          target_url: redirection.target_url
        },
        ipAddress: request.ip
      });

      reply.send({
        success: true,
        message: 'Redirection deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete redirection');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete redirection'
      });
    }
  });

  // ===== API KEYS ADMIN ENDPOINTS =====

  /**
   * List all API keys (admin only)
   * GET /api/admin/api-keys
   */
  fastify.get('/api-keys', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const apiKeys = await database.getAllApiKeys();

      // Format response (exclude sensitive data)
      const formattedKeys = apiKeys.map(key => ({
        id: key.id,
        userId: key.user_id,
        username: key.username,
        userDisplayName: key.user_display_name,
        userRole: key.user_role,
        name: key.name,
        description: key.description,
        keyPrefix: key.key_prefix,
        scopes: Array.isArray(key.scopes) ? key.scopes : JSON.parse(key.scopes || '[]'),
        rateLimitRpm: key.rate_limit_rpm,
        rateLimitRph: key.rate_limit_rph,
        isActive: key.is_active,
        expiresAt: key.expires_at,
        lastUsedAt: key.last_used_at,
        createdAt: key.created_at,
        updatedAt: key.updated_at
      }));

      reply.send({
        success: true,
        apiKeys: formattedKeys,
        total: formattedKeys.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to list all API keys');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to list API keys'
      });
    }
  });

  /**
   * Get API key details (admin only)
   * GET /api/admin/api-keys/:id
   */
  fastify.get('/api-keys/:id', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const apiKey = await database.getApiKeyById(id);

      if (!apiKey) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'API key not found'
        });
      }

      // Get user info
      const user = await database.getUserById(apiKey.user_id);

      reply.send({
        success: true,
        apiKey: {
          id: apiKey.id,
          userId: apiKey.user_id,
          username: user?.username,
          userDisplayName: user?.display_name,
          userRole: user?.role,
          name: apiKey.name,
          description: apiKey.description,
          keyPrefix: apiKey.key_prefix,
          scopes: Array.isArray(apiKey.scopes) ? apiKey.scopes : JSON.parse(apiKey.scopes || '[]'),
          rateLimitRpm: apiKey.rate_limit_rpm,
          rateLimitRph: apiKey.rate_limit_rph,
          isActive: apiKey.is_active,
          expiresAt: apiKey.expires_at,
          lastUsedAt: apiKey.last_used_at,
          createdAt: apiKey.created_at,
          updatedAt: apiKey.updated_at
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get API key');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve API key'
      });
    }
  });

  /**
   * Revoke (delete) any API key (admin only)
   * DELETE /api/admin/api-keys/:id
   */
  fastify.delete('/api-keys/:id', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { id } = request.params;

      // Get existing key
      const existingKey = await database.getApiKeyById(id);

      if (!existingKey) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'API key not found'
        });
      }

      // Get user info for logging
      const user = await database.getUserById(existingKey.user_id);

      // Delete from database
      await database.deleteApiKey(id);

      // Log audit event
      await database.createAuditLog({
        userId: request.user.id,
        action: 'admin_api_key_deleted',
        entityType: 'api_key',
        entityId: id,
        details: {
          name: existingKey.name,
          owner_username: user?.username,
          owner_id: existingKey.user_id
        },
        ipAddress: request.ip
      });

      reply.send({
        success: true,
        message: 'API key revoked successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete API key');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete API key'
      });
    }
  });

  /**
   * Get API key usage statistics (admin only)
   * GET /api/admin/api-keys/:id/usage
   */
  fastify.get('/api-keys/:id/usage', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { days = 7 } = request.query;

      // Get API key
      const apiKey = await database.getApiKeyById(id);

      if (!apiKey) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'API key not found'
        });
      }

      // Get usage stats
      const usageStats = await database.getApiKeyUsageStats(id, parseInt(days, 10));

      // Get user info
      const user = await database.getUserById(apiKey.user_id);

      reply.send({
        success: true,
        apiKeyId: id,
        apiKeyName: apiKey.name,
        owner: {
          id: user?.id,
          username: user?.username,
          displayName: user?.display_name
        },
        period: `${days} days`,
        ...usageStats
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get API key usage stats');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve usage statistics'
      });
    }
  });

  // ==========================================
  // Retry Queue & Dead Letter Queue Endpoints
  // ==========================================

  /**
   * Get queue statistics
   * GET /api/admin/queue/stats
   */
  fastify.get('/queue/stats', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { queueService } = await import('../services/queueService.js');
      const stats = await queueService.getStats();
      reply.send(stats);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get queue stats');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve queue statistics'
      });
    }
  });

  /**
   * Get Dead Letter Queue jobs
   * GET /api/admin/queue/dlq?jobType=email&notifiedAdmin=false
   */
  fastify.get('/queue/dlq', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { jobType, notifiedAdmin } = request.query;
      const filters = {};

      if (jobType) {
        filters.jobType = jobType;
      }
      if (notifiedAdmin !== undefined) {
        filters.notifiedAdmin = notifiedAdmin === 'true';
      }

      const jobs = await database.getJobsFromDLQ(filters);
      reply.send(jobs);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get DLQ jobs');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve DLQ jobs'
      });
    }
  });

  /**
   * Retry a job from Dead Letter Queue
   * POST /api/admin/queue/dlq/:jobId/retry
   */
  fastify.post('/queue/dlq/:jobId/retry', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;

      // Get job from DLQ and delete it
      const job = await database.retryJobFromDLQ(jobId);

      if (!job) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Job not found in Dead Letter Queue'
        });
      }

      // Re-queue the job
      const { queueService } = await import('../services/queueService.js');
      const newJobId = await queueService.enqueue(job.jobType, job.payload);

      reply.send({
        success: true,
        message: 'Job re-queued successfully',
        jobId: newJobId
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to retry DLQ job');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retry job'
      });
    }
  });

  /**
   * Delete a job from Dead Letter Queue
   * DELETE /api/admin/queue/dlq/:jobId
   */
  fastify.delete('/queue/dlq/:jobId', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;
      await database.deleteJobFromDLQ(jobId);

      reply.send({
        success: true,
        message: 'Job deleted from DLQ'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete DLQ job');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete job'
      });
    }
  });

  /**
   * Clear all jobs from Dead Letter Queue
   * POST /api/admin/queue/dlq/clear
   */
  fastify.post('/queue/dlq/clear', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { confirmClear } = request.body;

      if (!confirmClear) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Confirmation required to clear DLQ'
        });
      }

      // Get all DLQ jobs and delete them
      const jobs = await database.getJobsFromDLQ();
      for (const job of jobs) {
        await database.deleteJobFromDLQ(job.job_id);
      }

      reply.send({
        success: true,
        message: `Cleared ${jobs.length} jobs from DLQ`
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to clear DLQ');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to clear DLQ'
      });
    }
  });

  /**
   * Get retry audit log for a specific job
   * GET /api/admin/queue/audit/:jobId
   */
  fastify.get('/queue/audit/:jobId', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;
      const auditLog = await database.getRetryAuditLog(jobId);

      reply.send(auditLog);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get retry audit log');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve audit log'
      });
    }
  });

  /**
   * Get system monitoring metrics
   * GET /api/admin/monitoring/metrics
   */
  fastify.get('/monitoring/metrics', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const metrics = await monitoringService.getSystemMetrics();
      reply.send({
        success: true,
        metrics
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get system metrics');
      reply.code(500).send({
        success: false,
        message: 'Failed to retrieve system metrics'
      });
    }
  });

  /**
   * Get system logs
   * GET /api/admin/monitoring/logs
   */
  fastify.get('/monitoring/logs', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { lines = 50 } = request.query;
      const logs = await monitoringService.getSystemLogs(parseInt(lines));

      reply.send({
        success: true,
        logs
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get system logs');
      reply.code(500).send({
        success: false,
        message: 'Failed to retrieve system logs'
      });
    }
  });

  /**
   * Get process list
   * GET /api/admin/monitoring/processes
   */
  fastify.get('/monitoring/processes', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const processes = await monitoringService.getProcessList();

      reply.send({
        success: true,
        processes
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get process list');
      reply.code(500).send({
        success: false,
        message: 'Failed to retrieve process list'
      });
    }
  });

  /**
   * Database Backup Routes
   */

  // Get database stats
  fastify.get('/database/stats', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const stats = await databaseBackupService.getDatabaseStats();
      reply.send({ success: true, stats });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get database stats');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // List all backups
  fastify.get('/database/backups', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const backups = await databaseBackupService.listBackups();
      reply.send({ success: true, backups });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to list backups');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Create new backup
  fastify.post('/database/backups', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { alreadyRunning, job } = databaseBackupService.startBackupJob();

      if (alreadyRunning) {
        return reply.send({
          success: true,
          queued: false,
          running: true,
          message: 'A backup is already running',
          job
        });
      }

      reply.code(202).send({
        success: true,
        queued: true,
        message: 'Backup started in background',
        job
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create backup');



      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Get latest backup job status
  fastify.get('/database/backups/jobs/latest', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const job = databaseBackupService.getLatestBackupJob();
      reply.send({ success: true, job });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get latest backup job');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Get backup job status by id
  fastify.get('/database/backups/jobs/:jobId', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;
      const job = databaseBackupService.getBackupJob(jobId);
      if (!job) {
        return reply.code(404).send({ success: false, message: 'Backup job not found' });
      }
      reply.send({ success: true, job });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get backup job status');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Download backup
  fastify.get('/database/backups/:filename/download', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { filename } = request.params;
      const filepath = await databaseBackupService.getBackupPath(filename);
      const safeFilename = filepath.split(/[\\/]/).pop() || 'backup.sql';

      // Read into Buffer first — setting reply.type() to a non-JSON content type
      // before the send causes Fastify v4 to refuse serializing a plain JS object
      // in the catch block (FST_ERR_REP_INVALID_PAYLOAD_TYPE crash).
      const content = await readFile(filepath);

      const contentType = safeFilename.endsWith('.json')
        ? 'application/json'
        : 'application/octet-stream';
      reply.type(contentType);
      reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
      reply.send(content);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to download backup');
      reply.code(404).send({ success: false, message: error.message ?? 'Backup file not found' });
    }
  });

  // Delete backup
  fastify.delete('/database/backups/:filename', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { filename } = request.params;
      await databaseBackupService.deleteBackup(filename);
      reply.send({ success: true, message: 'Backup deleted successfully' });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete backup');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Restore backup
  fastify.post('/database/backups/:filename/restore', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { filename } = request.params;
      const result = await databaseBackupService.restoreBackup(filename);

      reply.send({
        success: true,
        message: 'Backup restored successfully',
        restore: result
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to restore backup');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Run VACUUM
  fastify.post('/database/vacuum', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const result = await databaseBackupService.vacuumDatabase();
      reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to vacuum database');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Run ANALYZE
  fastify.post('/database/analyze', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const result = await databaseBackupService.analyzeDatabase();
      reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to analyze database');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  /**
   * Docker Services Routes
   */

  // List containers
  fastify.get('/services/containers', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const containers = await dockerService.listContainers();
      reply.send({ success: true, containers });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to list containers');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Start container
  fastify.post('/services/containers/:name/start', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { name } = request.params;
      const result = await dockerService.startContainer(name);
      reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to start container');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Stop container
  fastify.post('/services/containers/:name/stop', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { name } = request.params;
      const result = await dockerService.stopContainer(name);
      reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to stop container');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Restart container
  fastify.post('/services/containers/:name/restart', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { name } = request.params;
      const result = await dockerService.restartContainer(name);
      reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to restart container');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // Get container logs
  fastify.get('/services/containers/:name/logs', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { name } = request.params;
      const { lines = 50 } = request.query;
      const logs = await dockerService.getContainerLogs(name, parseInt(lines));
      reply.send({ success: true, logs });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get container logs');
      reply.code(500).send({ success: false, message: error.message });
    }
  });

  // ===============================
  // User Management (Local Mode)
  // ===============================

  // Helper function to hash passwords
  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt}$${hash.toString('hex')}`;
  }

  // Create user (local mode only)
  fastify.post('/users', {
    preHandler: fastify.authorize(['admin']),
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9._@-]+$'
          },
          displayName: {
            type: 'string',
            minLength: 1,
            maxLength: 255
          },
          email: {
            type: 'string',
            maxLength: 255
          },
          password: {
            type: 'string',
            minLength: 6,
            maxLength: 1024
          },
          role: {
            type: 'string',
            enum: ['admin', 'user']
          },
          maxDomains: {
            type: 'integer'
          },
          maxRedirections: {
            type: 'integer'
          }
        }
      }
    }
  }, async (request, reply) => {
    // Only allow user creation in local mode
    if (config.auth.mode !== 'local') {
      return reply.code(400).send({
        success: false,
        error: 'Operation not allowed',
        message: 'User creation is only available in local authentication mode'
      });
    }

    const { username, password, displayName, email, role, maxDomains, maxRedirections } = request.body;

    try {
      // Check if user already exists
      const existing = await database.getUserByUsername(username);
      if (existing) {
        return reply.code(409).send({
          success: false,
          error: 'User already exists',
          message: 'Username is already taken'
        });
      }

      // Hash password
      const passwordHash = hashPassword(password);

      // Create user
      const dbUser = await database.createUser({
        username,
        displayName: displayName || username,
        email: email || null,
        role: role || 'user',
        passwordHash,
        maxDomains: maxDomains !== undefined ? maxDomains : 0,
        maxRedirections: maxRedirections !== undefined ? maxRedirections : 10
      });



      fastify.log.info({ username, role: dbUser.role }, 'User created by admin');

      reply.send({
        success: true,
        user: {
          id: dbUser.id,
          username: dbUser.username,
          displayName: dbUser.display_name,
          email: dbUser.email,
          role: dbUser.role
        }
      });
    } catch (error) {
      fastify.log.error({ error, username }, 'User creation failed');
      reply.code(500).send({
        success: false,
        error: 'User creation failed',
        message: error.message || 'Unable to create user'
      });
    }
  });

  // ===============================
  // Registration Configuration
  // ===============================

  // Get registration configuration
  fastify.get('/registration-config', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['registration_enabled']
      );

      const enabled = result.rows.length > 0 ? result.rows[0].value === 'true' : true;
      const authMode = config.auth.mode;

      reply.send({
        success: true,
        config: {
          enabled,
          authMode
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get registration config');
      reply.code(500).send({
        success: false,
        message: 'Failed to get registration configuration'
      });
    }
  });

  // Update registration configuration
  fastify.put('/registration-config', {
    preHandler: fastify.authorize(['admin']),
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: {
            type: 'boolean'
          }
        }
      }
    }
  }, async (request, reply) => {
    const { enabled } = request.body;

    try {
      // Update or insert the config
      await pool.query(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        ['registration_enabled', enabled.toString()]
      );

      fastify.log.info({ enabled }, 'Registration config updated');

      reply.send({
        success: true,
        message: 'Registration configuration updated'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update registration config');
      reply.code(500).send({
        success: false,
        message: 'Failed to update registration configuration'
      });
    }
  });
}
