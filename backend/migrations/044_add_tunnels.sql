-- Tunnel control plane tables

CREATE TABLE IF NOT EXISTS tunnels (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  team_id INTEGER,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  provider VARCHAR(32) NOT NULL DEFAULT 'cloudflare',
  public_domain VARCHAR(255) NOT NULL DEFAULT 'nebula-app.dev',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'paused', 'revoked')),
  enrollment_code_hash TEXT,
  enrollment_code_expires_at TIMESTAMP,
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tunnels_user_id ON tunnels(user_id);
CREATE INDEX IF NOT EXISTS idx_tunnels_team_id ON tunnels(team_id);
CREATE INDEX IF NOT EXISTS idx_tunnels_status ON tunnels(status);

CREATE TABLE IF NOT EXISTS tunnel_agents (
  id SERIAL PRIMARY KEY,
  tunnel_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  platform VARCHAR(64),
  os_name VARCHAR(64),
  arch VARCHAR(64),
  version VARCHAR(32),
  status VARCHAR(20) NOT NULL DEFAULT 'offline' CHECK(status IN ('offline', 'online', 'revoked')),
  agent_token_hash TEXT,
  agent_token_last_used_at TIMESTAMP,
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tunnel_id) REFERENCES tunnels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tunnel_agents_tunnel_id ON tunnel_agents(tunnel_id);
CREATE INDEX IF NOT EXISTS idx_tunnel_agents_status ON tunnel_agents(status);

CREATE TABLE IF NOT EXISTS tunnel_bindings (
  id SERIAL PRIMARY KEY,
  tunnel_id INTEGER NOT NULL,
  agent_id INTEGER,
  label VARCHAR(255) NOT NULL,
  protocol VARCHAR(10) NOT NULL DEFAULT 'tcp' CHECK(protocol IN ('tcp', 'udp')),
  local_port INTEGER NOT NULL,
  public_port INTEGER NOT NULL UNIQUE,
  public_hostname VARCHAR(255) NOT NULL UNIQUE,
  target_host VARCHAR(255) NOT NULL DEFAULT '127.0.0.1',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tunnel_id) REFERENCES tunnels(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES tunnel_agents(id) ON DELETE SET NULL,
  UNIQUE(tunnel_id, protocol, local_port)
);

CREATE INDEX IF NOT EXISTS idx_tunnel_bindings_tunnel_id ON tunnel_bindings(tunnel_id);
CREATE INDEX IF NOT EXISTS idx_tunnel_bindings_public_port ON tunnel_bindings(public_port);
CREATE INDEX IF NOT EXISTS idx_tunnel_bindings_public_hostname ON tunnel_bindings(public_hostname);

CREATE TABLE IF NOT EXISTS tunnel_access (
  id SERIAL PRIMARY KEY,
  tunnel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'view' CHECK(role IN ('view', 'manage')),
  granted_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tunnel_id) REFERENCES tunnels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(tunnel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tunnel_access_tunnel_id ON tunnel_access(tunnel_id);
CREATE INDEX IF NOT EXISTS idx_tunnel_access_user_id ON tunnel_access(user_id);
