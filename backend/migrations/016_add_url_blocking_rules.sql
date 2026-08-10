-- Migration: Add URL blocking rules table
-- Description: Add comprehensive URL path blocking with pattern matching support

CREATE TABLE IF NOT EXISTS url_blocking_rules (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,

  -- Pattern matching
  pattern TEXT NOT NULL,
  pattern_type VARCHAR(20) NOT NULL DEFAULT 'exact'
    CHECK(pattern_type IN ('exact', 'prefix', 'regex', 'wildcard')),

  -- Action
  action VARCHAR(20) NOT NULL DEFAULT 'block'
    CHECK(action IN ('block', 'allow')),

  -- Response configuration
  response_code INTEGER NOT NULL DEFAULT 403,
  response_message TEXT,

  -- Priority and status
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN DEFAULT TRUE,

  -- Metadata
  description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_domain_pattern UNIQUE(domain_id, pattern, pattern_type)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_url_rules_domain_active ON url_blocking_rules(domain_id, is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_url_rules_pattern ON url_blocking_rules(pattern);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_url_blocking_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_url_blocking_rules_updated_at ON url_blocking_rules;
CREATE TRIGGER trigger_update_url_blocking_rules_updated_at
BEFORE UPDATE ON url_blocking_rules
FOR EACH ROW
EXECUTE FUNCTION update_url_blocking_rules_updated_at();
