-- Add custom HTML maintenance page per domain
-- When set, this overrides the default generated maintenance page

ALTER TABLE domains ADD COLUMN IF NOT EXISTS custom_maintenance_page TEXT;
