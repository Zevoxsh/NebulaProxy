-- cdn_settings was created in the initial schema but never exposed via any route.
-- Removing the dead table and its trigger to keep the schema clean.
DROP TRIGGER IF EXISTS update_cdn_settings_updated_at ON cdn_settings;
DROP TABLE IF EXISTS cdn_settings;
