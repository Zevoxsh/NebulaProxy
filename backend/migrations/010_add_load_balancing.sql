-- NebulaProxy - Migration: Load Balancing Support
-- Allows multiple backend servers per domain with round-robin distribution

-- ============================================================================
-- Table: domain_backends
-- Stores multiple backend servers for load balancing
-- ============================================================================
CREATE TABLE IF NOT EXISTS domain_backends (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER NOT NULL,
  backend_url TEXT NOT NULL,
  backend_port VARCHAR(10),
  weight INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_domain_backends_domain_id ON domain_backends(domain_id);
CREATE INDEX IF NOT EXISTS idx_domain_backends_is_active ON domain_backends(is_active);

-- ============================================================================
-- Table: backend_health_status
-- Tracks health status per backend for intelligent routing
-- ============================================================================
CREATE TABLE IF NOT EXISTS backend_health_status (
  id SERIAL PRIMARY KEY,
  backend_id INTEGER NOT NULL UNIQUE,
  current_status VARCHAR(20) CHECK(current_status IN ('up', 'down', 'unknown')) DEFAULT 'unknown',
  last_checked_at TIMESTAMP,
  last_status_change_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  consecutive_failures INTEGER DEFAULT 0,
  consecutive_successes INTEGER DEFAULT 0,
  last_response_time INTEGER,
  FOREIGN KEY (backend_id) REFERENCES domain_backends(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backend_health_status_backend_id ON backend_health_status(backend_id);
CREATE INDEX IF NOT EXISTS idx_backend_health_status_current_status ON backend_health_status(current_status);

-- ============================================================================
-- Add load_balancing_enabled column to domains table
-- ============================================================================
ALTER TABLE domains ADD COLUMN IF NOT EXISTS load_balancing_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS load_balancing_algorithm VARCHAR(20) DEFAULT 'round-robin'
  CHECK(load_balancing_algorithm IN ('round-robin', 'random', 'least-connections', 'ip-hash'));

-- ============================================================================
-- Trigger for updated_at on domain_backends
-- ============================================================================
CREATE TRIGGER update_domain_backends_updated_at BEFORE UPDATE ON domain_backends
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- End of migration
-- ============================================================================
