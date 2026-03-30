-- 034: Add wildcard SSL certificates table
-- Stores wildcard certs (*.example.com) that auto-cover matching subdomains

CREATE TABLE IF NOT EXISTS wildcard_ssl_certs (
  id           SERIAL PRIMARY KEY,
  hostname     VARCHAR(255) NOT NULL UNIQUE,          -- e.g. *.example.com
  fullchain    TEXT         NOT NULL,
  private_key  TEXT         NOT NULL,
  issuer       VARCHAR(255) DEFAULT 'NebulaProxy Self-Signed',
  issued_at    TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  expires_at   TIMESTAMPTZ,
  cert_type    VARCHAR(20)  DEFAULT 'self-signed',    -- 'self-signed' | 'manual'
  auto_apply   BOOLEAN      DEFAULT TRUE,             -- auto-cover matching subdomains
  created_at   TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wildcard_ssl_certs_hostname ON wildcard_ssl_certs(hostname);
