-- Add Two-Factor Authentication support (email OTP + TOTP)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS two_factor_method VARCHAR(16),
  ADD COLUMN IF NOT EXISTS two_factor_totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS user_two_factor_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(32) NOT NULL, -- login | enable_email | disable_email
  method VARCHAR(16) NOT NULL,  -- email
  code_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_two_factor_codes_lookup
  ON user_two_factor_codes(user_id, purpose, method, expires_at);

CREATE INDEX IF NOT EXISTS idx_user_two_factor_codes_active
  ON user_two_factor_codes(user_id, consumed_at, expires_at);

