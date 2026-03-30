import { queueService } from './queueService.js';
import { emailNotificationService } from './emailNotificationService.js';
import { database } from './database.js';
import { config } from '../config/config.js';

/**
 * Retry Worker
 * Background worker that polls the retry queue and processes jobs
 *
 * Runs every 30 seconds, processes up to 10 jobs per cycle
 * Executes jobs based on type (email, acme)
 */
class RetryWorker {
  constructor() {
    this.interval = null;
    this.isRunning = false;
    this.pollIntervalSeconds = 30;
    this.batchSize = 10;
    this.lastDLQCheck = 0;
    this.dlqCheckIntervalMs = 3600000; // 1 hour
  }

  /**
   * Start the retry worker
   */
  async start() {
    if (this.interval) {
      console.log('[RetryWorker] Already running');
      return;
    }

    // Initialize queue service
    await queueService.init();

    console.log(`[RetryWorker] Starting (poll every ${this.pollIntervalSeconds}s, batch size: ${this.batchSize})`);

    // Run immediately
    this.processQueue();

    // Then run on interval
    this.interval = setInterval(() => {
      this.processQueue();
    }, this.pollIntervalSeconds * 1000);
  }

  /**
   * Stop the retry worker
   */
  async stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[RetryWorker] Stopped');
    }
  }

  /**
   * Process the retry queue (main worker loop)
   */
  async processQueue() {
    if (this.isRunning) {
      return; // Skip if already processing
    }

    this.isRunning = true;

    try {
      // Dequeue jobs ready for retry
      const jobs = await queueService.dequeue(this.batchSize);

      if (jobs.length === 0) {
        // No jobs to process, run cleanup and DLQ check
        await this.performMaintenance();
        return;
      }

      console.log(`[RetryWorker] Processing ${jobs.length} job(s)`);

      // Process all jobs in parallel
      const results = await Promise.allSettled(
        jobs.map(jobId => this.processJob(jobId))
      );

      // Count results
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
      const failed = results.filter(r => r.status === 'fulfilled' && r.value === false).length;
      const errors = results.filter(r => r.status === 'rejected').length;

      console.log(`[RetryWorker] Completed: ${succeeded} success, ${failed} retry/failed, ${errors} errors`);

      // Perform maintenance tasks
      await this.performMaintenance();

    } catch (error) {
      console.error('[RetryWorker] Error processing queue:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process a single job
   * @param {string} jobId - Job ID
   * @returns {boolean} True if succeeded, false if retry needed
   */
  async processJob(jobId) {
    // Acquire lock
    const locked = await queueService.markProcessing(jobId);
    if (!locked) {
      console.log(`[RetryWorker] Job ${jobId} already processing or completed`);
      return null;
    }

    try {
      // Get job data from Redis
      const jobKey = `nebulaproxy:queue:job:${jobId}`;
      const jobData = await queueService.redis.hgetall(jobKey);

      if (!jobData || !jobData.id) {
        console.error(`[RetryWorker] Job ${jobId} not found in Redis`);
        return false;
      }

      const { type, payload, attemptCount } = jobData;
      let parsedPayload;

      try {
        parsedPayload = JSON.parse(payload);
      } catch (e) {
        console.error(`[RetryWorker] Failed to parse job ${jobId} payload: ${e.message}`);
        await queueService.moveToDLQ(jobId, 'Invalid payload format');
        return false;
      }

      const currentAttempt = parseInt(attemptCount) + 1;
      console.log(`[RetryWorker] Processing ${type} job ${jobId} (attempt ${currentAttempt})`);

      // Execute job based on type
      let success = false;
      switch (type) {
        case 'email':
          success = await this.executeEmailJob(parsedPayload);
          break;
        case 'acme':
          success = await this.executeAcmeJob(parsedPayload);
          break;
        default:
          console.error(`[RetryWorker] Unknown job type: ${type}`);
          await queueService.moveToDLQ(jobId, `Unknown job type: ${type}`);
          return false;
      }

      if (success) {
        await queueService.markSuccess(jobId);
        return true;
      } else {
        throw new Error('Job execution returned false');
      }

    } catch (error) {
      console.error(`[RetryWorker] Job ${jobId} failed: ${error.message}`);
      await queueService.markRetry(jobId, error);
      return false;
    }
  }

  /**
   * Execute email job
   * @param {object} payload - Email payload { to, subject, html }
   * @returns {boolean} True if succeeded
   */
  async executeEmailJob(payload) {
    try {
      const { to, subject, html } = payload;

      if (!to || !subject || !html) {
        throw new Error('Invalid email payload: missing required fields');
      }

      // Call email service WITHOUT retry (to avoid infinite loop)
      // We'll temporarily disable retry by not catching errors
      const result = await emailNotificationService.transporter.sendMail({
        from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html
      });

      console.log(`[RetryWorker] Email sent successfully: ${subject}`);
      return true;

    } catch (error) {
      console.error(`[RetryWorker] Email job failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute ACME certificate renewal job
   * @param {object} payload - ACME payload { domain }
   * @returns {boolean} True if succeeded
   */
  async executeAcmeJob(payload) {
    try {
      // Optional: ACME cert renewal retry
      // const { domain } = payload;
      // const { acmeManager } = await import('./acmeManager.js');
      // await acmeManager.ensureCert(domain);

      console.log(`[RetryWorker] ACME job execution not yet implemented`);
      return true;

    } catch (error) {
      console.error(`[RetryWorker] ACME job failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform maintenance tasks
   */
  async performMaintenance() {
    try {
      // Clean up orphaned jobs from processing set
      await queueService.cleanup();

      // Check DLQ size and send alerts (hourly)
      const now = Date.now();
      if (now - this.lastDLQCheck >= this.dlqCheckIntervalMs) {
        await this.checkDLQThreshold();
        this.lastDLQCheck = now;
      }

    } catch (error) {
      console.error('[RetryWorker] Maintenance error:', error);
    }
  }

  /**
   * Check Dead Letter Queue size and send admin alert if threshold exceeded
   */
  async checkDLQThreshold() {
    try {
      const dlqCount = await database.getDLQCount();
      const threshold = config.queue.dlqAlertThreshold;

      if (dlqCount >= threshold) {
        console.log(`[RetryWorker] DLQ threshold exceeded: ${dlqCount} jobs (threshold: ${threshold})`);

        // Get unnotified jobs
        const unnotifiedJobs = await database.getJobsFromDLQ({ notifiedAdmin: false });

        if (unnotifiedJobs.length === 0) {
          return; // All jobs already notified
        }

        // Send admin alert
        await this.sendDLQAlert(dlqCount, unnotifiedJobs);

        // Mark jobs as notified
        for (const job of unnotifiedJobs) {
          await database.markDLQJobNotified(job.job_id);
        }

      }
    } catch (error) {
      console.error('[RetryWorker] DLQ threshold check failed:', error);
    }
  }

  /**
   * Send DLQ alert to admins
   * @param {number} dlqCount - Total DLQ count
   * @param {Array} jobs - Unnotified jobs
   */
  async sendDLQAlert(dlqCount, jobs) {
    try {
      const subject = `[NebulaProxy] Dead Letter Queue Alert`;
      const jobSummary = jobs.slice(0, 10).map(job => {
        return `- ${job.job_type} (${job.attempt_count} attempts): ${job.failure_reason}`;
      }).join('\n');

      const html = `
        <h2>Dead Letter Queue Alert</h2>
        <p><strong>Total jobs in DLQ:</strong> ${dlqCount}</p>
        <p><strong>Unnotified jobs:</strong> ${jobs.length}</p>
        <h3>Recent Failed Jobs:</h3>
        <pre>${jobSummary}</pre>
        <p>Please review the DLQ in the admin panel: <a href="${config.publicUrl}/admin/queue">Queue Management</a></p>
      `;

      // Get admin users
      const admins = await database.getAdminUsers();
      const adminEmails = admins.map(a => a.email).filter(Boolean);

      if (adminEmails.length === 0) {
        console.log('[RetryWorker] No admin emails configured, skipping DLQ alert');
        return;
      }

      // Send email WITHOUT retry (use skipRetry flag)
      // Use transporter directly to avoid queue loop
      if (emailNotificationService.isEnabled()) {
        await emailNotificationService.transporter.sendMail({
          from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
          to: adminEmails.join(', '),
          subject,
          html
        });
        console.log(`[RetryWorker] DLQ alert sent to ${adminEmails.length} admin(s)`);
      }

    } catch (error) {
      console.error('[RetryWorker] Failed to send DLQ alert:', error);
    }
  }
}

// Export singleton instance
export const retryWorker = new RetryWorker();
