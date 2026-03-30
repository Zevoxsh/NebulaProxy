-- Migration 035: Allow same hostname for different proxy types
-- Changes the UNIQUE constraint on domains.hostname to a composite
-- UNIQUE on (hostname, proxy_type), so mc.paxcia.net can exist as
-- both an HTTP proxy and a Minecraft proxy simultaneously.

-- Drop the existing single-column unique constraint
ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_hostname_key;

-- Add composite unique constraint
ALTER TABLE domains ADD CONSTRAINT domains_hostname_proxytype_unique UNIQUE (hostname, proxy_type);
