-- V3 Features Migration
-- Adds: maintenance mode, custom error pages, per-domain rate limiting,
--       traffic mirroring, sticky sessions, A/B test weights

-- Maintenance mode per domain
ALTER TABLE domains ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN DEFAULT FALSE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS maintenance_message TEXT DEFAULT 'Service en maintenance. Veuillez réessayer plus tard.';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS maintenance_end_time TIMESTAMPTZ;

-- Custom error pages per domain (HTML content)
ALTER TABLE domains ADD COLUMN IF NOT EXISTS custom_404_page TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS custom_502_page TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS custom_503_page TEXT;

-- Per-domain HTTP rate limiting
ALTER TABLE domains ADD COLUMN IF NOT EXISTS rate_limit_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS rate_limit_max INTEGER DEFAULT 100;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS rate_limit_window INTEGER DEFAULT 60;  -- seconds

-- Traffic mirroring (shadow proxying)
ALTER TABLE domains ADD COLUMN IF NOT EXISTS mirror_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS mirror_backend_url TEXT;

-- Sticky sessions (cookie-based)
ALTER TABLE domains ADD COLUMN IF NOT EXISTS sticky_sessions_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS sticky_sessions_ttl INTEGER DEFAULT 3600;  -- seconds

-- GeoIP blocking
ALTER TABLE domains ADD COLUMN IF NOT EXISTS geoip_blocking_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS geoip_blocked_countries TEXT[];  -- e.g. ARRAY['CN','RU']
ALTER TABLE domains ADD COLUMN IF NOT EXISTS geoip_allowed_countries TEXT[];  -- whitelist mode

-- A/B test weights on domain_backends (per backend)
ALTER TABLE domain_backends ADD COLUMN IF NOT EXISTS ab_weight INTEGER DEFAULT 50 CHECK (ab_weight >= 0 AND ab_weight <= 100);

-- Indexes for maintained fields
CREATE INDEX IF NOT EXISTS idx_domains_maintenance_mode ON domains(maintenance_mode) WHERE maintenance_mode = TRUE;
