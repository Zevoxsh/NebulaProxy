// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class DomainHealthRepository {
// ===== DOMAIN HEALTH STATUS METHODS =====

getDomainHealthStatus(domainId) {
  return this.queryOne('SELECT * FROM domain_health_status WHERE domain_id = ?', [domainId]);
}

async upsertDomainHealthStatus(domainId, status, isSuccess) {
  const existing = await this.getDomainHealthStatus(domainId);

  if (existing) {
    const consecutiveFailures  = isSuccess ? 0 : Math.min((existing.consecutive_failures  || 0) + 1, 50);
    const consecutiveSuccesses = isSuccess ? Math.min((existing.consecutive_successes || 0) + 1, 50) : 0;

    // Status only flips at the threshold of 3 consecutive checks in either direction
    let newStatus = existing.current_status;
    if (!isSuccess && consecutiveFailures >= 3 && existing.current_status !== 'down') {
      newStatus = 'down';
    } else if (isSuccess && consecutiveSuccesses >= 3 && existing.current_status !== 'up') {
      newStatus = 'up';
    }

    const statusChanged = existing.current_status !== newStatus;

    await this.execute(`
      UPDATE domain_health_status
      SET current_status = ?,
          last_checked_at = CURRENT_TIMESTAMP,
          last_status_change_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_status_change_at END,
          consecutive_failures = ?,
          consecutive_successes = ?
      WHERE domain_id = ?
    `, [newStatus, statusChanged, consecutiveFailures, consecutiveSuccesses, domainId]);

    return {
      statusChanged,
      previousStatus: existing.current_status,
      currentStatus: newStatus
    };
  } else {
    // First-ever check: only mark UP on success, stay 'unknown' on failure until threshold
    const newStatus = isSuccess ? 'up' : 'unknown';
    await this.execute(`
      INSERT INTO domain_health_status (domain_id, current_status, last_checked_at, consecutive_failures, consecutive_successes)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)
    `, [domainId, newStatus, isSuccess ? 0 : 1, isSuccess ? 1 : 0]);

    return {
      statusChanged: true,
      previousStatus: 'unknown',
      currentStatus: newStatus
    };
  }
}

// Update only last_checked_at — used when domain is already confirmed down
// and check keeps failing (no value in spamming the health_checks table)
async touchDomainHealthStatus(domainId) {
  await this.execute(
    'UPDATE domain_health_status SET last_checked_at = CURRENT_TIMESTAMP WHERE domain_id = ?',
    [domainId]
  );
}

// Mark that a down alert was sent for this domain
async markAlertSent(domainId) {
  await this.execute(`
    UPDATE domain_health_status
    SET alert_sent_at = CURRENT_TIMESTAMP
    WHERE domain_id = ?
  `, [domainId]);
}

// Clear alert tracking when service is restored
async clearAlertSent(domainId) {
  await this.execute(`
    UPDATE domain_health_status
    SET alert_sent_at = NULL
    WHERE domain_id = ?
  `, [domainId]);
}

// Check if an alert was sent for this domain
async hasAlertBeenSent(domainId) {
  const status = await this.getDomainHealthStatus(domainId);
  return status && status.alert_sent_at !== null;
}

// Mark alert sent for all domains matching same backend (by owner and backend URL/port)
async markAlertSentForBackend(ownerId, isTeam, backendUrl, backendPort, proxyType) {
  const ownerField = isTeam ? 'team_id' : 'user_id';
  await this.execute(`
    UPDATE domain_health_status dhs
    SET alert_sent_at = CURRENT_TIMESTAMP
    FROM domains d
    WHERE dhs.domain_id = d.id
      AND d.${ownerField} = ?
      AND d.backend_url = ?
      AND COALESCE(d.backend_port, '') = ?
      AND COALESCE(d.proxy_type, 'http') = ?
  `, [ownerId, backendUrl, backendPort || '', proxyType || 'http']);
}

// Clear alert for all domains matching same backend
async clearAlertSentForBackend(ownerId, isTeam, backendUrl, backendPort, proxyType) {
  const ownerField = isTeam ? 'team_id' : 'user_id';
  await this.execute(`
    UPDATE domain_health_status dhs
    SET alert_sent_at = NULL
    FROM domains d
    WHERE dhs.domain_id = d.id
      AND d.${ownerField} = ?
      AND d.backend_url = ?
      AND COALESCE(d.backend_port, '') = ?
      AND COALESCE(d.proxy_type, 'http') = ?
  `, [ownerId, backendUrl, backendPort || '', proxyType || 'http']);
}

// Get all users with notification settings enabled
async getUsersWithNotificationsEnabled() {
  return this.queryAll(`
    SELECT u.*, n.discord_webhook_url
    FROM users u
    JOIN notification_settings n ON u.id = n.user_id
    WHERE n.notifications_enabled = TRUE AND n.discord_webhook_url IS NOT NULL
  `, []);
}
}
