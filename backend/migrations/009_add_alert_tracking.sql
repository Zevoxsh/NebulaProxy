-- ============================================================================
-- Migration: Add alert tracking to domain_health_status
-- Description: Track when down alerts are sent to prevent spam and ensure
--              restoration alerts are only sent after down alerts
-- ============================================================================

-- Add alert_sent_at column to track when a down alert was sent
ALTER TABLE domain_health_status
ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMP DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN domain_health_status.alert_sent_at IS 'Timestamp when the last down alert was sent. NULL means no alert sent or service is up.';
