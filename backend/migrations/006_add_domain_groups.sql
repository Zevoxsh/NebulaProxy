-- ============================================================================
-- Migration 006: Add Domain Groups/Folders System
-- ============================================================================
-- Description: Create tables for organizing domains into groups/folders
--              Supports both personal and team groups with permissions
-- ============================================================================

-- Create domain_groups table
CREATE TABLE IF NOT EXISTS domain_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#9D4EDD',
  icon VARCHAR(50),
  user_id INTEGER,
  team_id INTEGER,
  created_by INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,

  -- A group is EITHER personal (user_id) OR team (team_id), not both
  CONSTRAINT check_group_ownership CHECK (
    (user_id IS NOT NULL AND team_id IS NULL) OR
    (user_id IS NULL AND team_id IS NOT NULL)
  )
);

-- Create indexes for domain_groups
CREATE INDEX IF NOT EXISTS idx_domain_groups_user_id ON domain_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_domain_groups_team_id ON domain_groups(team_id);
CREATE INDEX IF NOT EXISTS idx_domain_groups_created_by ON domain_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_domain_groups_is_active ON domain_groups(is_active);

-- Create domain_group_assignments table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS domain_group_assignments (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  assigned_by INTEGER NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES domain_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,

  -- Prevent duplicate assignments
  UNIQUE(domain_id, group_id)
);

-- Create indexes for domain_group_assignments
CREATE INDEX IF NOT EXISTS idx_domain_group_assignments_domain_id ON domain_group_assignments(domain_id);
CREATE INDEX IF NOT EXISTS idx_domain_group_assignments_group_id ON domain_group_assignments(group_id);

-- Create domain_group_members table (permissions for team group members)
CREATE TABLE IF NOT EXISTS domain_group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  can_manage_group BOOLEAN DEFAULT FALSE,
  can_assign_domains BOOLEAN DEFAULT FALSE,
  can_view_domains BOOLEAN DEFAULT TRUE,
  added_by INTEGER NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (group_id) REFERENCES domain_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE(group_id, user_id)
);

-- Create indexes for domain_group_members
CREATE INDEX IF NOT EXISTS idx_domain_group_members_group_id ON domain_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_domain_group_members_user_id ON domain_group_members(user_id);

-- Add trigger for updated_at on domain_groups
DROP TRIGGER IF EXISTS update_domain_groups_updated_at ON domain_groups;
CREATE TRIGGER update_domain_groups_updated_at
  BEFORE UPDATE ON domain_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
