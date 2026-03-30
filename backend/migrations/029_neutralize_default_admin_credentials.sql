-- Neutralize insecure bootstrap admin credentials created by migration 015.
-- This migration only targets the exact known bootstrap account fingerprint.

DO $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE users
  SET
    is_active = FALSE,
    updated_at = NOW()
  WHERE
    role = 'admin'
    AND username = 'admin'
    AND email = 'admin@localhost'
    AND password_hash = 'scrypt$1234567890abcdef$30d5078d009e954c799fe00cb0c48210d1794ae08af401f602b3a309996d59ad998fbd746822433568d272f3f0e9d504248cae9c57d4d0c36ab58f3d62eec384';

  GET DIAGNOSTICS affected_count = ROW_COUNT;

  IF affected_count > 0 THEN
    RAISE NOTICE 'Security hardening: disabled % insecure default admin account(s).', affected_count;
  ELSE
    RAISE NOTICE 'Security hardening: no insecure default admin account found.';
  END IF;
END $$;

