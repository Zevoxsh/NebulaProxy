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

// ===== WILDCARD SSL CERTIFICATE METHODS =====

/**
 * Look up a wildcard cert that covers the given hostname.
 * e.g. for "app.example.com" → checks *.example.com in wildcard_ssl_certs
 * Walks up the hierarchy: app.sub.example.com → *.sub.example.com → *.example.com
 * @param {string} hostname
 * @returns {object|null}
 */
async getWildcardCertForHostname(hostname) {
  const parts = hostname.split('.');
  // Need at least two labels (sub.tld) before a wildcard makes sense
  if (parts.length < 2) return null;

  for (let i = 1; i < parts.length - 1; i++) {
    const wildcardHostname = '*.' + parts.slice(i).join('.');
    const result = await this.queryOne(`
      SELECT id, hostname, fullchain, private_key, issuer, issued_at, expires_at, cert_type
      FROM wildcard_ssl_certs
      WHERE hostname = ? AND fullchain IS NOT NULL AND auto_apply = TRUE
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `, [wildcardHostname]);

    if (result && result.fullchain) {
      return {
        fullchain: result.fullchain,
        privateKey: result.private_key,
        issuer: result.issuer,
        issuedAt: result.issued_at,
        expiresAt: result.expires_at,
        certType: result.cert_type,
        isWildcard: true,
        wildcardHostname: result.hostname
      };
    }
  }
  return null;
}

/**
 * Return all wildcard SSL certificates
 */
async getAllWildcardCerts() {
  return this.queryAll(`
    SELECT id, hostname, issuer, issued_at, expires_at, cert_type, auto_apply,
           dns_challenge_status, dns_challenge_domain, dns_challenge_token,
           dns_challenge_expires_at,
           (fullchain IS NOT NULL) AS has_cert,
           created_at, updated_at
    FROM wildcard_ssl_certs
    ORDER BY created_at DESC
  `);
}

/**
 * Count how many enabled domains are covered by a given wildcard cert
 * @param {string} wildcardHostname - e.g. *.example.com
 * @returns {number}
 */
async getWildcardCoveredDomainsCount(wildcardHostname) {
  const pattern = wildcardHostname.replace(/^\*\./, '%.'); // *.example.com → %.example.com
  const result = await this.queryOne(`
    SELECT COUNT(*) AS count
    FROM domains
    WHERE hostname LIKE ? AND ssl_enabled = TRUE
  `, [pattern]);
  return parseInt(result?.count || 0, 10);
}

/**
 * Store (upsert) a wildcard SSL certificate
 */
async storeWildcardCert({ hostname, fullchain, privateKey, issuer, issuedAt, expiresAt, certType = 'self-signed', autoApply = true }) {
  const existing = await this.queryOne('SELECT id FROM wildcard_ssl_certs WHERE hostname = ?', [hostname]);
  if (existing) {
    await this.execute(`
      UPDATE wildcard_ssl_certs
      SET fullchain   = ?,
          private_key = ?,
          issuer      = ?,
          issued_at   = ?,
          expires_at  = ?,
          cert_type   = ?,
          auto_apply  = ?,
          updated_at  = CURRENT_TIMESTAMP
      WHERE hostname = ?
    `, [fullchain, privateKey, issuer, issuedAt, expiresAt, certType, autoApply, hostname]);
    return this.queryOne('SELECT * FROM wildcard_ssl_certs WHERE hostname = ?', [hostname]);
  } else {
    return this.queryOne(`
      INSERT INTO wildcard_ssl_certs (hostname, fullchain, private_key, issuer, issued_at, expires_at, cert_type, auto_apply)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [hostname, fullchain, privateKey, issuer, issuedAt, expiresAt, certType, autoApply]);
  }
}

/**
 * Get a wildcard cert by ID
 */
async getWildcardCertById(id) {
  return this.queryOne('SELECT * FROM wildcard_ssl_certs WHERE id = ?', [id]);
}

/**
 * Get a wildcard cert by hostname (e.g. *.example.com)
 */
async getWildcardCertByHostname(hostname) {
  return this.queryOne('SELECT * FROM wildcard_ssl_certs WHERE hostname = ?', [hostname]);
}

/**
 * Store DNS-01 challenge info for a wildcard cert
 */
async updateWildcardCertDNSChallenge(id, token, challengeDomain, expiresAt) {
  await this.execute(`
    UPDATE wildcard_ssl_certs
    SET dns_challenge_token      = ?,
        dns_challenge_domain     = ?,
        dns_challenge_status     = 'waiting_user',
        dns_challenge_expires_at = ?,
        updated_at               = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [token, challengeDomain, expiresAt, id]);
}

/**
 * Update the DNS challenge validation status
 */
async updateWildcardCertDNSStatus(id, status) {
  await this.execute(`
    UPDATE wildcard_ssl_certs
    SET dns_challenge_status = ?,
        updated_at           = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [status, id]);
}

/**
 * Clear DNS challenge data after completion or cancellation
 */
async clearWildcardCertDNSChallenge(id) {
  await this.execute(`
    UPDATE wildcard_ssl_certs
    SET dns_challenge_token      = NULL,
        dns_challenge_domain     = NULL,
        dns_challenge_status     = NULL,
        dns_challenge_expires_at = NULL,
        updated_at               = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [id]);
}

/**
 * Delete a wildcard SSL certificate by ID
 */
async deleteWildcardCert(id) {
  await this.execute('DELETE FROM wildcard_ssl_certs WHERE id = ?', [id]);
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

// Set domain as wildcard
async setDomainWildcard(domainId, isWildcard) {
  await this.execute(`
    UPDATE domains
    SET is_wildcard = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [isWildcard ? true : false, domainId]);
  return this.getDomainById(domainId);
}
}
