// @ts-check
// Mixed into DatabaseService in database.js via prototype iteration.

import { randomBytes } from 'crypto';

function generateSocks5Username() {
  return `sk5_${randomBytes(6).toString('hex')}`;
}

export class Socks5Repository {
// ===== SOCKS5 CREDENTIAL MANAGEMENT =====

async getUniqueSocks5Username() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = generateSocks5Username();
    const existing = await this.queryOne('SELECT id FROM socks5_credentials WHERE username = ?', [username]);
    if (!existing) return username;
  }
  throw new Error('Unable to generate a unique SOCKS5 username');
}

async createSocks5Credential({ userId, label, username, passwordHash, throttleBps }) {
  return this.queryOne(`
    INSERT INTO socks5_credentials (user_id, label, username, password_hash, throttle_bps)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `, [userId, label, username, passwordHash, throttleBps]);
}

async getSocks5CredentialsByUserId(userId) {
  return this.queryAll(`
    SELECT * FROM socks5_credentials WHERE user_id = ? ORDER BY id DESC
  `, [userId]);
}

async getAllSocks5Credentials() {
  return this.queryAll(`
    SELECT sc.*, u.username AS owner_username, u.email AS owner_email
    FROM socks5_credentials sc
    JOIN users u ON u.id = sc.user_id
    ORDER BY sc.id DESC
  `, []);
}

async getSocks5CredentialById(id) {
  return this.queryOne('SELECT * FROM socks5_credentials WHERE id = ?', [id]);
}

async getSocks5CredentialByUsername(username) {
  return this.queryOne('SELECT * FROM socks5_credentials WHERE username = ?', [username]);
}

async countSocks5CredentialsByUserId(userId) {
  const row = await this.queryOne('SELECT COUNT(*)::int AS count FROM socks5_credentials WHERE user_id = ?', [userId]);
  return row?.count || 0;
}

async updateSocks5Credential(id, { label, throttleBps, isEnabled }) {
  await this.execute(`
    UPDATE socks5_credentials
    SET label = COALESCE(?, label),
        throttle_bps = COALESCE(?, throttle_bps),
        is_enabled = COALESCE(?, is_enabled),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    label ?? null,
    throttleBps ?? null,
    isEnabled !== undefined && isEnabled !== null ? isEnabled : null,
    id
  ]);
  return this.getSocks5CredentialById(id);
}

async updateSocks5CredentialPasswordHash(id, passwordHash) {
  await this.execute(`
    UPDATE socks5_credentials SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [passwordHash, id]);
  return this.getSocks5CredentialById(id);
}

async touchSocks5CredentialLastUsed(id) {
  await this.execute(`
    UPDATE socks5_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [id]);
}

async deleteSocks5Credential(id) {
  return this.execute('DELETE FROM socks5_credentials WHERE id = ?', [id]);
}
}
