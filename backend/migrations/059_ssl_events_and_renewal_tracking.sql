-- ssl_events: audit trail for certificate lifecycle
CREATE TABLE IF NOT EXISTS ssl_events (
  id          BIGSERIAL PRIMARY KEY,
  domain_id   INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  event_type  VARCHAR(50) NOT NULL,  -- issued, renewed, renewal_failed, deleted, uploaded
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ssl_events_domain_id ON ssl_events(domain_id);
CREATE INDEX IF NOT EXISTS idx_ssl_events_created_at ON ssl_events(created_at DESC);

-- Renewal backoff tracking on domains
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_renewal_error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_last_renewal_attempt TIMESTAMPTZ;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_renewal_error TEXT;
