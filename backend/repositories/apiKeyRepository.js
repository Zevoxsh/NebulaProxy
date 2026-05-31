// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class ApiKeyRepository {
// ===== API KEYS METHODS =====

/**
 * Get API key by prefix (for authentication)
 * @param {string} prefix - First 16 characters of the key
 * @returns {object|null} - API key record
 */
getApiKeyByPrefix(prefix) {
  return this.queryOne(`
    SELECT * FROM api_keys
    WHERE key_prefix = ? AND is_active = TRUE
  `, [prefix]);
}

/**
 * Get API key by ID
 * @param {string} id - API key UUID
 * @returns {object|null}
 */
getApiKeyById(id) {
  return this.queryOne('SELECT * FROM api_keys WHERE id = ?', [id]);
}

/**
 * Get all API keys for a user
 * @param {string} userId - User UUID
 * @returns {Array} - Array of API key records (without key_hash)
 */
getApiKeysByUserId(userId) {
  return this.queryAll(`
    SELECT
      id, user_id, key_prefix, name, description, scopes,
      rate_limit_rpm, rate_limit_rph, is_active, expires_at,
      last_used_at, created_at, updated_at
    FROM api_keys
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [userId]);
}

/**
 * Get all API keys (admin only)
 * @returns {Array} - Array of API key records with user info (without key_hash)
 */
getAllApiKeys() {
  return this.queryAll(`
    SELECT
      k.id, k.user_id, k.key_prefix, k.name, k.description, k.scopes,
      k.rate_limit_rpm, k.rate_limit_rph, k.is_active, k.expires_at,
      k.last_used_at, k.created_at, k.updated_at,
      u.username, u.display_name as user_display_name, u.role as user_role
    FROM api_keys k
    JOIN users u ON k.user_id = u.id
    ORDER BY k.created_at DESC
  `, []);
}

/**
 * Create a new API key
 * @param {object} keyData - API key data
 * @returns {object} - Created API key record
 */
async createApiKey(keyData) {
  const {
    userId,
    keyPrefix,
    keyHash,
    name,
    description = null,
    scopes,
    rateLimitRpm = 60,
    rateLimitRph = 3600,
    expiresAt = null
  } = keyData;

  const scopesArray = Array.isArray(scopes) ? scopes : [scopes];

  const result = await this.execute(`
    INSERT INTO api_keys (
      user_id, key_prefix, key_hash, name, description, scopes,
      rate_limit_rpm, rate_limit_rph, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `, [
    userId,
    keyPrefix,
    keyHash,
    name,
    description,
    scopesArray,
    rateLimitRpm,
    rateLimitRph,
    expiresAt
  ]);

  return this.getApiKeyById(result.rows[0].id);
}

/**
 * Update an API key
 * @param {string} keyId - API key UUID
 * @param {object} updates - Fields to update
 * @returns {object} - Updated API key record
 */
async updateApiKey(keyId, updates) {
  const { name, description, scopes, rateLimitRpm, rateLimitRph, isActive, expiresAt } = updates;

  const hasScopes = Object.prototype.hasOwnProperty.call(updates, 'scopes');
  const hasRateLimitRpm = Object.prototype.hasOwnProperty.call(updates, 'rateLimitRpm');
  const hasRateLimitRph = Object.prototype.hasOwnProperty.call(updates, 'rateLimitRph');
  const hasIsActive = Object.prototype.hasOwnProperty.call(updates, 'isActive');
  const hasExpiresAt = Object.prototype.hasOwnProperty.call(updates, 'expiresAt');

  const scopesArray = hasScopes && scopes ? (Array.isArray(scopes) ? scopes : [scopes]) : null;

  await this.execute(`
    UPDATE api_keys
    SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      scopes = CASE WHEN ? THEN ?::text[] ELSE scopes END,
      rate_limit_rpm = CASE WHEN ? THEN ? ELSE rate_limit_rpm END,
      rate_limit_rph = CASE WHEN ? THEN ? ELSE rate_limit_rph END,
      is_active = CASE WHEN ? THEN ? ELSE is_active END,
      expires_at = CASE WHEN ? THEN ? ELSE expires_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    name ?? null,
    description ?? null,
    hasScopes, scopesArray,
    hasRateLimitRpm, rateLimitRpm ?? 60,
    hasRateLimitRph, rateLimitRph ?? 3600,
    hasIsActive, isActive ?? true,
    hasExpiresAt, expiresAt ?? null,
    keyId
  ]);

  return this.getApiKeyById(keyId);
}

/**
 * Delete (revoke) an API key
 * @param {string} keyId - API key UUID
 * @returns {object} - Result of deletion
 */
async deleteApiKey(keyId) {
  return this.execute('DELETE FROM api_keys WHERE id = ?', [keyId]);
}

/**
 * Update last_used_at timestamp for an API key
 * @param {string} keyId - API key UUID
 */
async updateApiKeyLastUsed(keyId) {
  await this.execute(`
    UPDATE api_keys
    SET last_used_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [keyId]);
}

/**
 * Log API key usage
 * @param {object} usageData - Usage log data
 */
async logApiKeyUsage(usageData) {
  const {
    apiKeyId,
    method,
    path,
    statusCode = null,
    ipAddress = null,
    userAgent = null,
    responseTimeMs = null
  } = usageData;

  await this.execute(`
    INSERT INTO api_key_usage (
      api_key_id, method, path, status_code, ip_address, user_agent, response_time_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    apiKeyId,
    method,
    path,
    statusCode,
    ipAddress,
    userAgent,
    responseTimeMs
  ]);
}

/**
 * Get usage statistics for an API key
 * @param {string} keyId - API key UUID
 * @param {number} days - Number of days to look back (default: 7)
 * @returns {object} - Usage statistics
 */
async getApiKeyUsageStats(keyId, days = 7) {
  const stats = await this.queryOne(`
    SELECT
      COUNT(*) as total_requests,
      COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as success_count,
      COUNT(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 END) as client_error_count,
      COUNT(CASE WHEN status_code >= 500 THEN 1 END) as server_error_count,
      AVG(response_time_ms) as avg_response_time,
      MAX(response_time_ms) as max_response_time,
      MIN(response_time_ms) as min_response_time
    FROM api_key_usage
    WHERE api_key_id = ?
      AND created_at >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
  `, [keyId, days]);

  // Get recent usage (last 100 requests)
  const recentUsage = await this.queryAll(`
    SELECT method, path, status_code, ip_address, response_time_ms, created_at
    FROM api_key_usage
    WHERE api_key_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `, [keyId]);

  return {
    stats: {
      total_requests: Number(stats?.total_requests || 0),
      success_count: Number(stats?.success_count || 0),
      client_error_count: Number(stats?.client_error_count || 0),
      server_error_count: Number(stats?.server_error_count || 0),
      avg_response_time: stats?.avg_response_time ? Number(stats.avg_response_time) : null,
      max_response_time: stats?.max_response_time ? Number(stats.max_response_time) : null,
      min_response_time: stats?.min_response_time ? Number(stats.min_response_time) : null
    },
    recent_usage: recentUsage
  };
}

/**
 * Get API key usage logs with pagination
 * @param {string} keyId - API key UUID
 * @param {number} limit - Max results per page
 * @param {number} offset - Offset for pagination
 * @returns {Array} - Array of usage log records
 */
getApiKeyUsageLogs(keyId, limit = 100, offset = 0) {
  return this.queryAll(`
    SELECT *
    FROM api_key_usage
    WHERE api_key_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [keyId, limit, offset]);
}

/**
 * Clean up old API key usage logs (keep last N days)
 * @param {number} days - Number of days to keep (default: 90)
 * @returns {object} - Number of deleted records
 */
async cleanOldApiKeyUsage(days = 90) {
  const result = await this.execute(`
    DELETE FROM api_key_usage
    WHERE created_at < (CURRENT_TIMESTAMP - (? || ' days')::interval)
  `, [days]);
  return { deleted: result.rowCount || 0 };
}
}
