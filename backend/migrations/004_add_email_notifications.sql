-- Add email notification support
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE team_notification_settings
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN DEFAULT FALSE;
