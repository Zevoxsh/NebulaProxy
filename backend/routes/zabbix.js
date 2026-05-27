import { database } from '../services/database.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '../../zabbix/nebula_proxy_template.yaml');

/**
 * Zabbix integration routes — no authentication required so Zabbix server
 * can poll them directly.
 *
 * GET /api/zabbix/lld/domains   — Low-Level Discovery feed (Zabbix LLD format)
 * GET /api/zabbix/template      — Download the Zabbix YAML template
 */
export async function zabbixRoutes(fastify, options) {
  // LLD: domain discovery
  fastify.get('/lld/domains', async (request, reply) => {
    try {
      const domains = await database.getAllActiveDomains();

      const data = domains.map((d) => ({
        '{#DOMAIN}': d.hostname,
        '{#PROXY_TYPE}': (d.proxy_type || 'http').toUpperCase(),
        '{#SSL_ENABLED}': d.ssl_enabled ? '1' : '0'
      }));

      reply.send({ data });
    } catch (error) {
      fastify.log.error({ error }, 'Zabbix LLD: failed to list domains');
      reply.code(500).send({ data: [] });
    }
  });

  // Template download
  fastify.get('/template', async (request, reply) => {
    try {
      const yaml = await readFile(TEMPLATE_PATH, 'utf8');
      reply
        .header('Content-Type', 'application/yaml')
        .header('Content-Disposition', 'attachment; filename="nebula_proxy_template.yaml"')
        .send(yaml);
    } catch (error) {
      fastify.log.error({ error }, 'Zabbix template: file not found');
      reply.code(404).send({ message: 'Template file not found' });
    }
  });
}
