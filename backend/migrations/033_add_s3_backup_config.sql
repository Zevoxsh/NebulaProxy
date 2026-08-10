-- Migration 033: Add S3 backup configuration
-- Stores MinIO / AWS S3 credentials and settings for automatic cloud backups.

-- Insert S3 backup config with MinIO credentials (enabled by default)
INSERT INTO system_config (key, value, updated_at)
VALUES (
  's3_backup_config',
  '{
    "enabled": true,
    "endpoint": "https://s3.paxcia.net",
    "region": "us-east-1",
    "access_key": "backup-user",
    "secret_key": "Byakuraisthebest1602007@@",
    "bucket": "nebula",
    "prefix": "backups/",
    "retention_count": 7
  }',
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;

-- Enable automatic daily backup at 02:00 (every 24 h) if not already configured
INSERT INTO system_config AS sc (key, value, updated_at)
VALUES (
  'backup_schedule',
  '{"enabled":true,"frequency":"daily","time":"02:00","retention_days":30}',
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO UPDATE
  SET value = CASE
    WHEN (sc.value::jsonb)->>'enabled' = 'false'
    THEN '{"enabled":true,"frequency":"daily","time":"02:00","retention_days":30}'
    ELSE sc.value
  END,
  updated_at = CURRENT_TIMESTAMP;

-- Track S3 uploads in the existing backups table
ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS s3_key         VARCHAR(500),
  ADD COLUMN IF NOT EXISTS s3_bucket      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS uploaded_to_s3 BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_backups_s3 ON backups(uploaded_to_s3) WHERE uploaded_to_s3 = TRUE;

COMMENT ON COLUMN backups.s3_key         IS 'S3 object key of the uploaded backup';
COMMENT ON COLUMN backups.s3_bucket      IS 'S3 bucket name where the backup was stored';
COMMENT ON COLUMN backups.uploaded_to_s3 IS 'TRUE once the backup has been successfully uploaded to S3';
