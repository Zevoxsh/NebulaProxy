-- Migration: Add team activity notifications
-- ============================================================================

-- Create notifications table for team activities
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  entity_name VARCHAR(255),
  message TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_team_id ON notifications(team_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);

-- Add comments
COMMENT ON TABLE notifications IS 'Team activity notifications for users';
COMMENT ON COLUMN notifications.user_id IS 'User who receives the notification';
COMMENT ON COLUMN notifications.team_id IS 'Team related to the notification';
COMMENT ON COLUMN notifications.actor_id IS 'User who performed the action';
COMMENT ON COLUMN notifications.action_type IS 'Type of action (domain_added, member_added, etc.)';
COMMENT ON COLUMN notifications.entity_type IS 'Type of entity affected (domain, member, etc.)';
COMMENT ON COLUMN notifications.entity_id IS 'ID of the affected entity';
COMMENT ON COLUMN notifications.entity_name IS 'Name of the affected entity for display';
COMMENT ON COLUMN notifications.message IS 'Human-readable notification message';
COMMENT ON COLUMN notifications.read_at IS 'Timestamp when notification was read (NULL = unread)';
