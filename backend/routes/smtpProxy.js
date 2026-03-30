/**
 * SMTP Proxy Management Routes
 */

import { smtpProxyService } from '../services/smtpProxyService.js';
import { pool } from '../config/database.js';
import { escapeLikePattern } from '../utils/security.js';

export async function smtpProxyRoutes(fastify, options) {
  // Get SMTP Proxy statistics
  fastify.get('/stats', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const stats = smtpProxyService.getStats();
      reply.send({ success: true, stats });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get SMTP proxy stats');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve SMTP proxy statistics'
      });
    }
  });

  // Restart SMTP Proxy service
  fastify.post('/restart', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      fastify.log.info('Restarting SMTP proxy service...');

      // Stop current service
      await smtpProxyService.stop();

      // Start with new configuration
      await smtpProxyService.start();

      const stats = smtpProxyService.getStats();

      reply.send({
        success: true,
        message: 'SMTP proxy service restarted successfully',
        stats
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to restart SMTP proxy');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to restart SMTP proxy service'
      });
    }
  });

  // Get SMTP connection logs
  fastify.get('/logs', {
    preHandler: fastify.authorize(['admin']),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 100, minimum: 1, maximum: 1000 },
          offset: { type: 'number', default: 0, minimum: 0 },
          ip: { type: 'string' },
          event_type: { type: 'string' },
          status: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { limit, offset, ip, event_type, status } = request.query;

      let query = 'SELECT * FROM smtp_logs WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      if (ip) {
        query += ` AND client_ip = $${paramIndex++}`;
        params.push(ip);
      }

      if (event_type) {
        const escapedEventType = escapeLikePattern(event_type);
        query += ` AND event_type LIKE $${paramIndex++}`;
        params.push(`%${escapedEventType}%`);
      }

      if (status) {
        query += ` AND status = $${paramIndex++}`;
        params.push(status);
      }

      query += ` ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);

      // Get total count
      let countQuery = 'SELECT COUNT(*) as total FROM smtp_logs WHERE 1=1';
      const countParams = [];
      let countIndex = 1;

      if (ip) {
        countQuery += ` AND client_ip = $${countIndex++}`;
        countParams.push(ip);
      }

      if (event_type) {
        const escapedEventType = escapeLikePattern(event_type);
        countQuery += ` AND event_type LIKE $${countIndex++}`;
        countParams.push(`%${escapedEventType}%`);
      }

      if (status) {
        countQuery += ` AND status = $${countIndex++}`;
        countParams.push(status);
      }

      const countResult = await pool.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0]?.total || 0, 10);

      reply.send({
        success: true,
        logs: result.rows,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch SMTP logs');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve SMTP logs'
      });
    }
  });

  // Get SMTP connection statistics summary
  fastify.get('/logs/summary', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      // Get statistics from last 24 hours
      const summaryQuery = `
        SELECT
          COUNT(*) as total_connections,
          COUNT(DISTINCT client_ip) as unique_ips,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(message_size) as total_bytes
        FROM smtp_logs
        WHERE timestamp > NOW() - INTERVAL '24 hours'
      `;

      const topIpsQuery = `
        SELECT
          client_ip,
          COUNT(*) as connection_count
        FROM smtp_logs
        WHERE timestamp > NOW() - INTERVAL '24 hours'
        GROUP BY client_ip
        ORDER BY connection_count DESC
        LIMIT 10
      `;

      const eventTypesQuery = `
        SELECT
          event_type,
          COUNT(*) as count
        FROM smtp_logs
        WHERE timestamp > NOW() - INTERVAL '24 hours'
        GROUP BY event_type
        ORDER BY count DESC
      `;

      const [summaryResult, topIpsResult, eventTypesResult] = await Promise.all([
        pool.query(summaryQuery),
        pool.query(topIpsQuery),
        pool.query(eventTypesQuery)
      ]);

      reply.send({
        success: true,
        summary: {
          totalConnections: parseInt(summaryResult.rows[0]?.total_connections || 0, 10),
          uniqueIps: parseInt(summaryResult.rows[0]?.unique_ips || 0, 10),
          successful: parseInt(summaryResult.rows[0]?.successful || 0, 10),
          failed: parseInt(summaryResult.rows[0]?.failed || 0, 10),
          totalBytes: parseInt(summaryResult.rows[0]?.total_bytes || 0, 10)
        },
        topIps: topIpsResult.rows.map(row => ({
          ip: row.client_ip,
          count: parseInt(row.connection_count, 10)
        })),
        eventTypes: eventTypesResult.rows.map(row => ({
          type: row.event_type,
          count: parseInt(row.count, 10)
        }))
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch SMTP summary');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve SMTP summary'
      });
    }
  });
}
