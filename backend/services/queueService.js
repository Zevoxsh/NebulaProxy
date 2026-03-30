import { v4 as uuidv4 } from 'uuid';
import configManager from '../config/config-manager.js';
import { config } from '../config/config.js';

/**
 * Queue Service
 * Manages Redis-based retry queue for critical services (Email, Discord, ACME)
 *
 * Queue Structure:
 * - nebulaproxy:queue:pending (Sorted Set): Jobs waiting for retry (score = nextRetryAt timestamp)
 * - nebulaproxy:queue:job:{jobId} (Hash): Job details with TTL
 * - nebulaproxy:queue:processing (Set): Jobs currently being processed (lock mechanism)
 */
class QueueService {
  constructor() {
    this.redis = null;
    this.PENDING_KEY = 'nebulaproxy:queue:pending';
    this.PROCESSING_KEY = 'nebulaproxy:queue:processing';
    this.initialized = false;
  }

  /**
   * Initialize queue service with Redis connection
   */
  async init() {
    if (this.initialized) {
      console.log('[Queue] Already initialized');
      return;
    }

    this.redis = configManager.redis;
    if (!this.redis) {
      throw new Error('[Queue] Redis connection not available');
    }

    this.initialized = true;
    console.log('[Queue] Initialized successfully');
  }

  /**
   * Enqueue a job for retry
   * @param {string} jobType - Type of job: 'email', 'discord', 'acme'
   * @param {object} payload - Job payload (service-specific data)
   * @param {object} options - Optional settings (maxAttempts, skipRetry)
   * @returns {string} Job ID
   */
  async enqueue(jobType, payload, options = {}) {
    if (!this.initialized) {
      console.error('[Queue] Not initialized, cannot enqueue');
      return null;
    }

    // Skip retry if flag set (for DLQ alerts to avoid loops)
    if (options.skipRetry) {
      console.log(`[Queue] Skipping retry for ${jobType} job (skipRetry flag)`);
      return null;
    }

    const jobId = uuidv4();
    const now = Date.now();
    const retryInterval = config.queue.retryIntervalMinutes * 60 * 1000;
    const nextRetryAt = now + retryInterval;
    const ttl = config.queue.jobTtlHours * 3600;

    const job = {
      id: jobId,
      type: jobType,
      payload: JSON.stringify(payload),
      attemptCount: '0',
      maxAttempts: String(options.maxAttempts || config.queue.maxAttempts),
      createdAt: new Date(now).toISOString(),
      nextRetryAt: new Date(nextRetryAt).toISOString(),
      lastError: ''
    };

    try {
      // Store job details as hash with TTL
      const jobKey = `nebulaproxy:queue:job:${jobId}`;
      await this.redis.hmset(jobKey, job);
      await this.redis.expire(jobKey, ttl);

      // Add to pending sorted set (score = nextRetryAt timestamp)
      await this.redis.zadd(this.PENDING_KEY, nextRetryAt, jobId);

      // Audit log
      const { database } = await import('./database.js');
      await database.insertRetryAudit(jobId, jobType, 0, 'queued', null);

      console.log(`[Queue] Enqueued ${jobType} job ${jobId} for retry in ${config.queue.retryIntervalMinutes}min`);
      return jobId;
    } catch (error) {
      console.error(`[Queue] Failed to enqueue job: ${error.message}`);
      return null;
    }
  }

  /**
   * Dequeue jobs ready for processing
   * @param {number} limit - Maximum number of jobs to retrieve
   * @returns {Array<string>} Array of job IDs
   */
  async dequeue(limit = 10) {
    if (!this.initialized) {
      return [];
    }

    try {
      const now = Date.now();

      // Get jobs with score <= now (ready for processing)
      const jobIds = await this.redis.zrangebyscore(
        this.PENDING_KEY,
        '-inf',
        now,
        'LIMIT', 0, limit
      );

      return jobIds || [];
    } catch (error) {
      console.error(`[Queue] Failed to dequeue jobs: ${error.message}`);
      return [];
    }
  }

  /**
   * Mark job as processing (atomic lock)
   * @param {string} jobId - Job ID
   * @returns {boolean} True if locked successfully, false if already locked
   */
  async markProcessing(jobId) {
    if (!this.initialized) {
      return false;
    }

    try {
      // Remove from pending set (returns 1 if removed, 0 if not found)
      const removed = await this.redis.zrem(this.PENDING_KEY, jobId);
      if (removed === 0) {
        return false; // Already processed by another worker
      }

      // Add to processing set with 5-minute safety timeout
      await this.redis.sadd(this.PROCESSING_KEY, jobId);
      await this.redis.expire(`${this.PROCESSING_KEY}:${jobId}`, 300);

      return true;
    } catch (error) {
      console.error(`[Queue] Failed to mark job ${jobId} as processing: ${error.message}`);
      return false;
    }
  }

  /**
   * Mark job as successfully completed
   * @param {string} jobId - Job ID
   */
  async markSuccess(jobId) {
    if (!this.initialized) {
      return;
    }

    try {
      // Remove from processing set
      await this.redis.srem(this.PROCESSING_KEY, jobId);

      // Delete job data
      await this.redis.del(`nebulaproxy:queue:job:${jobId}`);

      // Audit log
      const { database } = await import('./database.js');
      await database.insertRetryAudit(jobId, null, null, 'success', null);

      console.log(`[Queue] Job ${jobId} completed successfully`);
    } catch (error) {
      console.error(`[Queue] Failed to mark job ${jobId} as success: ${error.message}`);
    }
  }

  /**
   * Mark job for retry (increment attempt count and re-queue)
   * @param {string} jobId - Job ID
   * @param {Error} error - Error that caused retry
   */
  async markRetry(jobId, error) {
    if (!this.initialized) {
      return;
    }

    try {
      const jobKey = `nebulaproxy:queue:job:${jobId}`;
      const job = await this.redis.hgetall(jobKey);

      if (!job || !job.id) {
        console.error(`[Queue] Job ${jobId} not found for retry`);
        return;
      }

      const attemptCount = parseInt(job.attemptCount) + 1;
      const maxAttempts = parseInt(job.maxAttempts);

      // Check if max attempts reached
      if (attemptCount >= maxAttempts) {
        console.log(`[Queue] Job ${jobId} exceeded max attempts (${attemptCount}/${maxAttempts})`);
        await this.moveToDLQ(jobId, 'Max attempts exceeded');
        return;
      }

      // Calculate next retry time
      const nextRetryAt = this.calculateNextRetry(attemptCount);

      // Update job
      await this.redis.hmset(jobKey, {
        attemptCount: String(attemptCount),
        nextRetryAt: new Date(nextRetryAt).toISOString(),
        lastError: error.message || 'Unknown error'
      });

      // Move back to pending queue
      await this.redis.srem(this.PROCESSING_KEY, jobId);
      await this.redis.zadd(this.PENDING_KEY, nextRetryAt, jobId);

      // Audit log
      const { database } = await import('./database.js');
      await database.insertRetryAudit(jobId, job.type, attemptCount, 'retry', error.message);

      console.log(`[Queue] Job ${jobId} retry ${attemptCount}/${maxAttempts} scheduled for ${new Date(nextRetryAt).toISOString()}`);
    } catch (err) {
      console.error(`[Queue] Failed to mark job ${jobId} for retry: ${err.message}`);
    }
  }

  /**
   * Move job to Dead Letter Queue (PostgreSQL)
   * @param {string} jobId - Job ID
   * @param {string} failureReason - Reason for moving to DLQ
   */
  async moveToDLQ(jobId, failureReason) {
    if (!this.initialized) {
      return;
    }

    try {
      const jobKey = `nebulaproxy:queue:job:${jobId}`;
      const job = await this.redis.hgetall(jobKey);

      if (!job || !job.id) {
        console.error(`[Queue] Job ${jobId} not found for DLQ`);
        return;
      }

      // Parse payload
      let payload = {};
      try {
        payload = JSON.parse(job.payload);
      } catch (e) {
        payload = { raw: job.payload };
      }

      // Insert to PostgreSQL DLQ
      const { database } = await import('./database.js');
      await database.insertJobToDLQ({
        jobId,
        jobType: job.type,
        payload,
        attemptCount: parseInt(job.attemptCount),
        failureReason,
        lastError: job.lastError || ''
      });

      // Remove from Redis
      await this.redis.srem(this.PROCESSING_KEY, jobId);
      await this.redis.del(jobKey);

      // Audit log
      await database.insertRetryAudit(jobId, job.type, job.attemptCount, 'failed', failureReason);

      console.log(`[Queue] Job ${jobId} moved to DLQ: ${failureReason}`);
    } catch (error) {
      console.error(`[Queue] Failed to move job ${jobId} to DLQ: ${error.message}`);
    }
  }

  /**
   * Calculate next retry timestamp
   * @param {number} attemptCount - Current attempt count
   * @returns {number} Timestamp in milliseconds
   */
  calculateNextRetry(attemptCount) {
    const retryIntervalMs = config.queue.retryIntervalMinutes * 60 * 1000;

    if (config.queue.useExponentialBackoff) {
      // Exponential backoff: 1min, 2min, 4min, 8min, 16min, 30min (capped)
      const backoffMs = Math.min(
        Math.pow(2, attemptCount) * 60000,
        retryIntervalMs
      );
      return Date.now() + backoffMs;
    }

    // Fixed interval
    return Date.now() + retryIntervalMs;
  }

  /**
   * Get queue statistics
   * @returns {object} Stats object
   */
  async getStats() {
    if (!this.initialized) {
      return { pendingCount: 0, processingCount: 0, dlqCount: 0 };
    }

    try {
      const pendingCount = await this.redis.zcard(this.PENDING_KEY);
      const processingCount = await this.redis.scard(this.PROCESSING_KEY);

      const { database } = await import('./database.js');
      const dlqCount = await database.getDLQCount();

      return {
        pendingCount: pendingCount || 0,
        processingCount: processingCount || 0,
        dlqCount: dlqCount || 0
      };
    } catch (error) {
      console.error(`[Queue] Failed to get stats: ${error.message}`);
      return { pendingCount: 0, processingCount: 0, dlqCount: 0 };
    }
  }

  /**
   * Clean up expired jobs (safety mechanism)
   * Should not be needed due to Redis TTL, but provides extra safety
   */
  async cleanup() {
    if (!this.initialized) {
      return;
    }

    try {
      // Remove jobs from processing set that are orphaned (older than 5 minutes)
      const processingJobs = await this.redis.smembers(this.PROCESSING_KEY);
      let cleanedCount = 0;

      for (const jobId of processingJobs) {
        const jobKey = `nebulaproxy:queue:job:${jobId}`;
        const exists = await this.redis.exists(jobKey);

        if (!exists) {
          // Job data expired but still in processing set - remove
          await this.redis.srem(this.PROCESSING_KEY, jobId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`[Queue] Cleaned up ${cleanedCount} orphaned jobs from processing set`);
      }
    } catch (error) {
      console.error(`[Queue] Cleanup failed: ${error.message}`);
    }
  }
}

// Export singleton instance
export const queueService = new QueueService();
