import updateService from '../services/updateService.js';

/**
 * Update routes - Admin-only endpoints for update management
 */
export function updateRoutes(fastify, opts, done) {
  // All routes require admin authentication
  fastify.addHook('preHandler', fastify.authorize(['admin']));

  /**
   * GET /api/admin/updates/status
   * Get current update status
   */
  fastify.get('/status', async (request, reply) => {
    try {
      const status = await updateService.getStatus();
      reply.send({
        success: true,
        data: status
      });
    } catch (error) {
      fastify.log.error(`[Updates API] Failed to get status: ${error.message}`);
      reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/admin/updates/history
   * Get update history
   */
  fastify.get('/history', async (request, reply) => {
    try {
      const { limit = 10 } = request.query;
      const history = await updateService.getHistory(parseInt(limit, 10));
      reply.send({
        success: true,
        data: history
      });
    } catch (error) {
      fastify.log.error(`[Updates API] Failed to get history: ${error.message}`);
      reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/updates/check
   * Manually trigger update check
   */
  fastify.post('/check', async (request, reply) => {
    try {
      const result = await updateService.checkForUpdates();
      reply.send({
        success: true,
        data: result
      });
    } catch (error) {
      fastify.log.error(`[Updates API] Failed to check for updates: ${error.message}`);
      reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/updates/apply
   * Manually apply available update
   */
  fastify.post('/apply', async (request, reply) => {
    try {
      // Check if update is already in progress
      if (updateService.updateInProgress || await updateService.hasActiveUpdate()) {
        return reply.code(409).send({
          success: false,
          error: 'Update already in progress'
        });
      }

      // Start update asynchronously (skip wait for manual updates)
      updateService.applyUpdate({ skipWait: true }).catch(error => {
        fastify.log.error(`[Updates API] Update failed: ${error.message}`);
      });

      reply.send({
        success: true,
        message: 'Update started (applying immediately)'
      });
    } catch (error) {
      fastify.log.error(`[Updates API] Failed to apply update: ${error.message}`);
      reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/updates/toggle
   * Enable/disable auto-update
   */
  fastify.post('/toggle', async (request, reply) => {
    try {
      const { enabled } = request.body;

      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({
          success: false,
          error: 'enabled must be a boolean'
        });
      }

      await updateService.toggleAutoUpdate(enabled);

      reply.send({
        success: true,
        message: `Auto-update ${enabled ? 'enabled' : 'disabled'}`
      });
    } catch (error) {
      fastify.log.error(`[Updates API] Failed to toggle auto-update: ${error.message}`);
      reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/updates/cleanup
   * Clean up stuck updates that have been in progress for too long
   */
  fastify.post('/cleanup', async (request, reply) => {
    try {
      const cleanedCount = await updateService.cleanupStuckUpdates(10);
      reply.send({
        success: true,
        data: {
          cleanedCount,
          message: cleanedCount > 0
            ? `Cleaned up ${cleanedCount} stuck update(s)`
            : 'No stuck updates found'
        }
      });
    } catch (error) {
      fastify.log.error(`[Updates API] Failed to cleanup stuck updates: ${error.message}`);
      reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/updates/rollback/:id
   * Manually rollback to specific update
   */
  fastify.post('/rollback/:id', async (request, reply) => {
    try {
      const updateId = parseInt(request.params.id, 10);

      if (isNaN(updateId)) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid update ID'
        });
      }

      // Check if update is in progress
      if (updateService.updateInProgress) {
        return reply.code(409).send({
          success: false,
          error: 'Cannot rollback while update is in progress'
        });
      }

      // Get update record
      const { pool } = await import('../config/database.js');
      const result = await pool.query(
        'SELECT rollback_tag FROM update_history WHERE id = $1',
        [updateId]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({
          success: false,
          error: 'Update not found'
        });
      }

      const rollbackTag = result.rows[0].rollback_tag;

      if (!rollbackTag || rollbackTag === 'pending') {
        return reply.code(400).send({
          success: false,
          error: 'No rollback tag available for this update'
        });
      }

      // Perform rollback asynchronously
      updateService.rollback(updateId, rollbackTag, 'Manual rollback requested by admin').catch(error => {
        fastify.log.error(`[Updates API] Rollback failed: ${error.message}`);
      });

      reply.send({
        success: true,
        message: 'Rollback started'
      });
    } catch (error) {
      fastify.log.error(`[Updates API] Failed to rollback: ${error.message}`);
      reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  done();
}
