-- Add persistent lockout controls for admin PIN brute-force protection.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_pin_locked_until TIMESTAMP;

COMMENT ON COLUMN users.admin_pin_failed_attempts IS 'Number of consecutive failed admin PIN verification attempts.';
COMMENT ON COLUMN users.admin_pin_locked_until IS 'Timestamp until which admin PIN verification is locked.';

