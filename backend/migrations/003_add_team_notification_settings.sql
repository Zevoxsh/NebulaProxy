-- Add team notification settings
CREATE TABLE IF NOT EXISTS team_notification_settings (
  team_id INTEGER PRIMARY KEY,
  discord_webhook_url TEXT,
  notifications_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_notification_settings_team_id ON team_notification_settings(team_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_team_notification_settings_updated_at'
  ) THEN
    CREATE TRIGGER update_team_notification_settings_updated_at
    BEFORE UPDATE ON team_notification_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
