-- Migration 038: Add PROXY Protocol support for Minecraft domains
-- Works natively with Paper (proxy-protocol: true) and Velocity (haproxy-protocol: true)
ALTER TABLE domains ADD COLUMN IF NOT EXISTS proxy_protocol BOOLEAN DEFAULT FALSE;
