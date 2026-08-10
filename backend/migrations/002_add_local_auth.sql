-- Add local authentication support (password hashes)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
