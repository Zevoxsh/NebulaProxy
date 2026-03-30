-- Migration: Add request_logs table for detailed HTTP request logging
-- Created: 2025-12-29

CREATE TABLE IF NOT EXISTS request_logs (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  hostname VARCHAR(255) NOT NULL,

  -- Request details
  method VARCHAR(10) NOT NULL,
  path TEXT NOT NULL,
  query_string TEXT,

  -- Response details
  status_code INTEGER,
  response_time INTEGER, -- milliseconds
  response_size INTEGER, -- bytes

  -- Client details
  ip_address VARCHAR(45),
  user_agent TEXT,
  referer TEXT,

  -- Request headers (JSON)
  request_headers JSONB,

  -- Response headers (JSON)
  response_headers JSONB,

  -- Error details
  error_message TEXT,

  -- Timestamps
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_request_logs_domain_id ON request_logs(domain_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_hostname ON request_logs(hostname);
CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_status_code ON request_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_request_logs_method ON request_logs(method);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_request_logs_domain_timestamp ON request_logs(domain_id, timestamp DESC);

-- Partial index for errors
CREATE INDEX IF NOT EXISTS idx_request_logs_errors ON request_logs(domain_id, timestamp DESC) WHERE status_code >= 400;

COMMENT ON TABLE request_logs IS 'Detailed HTTP request logs for each domain';
COMMENT ON COLUMN request_logs.response_time IS 'Response time in milliseconds';
COMMENT ON COLUMN request_logs.response_size IS 'Response size in bytes';
