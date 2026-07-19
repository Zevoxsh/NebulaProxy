-- Per-domain toggle to opt out of up/down health monitoring entirely.
-- When disabled, the domain is skipped by the health check loop: no probes,
-- no health_checks rows, no domain up/down notifications.
ALTER TABLE domains ADD COLUMN IF NOT EXISTS health_check_enabled BOOLEAN DEFAULT TRUE;
