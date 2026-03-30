-- Migration 037: Add Velocity modern IP forwarding for Minecraft domains
ALTER TABLE domains ADD COLUMN IF NOT EXISTS velocity_secret TEXT;
