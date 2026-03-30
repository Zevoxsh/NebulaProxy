import { database } from '../services/database.js';
import { urlFilterService } from '../services/urlFilterService.js';

/**
 * URL Blocking Rules API Routes
 */
export default async function urlBlockingRoutes(fastify, options) {

  /**
   * Get all URL blocking rules for a domain
   */
  fastify.get('/domains/:domainId/rules', {
    preHandler: fastify.authenticate,
    schema: {
      params: {
        type: 'object',
        properties: {
          domainId: { type: 'integer' }
        },
        required: ['domainId']
      }
    }
  }, async (request, reply) => {
    try {
      const { domainId } = request.params;
      const userId = request.user.id;
      const isAdmin = request.user?.role === 'admin';

      // Verify domain ownership
      const domain = await database.getDomainById(domainId);
      if (!domain || (!isAdmin && domain.user_id !== userId)) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this domain'
        });
      }

      const result = await database.pgPool.query(
        `SELECT ubr.*, u.username as created_by_username
         FROM url_blocking_rules ubr
         LEFT JOIN users u ON ubr.created_by = u.id
         WHERE ubr.domain_id = $1
         ORDER BY ubr.priority DESC, ubr.id ASC`,
        [domainId]
      );

      return {
        success: true,
        rules: result.rows
      };
    } catch (error) {
      fastify.log.error({ err: error }, 'Error fetching URL blocking rules');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch URL blocking rules'
      });
    }
  });

  /**
   * Create a new URL blocking rule
   */
  fastify.post('/domains/:domainId/rules', {
    preHandler: fastify.authenticate,
    schema: {
      params: {
        type: 'object',
        properties: {
          domainId: { type: 'integer' }
        },
        required: ['domainId']
      },
      body: {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1 },
          pattern_type: { type: 'string', enum: ['exact', 'prefix', 'wildcard', 'regex', 'ip', 'cidr'] },
          action: { type: 'string', enum: ['block', 'allow'] },
          response_code: { type: 'integer', minimum: 100, maximum: 599 },
          response_message: { type: 'string' },
          priority: { type: 'integer', minimum: 0, maximum: 1000 },
          is_active: { type: 'boolean' },
          description: { type: 'string' },
          allowed_ips: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['pattern', 'pattern_type', 'action']
      }
    }
  }, async (request, reply) => {
    try {
      const { domainId } = request.params;
      const userId = request.user.id;
      const isAdmin = request.user?.role === 'admin';
      const ruleData = request.body;

      // Verify domain ownership
      const domain = await database.getDomainById(domainId);
      if (!domain || (!isAdmin && domain.user_id !== userId)) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this domain'
        });
      }

      // Validate pattern
      const validation = urlFilterService.validatePattern(ruleData.pattern, ruleData.pattern_type);
      if (!validation.valid) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: validation.error
        });
      }

      const ipValidation = urlFilterService.validateAllowedIps(ruleData.allowed_ips);
      if (!ipValidation.valid) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: ipValidation.error
        });
      }

      // Insert rule
      const allowedIps = Array.isArray(ruleData.allowed_ips) && ruleData.allowed_ips.length > 0
        ? ruleData.allowed_ips
        : null;

      const result = await database.pgPool.query(
        `INSERT INTO url_blocking_rules (
          domain_id, pattern, pattern_type, action, response_code,
          response_message, priority, is_active, description, created_by, allowed_ips
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          domainId,
          ruleData.pattern,
          ruleData.pattern_type,
          ruleData.action,
          ruleData.response_code || 403,
          ruleData.response_message || null,
          ruleData.priority || 100,
          ruleData.is_active !== false,
          ruleData.description || null,
          userId,
          allowedIps
        ]
      );

      // Invalidate cache
      urlFilterService.invalidateCache(domainId);

      fastify.log.info({ ruleId: result.rows[0].id, domainId, pattern: ruleData.pattern, userId }, 'URL blocking rule created');

      return {
        success: true,
        rule: result.rows[0]
      };
    } catch (error) {
      if (error.code === '23505') { // Unique constraint violation
        return reply.status(409).send({
          error: 'Conflict',
          message: 'A rule with this pattern already exists for this domain'
        });
      }

      fastify.log.error({ err: error }, 'Error creating URL blocking rule');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create URL blocking rule'
      });
    }
  });

  /**
   * Update a URL blocking rule
   */
  fastify.put('/rules/:ruleId', {
    preHandler: fastify.authenticate,
    schema: {
      params: {
        type: 'object',
        properties: {
          ruleId: { type: 'integer' }
        },
        required: ['ruleId']
      },
      body: {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1 },
          pattern_type: { type: 'string', enum: ['exact', 'prefix', 'wildcard', 'regex', 'ip', 'cidr'] },
          action: { type: 'string', enum: ['block', 'allow'] },
          response_code: { type: 'integer', minimum: 100, maximum: 599 },
          response_message: { type: 'string' },
          priority: { type: 'integer', minimum: 0, maximum: 1000 },
          is_active: { type: 'boolean' },
          description: { type: 'string' },
          allowed_ips: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { ruleId } = request.params;
      const userId = request.user.id;
      const isAdmin = request.user?.role === 'admin';
      const updates = request.body;

      // Get existing rule and verify ownership
      const existing = await database.pgPool.query(
        `SELECT ubr.*, d.user_id
         FROM url_blocking_rules ubr
         JOIN domains d ON ubr.domain_id = d.id
         WHERE ubr.id = $1`,
        [ruleId]
      );

      if (existing.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'URL blocking rule not found'
        });
      }

      if (!isAdmin && existing.rows[0].user_id !== userId) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this rule'
        });
      }

      // Validate pattern if being updated
      if (updates.pattern && updates.pattern_type) {
        const validation = urlFilterService.validatePattern(updates.pattern, updates.pattern_type);
        if (!validation.valid) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: validation.error
          });
        }
      }

      if (updates.allowed_ips !== undefined) {
        const ipValidation = urlFilterService.validateAllowedIps(updates.allowed_ips);
        if (!ipValidation.valid) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: ipValidation.error
          });
        }
      }

      // Build update query
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;

      if (updates.pattern !== undefined) {
        updateFields.push(`pattern = $${paramCount++}`);
        updateValues.push(updates.pattern);
      }
      if (updates.pattern_type !== undefined) {
        updateFields.push(`pattern_type = $${paramCount++}`);
        updateValues.push(updates.pattern_type);
      }
      if (updates.action !== undefined) {
        updateFields.push(`action = $${paramCount++}`);
        updateValues.push(updates.action);
      }
      if (updates.response_code !== undefined) {
        updateFields.push(`response_code = $${paramCount++}`);
        updateValues.push(updates.response_code);
      }
      if (updates.response_message !== undefined) {
        updateFields.push(`response_message = $${paramCount++}`);
        updateValues.push(updates.response_message);
      }
      if (updates.priority !== undefined) {
        updateFields.push(`priority = $${paramCount++}`);
        updateValues.push(updates.priority);
      }
      if (updates.is_active !== undefined) {
        updateFields.push(`is_active = $${paramCount++}`);
        updateValues.push(updates.is_active);
      }
      if (updates.description !== undefined) {
        updateFields.push(`description = $${paramCount++}`);
        updateValues.push(updates.description);
      }
      if (updates.allowed_ips !== undefined) {
        updateFields.push(`allowed_ips = $${paramCount++}`);
        updateValues.push(
          Array.isArray(updates.allowed_ips) && updates.allowed_ips.length > 0
            ? updates.allowed_ips
            : null
        );
      }

      if (updateFields.length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'No fields to update'
        });
      }

      updateValues.push(ruleId);
      const result = await database.pgPool.query(
        `UPDATE url_blocking_rules
         SET ${updateFields.join(', ')}
         WHERE id = $${paramCount}
         RETURNING *`,
        updateValues
      );

      // Invalidate cache
      urlFilterService.invalidateCache(existing.rows[0].domain_id);

      fastify.log.info({ ruleId, userId }, 'URL blocking rule updated');

      return {
        success: true,
        rule: result.rows[0]
      };
    } catch (error) {
      fastify.log.error({ err: error }, 'Error updating URL blocking rule');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update URL blocking rule'
      });
    }
  });

  /**
   * Delete a URL blocking rule
   */
  fastify.delete('/rules/:ruleId', {
    preHandler: fastify.authenticate,
    schema: {
      params: {
        type: 'object',
        properties: {
          ruleId: { type: 'integer' }
        },
        required: ['ruleId']
      }
    }
  }, async (request, reply) => {
    try {
      const { ruleId } = request.params;
      const userId = request.user.id;
      const isAdmin = request.user?.role === 'admin';

      // Get existing rule and verify ownership
      const existing = await database.pgPool.query(
        `SELECT ubr.*, d.user_id
         FROM url_blocking_rules ubr
         JOIN domains d ON ubr.domain_id = d.id
         WHERE ubr.id = $1`,
        [ruleId]
      );

      if (existing.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'URL blocking rule not found'
        });
      }

      if (!isAdmin && existing.rows[0].user_id !== userId) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to delete this rule'
        });
      }

      // Delete rule
      await database.pgPool.query('DELETE FROM url_blocking_rules WHERE id = $1', [ruleId]);

      // Invalidate cache
      urlFilterService.invalidateCache(existing.rows[0].domain_id);

      fastify.log.info({ ruleId, userId }, 'URL blocking rule deleted');

      return {
        success: true,
        message: 'URL blocking rule deleted successfully'
      };
    } catch (error) {
      fastify.log.error({ err: error }, 'Error deleting URL blocking rule');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete URL blocking rule'
      });
    }
  });

  /**
   * Test a URL pattern against sample paths
   */
  fastify.post('/rules/test', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1 },
          pattern_type: { type: 'string', enum: ['exact', 'prefix', 'wildcard', 'regex', 'ip', 'cidr'] },
          test_paths: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 50
          }
        },
        required: ['pattern', 'pattern_type', 'test_paths']
      }
    }
  }, async (request, reply) => {
    try {
      const { pattern, pattern_type, test_paths } = request.body;

      // Validate pattern
      const validation = urlFilterService.validatePattern(pattern, pattern_type);
      if (!validation.valid) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: validation.error
        });
      }

      // Test each path
      const results = test_paths.map(path => ({
        path,
        matches: urlFilterService.matchPattern(path, pattern, pattern_type)
      }));

      return {
        success: true,
        pattern,
        pattern_type,
        results
      };
    } catch (error) {
      fastify.log.error({ err: error }, 'Error testing URL pattern');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to test URL pattern'
      });
    }
  });
}
