// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class BackendRepository {
// ===== LOAD BALANCING / BACKEND METHODS =====

/**
 * Get all backends for a domain
 */
getBackendsByDomainId(domainId) {
  return this.queryAll(`
    SELECT db.*, bhs.current_status as health_status, bhs.last_response_time
    FROM domain_backends db
    LEFT JOIN backend_health_status bhs ON db.id = bhs.backend_id
    WHERE db.domain_id = ?
    ORDER BY db.priority DESC, db.id ASC
  `, [domainId]);
}

/**
 * Get active backends for a domain (for load balancing)
 */
getActiveBackendsByDomainId(domainId) {
  return this.queryAll(`
    SELECT db.*, bhs.current_status as health_status, bhs.last_response_time
    FROM domain_backends db
    LEFT JOIN backend_health_status bhs ON db.id = bhs.backend_id
    WHERE db.domain_id = ? AND db.is_active = TRUE
    ORDER BY db.priority DESC, db.id ASC
  `, [domainId]);
}

/**
 * Get healthy backends for a domain (excludes down backends)
 */
getHealthyBackendsByDomainId(domainId) {
  return this.queryAll(`
    SELECT db.*, bhs.current_status as health_status, bhs.last_response_time
    FROM domain_backends db
    LEFT JOIN backend_health_status bhs ON db.id = bhs.backend_id
    WHERE db.domain_id = ?
      AND db.is_active = TRUE
      AND (bhs.current_status IS NULL OR bhs.current_status != 'down')
    ORDER BY db.priority DESC, db.id ASC
  `, [domainId]);
}

/**
 * Get a backend by ID
 */
getBackendById(backendId) {
  return this.queryOne(`
    SELECT db.*, bhs.current_status as health_status, bhs.last_response_time
    FROM domain_backends db
    LEFT JOIN backend_health_status bhs ON db.id = bhs.backend_id
    WHERE db.id = ?
  `, [backendId]);
}

/**
 * Create a new backend for a domain
 */
async createBackend(backendData) {
  const { domainId, backendUrl, backendPort, weight = 1, priority = 0 } = backendData;

  const result = await this.execute(`
    INSERT INTO domain_backends (domain_id, backend_url, backend_port, weight, priority)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `, [domainId, backendUrl, backendPort || null, weight, priority]);

  return this.getBackendById(result.rows[0].id);
}

/**
 * Update a backend
 */
async updateBackend(backendId, updates) {
  const { backendUrl, backendPort, weight, priority, isActive } = updates;

  const hasBackendPort = Object.prototype.hasOwnProperty.call(updates, 'backendPort');
  const hasWeight = Object.prototype.hasOwnProperty.call(updates, 'weight');
  const hasPriority = Object.prototype.hasOwnProperty.call(updates, 'priority');
  const hasIsActive = Object.prototype.hasOwnProperty.call(updates, 'isActive');

  await this.execute(`
    UPDATE domain_backends
    SET
      backend_url = COALESCE(?, backend_url),
      backend_port = CASE WHEN ? THEN ? ELSE backend_port END,
      weight = CASE WHEN ? THEN ? ELSE weight END,
      priority = CASE WHEN ? THEN ? ELSE priority END,
      is_active = CASE WHEN ? THEN ? ELSE is_active END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    backendUrl ?? null,
    hasBackendPort, backendPort ?? null,
    hasWeight, weight ?? 1,
    hasPriority, priority ?? 0,
    hasIsActive, isActive ?? true,
    backendId
  ]);

  return this.getBackendById(backendId);
}

/**
 * Delete a backend
 */
async deleteBackend(backendId) {
  return this.execute('DELETE FROM domain_backends WHERE id = ?', [backendId]);
}

/**
 * Toggle backend active status
 */
async toggleBackendActive(backendId) {
  await this.execute(`
    UPDATE domain_backends
    SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [backendId]);
  return this.getBackendById(backendId);
}

/**
 * Update domain load balancing settings
 */
async updateDomainLoadBalancing(domainId, enabled, algorithm = 'round-robin') {
  await this.execute(`
    UPDATE domains
    SET
      load_balancing_enabled = ?,
      load_balancing_algorithm = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [enabled, algorithm, domainId]);
  return this.getDomainById(domainId);
}

/**
 * Update backend health status
 */
async updateBackendHealthStatus(backendId, status, responseTime = null) {
  const isUp = status === 'up';
  const isDown = status === 'down';

  await this.execute(`
    INSERT INTO backend_health_status (backend_id, current_status, last_checked_at, last_response_time, consecutive_failures, consecutive_successes)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    ON CONFLICT (backend_id) DO UPDATE SET
      current_status = EXCLUDED.current_status,
      last_checked_at = CURRENT_TIMESTAMP,
      last_response_time = EXCLUDED.last_response_time,
      consecutive_failures = CASE
        WHEN EXCLUDED.current_status = 'down' THEN backend_health_status.consecutive_failures + 1
        ELSE 0
      END,
      consecutive_successes = CASE
        WHEN EXCLUDED.current_status = 'up' THEN backend_health_status.consecutive_successes + 1
        ELSE 0
      END,
      last_status_change_at = CASE
        WHEN backend_health_status.current_status != EXCLUDED.current_status THEN CURRENT_TIMESTAMP
        ELSE backend_health_status.last_status_change_at
      END
  `, [backendId, status, responseTime, isDown ? 1 : 0, isUp ? 1 : 0]);
}

/**
 * Get backend health status
 */
getBackendHealthStatus(backendId) {
  return this.queryOne('SELECT * FROM backend_health_status WHERE backend_id = ?', [backendId]);
}

/**
 * Get all backends with health status for health checking service
 */
getAllActiveBackendsForHealthCheck() {
  return this.queryAll(`
    SELECT
      db.*,
      d.hostname as domain_hostname,
      d.proxy_type,
      d.ssl_enabled,
      d.load_balancing_enabled
    FROM domain_backends db
    JOIN domains d ON db.domain_id = d.id
    WHERE db.is_active = TRUE AND d.is_active = TRUE AND d.load_balancing_enabled = TRUE
    ORDER BY db.domain_id, db.id
  `, []);
}
}
