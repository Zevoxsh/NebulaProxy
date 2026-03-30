-- Admin panel access PIN (4 digits)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS admin_pin_set_at TIMESTAMP;
