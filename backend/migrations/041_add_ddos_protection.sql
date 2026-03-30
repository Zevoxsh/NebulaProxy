-- Per-domain DDoS protection toggle and thresholds
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ddos_protection_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ddos_req_per_second INTEGER DEFAULT 100;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ddos_connections_per_minute INTEGER DEFAULT 60;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ddos_ban_duration_sec INTEGER DEFAULT 3600;

-- Persistent IP ban table
CREATE TABLE IF NOT EXISTS ddos_ip_bans (
  id            BIGSERIAL PRIMARY KEY,
  ip_address    VARCHAR(45) NOT NULL,
  domain_id     INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL DEFAULT 'rate-limit',
  banned_by     VARCHAR(32) NOT NULL DEFAULT 'auto',
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ddos_ip_bans_ip  ON ddos_ip_bans(ip_address);
CREATE INDEX IF NOT EXISTS idx_ddos_ip_bans_exp ON ddos_ip_bans(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ddos_ip_bans_dom ON ddos_ip_bans(domain_id) WHERE domain_id IS NOT NULL;

-- Blocklist metadata table
CREATE TABLE IF NOT EXISTS ddos_blocklist_meta (
  source      VARCHAR(64) PRIMARY KEY,
  url         TEXT NOT NULL,
  last_fetched TIMESTAMPTZ,
  ip_count    INTEGER DEFAULT 0,
  last_error  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ddos_blocklist_meta (source, url) VALUES
  ('blocklist_de',     'https://lists.blocklist.de/lists/all.txt'),
  ('emerging_threats', 'https://rules.emergingthreats.net/blockrules/compromised-ips.txt'),
  ('ci_badguys',       'https://cinsscore.com/list/ci-badguys.txt')
ON CONFLICT (source) DO NOTHING;
