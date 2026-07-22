-- Outgoing SOCKS5 proxy credentials

CREATE TABLE IF NOT EXISTS socks5_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  label VARCHAR(255) NOT NULL,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  throttle_bps BIGINT NOT NULL DEFAULT 2097152,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_socks5_credentials_user_id ON socks5_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_socks5_credentials_username ON socks5_credentials(username);
