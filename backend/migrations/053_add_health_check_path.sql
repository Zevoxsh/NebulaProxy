-- Per-domain HTTP health check path (defaults to '/' when not set)
-- Lets domains that don't return a usable response on '/' (e.g. redirects,
-- auth-gated root) point the active health checker at a dedicated endpoint
-- such as '/status' or '/healthz' instead.

ALTER TABLE domains ADD COLUMN IF NOT EXISTS health_check_path TEXT;
