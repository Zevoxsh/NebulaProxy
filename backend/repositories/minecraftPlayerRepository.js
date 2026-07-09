// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class MinecraftPlayerRepository {
// ===== MINECRAFT PLAYER TRACKING =====

// Upsert player + IP history in one call. Username identity is
// case-insensitive (username_lower), but we keep the last-observed casing
// in `username` for display.
async upsertPlayerLogin(domainId, username, ipAddress) {
  const usernameLower = username.toLowerCase();

  const player = await this.queryOne(`
    INSERT INTO mc_players (domain_id, username, username_lower, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (domain_id, username_lower)
    DO UPDATE SET username = EXCLUDED.username, last_seen_at = CURRENT_TIMESTAMP
    RETURNING id
  `, [domainId, username, usernameLower]);

  await this.execute(`
    INSERT INTO mc_player_ips (player_id, ip_address, first_seen_at, last_seen_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (player_id, ip_address)
    DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP
  `, [player.id, ipAddress]);

  return player.id;
}

getPlayersByDomain(domainId, limit = 200) {
  return this.queryAll(`
    SELECT
      p.id,
      p.username,
      p.first_seen_at,
      p.last_seen_at,
      latest_ip.ip_address AS current_ip,
      ip_counts.ip_count
    FROM mc_players p
    LEFT JOIN LATERAL (
      SELECT ip_address FROM mc_player_ips
      WHERE player_id = p.id
      ORDER BY last_seen_at DESC
      LIMIT 1
    ) latest_ip ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS ip_count FROM mc_player_ips WHERE player_id = p.id
    ) ip_counts ON true
    WHERE p.domain_id = ?
    ORDER BY p.last_seen_at DESC
    LIMIT ?
  `, [domainId, limit]);
}

getPlayerByDomainAndUsername(domainId, username) {
  return this.queryOne(`
    SELECT * FROM mc_players WHERE domain_id = ? AND username_lower = ?
  `, [domainId, username.toLowerCase()]);
}

getPlayerIpHistory(playerId) {
  return this.queryAll(`
    SELECT ip_address, first_seen_at, last_seen_at
    FROM mc_player_ips
    WHERE player_id = ?
    ORDER BY last_seen_at DESC
  `, [playerId]);
}
}
