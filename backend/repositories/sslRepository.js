// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

import { logger } from '../utils/logger.js';

export class SslRepository {
// ===== CERTIFICATE STORAGE METHODS (BDD) =====

/**
 * Stocker un certificat SSL directement en base de données
 * @param {number} domainId - ID du domaine
 * @param {string} fullchain - Certificat complet (fullchain) au format PEM
 * @param {string} privateKey - Clé privée au format PEM
 * @param {string} issuer - Émetteur (ex: "Let's Encrypt", "Manual")
 * @param {Date} issuedAt - Date d'émission
 * @param {Date} expiresAt - Date d'expiration
 * @param {string} certType - Type: 'acme' ou 'manual'
 */
async storeCertificateInDB(domainId, fullchain, privateKey, issuer, issuedAt, expiresAt, certType = 'acme') {
  await this.execute(`
    UPDATE domains
    SET ssl_fullchain = ?,
        ssl_private_key = ?,
        ssl_issuer = ?,
        ssl_issued_at = ?,
        ssl_expires_at = ?,
        ssl_cert_type = ?,
        ssl_status = 'active',
        ssl_enabled = TRUE,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [fullchain, privateKey, issuer, issuedAt, expiresAt, certType, domainId]);
  logger.info(`[DB] SSL certificate stored in DB for domain ID ${domainId}`);
  return this.getDomainById(domainId);
}

/**
 * Récupérer un certificat SSL depuis la base de données
 * @param {number} domainId - ID du domaine
 * @returns {object|null} - {fullchain, privateKey, issuer, issuedAt, expiresAt, certType}
 */
async getCertificateFromDB(domainId) {
  const result = await this.queryOne(`
    SELECT ssl_fullchain, ssl_private_key, ssl_issuer, ssl_issued_at, ssl_expires_at, ssl_cert_type
    FROM domains
    WHERE id = ? AND ssl_fullchain IS NOT NULL
  `, [domainId]);

  if (!result || !result.ssl_fullchain) {
    return null;
  }

  return {
    fullchain: result.ssl_fullchain,
    privateKey: result.ssl_private_key,
    issuer: result.ssl_issuer,
    issuedAt: result.ssl_issued_at,
    expiresAt: result.ssl_expires_at,
    certType: result.ssl_cert_type
  };
}

/**
 * Récupérer certificat par hostname (pour chargement dynamique)
 * @param {string} hostname
 * @returns {object|null}
 */
async getCertificateByHostname(hostname) {
  const result = await this.queryOne(`
    SELECT ssl_fullchain, ssl_private_key, ssl_issuer, ssl_issued_at, ssl_expires_at, ssl_cert_type
    FROM domains
    WHERE hostname = ? AND ssl_fullchain IS NOT NULL AND ssl_enabled = TRUE
  `, [hostname]);

  if (!result || !result.ssl_fullchain) {
    return null;
  }

  return {
    fullchain: result.ssl_fullchain,
    privateKey: result.ssl_private_key,
    issuer: result.ssl_issuer,
    issuedAt: result.ssl_issued_at,
    expiresAt: result.ssl_expires_at,
    certType: result.ssl_cert_type
  };
}

/**
 * Lister tous les certificats expirant bientôt (30 jours)
 * @returns {Array} - Liste des domaines avec certificats expirant
 */
getExpiringCertificates(days = 30) {
  return this.queryAll(`
    SELECT
      id,
      hostname,
      ssl_expires_at,
      ssl_auto_renew,
      ssl_cert_type,
      ssl_issuer,
      CAST(DATE_PART('day', ssl_expires_at - CURRENT_TIMESTAMP) AS INTEGER) as days_until_expiry
    FROM domains
    WHERE ssl_enabled = TRUE
      AND ssl_expires_at IS NOT NULL
      AND ssl_expires_at < (CURRENT_TIMESTAMP + (? || ' days')::interval)
    ORDER BY ssl_expires_at ASC
  `, [days]);
}

/**
 * Supprimer un certificat de la BDD
 * @param {number} domainId
 */
async deleteCertificateFromDB(domainId) {
  await this.execute(`
    UPDATE domains
    SET ssl_fullchain = NULL,
        ssl_private_key = NULL,
        ssl_issuer = NULL,
        ssl_issued_at = NULL,
        ssl_expires_at = NULL,
        ssl_cert_type = NULL,
        ssl_status = 'disabled',
        ssl_enabled = FALSE,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [domainId]);
  logger.info(`[DB] SSL certificate deleted from DB for domain ID ${domainId}`);
  return this.getDomainById(domainId);
}

/**
 * Activer/désactiver le renouvellement automatique
 * @param {number} domainId
 * @param {boolean} autoRenew
 */
async setSSLAutoRenew(domainId, autoRenew) {
  await this.execute(`
    UPDATE domains
    SET ssl_auto_renew = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [autoRenew ? true : false, domainId]);
  return this.getDomainById(domainId);
}

// Backwards-compatible helper: update SSL paths for a domain
updateDomainSSLPaths(domainId, certPath, keyPath, expiresAt) {
  return this.updateDomainACMEStatus(domainId, certPath, keyPath, expiresAt);
}

// Check if a port is already in use (for TCP/UDP proxies)
// TCP and UDP can use the same port number since they're different protocols
async isPortInUse(port, protocol) {
  const result = await this.queryOne(`
    SELECT COUNT(*) as count FROM domains
    WHERE external_port = ? AND proxy_type = ? AND is_active = TRUE
  `, [port, protocol]);
  return Number(result?.count || 0) > 0;
}

async isPortAssigned(port, protocol) {
  const result = await this.queryOne(`
    SELECT COUNT(*) as count FROM domains
    WHERE external_port = ? AND proxy_type = ?
  `, [port, protocol]);
  return Number(result?.count || 0) > 0;
}

// Interval-overlap check: catches conflicts against both existing single
// ports (external_port_end IS NULL) and existing ranges.
async isPortRangeAssigned(startPort, endPort, protocol, excludeDomainId = null) {
  const params = [protocol, endPort, startPort];
  let query = `
    SELECT COUNT(*) as count FROM domains
    WHERE proxy_type = ? AND external_port <= ? AND COALESCE(external_port_end, external_port) >= ?
  `;
  if (excludeDomainId) {
    query += ' AND id != ?';
    params.push(excludeDomainId);
  }
  const result = await this.queryOne(query, params);
  return Number(result?.count || 0) > 0;
}

// ===== DNS ACME CHALLENGE METHODS =====

// Store DNS challenge details when initiated
async updateDomainDNSChallenge(domainId, token, domain, expiresAt) {
  await this.execute(`
    UPDATE domains
    SET dns_validation_token = ?,
        dns_validation_domain = ?,
        dns_validation_status = 'waiting_user',
        dns_validation_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [token, domain, expiresAt, domainId]);
  return this.getDomainById(domainId);
}

// Get DNS challenge details for display
async getDNSChallengeByDomainId(domainId) {
  const domain = await this.getDomainById(domainId);
  if (!domain) return null;

  return {
    token: domain.dns_validation_token,
    domain: domain.dns_validation_domain,
    status: domain.dns_validation_status,
    expiresAt: domain.dns_validation_expires_at
  };
}

// Update DNS validation status
async updateDNSValidationStatus(domainId, status) {
  await this.execute(`
    UPDATE domains
    SET dns_validation_status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [status, domainId]);
  return this.getDomainById(domainId);
}

// Clear DNS challenge data after completion
async clearDNSChallenge(domainId) {
  await this.execute(`
    UPDATE domains
    SET dns_validation_token = NULL,
        dns_validation_domain = NULL,
        dns_validation_status = NULL,
        dns_validation_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [domainId]);
  return this.getDomainById(domainId);
}

// ===== SSL EVENTS =====

async createSSLEvent(domainId, eventType, message = null) {
  try {
    await this.execute(
      'INSERT INTO ssl_events (domain_id, event_type, message) VALUES (?, ?, ?)',
      [domainId, eventType, message]
    );
  } catch (err) {
    logger.warn(`[DB] Failed to write ssl_event for domain ${domainId}:`, err.message);
  }
}

async getSSLEvents(domainId, limit = 20) {
  return this.queryAll(
    'SELECT id, event_type, message, created_at FROM ssl_events WHERE domain_id = ? ORDER BY created_at DESC LIMIT ?',
    [domainId, limit]
  );
}

// ===== RENEWAL BACKOFF TRACKING =====

async recordRenewalSuccess(domainId) {
  await this.execute(`
    UPDATE domains
    SET ssl_renewal_error_count = 0,
        ssl_last_renewal_attempt = CURRENT_TIMESTAMP,
        ssl_renewal_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [domainId]);
}

async recordRenewalFailure(domainId, errorMessage) {
  await this.execute(`
    UPDATE domains
    SET ssl_renewal_error_count = COALESCE(ssl_renewal_error_count, 0) + 1,
        ssl_last_renewal_attempt = CURRENT_TIMESTAMP,
        ssl_renewal_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [errorMessage ? errorMessage.substring(0, 500) : null, domainId]);
}
}
