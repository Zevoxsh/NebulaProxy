-- Per-domain toggle routing HTTP traffic through the Anubis anti-bot
-- challenge proxy (proof-of-work) before it reaches the backend.
ALTER TABLE domains ADD COLUMN IF NOT EXISTS antibot_enabled BOOLEAN DEFAULT FALSE;
