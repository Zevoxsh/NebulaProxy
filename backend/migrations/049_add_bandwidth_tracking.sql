-- Bandwidth tracking: per-user daily counters and quota enforcement.

-- Add bandwidth quota column to users (0 = unlimited)
ALTER TABLE users ADD COLUMN IF NOT EXISTS
  bandwidth_quota_bytes BIGINT NOT NULL DEFAULT 0;

-- Daily usage aggregates (flushed from Redis every 5 minutes)
CREATE TABLE IF NOT EXISTS bandwidth_usage (
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE         NOT NULL DEFAULT CURRENT_DATE,
  bytes_in    BIGINT       NOT NULL DEFAULT 0,
  bytes_out   BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_bandwidth_usage_date ON bandwidth_usage(date);
CREATE INDEX IF NOT EXISTS idx_bandwidth_usage_user  ON bandwidth_usage(user_id);
