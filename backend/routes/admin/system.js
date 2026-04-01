import { database } from '../../services/database.js';
import { monitoringService } from '../../services/monitoringService.js';
import { databaseBackupService } from '../../services/databaseBackupService.js';
import { dockerService } from '../../services/dockerService.js';
import { readFile } from 'fs/promises';

export async function adminSystemRoutes(fastify, options) {

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
      const { queueService } = await import('../../services/queueService.js');
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
      const { queueService } = await import('../../services/queueService.js');
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
}
