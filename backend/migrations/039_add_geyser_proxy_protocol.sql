-- Migration 039: Add Geyser PROXY Protocol v2 support for UDP domains
-- Enables PROXY Protocol v2 header injection on the first UDP packet sent to Geyser,
-- so Geyser can read the real Bedrock client IP (requires use-proxy-protocol: true in Geyser config.yml).
ALTER TABLE domains ADD COLUMN IF NOT EXISTS geyser_proxy_protocol BOOLEAN DEFAULT FALSE;
