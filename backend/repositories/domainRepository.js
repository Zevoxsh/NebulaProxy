// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

import {
  getRandomExternalPortCandidate,
  isReservedExternalPort,
  AUTOMATIC_EXTERNAL_PORT_MIN,
  MAX_EXTERNAL_PORT
} from '../utils/externalPorts.js';

export class DomainRepository {
// ===== DOMAIN METHODS =====

getDomainById(id) {
  return this.queryOne('SELECT * FROM domains WHERE id = ?', [id]);
}

getDomainsByUserId(userId) {
  return this.queryAll(`
    SELECT * FROM domains
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [userId]);
}

async getDomainIdsByUserId(userId) {
  const rows = await this.queryAll('SELECT id FROM domains WHERE user_id = ? ORDER BY id ASC', [userId]);
  return rows.map((row) => row.id);
}

getAllDomains() {
  return this.queryAll(`
    SELECT
      d.*,
      u.username,
      u.display_name as user_display_name,
      t.name as team_name
    FROM domains d
    JOIN users u ON d.user_id = u.id
    LEFT JOIN teams t ON d.team_id = t.id
    ORDER BY d.created_at DESC
  `, []);
}

async countDomainsByUserId(userId) {
  const result = await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE user_id = ?', [userId]);
  return Number(result?.count || 0);
}

async countActiveDomains() {
  const result = await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE is_active = TRUE', []);
  return Number(result?.count || 0);
}

async createDomain(domainData) {
  const {
    userId, hostname, backendUrl, backendPort, description,
    proxyType = 'http', sslEnabled,
    externalPort: requestedExternalPort = null,
    acmeChallengeType = 'http-01',
    minecraftEdition = 'java'
  } = domainData;

  // Generate external port for TCP/UDP and Minecraft Bedrock
  let externalPort = null;
  const needsPort = proxyType === 'tcp' || proxyType === 'udp' ||
    (proxyType === 'minecraft' && minecraftEdition === 'bedrock');
  if (needsPort) {
    externalPort = requestedExternalPort || await this.generateExternalPort();
  }

  const sslStatus = sslEnabled ? 'pending' : 'disabled';
  const result = await this.execute(`
    INSERT INTO domains (user_id, hostname, backend_url, backend_port, description, proxy_type, external_port, ssl_enabled, ssl_status, acme_challenge_type, minecraft_edition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `, [
    userId,
    hostname,
    backendUrl,
    backendPort || null,
    description || null,
    proxyType,
    externalPort,
    sslEnabled ? true : false,
    sslStatus,
    acmeChallengeType,
    proxyType === 'minecraft' ? minecraftEdition : null
  ]);
  return this.getDomainById(result.rows[0].id);
}

async generateExternalPort() {
  let port;
  let attempts = 0;
  const maxAttempts = 100;

  do {
    port = getRandomExternalPortCandidate();
    if (port < AUTOMATIC_EXTERNAL_PORT_MIN || port > MAX_EXTERNAL_PORT || isReservedExternalPort(port)) {
      attempts++;
      continue;
    }
    const existing = await this.queryOne('SELECT id FROM domains WHERE external_port = ?', [port]);
    if (!existing) {
      return port;
    }
    attempts++;
  } while (attempts < maxAttempts);

  throw new Error('Unable to generate unique external port');
}

async updateDomain(domainId, updates) {
  const { hostname, backendUrl, backendPort, description, proxyType, sslEnabled, externalPort, bungeecordForwarding } = updates;
  const hasExternalPort = Object.prototype.hasOwnProperty.call(updates, 'externalPort');

  let sslStatus = null;
  if (sslEnabled !== undefined && sslEnabled !== null) {
    sslStatus = sslEnabled ? 'pending' : 'disabled';
  }

  await this.execute(`
    UPDATE domains
    SET
      hostname = COALESCE(?, hostname),
      backend_url = COALESCE(?, backend_url),
      backend_port = COALESCE(?, backend_port),
      description = COALESCE(?, description),
      proxy_type = COALESCE(?, proxy_type),
      external_port = CASE WHEN ? THEN ? ELSE external_port END,
      ssl_enabled = COALESCE(?, ssl_enabled),
      ssl_status = COALESCE(?, ssl_status),
      bungeecord_forwarding = COALESCE(?, bungeecord_forwarding),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    hostname ?? null,
    backendUrl ?? null,
    backendPort ?? null,
    description ?? null,
    proxyType ?? null,
    hasExternalPort,
    externalPort ?? null,
    sslEnabled !== undefined && sslEnabled !== null ? sslEnabled : null,
    sslStatus,
    bungeecordForwarding !== undefined && bungeecordForwarding !== null ? bungeecordForwarding : null,
    domainId
  ]);
  return this.getDomainById(domainId);
}

async updateDomainAdmin(domainId, updates) {
  const {
    hostname,
    backendUrl,
    backendPort,
    description,
    proxyType,
    sslEnabled,
    externalPort,
    userId,
    teamId,
    acmeChallengeType,
    isActive
  } = updates;

  const hasExternalPort = Object.prototype.hasOwnProperty.call(updates, 'externalPort');
  const hasTeamId = Object.prototype.hasOwnProperty.call(updates, 'teamId');
  const hasUserId = Object.prototype.hasOwnProperty.call(updates, 'userId');
  const hasChallengeType = Object.prototype.hasOwnProperty.call(updates, 'acmeChallengeType');
  const hasIsActive = Object.prototype.hasOwnProperty.call(updates, 'isActive');

  let sslStatus = null;
  if (sslEnabled !== undefined && sslEnabled !== null) {
    sslStatus = sslEnabled ? 'pending' : 'disabled';
  }

  await this.execute(`
    UPDATE domains
    SET
      user_id = CASE WHEN ? THEN ? ELSE user_id END,
      team_id = CASE WHEN ? THEN ? ELSE team_id END,
      hostname = COALESCE(?, hostname),
      backend_url = COALESCE(?, backend_url),
      backend_port = COALESCE(?, backend_port),
      description = COALESCE(?, description),
      proxy_type = COALESCE(?, proxy_type),
      external_port = CASE WHEN ? THEN ? ELSE external_port END,
      ssl_enabled = COALESCE(?, ssl_enabled),
      ssl_status = COALESCE(?, ssl_status),
      acme_challenge_type = CASE WHEN ? THEN ? ELSE acme_challenge_type END,
      is_active = CASE WHEN ? THEN ? ELSE is_active END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    hasUserId,
    userId ?? null,
    hasTeamId,
    teamId ?? null,
    hostname ?? null,
    backendUrl ?? null,
    backendPort ?? null,
    description ?? null,
    proxyType ?? null,
    hasExternalPort,
    externalPort ?? null,
    sslEnabled !== undefined && sslEnabled !== null ? sslEnabled : null,
    sslStatus,
    hasChallengeType,
    acmeChallengeType ?? null,
    hasIsActive,
    isActive !== undefined && isActive !== null ? isActive : null,
    domainId
  ]);

  return this.getDomainById(domainId);
}

async deleteDomain(domainId) {
  return this.execute('DELETE FROM domains WHERE id = ?', [domainId]);
}

async toggleDomainActive(domainId) {
  await this.execute(`
    UPDATE domains
    SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [domainId]);
  return this.getDomainById(domainId);
}

async updateDomainSSLStatus(domainId, status, certPath = null, keyPath = null, expiresAt = null) {
  await this.execute(`
    UPDATE domains
    SET
      ssl_status = ?,
      ssl_cert_path = COALESCE(?, ssl_cert_path),
      ssl_key_path = COALESCE(?, ssl_key_path),
      ssl_expires_at = COALESCE(?, ssl_expires_at),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [status, certPath, keyPath, expiresAt, domainId]);
  return this.getDomainById(domainId);
}
}
