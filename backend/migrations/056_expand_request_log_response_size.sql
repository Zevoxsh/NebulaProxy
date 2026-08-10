-- Migration: expand request_logs.response_size to BIGINT
-- Created: 2026-07-07

ALTER TABLE request_logs
  ALTER COLUMN response_size TYPE BIGINT
  USING response_size::BIGINT;

COMMENT ON COLUMN request_logs.response_size IS 'Response size in bytes';