-- Multi-method Two-Factor Authentication support
-- Allows users to enable multiple 2FA methods simultaneously (email + TOTP).

CREATE TABLE IF NOT EXISTS user_two_factor_methods (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method VARCHAR(16) NOT NULL CHECK (method IN ('email', 'totp')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  totp_secret TEXT,
  enabled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, method)
);

CREATE INDEX IF NOT EXISTS idx_user_two_factor_methods_user
  ON user_two_factor_methods(user_id, enabled);

-- Backfill from legacy single-method columns if table is still empty for a user.
INSERT INTO user_two_factor_methods (user_id, method, enabled, totp_secret, enabled_at, created_at, updated_at)
SELECT
  id AS user_id,
  two_factor_method AS method,
  TRUE AS enabled,
  CASE WHEN two_factor_method = 'totp' THEN two_factor_totp_secret ELSE NULL END AS totp_secret,
  two_factor_enabled_at AS enabled_at,
  NOW() AS created_at,
  NOW() AS updated_at
FROM users
WHERE two_factor_enabled = TRUE
  AND two_factor_method IS NOT NULL
ON CONFLICT (user_id, method) DO NOTHING;
