-- IPsec (IKEv2/PSK, strongSwan) site-to-site tunnels — client or server mode,
-- same shape as WireGuard tunnels (063) but one connection = one peer, since
-- that's how classic IPsec site-to-site is modeled (no peer sub-table).

CREATE TABLE IF NOT EXISTS ipsec_tunnels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  mode VARCHAR(16) NOT NULL DEFAULT 'server' CHECK (mode IN ('client', 'server')),
  conn_name VARCHAR(32) NOT NULL UNIQUE,
  local_id VARCHAR(255),
  remote_id VARCHAR(255),
  remote_addr VARCHAR(255),
  local_subnet TEXT NOT NULL,
  remote_subnet TEXT NOT NULL,
  ike_proposal VARCHAR(255) NOT NULL DEFAULT 'aes256-sha256-modp2048',
  esp_proposal VARCHAR(255) NOT NULL DEFAULT 'aes256-sha256',
  psk TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ipsec_tunnels_conn_name ON ipsec_tunnels(conn_name);
