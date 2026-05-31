// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class AuditLogRepository {
// ===== AUDIT LOG METHODS =====

async createAuditLog(logData) {
  const { userId, action, entityType, entityId, details, ipAddress } = logData;

  const detailsJson = details ? JSON.stringify(details) : null;
  await this.execute(`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [userId, action, entityType || null, entityId || null, detailsJson, ipAddress || null]);
}

getAuditLogs(limit = 100, offset = 0) {
  return this.queryAll(`
    SELECT
      a.*,
      u.username,
      u.display_name as user_display_name
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
}

getAuditLogsByUserId(userId, limit = 50) {
  return this.queryAll(`
    SELECT * FROM audit_logs
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}
}
