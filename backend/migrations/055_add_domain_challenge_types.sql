-- Per-domain challenge type selection. NULL/empty means "use whatever the
-- admin has globally enabled" (backend/services/ddosProtectionService.js) —
-- a domain's selection is a further restriction on top of the global set,
-- not a replacement for it.

ALTER TABLE domains ADD COLUMN IF NOT EXISTS ddos_challenge_types TEXT[];
