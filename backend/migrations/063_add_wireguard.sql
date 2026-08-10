-- WireGuard VPN tunnels (client or server mode) for site-to-site connectivity.

CREATE TABLE IF NOT EXISTS wireguard_tunnels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  mode VARCHAR(16) NOT NULL DEFAULT 'server' CHECK (mode IN ('client', 'server')),
  interface_name VARCHAR(16) NOT NULL UNIQUE,
  private_key TEXT NOT NULL,
  public_key VARCHAR(64) NOT NULL,
  address VARCHAR(64) NOT NULL,
  listen_port INTEGER,
  mtu INTEGER,
  dns VARCHAR(255),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wireguard_tunnels_interface ON wireguard_tunnels(interface_name);

CREATE TABLE IF NOT EXISTS wireguard_peers (
  id SERIAL PRIMARY KEY,
  tunnel_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  public_key VARCHAR(64) NOT NULL,
  preshared_key TEXT,
  allowed_ips TEXT NOT NULL,
  endpoint_host VARCHAR(255),
  endpoint_port INTEGER,
  persistent_keepalive INTEGER,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tunnel_id) REFERENCES wireguard_tunnels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wireguard_peers_tunnel_id ON wireguard_peers(tunnel_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wireguard_peers_pubkey_per_tunnel ON wireguard_peers(tunnel_id, public_key);
