-- Create default admin user if no admin exists
-- This will only run once during migration

DO $$
DECLARE
  admin_count INTEGER;
  default_password_hash TEXT;
BEGIN
  -- Check if any admin users exist
  SELECT COUNT(*) INTO admin_count FROM users WHERE role = 'admin';

  -- Only create default admin if no admin exists
  IF admin_count = 0 THEN
    -- Default password: "admin" - MUST BE CHANGED ON FIRST LOGIN
    -- Hash generated using: scrypt with salt '1234567890abcdef'
    default_password_hash := 'scrypt$1234567890abcdef$30d5078d009e954c799fe00cb0c48210d1794ae08af401f602b3a309996d59ad998fbd746822433568d272f3f0e9d504248cae9c57d4d0c36ab58f3d62eec384';

    INSERT INTO users (
      username,
      display_name,
      email,
      role,
      password_hash,
      is_active,
      max_domains,
      max_redirections,
      created_at
    ) VALUES (
      'admin',
      'Administrator',
      'admin@localhost',
      'admin',
      default_password_hash,
      true,
      -1,  -- Unlimited domains
      -1,  -- Unlimited redirections
      NOW()
    );

    RAISE NOTICE 'Default admin user created: username=admin, password=admin (PLEASE CHANGE THIS PASSWORD!)';
  ELSE
    RAISE NOTICE 'Admin user(s) already exist, skipping default admin creation';
  END IF;
END $$;

-- Add registration_enabled setting to system_config if not exists
INSERT INTO system_config (key, value, updated_at)
VALUES (
  'registration_enabled',
  'true',
  NOW()
)
ON CONFLICT (key) DO NOTHING;
