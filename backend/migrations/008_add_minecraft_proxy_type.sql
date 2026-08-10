-- Migration 008: Add Minecraft proxy type
-- Add 'minecraft' to the proxy_type CHECK constraint

-- Drop existing CHECK constraint
ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_proxy_type_check;

-- Recreate constraint with 'minecraft' included
ALTER TABLE domains ADD CONSTRAINT domains_proxy_type_check
  CHECK(proxy_type IN ('http', 'tcp', 'udp', 'minecraft'));

-- Note: This migration allows creating domains with proxy_type='minecraft'
-- for Minecraft Java Edition proxy support with hostname-based routing
