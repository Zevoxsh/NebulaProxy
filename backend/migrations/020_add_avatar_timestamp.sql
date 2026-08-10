-- Add avatar_updated_at timestamp to track when avatar was last changed
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Set initial value for existing users
UPDATE users SET avatar_updated_at = CURRENT_TIMESTAMP WHERE avatar_updated_at IS NULL;
