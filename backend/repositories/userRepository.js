// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class UserRepository {
// ===== USER METHODS =====

async getUserByUsername(username) {
  return this.queryOne('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
}

async getUserById(id) {
  return this.queryOne('SELECT * FROM users WHERE id = ?', [id]);
}

async updateUserProfile(userId, updates = {}) {
  const { displayName, email, avatarUrl } = updates;

  // Build dynamic SET clause based on what's being updated
  const setClauses = ['updated_at = CURRENT_TIMESTAMP'];
  const values = [];

  if (displayName !== undefined) {
    setClauses.push('display_name = ?');
    values.push(displayName);
  }

  if (email !== undefined) {
    setClauses.push('email = ?');
    values.push(email);
  }

  if (avatarUrl !== undefined) {
    setClauses.push('avatar_url = ?');
    setClauses.push('avatar_updated_at = CURRENT_TIMESTAMP');
    values.push(avatarUrl);
  }

  values.push(userId);

  await this.execute(`
    UPDATE users
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `, values);

  return this.getUserById(userId);
}

async createUser(userData) {
  const {
    username,
    displayName,
    email,
    role,
    passwordHash
  } = userData;
  const maxDomains = role === 'admin' ? 999 : 5;
  const maxProxies = role === 'admin' ? 999 : 5;

  const result = await this.execute(`
    INSERT INTO users (username, display_name, email, role, max_domains, max_proxies, last_login_at, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    RETURNING id
  `, [username, displayName, email || null, role, maxDomains, maxProxies, passwordHash || null]);

  return this.getUserById(result.rows[0].id);
}

async updateUserLoginTime(userId) {
  await this.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
}

async getAllUsers() {
  return this.queryAll(`
    SELECT
      u.*,
      COUNT(d.id) as domain_count
    FROM users u
    LEFT JOIN domains d ON u.id = d.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `, []);
}

async updateUserQuotas(userId, maxDomains, maxProxies) {
  await this.execute(`
    UPDATE users
    SET max_domains = ?, max_proxies = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [maxDomains, maxProxies, userId]);
  return this.getUserById(userId);
}

async toggleUserActive(userId) {
  await this.execute(`
    UPDATE users
    SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [userId]);
  return this.getUserById(userId);
}

async deleteUser(userId) {
  return this.execute('DELETE FROM users WHERE id = ?', [userId]);
}
}
