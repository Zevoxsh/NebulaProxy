-- WebAuthn passkeys storage

CREATE TABLE IF NOT EXISTS user_passkeys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255),
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports JSONB,
  device_type VARCHAR(32),
  backed_up BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user
  ON user_passkeys(user_id);
