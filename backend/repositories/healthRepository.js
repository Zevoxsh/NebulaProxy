// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class HealthRepository {
// ===== HEALTH CHECKS METHODS =====

async recordHealthCheck(domainId, status, responseTime = null, statusCode = null, errorMessage = null) {
  await this.execute(`
    INSERT INTO health_checks (domain_id, status, response_time, status_code, error_message)
    VALUES (?, ?, ?, ?, ?)
  `, [domainId, status, responseTime, statusCode, errorMessage]);
}

getHealthChecksByDomain(domainId, limit = 10) {
  return this.queryAll(`
    SELECT * FROM health_checks
    WHERE domain_id = ?
    ORDER BY checked_at DESC
    LIMIT ?
  `, [domainId, limit]);
}

getLatestHealthCheck(domainId) {
  return this.queryOne(`
    SELECT * FROM health_checks
    WHERE domain_id = ?
    ORDER BY checked_at DESC
    LIMIT 1
  `, [domainId]);
}

getHealthCheckStats(domainId, days = 30) {
  return this.queryOne(`
    SELECT
      COUNT(*) as total_checks,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_checks,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_checks,
      AVG(response_time) as avg_response_time
    FROM health_checks
    WHERE domain_id = ?
      AND checked_at >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
  `, [domainId, days]);
}

// Clean old health checks (keep only last 10 per domain for real-time monitoring)
async cleanOldHealthChecks(keepCount = 10) {
  // For each domain, keep only the last N health checks
  const domains = await this.queryAll('SELECT DISTINCT domain_id FROM health_checks', []);

  let totalDeleted = 0;
  for (const { domain_id } of domains) {
    const result = await this.execute(`
      DELETE FROM health_checks
      WHERE domain_id = ?
      AND id NOT IN (
        SELECT id FROM health_checks
        WHERE domain_id = ?
        ORDER BY checked_at DESC
        LIMIT ?
      )
    `, [domain_id, domain_id, keepCount]);
    totalDeleted += result.rowCount || 0;
  }

  return { changes: totalDeleted };
}
}
