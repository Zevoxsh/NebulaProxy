-- Migration 012: Add Retry Queue System
-- Description: Creates tables for Dead Letter Queue and retry job audit trail

-- Dead Letter Queue table for failed jobs
CREATE TABLE IF NOT EXISTS job_dead_letter_queue (
  id SERIAL PRIMARY KEY,
  job_id UUID NOT NULL UNIQUE,
  job_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  attempt_count INTEGER DEFAULT 0,
  failure_reason TEXT,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  failed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notified_admin BOOLEAN DEFAULT FALSE
);

-- Indexes for DLQ table
CREATE INDEX IF NOT EXISTS idx_dlq_job_type ON job_dead_letter_queue(job_type);
CREATE INDEX IF NOT EXISTS idx_dlq_created_at ON job_dead_letter_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_dlq_notified_admin ON job_dead_letter_queue(notified_admin);
CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON job_dead_letter_queue(failed_at);

-- Retry job audit log for tracking all retry attempts
CREATE TABLE IF NOT EXISTS retry_job_audit (
  id SERIAL PRIMARY KEY,
  job_id UUID NOT NULL,
  job_type VARCHAR(50) NOT NULL,
  attempt_number INTEGER,
  status VARCHAR(20),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit table
CREATE INDEX IF NOT EXISTS idx_retry_audit_job_id ON retry_job_audit(job_id);
CREATE INDEX IF NOT EXISTS idx_retry_audit_created_at ON retry_job_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_retry_audit_status ON retry_job_audit(status);

-- Add comment for documentation
COMMENT ON TABLE job_dead_letter_queue IS 'Stores jobs that failed after max retry attempts (48 retries over 24 hours)';
COMMENT ON TABLE retry_job_audit IS 'Audit trail of all retry job attempts for debugging and analytics';
