// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

import { logger } from '../utils/logger.js';

export class TunnelRepository {
// ===== TUNNEL MANAGEMENT =====

async createTunnel(data) {
  const {
    userId,
    teamId = null,
    name,
    description = null,
    provider = 'cloudflare',
    publicDomain = null,
    publicSlug = null
  } = data;

  const resolvedPublicSlug = publicSlug || await this.getUniqueTunnelPublicSlug();

  return this.queryOne(`
    INSERT INTO tunnels (user_id, team_id, name, description, provider, public_domain, public_slug)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `, [userId, teamId, name, description, provider, publicDomain, resolvedPublicSlug]);
}

async getUniqueTunnelPublicSlug() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = generateTunnelPublicSlug();
    const existing = await this.queryOne('SELECT id FROM tunnels WHERE public_slug = ? LIMIT 1', [slug]);

    if (!existing) {
      return slug;
    }
  }

  throw new Error('Unable to generate a unique tunnel public slug');
}

async deleteTunnel(tunnelId) {
  await this.execute('DELETE FROM tunnels WHERE id = ?', [tunnelId]);
}

async getTunnelById(tunnelId) {
  return this.queryOne('SELECT * FROM tunnels WHERE id = ?', [tunnelId]);
}

async getTunnelsByUserId(userId) {
  return this.queryAll(`
    SELECT *
    FROM tunnels
    WHERE user_id = ?
    ORDER BY id DESC
  `, [userId]);
}

async getAccessibleTunnelsByUserId(userId) {
  return this.queryAll(`
    SELECT DISTINCT t.*
    FROM tunnels t
    LEFT JOIN tunnel_access ta ON ta.tunnel_id = t.id AND ta.user_id = ?
    WHERE t.user_id = ?
       OR ta.user_id = ?
       OR EXISTS (
         SELECT 1
         FROM team_members tm
         WHERE tm.team_id = t.team_id
           AND tm.user_id = ?
       )
    ORDER BY t.id DESC
  `, [userId, userId, userId, userId]);
}

async getAllTunnels() {
  return this.queryAll('SELECT * FROM tunnels ORDER BY id DESC', []);
}

async updateTunnelEnrollmentCode(tunnelId, codeHash, expiresAt) {
  await this.execute(`
    UPDATE tunnels
    SET enrollment_code_hash = ?, enrollment_code_expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [codeHash, expiresAt, tunnelId]);
  return this.getTunnelById(tunnelId);
}

async consumeTunnelEnrollmentCode(codeHash) {
  const tunnel = await this.queryOne(`
    SELECT *
    FROM tunnels
    WHERE enrollment_code_hash = ?
      AND enrollment_code_expires_at IS NOT NULL
      AND enrollment_code_expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `, [codeHash]);

  if (!tunnel) return null;

  await this.execute(`
    UPDATE tunnels
    SET enrollment_code_hash = NULL,
        enrollment_code_expires_at = NULL,
        status = 'active',
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [tunnel.id]);

  return this.getTunnelById(tunnel.id);
}

async getTunnelByEnrollmentCodeHash(codeHash) {
  return this.queryOne(`
    SELECT *
    FROM tunnels
    WHERE enrollment_code_hash = ?
      AND enrollment_code_expires_at IS NOT NULL
      AND enrollment_code_expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `, [codeHash]);
}

async createTunnelAgent(data) {
  const {
    tunnelId,
    name,
    platform = null,
    osName = null,
    arch = null,
    version = null,
    agentTokenHash
  } = data;

  return this.queryOne(`
    INSERT INTO tunnel_agents (tunnel_id, name, platform, os_name, arch, version, agent_token_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `, [tunnelId, name, platform, osName, arch, version, agentTokenHash]);
}

async getTunnelAgents(tunnelId) {
  return this.queryAll(`
    SELECT *
    FROM tunnel_agents
    WHERE tunnel_id = ?
    ORDER BY id DESC
  `, [tunnelId]);
}

async getTunnelAgentById(agentId) {
  return this.queryOne('SELECT * FROM tunnel_agents WHERE id = ?', [agentId]);
}

async getTunnelAgentByTokenHash(tokenHash) {
  return this.queryOne('SELECT * FROM tunnel_agents WHERE agent_token_hash = ?', [tokenHash]);
}

async updateTunnelAgentHeartbeat(agentId, { status = 'online' } = {}) {
  await this.execute(`
    UPDATE tunnel_agents
    SET status = ?, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        agent_token_last_used_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [status, agentId]);
  return this.getTunnelAgentById(agentId);
}

async deleteTunnelAgent(agentId) {
  return this.execute('DELETE FROM tunnel_agents WHERE id = ?', [agentId]);
}

async getTunnelBindings(tunnelId) {
  return this.queryAll(`
    SELECT *
    FROM tunnel_bindings
    WHERE tunnel_id = ?
    ORDER BY id DESC
  `, [tunnelId]);
}

async getTunnelBindingById(bindingId) {
  return this.queryOne('SELECT * FROM tunnel_bindings WHERE id = ?', [bindingId]);
}

async getTunnelBindingsByAgentId(agentId) {
  return this.queryAll(`
    SELECT *
    FROM tunnel_bindings
    WHERE agent_id = ?
      AND is_enabled = TRUE
    ORDER BY id DESC
  `, [agentId]);
}

async getActiveTunnelBindings() {
  return this.queryAll(`
    SELECT tb.*
    FROM tunnel_bindings tb
    JOIN tunnel_agents ta ON ta.id = tb.agent_id
    JOIN tunnels t ON t.id = tb.tunnel_id
    WHERE tb.is_enabled = TRUE
      AND tb.protocol IN ('tcp', 'udp')
      AND t.status IN ('active', 'pending')
  `, []);
}

async getActiveTcpTunnelBindings() {
  return this.queryAll(`
    SELECT tb.*
    FROM tunnel_bindings tb
    JOIN tunnel_agents ta ON ta.id = tb.agent_id
    JOIN tunnels t ON t.id = tb.tunnel_id
    WHERE tb.is_enabled = TRUE
      AND tb.protocol = 'tcp'
      AND t.status IN ('active', 'pending')
  `, []);
}

async createTunnelBinding(data) {
  const {
    tunnelId,
    agentId = null,
    label,
    protocol = 'tcp',
    localPort,
    publicPort,
    publicHostname,
    targetHost = '127.0.0.1'
  } = data;

  return this.queryOne(`
    INSERT INTO tunnel_bindings (tunnel_id, agent_id, label, protocol, local_port, public_port, public_hostname, target_host)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `, [tunnelId, agentId, label, protocol, localPort, publicPort, publicHostname, targetHost]);
}

async updateTunnelBinding(bindingId, updates) {
  const { label, protocol, localPort, publicPort, publicHostname, targetHost, isEnabled, agentId } = updates;
  const hasAgentId = Object.prototype.hasOwnProperty.call(updates, 'agentId');

  await this.execute(`
    UPDATE tunnel_bindings
    SET
      label = COALESCE(?, label),
      protocol = COALESCE(?, protocol),
      local_port = COALESCE(?, local_port),
      public_port = COALESCE(?, public_port),
      public_hostname = COALESCE(?, public_hostname),
      target_host = COALESCE(?, target_host),
      is_enabled = COALESCE(?, is_enabled),
      agent_id = CASE WHEN ? THEN ? ELSE agent_id END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    label ?? null,
    protocol ?? null,
    localPort ?? null,
    publicPort ?? null,
    publicHostname ?? null,
    targetHost ?? null,
    isEnabled !== undefined && isEnabled !== null ? isEnabled : null,
    hasAgentId,
    agentId ?? null,
    bindingId
  ]);

  return this.getTunnelBindingById(bindingId);
}

async deleteTunnelBinding(bindingId) {
  return this.execute('DELETE FROM tunnel_bindings WHERE id = ?', [bindingId]);
}

async getTunnelAccessEntries(tunnelId) {
  return this.queryAll(`
    SELECT ta.*, u.username, u.email, u.display_name
    FROM tunnel_access ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.tunnel_id = ?
    ORDER BY ta.created_at DESC
  `, [tunnelId]);
}

async getTunnelAccessEntry(tunnelId, userId) {
  return this.queryOne(`
    SELECT *
    FROM tunnel_access
    WHERE tunnel_id = ? AND user_id = ?
    LIMIT 1
  `, [tunnelId, userId]);
}

async grantTunnelAccess({ tunnelId, userId, role = 'view', grantedBy = null }) {
  return this.queryOne(`
    INSERT INTO tunnel_access (tunnel_id, user_id, role, granted_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (tunnel_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [tunnelId, userId, role, grantedBy]);
}

async revokeTunnelAccess(tunnelId, userId) {
  return this.execute('DELETE FROM tunnel_access WHERE tunnel_id = ? AND user_id = ?', [tunnelId, userId]);
}

// Get all active domains
async getAllActiveDomains() {
  try {
    // Try to get all domains with full data
    return await this.queryAll('SELECT * FROM domains WHERE is_active = TRUE ORDER BY id', []);
  } catch (error) {
    // If TOAST corruption error (XX001), try to recover domain by domain
    if (error.code === 'XX001') {
      logger.warn('[Database] TOAST corruption detected, attempting recovery...');
      
      try {
        // Get only IDs first (safe, as id is not a large value)
        const ids = await this.queryAll('SELECT id FROM domains WHERE is_active = TRUE ORDER BY id', []);
        const recoveredDomains = [];
        
        // Try to fetch each domain individually with essential columns only
        for (const { id } of ids) {
          try {
            const domain = await this.queryOne(`
              SELECT 
                id, user_id, team_id, hostname, backend_url, backend_port,
                proxy_type, external_port, ssl_enabled, ssl_status
              WHERE id = ? AND is_active = TRUE
              LIMIT 1
            `, [id]);
            
            if (domain) {
              recoveredDomains.push(domain);
            }
          } catch (domainError) {
            logger.error(`[Database] Failed to recover domain ${id}:`, domainError.message);
            // Skip corrupted domain and continue
          }
        }
        
        logger.info(`[Database] Recovered ${recoveredDomains.length}/${ids.length} domains`);
        return recoveredDomains;
      } catch (recoveryError) {
        logger.error('[Database] Domain recovery failed:', recoveryError);
        return []; // Return empty array to allow server to start
      }
    }
    
    // Re-throw other errors
    throw error;
  }
}

// Get active domains by proxy type (tcp, udp, http)
getActiveDomainsByType(proxyType) {
  return this.queryAll(`
    SELECT * FROM domains
    WHERE is_active = TRUE AND proxy_type = ?
    ORDER BY id
  `, [proxyType]);
}

// Get domain by hostname (for HTTP/HTTPS routing with Host header)
getDomainByHostname(hostname) {
  return this.queryOne(`
    SELECT * FROM domains
    WHERE hostname = ? AND is_active = TRUE
    LIMIT 1
  `, [hostname]);
}

// Get domain by hostname + proxy_type (for uniqueness checks)
getDomainByHostnameAndType(hostname, proxyType) {
  return this.queryOne(`
    SELECT * FROM domains
    WHERE hostname = ? AND proxy_type = ? AND is_active = TRUE
    LIMIT 1
  `, [hostname, proxyType]);
}

// Update domain ACME status after certificate generation
async updateDomainACMEStatus(domainId, certPath, keyPath, expiresAt) {
  await this.execute(`
    UPDATE domains
    SET ssl_status = 'active',
        ssl_cert_path = ?,
        ssl_key_path = ?,
        ssl_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [certPath, keyPath, expiresAt, domainId]);
  return this.getDomainById(domainId);
}
}
