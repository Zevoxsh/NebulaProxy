-- Per-domain Nebula Shield aggressiveness: 'lenient' | 'balanced' | 'strict'.
-- Controls base proof-of-work difficulty and whether known AI scrapers /
-- automation are denied outright vs hard-challenged.
ALTER TABLE domains ADD COLUMN IF NOT EXISTS antibot_mode VARCHAR(16) NOT NULL DEFAULT 'balanced';
