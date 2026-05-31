// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class QueueRepository {
// ==========================================
// Retry Queue & Dead Letter Queue Methods
// ==========================================

/**
 * Insert job to Dead Letter Queue
 * @param {object} job - Job object
 * @returns {void}
 */
async insertJobToDLQ(job) {
  await this.execute(`
    INSERT INTO job_dead_letter_queue (job_id, job_type, payload, attempt_count, failure_reason, last_error)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (job_id) DO UPDATE SET
      attempt_count = EXCLUDED.attempt_count,
      failure_reason = EXCLUDED.failure_reason,
      last_error = EXCLUDED.last_error,
      failed_at = CURRENT_TIMESTAMP
  `, [job.jobId, job.jobType, JSON.stringify(job.payload), job.attemptCount, job.failureReason, job.lastError]);
}

/**
 * Get jobs from Dead Letter Queue with optional filters
 * @param {object} filters - Filter criteria
 * @returns {Array} - Array of DLQ jobs
 */
async getJobsFromDLQ(filters = {}) {
  let query = 'SELECT * FROM job_dead_letter_queue';
  const conditions = [];
  const values = [];

  if (filters.jobType) {
    conditions.push(`job_type = $${values.length + 1}`);
    values.push(filters.jobType);
  }
  if (filters.notifiedAdmin !== undefined) {
    conditions.push(`notified_admin = $${values.length + 1}`);
    values.push(filters.notifiedAdmin);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY failed_at DESC LIMIT 100';

  const result = await this.execute(query, values);
  return result.rows || [];
}

/**
 * Get Dead Letter Queue count
 * @returns {number} - Count of jobs in DLQ
 */
async getDLQCount() {
  const result = await this.execute('SELECT COUNT(*) as count FROM job_dead_letter_queue');
  return parseInt(result.rows[0]?.count || 0, 10);
}

/**
 * Retry job from Dead Letter Queue (remove from DLQ and return job data)
 * @param {string} jobId - Job ID (UUID)
 * @returns {object|null} - Job data or null if not found
 */
async retryJobFromDLQ(jobId) {
  const result = await this.execute('SELECT * FROM job_dead_letter_queue WHERE job_id = $1', [jobId]);
  if (!result.rows || result.rows.length === 0) {
    return null;
  }

  const job = result.rows[0];
  await this.execute('DELETE FROM job_dead_letter_queue WHERE job_id = $1', [jobId]);

  return {
    jobType: job.job_type,
    payload: typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload
  };
}

/**
 * Delete job from Dead Letter Queue
 * @param {string} jobId - Job ID (UUID)
 * @returns {void}
 */
async deleteJobFromDLQ(jobId) {
  await this.execute('DELETE FROM job_dead_letter_queue WHERE job_id = $1', [jobId]);
}

/**
 * Mark DLQ job as notified (admin has been alerted)
 * @param {string} jobId - Job ID (UUID)
 * @returns {void}
 */
async markDLQJobNotified(jobId) {
  await this.execute('UPDATE job_dead_letter_queue SET notified_admin = TRUE WHERE job_id = $1', [jobId]);
}

/**
 * Insert retry job audit log entry
 * @param {string} jobId - Job ID (UUID)
 * @param {string} jobType - Job type
 * @param {number} attemptNumber - Attempt number
 * @param {string} status - Status (queued, processing, success, retry, failed)
 * @param {string} errorMessage - Error message if any
 * @returns {void}
 */
async insertRetryAudit(jobId, jobType, attemptNumber, status, errorMessage) {
  await this.execute(`
    INSERT INTO retry_job_audit (job_id, job_type, attempt_number, status, error_message)
    VALUES ($1, $2, $3, $4, $5)
  `, [jobId, jobType, attemptNumber, status, errorMessage]);
}

/**
 * Get retry audit log for a job
 * @param {string} jobId - Job ID (UUID)
 * @returns {Array} - Array of audit entries
 */
async getRetryAuditLog(jobId) {
  const result = await this.execute(
    'SELECT * FROM retry_job_audit WHERE job_id = $1 ORDER BY created_at ASC',
    [jobId]
  );
  return result.rows || [];
}

/**
 * Clean old DLQ entries (older than specified days)
 * @param {number} days - Number of days to keep (default: 90)
 * @returns {object} - Number of deleted records
 */
async cleanOldDLQEntries(days = 90) {
  const result = await this.execute(`
    DELETE FROM job_dead_letter_queue
    WHERE created_at < (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
  `, [days]);
  return { deleted: result.rowCount || 0 };
}

/**
 * Clean old retry audit entries (older than specified days)
 * @param {number} days - Number of days to keep (default: 90)
 * @returns {object} - Number of deleted records
 */
async cleanOldRetryAudit(days = 90) {
  const result = await this.execute(`
    DELETE FROM retry_job_audit
    WHERE created_at < (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
  `, [days]);
  return { deleted: result.rowCount || 0 };
}
}
