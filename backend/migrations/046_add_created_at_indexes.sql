-- Migration: Add missing indexes on created_at column
-- Issue: Analytics queries use created_at but indexes were on timestamp
-- This causes full table scans and 504 errors

-- Add indexes for created_at column (used by analytics)
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at DESC);

-- Composite index for the most common analytics query:
-- WHERE domain_id = ANY(?) AND created_at >= ?
CREATE INDEX IF NOT EXISTS idx_request_logs_domain_created_at ON request_logs(domain_id, created_at DESC);

-- Partial index for error filtering
CREATE INDEX IF NOT EXISTS idx_request_logs_errors_created_at ON request_logs(domain_id, created_at DESC) WHERE status_code >= 400;

COMMENT ON INDEX idx_request_logs_created_at IS 'Index for analytics queries filtering by created_at timestamp';
COMMENT ON INDEX idx_request_logs_domain_created_at IS 'Composite index for domain+created_at analytics queries (solves 504 errors)';
