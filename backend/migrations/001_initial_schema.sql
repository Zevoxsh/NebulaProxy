-- NebulaProxy - Migration initiale PostgreSQL
-- Création de toutes les tables avec leur schéma complet

-- ============================================================================
-- Table: users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(20) NOT NULL CHECK(role IN ('admin', 'user')),
  max_domains INTEGER DEFAULT 5,
  max_proxies INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- ============================================================================
-- Table: teams
-- ============================================================================
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  owner_id INTEGER NOT NULL,
  max_domains INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teams_owner_id ON teams(owner_id);

-- ============================================================================
-- Table: team_members
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role VARCHAR(20) DEFAULT 'member' CHECK(role IN ('owner', 'member')),
  can_manage_domains INTEGER DEFAULT 0,
  can_manage_members INTEGER DEFAULT 0,
  can_manage_settings INTEGER DEFAULT 0,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- ============================================================================
-- Table: team_invitations
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_invitations (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL,
  inviter_id INTEGER NOT NULL,
  invited_user_id INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
  can_manage_domains INTEGER DEFAULT 0,
  can_manage_members INTEGER DEFAULT 0,
  can_manage_settings INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(team_id, invited_user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_team_id ON team_invitations(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_invited_user_id ON team_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_status ON team_invitations(status);

-- ============================================================================
-- Table: domains
-- ============================================================================
CREATE TABLE IF NOT EXISTS domains (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  team_id INTEGER,
  hostname VARCHAR(255) NOT NULL UNIQUE,
  backend_url TEXT NOT NULL,
  backend_port VARCHAR(10),
  description TEXT,
  proxy_type VARCHAR(10) DEFAULT 'http' CHECK(proxy_type IN ('http', 'tcp', 'udp')),
  external_port INTEGER,
  ssl_enabled BOOLEAN DEFAULT FALSE,
  ssl_status VARCHAR(20) DEFAULT 'disabled',
  ssl_cert_path TEXT,
  ssl_key_path TEXT,
  ssl_expires_at TIMESTAMP,
  acme_challenge_type VARCHAR(10) DEFAULT 'http-01',
  dns_validation_token TEXT,
  dns_validation_domain TEXT,
  dns_validation_status VARCHAR(20),
  dns_validation_expires_at TIMESTAMP,
  is_wildcard BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_domains_hostname ON domains(hostname);
CREATE INDEX IF NOT EXISTS idx_domains_user_id ON domains(user_id);
CREATE INDEX IF NOT EXISTS idx_domains_team_id ON domains(team_id);
CREATE INDEX IF NOT EXISTS idx_domains_is_active ON domains(is_active);
CREATE INDEX IF NOT EXISTS idx_domains_ssl_enabled ON domains(ssl_enabled);

-- ============================================================================
-- Table: audit_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  details TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- ============================================================================
-- Table: proxy_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS proxy_logs (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER,
  hostname VARCHAR(255),
  method VARCHAR(10),
  path TEXT,
  status INTEGER,
  response_time INTEGER,
  ip_address VARCHAR(45),
  user_agent TEXT,
  level VARCHAR(20) CHECK(level IN ('success', 'info', 'warning', 'error')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_proxy_logs_domain_id ON proxy_logs(domain_id);
CREATE INDEX IF NOT EXISTS idx_proxy_logs_created_at ON proxy_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_proxy_logs_level ON proxy_logs(level);
CREATE INDEX IF NOT EXISTS idx_proxy_logs_hostname ON proxy_logs(hostname);

-- ============================================================================
-- Table: health_checks
-- ============================================================================
CREATE TABLE IF NOT EXISTS health_checks (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER NOT NULL,
  status VARCHAR(20) CHECK(status IN ('success', 'failed')) NOT NULL,
  response_time INTEGER,
  status_code INTEGER,
  error_message TEXT,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_health_checks_domain_id ON health_checks(domain_id);
CREATE INDEX IF NOT EXISTS idx_health_checks_checked_at ON health_checks(checked_at);

-- ============================================================================
-- Table: domain_health_status
-- ============================================================================
CREATE TABLE IF NOT EXISTS domain_health_status (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER NOT NULL UNIQUE,
  current_status VARCHAR(20) CHECK(current_status IN ('up', 'down', 'unknown')) DEFAULT 'unknown',
  last_checked_at TIMESTAMP,
  last_status_change_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  consecutive_failures INTEGER DEFAULT 0,
  consecutive_successes INTEGER DEFAULT 0,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_domain_health_status_domain_id ON domain_health_status(domain_id);

-- ============================================================================
-- Table: custom_headers
-- ============================================================================
CREATE TABLE IF NOT EXISTS custom_headers (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER NOT NULL,
  header_name VARCHAR(255) NOT NULL,
  header_value TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_headers_domain_id ON custom_headers(domain_id);

-- ============================================================================
-- Table: cache_settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS cache_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT TRUE,
  default_ttl INTEGER DEFAULT 3600,
  max_age INTEGER DEFAULT 86400,
  stale_while_revalidate BOOLEAN DEFAULT TRUE,
  bypass_query_string BOOLEAN DEFAULT FALSE,
  cacheable_content_types TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================================
-- Table: cdn_settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS cdn_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT TRUE,
  auto_minify_html BOOLEAN DEFAULT TRUE,
  auto_minify_css BOOLEAN DEFAULT TRUE,
  auto_minify_js BOOLEAN DEFAULT TRUE,
  compression_gzip BOOLEAN DEFAULT TRUE,
  compression_brotli BOOLEAN DEFAULT TRUE,
  image_optimization BOOLEAN DEFAULT TRUE,
  http2_enabled BOOLEAN DEFAULT TRUE,
  http3_enabled BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================================
-- Table: notification_settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  discord_webhook_url TEXT,
  notifications_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_settings_user_id ON notification_settings(user_id);

-- ============================================================================
-- Triggers pour updated_at automatique
-- ============================================================================

-- Fonction pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Appliquer aux tables concernées
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_domains_updated_at BEFORE UPDATE ON domains
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cache_settings_updated_at BEFORE UPDATE ON cache_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cdn_settings_updated_at BEFORE UPDATE ON cdn_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_settings_updated_at BEFORE UPDATE ON notification_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Fin de la migration initiale
-- ============================================================================
