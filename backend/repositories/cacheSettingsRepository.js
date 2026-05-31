// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class CacheSettingsRepository {
// ===== CACHE SETTINGS METHODS =====

async getCacheSettings(userId) {
  const settings = await this.queryOne('SELECT * FROM cache_settings WHERE user_id = ?', [userId]);

  if (settings && settings.cacheable_content_types) {
    settings.cacheable_content_types = JSON.parse(settings.cacheable_content_types);
  }

  return settings;
}

async upsertCacheSettings(userId, settings) {
  const { enabled, defaultTTL, maxAge, staleWhileRevalidate, bypassQueryString, cacheableContentTypes } = settings;

  const existing = await this.getCacheSettings(userId);
  const contentTypesJson = JSON.stringify(cacheableContentTypes || []);

  if (existing) {
    await this.execute(`
      UPDATE cache_settings
      SET enabled = ?, default_ttl = ?, max_age = ?,
          stale_while_revalidate = ?, bypass_query_string = ?,
          cacheable_content_types = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [
      enabled ? true : false,
      defaultTTL,
      maxAge,
      staleWhileRevalidate ? true : false,
      bypassQueryString ? true : false,
      contentTypesJson,
      userId
    ]);
  } else {
    await this.execute(`
      INSERT INTO cache_settings (user_id, enabled, default_ttl, max_age, stale_while_revalidate, bypass_query_string, cacheable_content_types)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      enabled ? true : false,
      defaultTTL,
      maxAge,
      staleWhileRevalidate ? true : false,
      bypassQueryString ? true : false,
      contentTypesJson
    ]);
  }

  return this.getCacheSettings(userId);
}
}
