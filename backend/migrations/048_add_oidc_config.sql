-- OIDC / SSO configuration stored in system_config under key 'oidc_config'.
-- No extra table needed — uses the existing key-value store.
-- This migration creates the index for fast lookup and documents the expected shape.

-- Ensure the system_config table exists (it always should, but be safe)
CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert a disabled OIDC config placeholder so the admin UI can always read it
INSERT INTO system_config (key, value, updated_at)
VALUES (
  'oidc_config',
  '{"enabled":false,"issuer_url":"","client_id":"","client_secret":"","redirect_uri":"","scope":"openid email profile","role_claim":"","admin_group":"","auto_create_users":true}',
  NOW()
)
ON CONFLICT (key) DO NOTHING;
