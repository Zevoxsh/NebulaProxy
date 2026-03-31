-- Migration 042: Enhanced DDoS Protection
-- Adds whitelist, attack events, and per-domain advanced settings

-- Whitelist: IPs / CIDRs that bypass all DDoS protection
CREATE TABLE IF NOT EXISTS ddos_whitelist (
  id          SERIAL PRIMARY KEY,
  cidr        VARCHAR(50) NOT NULL UNIQUE,
  description TEXT        DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Attack event log (analytics, live feed)
CREATE TABLE IF NOT EXISTS ddos_attack_events (
  id           BIGSERIAL PRIMARY KEY,
  ip_address   VARCHAR(50)  NOT NULL,
  domain_id    INTEGER      REFERENCES domains(id) ON DELETE SET NULL,
  attack_type  VARCHAR(50)  NOT NULL,  -- 'blocklist','rate-limit','connections-per-minute','too-many-connections','behavioral-4xx','challenge-fail'
  details      JSONB        DEFAULT '{}',
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ddos_events_created ON ddos_attack_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ddos_events_ip      ON ddos_attack_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_ddos_events_domain  ON ddos_attack_events(domain_id);

-- New per-domain DDoS settings
ALTER TABLE domains
  ADD COLUMN IF NOT EXISTS ddos_max_connections_per_ip INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS ddos_challenge_mode         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ddos_ban_on_4xx_rate        BOOLEAN DEFAULT FALSE;
