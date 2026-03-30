-- Migration: Add logo support for teams
-- ============================================================================

-- Add logo_url column to teams table
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);

-- Add logo_updated_at for cache busting (similar to user avatars)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMP;

-- Add comment
COMMENT ON COLUMN teams.logo_url IS 'URL to team logo image';
COMMENT ON COLUMN teams.logo_updated_at IS 'Timestamp for cache busting logo URLs';
