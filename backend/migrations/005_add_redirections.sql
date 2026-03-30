-- Migration: Add redirection support
-- Adds max_redirections to users table and creates redirections table

-- Add max_redirections column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_redirections INTEGER DEFAULT 10;

-- Create redirections table
CREATE TABLE IF NOT EXISTS redirections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  team_id INTEGER,
  short_code VARCHAR(255) NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  click_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_redirections_short_code ON redirections(short_code);
CREATE INDEX IF NOT EXISTS idx_redirections_user_id ON redirections(user_id);
CREATE INDEX IF NOT EXISTS idx_redirections_team_id ON redirections(team_id);
CREATE INDEX IF NOT EXISTS idx_redirections_is_active ON redirections(is_active);

-- Add trigger for updated_at
CREATE TRIGGER update_redirections_updated_at BEFORE UPDATE ON redirections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
