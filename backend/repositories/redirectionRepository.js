// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class RedirectionRepository {
// ===== REDIRECTION METHODS =====

// Create a new redirection
async createRedirection(redirectionData) {
  const { userId, shortCode, targetUrl, description, teamId } = redirectionData;

  const result = await this.execute(`
    INSERT INTO redirections (user_id, short_code, target_url, description, team_id)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `, [userId, shortCode, targetUrl, description || null, teamId || null]);

  return this.getRedirectionById(result.rows[0].id);
}

// Get redirection by ID
getRedirectionById(id) {
  return this.queryOne('SELECT * FROM redirections WHERE id = ?', [id]);
}

// Get redirection by short code
getRedirectionByShortCode(shortCode) {
  return this.queryOne('SELECT * FROM redirections WHERE short_code = ? AND is_active = TRUE', [shortCode]);
}

// Get all redirections for a user (personal + team redirections)
getRedirectionsByUserId(userId) {
  return this.queryAll(`
    SELECT * FROM redirections
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [userId]);
}

// Get all redirections accessible by a user (personal + team redirections)
getRedirectionsByUserIdWithTeams(userId) {
  return this.queryAll(`
    SELECT
      r.*,
      u.username,
      u.display_name as user_display_name,
      t.name as team_name,
      CASE
        WHEN r.team_id IS NULL THEN 'personal'
        ELSE 'team'
      END as ownership_type
    FROM redirections r
    JOIN users u ON r.user_id = u.id
    LEFT JOIN teams t ON r.team_id = t.id
    WHERE r.user_id = ?
       OR r.team_id IN (
         SELECT team_id FROM team_members WHERE user_id = ?
       )
    ORDER BY r.created_at DESC
  `, [userId, userId]);
}

// Get all redirections (admin only)
getAllRedirections() {
  return this.queryAll(`
    SELECT
      r.*,
      u.username,
      u.display_name as user_display_name,
      t.name as team_name
    FROM redirections r
    JOIN users u ON r.user_id = u.id
    LEFT JOIN teams t ON r.team_id = t.id
    ORDER BY r.created_at DESC
  `, []);
}

// Count redirections by user ID
async countRedirectionsByUserId(userId) {
  const result = await this.queryOne('SELECT COUNT(*) as count FROM redirections WHERE user_id = ?', [userId]);
  return Number(result?.count || 0);
}

// Update redirection
async updateRedirection(redirectionId, updates) {
  const { shortCode, targetUrl, description, isActive } = updates;

  await this.execute(`
    UPDATE redirections
    SET
      short_code = COALESCE(?, short_code),
      target_url = COALESCE(?, target_url),
      description = COALESCE(?, description),
      is_active = COALESCE(?, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    shortCode ?? null,
    targetUrl ?? null,
    description ?? null,
    isActive !== undefined && isActive !== null ? isActive : null,
    redirectionId
  ]);

  return this.getRedirectionById(redirectionId);
}

// Delete redirection
async deleteRedirection(redirectionId) {
  return this.execute('DELETE FROM redirections WHERE id = ?', [redirectionId]);
}

// Toggle redirection active status
async toggleRedirectionActive(redirectionId) {
  await this.execute(`
    UPDATE redirections
    SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [redirectionId]);
  return this.getRedirectionById(redirectionId);
}

// Increment click count
async incrementRedirectionClicks(redirectionId) {
  await this.execute(`
    UPDATE redirections
    SET click_count = click_count + 1
    WHERE id = ?
  `, [redirectionId]);
}

// Update user redirection quota
async updateUserRedirectionQuota(userId, maxRedirections) {
  await this.execute(`
    UPDATE users
    SET max_redirections = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [maxRedirections, userId]);
  return this.getUserById(userId);
}

// Get redirection statistics
async getRedirectionStats(redirectionId, days = 30) {
  const redirection = await this.getRedirectionById(redirectionId);
  if (!redirection) return null;

  return {
    total_clicks: redirection.click_count,
    short_code: redirection.short_code,
    target_url: redirection.target_url,
    is_active: redirection.is_active
  };
}
}
