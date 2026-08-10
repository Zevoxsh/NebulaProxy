-- Resolved client country (ISO 3166-1 alpha-2) per logged request, so the
-- per-domain logs view can show where traffic is actually coming from
-- without an on-the-fly lookup in the UI.

ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS country VARCHAR(2);
CREATE INDEX IF NOT EXISTS idx_request_logs_country ON request_logs(country);
