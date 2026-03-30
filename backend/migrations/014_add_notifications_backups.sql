-- Migration: Add notifications and backups configuration
-- Created: 2026-02-01

-- Backups table (system_config already exists from migration 013)
CREATE TABLE IF NOT EXISTS backups (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  filepath VARCHAR(500) NOT NULL,
  size BIGINT DEFAULT 0,
  type VARCHAR(20) DEFAULT 'manual', -- 'manual' or 'auto'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on backups for faster queries
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(type);

-- Insert default notification config if not exists (using existing system_config structure)
INSERT INTO system_config (key, value, updated_at)
VALUES (
  'notification_config',
  '{"email":{"enabled":false,"smtp_host":"","smtp_port":587,"smtp_user":"","smtp_password":"","from_email":"","to_emails":""},"webhook":{"enabled":false,"url":"","secret":""},"alerts":{"certificate_expiry_days":7,"domain_down_enabled":true,"high_cpu_threshold":80,"high_memory_threshold":85,"disk_space_threshold":90,"failed_backup_enabled":true}}',
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;

-- Insert default backup schedule if not exists
INSERT INTO system_config (key, value, updated_at)
VALUES (
  'backup_schedule',
  '{"enabled":false,"frequency":"daily","time":"02:00","retention_days":30}',
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;

-- Add comments
COMMENT ON TABLE backups IS 'Tracks database backups (manual and automatic)';
