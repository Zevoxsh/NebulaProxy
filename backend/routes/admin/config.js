import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import configManager from '../../config/config-manager.js';
import { pool } from '../../config/database.js';
import { config } from '../../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, '..', '..', '.env');
const ENV_EXAMPLE_PATH = join(__dirname, '..', '..', '.env.example');

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

export async function adminConfigRoutes(fastify, options) {

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

  fastify.get('/config/export', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      await configManager.init();
      const currentConfig = configManager.getAll();

      // Build a clean export — keep all keys but redact nothing
      // (admin-only endpoint, the admin already has access to these secrets)
      const exportData = {
        _exported_at: new Date().toISOString(),
        _version: 1,
        ...currentConfig,
      };

      const filename = `nebulaproxy-config-${new Date().toISOString().slice(0, 10)}.json`;
      reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(JSON.stringify(exportData, null, 2));
    } catch (error) {
      fastify.log.error({ error }, 'Failed to export configuration');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to export configuration' });
    }
  });

  fastify.post('/config/validate', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const cfg = request.body || {};
      const errors = configManager.validateConfig(cfg);
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
      const cfg = request.body || {};
      const errors = configManager.validateConfig(cfg);
      if (errors.length > 0) {
        return reply.code(400).send({ success: false, errors });
      }

      await configManager.saveToRedis(cfg);

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
