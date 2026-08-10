-- Add operator and viewer roles to the users table.
--
-- operator : can view everything, manage domains/SSL/proxies, cannot manage users or global config
-- viewer   : read-only access to their own resources
--
-- Existing CHECK constraint must be dropped and recreated (PostgreSQL limitation).

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'operator', 'viewer', 'user'));

-- Permissions table: maps role → allowed action namespaces.
-- This makes future role changes a data change, not a code change.
CREATE TABLE IF NOT EXISTS role_permissions (
  role        VARCHAR(20)  NOT NULL,
  namespace   VARCHAR(60)  NOT NULL,   -- e.g. 'domains.read', 'users.write', 'admin.all'
  PRIMARY KEY (role, namespace)
);

-- Seed default permissions (idempotent)
INSERT INTO role_permissions (role, namespace) VALUES
  -- admin: everything
  ('admin',    'admin.all'),

  -- operator: read + write on proxy resources, read-only on system
  ('operator', 'domains.read'),
  ('operator', 'domains.write'),
  ('operator', 'ssl.read'),
  ('operator', 'ssl.write'),
  ('operator', 'redirections.read'),
  ('operator', 'redirections.write'),
  ('operator', 'monitoring.read'),
  ('operator', 'analytics.read'),
  ('operator', 'logs.read'),
  ('operator', 'teams.read'),

  -- viewer: read-only on everything except admin
  ('viewer',   'domains.read'),
  ('viewer',   'ssl.read'),
  ('viewer',   'redirections.read'),
  ('viewer',   'monitoring.read'),
  ('viewer',   'analytics.read'),
  ('viewer',   'logs.read'),
  ('viewer',   'teams.read'),

  -- user: current default (full access to own resources)
  ('user',     'domains.read'),
  ('user',     'domains.write'),
  ('user',     'ssl.read'),
  ('user',     'ssl.write'),
  ('user',     'redirections.read'),
  ('user',     'redirections.write'),
  ('user',     'monitoring.read'),
  ('user',     'analytics.read'),
  ('user',     'logs.read'),
  ('user',     'teams.read'),
  ('user',     'teams.write')
ON CONFLICT DO NOTHING;
