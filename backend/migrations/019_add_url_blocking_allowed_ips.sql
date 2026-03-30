-- Migration: Add allowed IPs to URL blocking rules
-- Description: Store allowlist of IPs/CIDR ranges for URL blocking rules

ALTER TABLE url_blocking_rules
ADD COLUMN IF NOT EXISTS allowed_ips TEXT[];
