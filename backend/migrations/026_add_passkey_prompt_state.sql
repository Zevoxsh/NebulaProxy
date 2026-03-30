-- Persist passkey prompt schedule per user.
-- If a user clicks "later", we snooze reminders for 30 days.

CREATE TABLE IF NOT EXISTS user_passkey_prompt_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  next_prompt_at TIMESTAMP,
  last_prompted_at TIMESTAMP,
  last_dismissed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_passkey_prompt_next
  ON user_passkey_prompt_state(next_prompt_at);
