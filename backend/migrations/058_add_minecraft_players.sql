-- Minecraft player tracking: username + full IP history per (domain, player).
-- Username uniqueness is case-insensitive (Minecraft account identity is
-- effectively case-insensitive) but we preserve the exact case last seen
-- for display, so lookups normalize to lowercase while `username` itself
-- stores the most recently observed casing.
CREATE TABLE IF NOT EXISTS mc_players (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  username VARCHAR(16) NOT NULL,
  username_lower VARCHAR(16) NOT NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain_id, username_lower)
);

CREATE INDEX IF NOT EXISTS idx_mc_players_domain_id ON mc_players(domain_id);

CREATE TABLE IF NOT EXISTS mc_player_ips (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES mc_players(id) ON DELETE CASCADE,
  ip_address VARCHAR(45) NOT NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (player_id, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_mc_player_ips_player_id ON mc_player_ips(player_id);
