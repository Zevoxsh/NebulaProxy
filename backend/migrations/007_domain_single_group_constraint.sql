-- ============================================================================
-- Migration 007: Ensure a domain can only be in ONE group at a time
-- ============================================================================
-- Description: Add UNIQUE constraint on domain_id in domain_group_assignments
--              to prevent a domain from being in multiple groups
-- ============================================================================

-- First, remove any duplicate assignments (keep only the most recent one per domain)
DELETE FROM domain_group_assignments
WHERE id NOT IN (
  SELECT MAX(id)
  FROM domain_group_assignments
  GROUP BY domain_id
);

-- Drop the old composite unique constraint
ALTER TABLE domain_group_assignments
DROP CONSTRAINT IF EXISTS domain_group_assignments_domain_id_group_id_key;

-- Add new UNIQUE constraint on domain_id only
-- This ensures one domain can only be in ONE group at a time
ALTER TABLE domain_group_assignments
ADD CONSTRAINT domain_group_assignments_domain_id_unique UNIQUE (domain_id);

-- Note: The old constraint prevented duplicate (domain, group) pairs
-- The new constraint prevents a domain from being in ANY multiple groups
