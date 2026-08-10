-- Tunnel access control lists

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
