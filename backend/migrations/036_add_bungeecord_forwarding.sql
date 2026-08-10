-- Migration 036: Add BungeeCord IP forwarding option for Minecraft domains
ALTER TABLE domains ADD COLUMN IF NOT EXISTS bungeecord_forwarding BOOLEAN DEFAULT FALSE;
