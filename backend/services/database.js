import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPgPool } from '../config/database.js';
import { config } from '../config/config.js';
import { logBroadcastService } from './logBroadcastService.js';
import {
  AUTOMATIC_EXTERNAL_PORT_MIN,
  MAX_EXTERNAL_PORT,
  getRandomExternalPortCandidate,
  isReservedExternalPort
} from '../utils/externalPorts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, '..', 'migrations');

function generateTunnelPublicSlug(length = 12) {
  return crypto.randomBytes(16).toString('hex').slice(0, length);
}

class DatabaseService {
  constructor() {
    this.pgPool = null;
  }

  async init() {
    // Use PostgreSQL only
    this.pgPool = getPgPool();
    if (!config.logging.quiet) {
      console.log('[Database] Using PostgreSQL');
    }
    await this.runMigrations();
    await this.verifySchema();
    await this.ensureTunnelPublicSlugs();
    if (!config.logging.quiet) {
      console.log('[Database] Initialized successfully');
    }
  }

  async getMissingTables() {
    const requiredTables = [
      'users',
      'teams',
      'team_members',
      'team_invitations',
      'domains',
      'redirections',
      'audit_logs',
      'proxy_logs',
      'health_checks',
      'domain_health_status',
      'custom_headers',
      'cache_settings',
      'cdn_settings',
      'notification_settings',
      'team_notification_settings',
      'request_logs',
      'domain_groups',
      'domain_group_assignments',
      'domain_group_members',
      'domain_backends',
      'backend_health_status',
      'ddos_ip_bans',
      'ddos_blocklist_meta',
      'ddos_whitelist',
      'ddos_attack_events',
      'tunnels',
      'tunnel_agents',
      'tunnel_bindings',
      'tunnel_access'
    ];

    const result = await this.pgPool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [requiredTables]
    );

    const existing = new Set(result.rows.map(row => row.table_name));
    return requiredTables.filter(name => !existing.has(name));
  }

  async runMigrations() {
    let files;
    try {
      files = await fs.promises.readdir(migrationsDir);
    } catch (error) {
      const err = new Error(`Unable to read migrations directory: ${migrationsDir}`);
      err.code = 'MIGRATION_READ_FAILED';
      throw err;
    }

    const sqlFiles = files
      .filter(file => /^\d+_.*\.sql$/i.test(file))
      .sort((a, b) => a.localeCompare(b));

    await this.pgPool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const appliedRows = await this.pgPool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map(row => row.filename));

    for (const file of sqlFiles) {
      if (applied.has(file)) {
        continue;
      }
      const filePath = join(migrationsDir, file);
      const sql = await fs.promises.readFile(filePath, 'utf-8');
      if (sql.trim().length === 0) {
        continue;
      }
      console.log(`[Database] Applying migration: ${file}`);
      try {
        await this.pgPool.query(sql);
        await this.pgPool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      } catch (error) {
        if (file === '001_initial_schema.sql' && error.code === '42710') {
          console.warn('[Database] Base schema already exists. Marking 001_initial_schema.sql as applied.');
          await this.pgPool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
          continue;
        }
        throw error;
      }
    }
  }

  async verifySchema() {
    const missing = await this.getMissingTables();

    if (missing.length > 0) {
      const error = new Error(`Missing database tables: ${missing.join(', ')}`);
      error.code = 'SCHEMA_MISSING';
      throw error;
    }
  }

  async ensureTunnelPublicSlugs() {
    const tunnels = await this.queryAll(`
      SELECT id, public_slug
      FROM tunnels
      WHERE public_slug IS NULL
         OR public_slug = ''
      ORDER BY id ASC
    `, []);

    if (tunnels.length === 0) {
      return;
    }

    const existingSlugs = new Set(
      (await this.queryAll(`
        SELECT public_slug
        FROM tunnels
        WHERE public_slug IS NOT NULL
          AND public_slug <> ''
      `, [])).map((row) => String(row.public_slug))
    );

    for (const tunnel of tunnels) {
      let slug = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = generateTunnelPublicSlug();
        if (!existingSlugs.has(candidate)) {
          slug = candidate;
          existingSlugs.add(candidate);
          break;
        }
      }

      if (!slug) {
        throw new Error(`Unable to generate a unique public slug for tunnel ${tunnel.id}`);
      }

      await this.execute('UPDATE tunnels SET public_slug = ? WHERE id = ?', [slug, tunnel.id]);
    }
  }

  // Helper: Execute a query and return one row
  async queryOne(sql, params = []) {
    // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
    let pgSql = sql;
    let pgParams = [...params];
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

    const result = await this.pgPool.query(pgSql, pgParams);
    return result.rows[0] || null;
  }

  // Helper: Execute a query and return all rows
  async queryAll(sql, params = []) {
    let pgSql = sql;
    let pgParams = [...params];
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

    const result = await this.pgPool.query(pgSql, pgParams);
    return result.rows;
  }

  // Helper: Execute a query (INSERT/UPDATE/DELETE)
  async execute(sql, params = []) {
    let pgSql = sql;
    let pgParams = [...params];
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

    const result = await this.pgPool.query(pgSql, pgParams);
    return result;
  }

  // ===== USER METHODS =====

  async getUserByUsername(username) {
    return this.queryOne('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
  }

  async getUserById(id) {
    return this.queryOne('SELECT * FROM users WHERE id = ?', [id]);
  }

  async updateUserProfile(userId, updates = {}) {
    const { displayName, email, avatarUrl } = updates;

    // Build dynamic SET clause based on what's being updated
    const setClauses = ['updated_at = CURRENT_TIMESTAMP'];
    const values = [];

    if (displayName !== undefined) {
      setClauses.push('display_name = ?');
      values.push(displayName);
    }

    if (email !== undefined) {
      setClauses.push('email = ?');
      values.push(email);
    }

    if (avatarUrl !== undefined) {
      setClauses.push('avatar_url = ?');
      setClauses.push('avatar_updated_at = CURRENT_TIMESTAMP');
      values.push(avatarUrl);
    }

    values.push(userId);

    await this.execute(`
      UPDATE users
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `, values);

    return this.getUserById(userId);
  }

  async createUser(userData) {
    const {
      username,
      displayName,
      email,
      role,
      passwordHash
    } = userData;
    const maxDomains = role === 'admin' ? 999 : 5;
    const maxProxies = role === 'admin' ? 999 : 5;

    const result = await this.execute(`
      INSERT INTO users (username, display_name, email, role, max_domains, max_proxies, last_login_at, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      RETURNING id
    `, [username, displayName, email || null, role, maxDomains, maxProxies, passwordHash || null]);

    return this.getUserById(result.rows[0].id);
  }

  async updateUserLoginTime(userId) {
    await this.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
  }

  async getAllUsers() {
    return this.queryAll(`
      SELECT
        u.*,
        COUNT(d.id) as domain_count
      FROM users u
      LEFT JOIN domains d ON u.id = d.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `, []);
  }

  async updateUserQuotas(userId, maxDomains, maxProxies) {
    await this.execute(`
      UPDATE users
      SET max_domains = ?, max_proxies = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [maxDomains, maxProxies, userId]);
    return this.getUserById(userId);
  }

  async toggleUserActive(userId) {
    await this.execute(`
      UPDATE users
      SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [userId]);
    return this.getUserById(userId);
  }

  async deleteUser(userId) {
    return this.execute('DELETE FROM users WHERE id = ?', [userId]);
  }

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

  async createDomain(domainData) {
    const {
      userId, hostname, backendUrl, backendPort, description,
      proxyType = 'http', sslEnabled,
      externalPort: requestedExternalPort = null,
      acmeChallengeType = 'http-01', isWildcard = false,
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
      INSERT INTO domains (user_id, hostname, backend_url, backend_port, description, proxy_type, external_port, ssl_enabled, ssl_status, acme_challenge_type, is_wildcard, minecraft_edition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      isWildcard ? true : false,
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
        console.warn('[Database] TOAST corruption detected, attempting recovery...');
        
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
                  proxy_type, external_port, ssl_enabled, ssl_status,
                  AND enrollment_code_expires_at IS NOT NULL
                  AND enrollment_code_expires_at > CURRENT_TIMESTAMP
                LIMIT 1
                WHERE id = ? AND is_active = TRUE
              `, [id]);
              
              if (domain) {
                recoveredDomains.push(domain);
              }
            } catch (domainError) {
              console.error(`[Database] Failed to recover domain ${id}:`, domainError.message);
              // Skip corrupted domain and continue
            }
          }
          
          console.log(`[Database] Recovered ${recoveredDomains.length}/${ids.length} domains`);
          return recoveredDomains;
        } catch (recoveryError) {
          console.error('[Database] Domain recovery failed:', recoveryError);

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
    console.log(`[DB] SSL certificate stored in DB for domain ID ${domainId}`);
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
      SELECT id, hostname, issuer, issued_at, expires_at, cert_type, auto_apply, created_at, updated_at
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
    console.log(`[DB] SSL certificate deleted from DB for domain ID ${domainId}`);
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

  // ===== TEAM METHODS =====

  // Create a new team
  async createTeam(name, ownerId, maxDomains = null) {
    const result = await this.execute(`
      INSERT INTO teams (name, owner_id, max_domains)
      VALUES (?, ?, ?)
      RETURNING id
    `, [name, ownerId, maxDomains]);
    const teamId = result.rows[0].id;

    // Automatically add the owner as a team member with 'owner' role
    await this.execute(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES (?, ?, 'owner')
    `, [teamId, ownerId]);

    return this.getTeamById(teamId);
  }

  // Get team by ID with owner information
  getTeamById(teamId) {
    return this.queryOne(`
      SELECT
        t.*,
        u.username as owner_username,
        u.display_name as owner_display_name
      FROM teams t
      JOIN users u ON t.owner_id = u.id
      WHERE t.id = ?
    `, [teamId]);
  }

  // Get all teams a user is part of (as owner or member)
  getTeamsByUserId(userId) {
    return this.queryAll(`
      SELECT
        t.*,
        u.username as owner_username,
        u.display_name as owner_display_name,
        tm.role as user_role
      FROM teams t
      JOIN users u ON t.owner_id = u.id
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = ?
      ORDER BY t.created_at DESC
    `, [userId]);
  }

  /**
   * PERFORMANCE OPTIMIZATION: Get enriched teams for user with single query
   * Replaces N+1 query pattern where each team triggered 4 separate queries
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Enriched teams with counts and permissions
   */
  async getEnrichedTeamsForUser(userId) {
    const result = await this.queryAll(`
      SELECT
        t.id,
        t.name,
        t.owner_id,
        t.max_domains,
        t.created_at,
        t.updated_at,
        t.logo_url,
        t.logo_updated_at,
        u.username as owner_username,
        u.display_name as owner_display_name,
        tm_user.role as user_role,
        tm_user.can_manage_domains,
        tm_user.can_manage_members,
        tm_user.can_manage_settings,
        COUNT(DISTINCT tm_all.user_id) as member_count,
        COUNT(DISTINCT d.id) as domain_count,
        t.max_domains as domain_quota
      FROM teams t
      INNER JOIN users u ON t.owner_id = u.id
      INNER JOIN team_members tm_user ON t.id = tm_user.team_id AND tm_user.user_id = ?
      LEFT JOIN team_members tm_all ON t.id = tm_all.team_id
      LEFT JOIN domains d ON t.id = d.team_id
      WHERE tm_user.user_id = ?
      GROUP BY
        t.id,
        t.name,
        t.owner_id,
        t.max_domains,
        t.created_at,
        t.updated_at,
        t.logo_url,
        t.logo_updated_at,
        u.username,
        u.display_name,
        tm_user.role,
        tm_user.can_manage_domains,
        tm_user.can_manage_members,
        tm_user.can_manage_settings
      ORDER BY t.created_at DESC
    `, [userId, userId]);

    // Transform to match expected format
    return result.map(row => ({
      id: row.id,
      name: row.name,
      owner_id: row.owner_id,
      max_domains: row.max_domains,
      created_at: row.created_at,
      updated_at: row.updated_at,
      logo_url: row.logo_url,
      logo_updated_at: row.logo_updated_at,
      owner_username: row.owner_username,
      owner_display_name: row.owner_display_name,
      user_role: row.user_role || 'member',
      member_count: parseInt(row.member_count, 10),
      domain_count: parseInt(row.domain_count, 10),
      domain_quota: row.domain_quota,
      can_add_domain: parseInt(row.domain_count, 10) < row.domain_quota,
      can_manage_domains: row.can_manage_domains,
      can_manage_members: row.can_manage_members,
      can_manage_settings: row.can_manage_settings
    }));
  }

  // Get all teams (admin only)
  getAllTeams() {
    return this.queryAll(`
      SELECT
        t.*,
        u.username as owner_username,
        u.display_name as owner_display_name,
        COUNT(DISTINCT tm.user_id) as member_count,
        COUNT(DISTINCT d.id) as domain_count
      FROM teams t
      JOIN users u ON t.owner_id = u.id
      LEFT JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN domains d ON t.id = d.team_id
      GROUP BY t.id, u.id
      ORDER BY t.created_at DESC
    `, []);
  }

  // Update team name or max_domains
  async updateTeam(teamId, data) {
    const { name, maxDomains } = data;

    await this.execute(`
      UPDATE teams
      SET
        name = COALESCE(?, name),
        max_domains = COALESCE(?, max_domains),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [name ?? null, maxDomains ?? null, teamId]);
    return this.getTeamById(teamId);
  }

  // Update team logo
  async updateTeamLogo(teamId, logoUrl) {
    await this.execute(`
      UPDATE teams
      SET
        logo_url = ?,
        logo_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [logoUrl, teamId]);
    return this.getTeamById(teamId);
  }

  // Delete team (cascades to team_members and removes team_id from domains)
  async deleteTeam(teamId) {
    return this.execute('DELETE FROM teams WHERE id = ?', [teamId]);
  }

  // Add a user to a team
  async addTeamMember(teamId, userId, role = 'member', permissions = {}) {
    const { canManageDomains = 0, canManageMembers = 0, canManageSettings = 0 } = permissions;

    try {
      await this.execute(`
        INSERT INTO team_members (team_id, user_id, role, can_manage_domains, can_manage_members, can_manage_settings)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        teamId,
        userId,
        role,
        canManageDomains ? 1 : 0,
        canManageMembers ? 1 : 0,
        canManageSettings ? 1 : 0
      ]);
      return { success: true };
    } catch (err) {
      if (err.code === '23505') {
        return { success: false, error: 'User is already a member of this team' };
      }
      throw err;
    }
  }

  // Update team member permissions
  async updateTeamMemberPermissions(teamId, userId, permissions) {
    const { canManageDomains, canManageMembers, canManageSettings } = permissions;

    await this.execute(`
      UPDATE team_members
      SET can_manage_domains = ?,
          can_manage_members = ?,
          can_manage_settings = ?
      WHERE team_id = ? AND user_id = ?
    `, [
      canManageDomains ? 1 : 0,
      canManageMembers ? 1 : 0,
      canManageSettings ? 1 : 0,
      teamId,
      userId
    ]);

    const members = await this.getTeamMembers(teamId);
    return members.find(m => m.user_id === userId);
  }

  // Check if user has specific permission in team
  async hasTeamPermission(teamId, userId, permission) {
    const result = await this.queryOne(`
      SELECT role, ${permission} as has_permission FROM team_members
      WHERE team_id = ? AND user_id = ?
    `, [teamId, userId]);

    if (!result) return false;
    if (result.role === 'owner') return true; // Owner has all permissions
    return Boolean(result.has_permission); // INTEGER 0/1 from PostgreSQL → boolean
  }

  // Remove a user from a team
  async removeTeamMember(teamId, userId) {
    return this.execute(`
      DELETE FROM team_members
      WHERE team_id = ? AND user_id = ?
    `, [teamId, userId]);
  }

  // Get all members of a team with their user information
  getTeamMembers(teamId) {
    return this.queryAll(`
      SELECT
        tm.*,
        u.username,
        u.display_name,
        u.avatar_url,
        u.email,
        u.max_domains,
        u.is_active
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
      ORDER BY
        CASE tm.role
          WHEN 'owner' THEN 1
          WHEN 'member' THEN 2
        END,
        tm.joined_at ASC
    `, [teamId]);
  }

  // Get a specific team member's role
  async getTeamMemberRole(teamId, userId) {
    const result = await this.queryOne(`
      SELECT role FROM team_members
      WHERE team_id = ? AND user_id = ?
    `, [teamId, userId]);
    return result ? result.role : null;
  }

  // Check if user is a member of a team
  async isTeamMember(teamId, userId) {
    const result = await this.queryOne(`
      SELECT COUNT(*) as count FROM team_members
      WHERE team_id = ? AND user_id = ?
    `, [teamId, userId]);
    return Number(result?.count || 0) > 0;
  }

  // Calculate team's total domain quota (sum of all members' max_domains)
  async getTeamDomainQuota(teamId) {
    // If team has a custom max_domains set, use that
    const team = await this.getTeamById(teamId);
    if (team && team.max_domains !== null && team.max_domains !== undefined) {
      return Number(team.max_domains);
    }

    // Otherwise, sum all team members' max_domains
    const result = await this.queryOne(`
      SELECT SUM(u.max_domains) as total_quota
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
    `, [teamId]);
    return Number(result?.total_quota || 0);
  }

  // Count domains owned by a team
  async getTeamDomainCount(teamId) {
    const result = await this.queryOne(`
      SELECT COUNT(*) as count FROM domains
      WHERE team_id = ?
    `, [teamId]);
    return Number(result?.count || 0);
  }

  // Check if team can add more domains
  async canTeamAddDomain(teamId) {
    const quota = await this.getTeamDomainQuota(teamId);
    const current = await this.getTeamDomainCount(teamId);
    return current < quota;
  }

  // Get domains by team ID
  getDomainsByTeamId(teamId) {
    return this.queryAll(`
      SELECT
        d.*,
        u.username,
        u.display_name as user_display_name
      FROM domains d
      JOIN users u ON d.user_id = u.id
      WHERE d.team_id = ?
      ORDER BY d.created_at DESC
    `, [teamId]);
  }

  // Get all domains accessible by a user (personal + team domains)
  async getDomainsByUserIdWithTeams(userId) {
    const domains = await this.queryAll(`
      SELECT
        d.*,
        u.username,
        u.display_name as user_display_name,
        t.name as team_name,
        CASE
          WHEN d.team_id IS NULL THEN 'personal'
          ELSE 'team'
        END as ownership_type,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', dg.id,
                'name', dg.name,
                'color', dg.color,
                'icon', dg.icon
              )
            )
            FROM domain_group_assignments dga
            JOIN domain_groups dg ON dga.group_id = dg.id
            WHERE dga.domain_id = d.id
              AND dg.is_active = TRUE
          ),
          '[]'::json
        ) as groups
      FROM domains d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN teams t ON d.team_id = t.id
      WHERE d.user_id = $1
         OR d.team_id IN (
           SELECT team_id FROM team_members WHERE user_id = $2
         )
      ORDER BY d.created_at DESC
    `, [userId, userId]);

    // Convert groups from JSON string to array if needed
    return domains.map(domain => ({
      ...domain,
      groups: typeof domain.groups === 'string' ? JSON.parse(domain.groups) : domain.groups
    }));
  }

  // Assign domain to team
  async assignDomainToTeam(domainId, teamId) {
    await this.execute(`
      UPDATE domains
      SET team_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [teamId, domainId]);
    return this.getDomainById(domainId);
  }

  // Remove domain from team (make it personal)
  async removeDomainFromTeam(domainId) {
    await this.execute(`
      UPDATE domains
      SET team_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [domainId]);
    return this.getDomainById(domainId);
  }

  // ===== TEAM INVITATION METHODS =====

  // Create a team invitation
  async createTeamInvitation(teamId, inviterId, invitedUserId, permissions = {}) {
    const { canManageDomains = 0, canManageMembers = 0, canManageSettings = 0 } = permissions;

    // Check if there's already a pending invitation
    const pendingInvitation = await this.queryOne(`
      SELECT id FROM team_invitations
      WHERE team_id = ? AND invited_user_id = ? AND status = 'pending'
    `, [teamId, invitedUserId]);

    if (pendingInvitation) {
      return { success: false, error: 'Invitation already sent to this user' };
    }

    // Delete any old invitations (accepted/rejected) to allow re-invitation
    await this.execute(`
      DELETE FROM team_invitations
      WHERE team_id = ? AND invited_user_id = ? AND status != 'pending'
    `, [teamId, invitedUserId]);

    // Create the new invitation
    await this.execute(`
      INSERT INTO team_invitations (team_id, inviter_id, invited_user_id, can_manage_domains, can_manage_members, can_manage_settings)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      teamId,
      inviterId,
      invitedUserId,
      canManageDomains ? 1 : 0,
      canManageMembers ? 1 : 0,
      canManageSettings ? 1 : 0
    ]);

    return { success: true };
  }

  // Get all pending invitations for a user
  getUserPendingInvitations(userId) {
    return this.queryAll(`
      SELECT
        ti.*,
        t.name as team_name,
        t.owner_id,
        inviter.username as inviter_username,
        inviter.display_name as inviter_display_name
      FROM team_invitations ti
      JOIN teams t ON ti.team_id = t.id
      JOIN users inviter ON ti.inviter_id = inviter.id
      WHERE ti.invited_user_id = ? AND ti.status = 'pending'
      ORDER BY ti.created_at DESC
    `, [userId]);
  }

  // Get all invitations for a team
  getTeamInvitations(teamId) {
    return this.queryAll(`
      SELECT
        ti.*,
        invited.username as invited_username,
        invited.display_name as invited_display_name,
        invited.email as invited_email,
        inviter.username as inviter_username,
        inviter.display_name as inviter_display_name
      FROM team_invitations ti
      JOIN users invited ON ti.invited_user_id = invited.id
      JOIN users inviter ON ti.inviter_id = inviter.id
      WHERE ti.team_id = ?
      ORDER BY ti.created_at DESC
    `, [teamId]);
  }

  // Accept a team invitation
  async acceptTeamInvitation(invitationId, userId) {
    const invitation = await this.queryOne('SELECT * FROM team_invitations WHERE id = ?', [invitationId]);

    if (!invitation) {
      return { success: false, error: 'Invitation not found' };
    }

    if (invitation.invited_user_id !== userId) {
      return { success: false, error: 'Unauthorized' };
    }

    if (invitation.status !== 'pending') {
      return { success: false, error: 'Invitation already responded to' };
    }

    // Update invitation status
    await this.execute(`
      UPDATE team_invitations
      SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [invitationId]);

    // Add user to team with permissions from invitation
    const addResult = await this.addTeamMember(invitation.team_id, userId, 'member', {
      canManageDomains: invitation.can_manage_domains,
      canManageMembers: invitation.can_manage_members,
      canManageSettings: invitation.can_manage_settings
    });

    if (!addResult.success) {
      return addResult;
    }

    return { success: true, teamId: invitation.team_id };
  }

  // Reject a team invitation
  async rejectTeamInvitation(invitationId, userId) {
    const invitation = await this.queryOne('SELECT * FROM team_invitations WHERE id = ?', [invitationId]);

    if (!invitation) {
      return { success: false, error: 'Invitation not found' };
    }

    if (invitation.invited_user_id !== userId) {
      return { success: false, error: 'Unauthorized' };
    }

    if (invitation.status !== 'pending') {
      return { success: false, error: 'Invitation already responded to' };
    }

    await this.execute(`
      UPDATE team_invitations
      SET status = 'rejected', responded_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [invitationId]);

    return { success: true };
  }

  // Cancel a team invitation (by inviter or team owner)
  async cancelTeamInvitation(invitationId) {
    await this.execute('DELETE FROM team_invitations WHERE id = ?', [invitationId]);
    return { success: true };
  }

  // Count pending invitations for a user
  async countUserPendingInvitations(userId) {
    const result = await this.queryOne(`
      SELECT COUNT(*) as count FROM team_invitations
      WHERE invited_user_id = ? AND status = 'pending'
    `, [userId]);
    return Number(result?.count || 0);
  }

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

  // ===== STATS METHODS =====

  async getStats() {
    const totalUsers = Number((await this.queryOne('SELECT COUNT(*) as count FROM users', []))?.count || 0);
    const adminCount = Number((await this.queryOne('SELECT COUNT(*) as count FROM users WHERE role = \'admin\'', []))?.count || 0);
    const totalDomains = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains', []))?.count || 0);
    const activeDomains = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE is_active = TRUE', []))?.count || 0);
    const sslEnabledDomains = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE ssl_enabled = TRUE', []))?.count || 0);
    const activeSSLDomains = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE ssl_status = \'active\'', []))?.count || 0);
    const httpProxies = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE proxy_type = \'http\'', []))?.count || 0);
    const tcpProxies = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE proxy_type = \'tcp\'', []))?.count || 0);
    const udpProxies = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE proxy_type = \'udp\'', []))?.count || 0);
    const totalTeams = Number((await this.queryOne('SELECT COUNT(*) as count FROM teams', []))?.count || 0);
    const teamMembersCount = Number((await this.queryOne('SELECT COUNT(*) as count FROM team_members', []))?.count || 0);
    const totalRedirections = Number((await this.queryOne('SELECT COUNT(*) as count FROM redirections', []))?.count || 0);
    const activeRedirections = Number((await this.queryOne('SELECT COUNT(*) as count FROM redirections WHERE is_active = TRUE', []))?.count || 0);
    const totalRedirectionClicks = Number((await this.queryOne('SELECT COALESCE(SUM(click_count), 0) as count FROM redirections', []))?.count || 0);

    const avgDomainsPerUser = totalUsers > 0 ? totalDomains / totalUsers : 0;
    const avgMembersPerTeam = totalTeams > 0 ? teamMembersCount / totalTeams : 0;

    return {
      totalUsers,
      adminCount,
      totalDomains,
      activeDomains,
      sslEnabledDomains,
      activeSSLDomains,
      httpProxies,
      tcpProxies,
      udpProxies,
      totalTeams,
      teamMembersCount,
      avgMembersPerTeam,
      totalRedirections,
      activeRedirections,
      totalRedirectionClicks,
      avgDomainsPerUser
    };
  }

  // ===== PROXY LOGS METHODS =====

  async createProxyLog(logData) {
    const { domainId, hostname, method, path, status, responseTime, ipAddress, userAgent, level } = logData;

    await this.execute(`
      INSERT INTO proxy_logs (domain_id, hostname, method, path, status, response_time, ip_address, user_agent, level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [domainId || null, hostname, method, path, status, responseTime, ipAddress || null, userAgent || null, level]);

    // Broadcast log to WebSocket clients
    try {
      logBroadcastService.broadcastProxyLog({
        id: Date.now(),
        timestamp: new Date(),
        domain_id: domainId,
        domainId: domainId,
        hostname,
        method,
        path,
        status,
        statusCode: status,
        response_time: responseTime,
        responseTime,
        ip_address: ipAddress,
        ipAddress,
        user_agent: userAgent,
        userAgent,
        level,
        protocol: method || 'TCP' // Determine protocol from method if available
      });
    } catch (error) {
      // Don't fail the log creation if broadcast fails
      console.error('[Database] Failed to broadcast proxy log:', error.message);
    }
  }

  getProxyLogs(limit = 100, offset = 0, level = null) {
    let query = `
      SELECT * FROM proxy_logs
      ${level ? 'WHERE level = ?' : ''}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    return level
      ? this.queryAll(query, [level, limit, offset])
      : this.queryAll(query, [limit, offset]);
  }

  getProxyLogsByDomain(domainId, limit = 50) {
    return this.queryAll(`
      SELECT * FROM proxy_logs
      WHERE domain_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [domainId, limit]);
  }

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

  // ===== CUSTOM HEADERS METHODS =====

  async createCustomHeader(domainId, headerName, headerValue) {
    const result = await this.execute(`
      INSERT INTO custom_headers (domain_id, header_name, header_value)
      VALUES (?, ?, ?)
      RETURNING id
    `, [domainId, headerName, headerValue]);
    return this.getCustomHeaderById(result.rows[0].id);
  }

  getCustomHeaderById(id) {
    return this.queryOne('SELECT * FROM custom_headers WHERE id = ?', [id]);
  }

  getCustomHeadersByDomainId(domainId) {
    return this.queryAll(`
      SELECT * FROM custom_headers
      WHERE domain_id = ?
      ORDER BY created_at DESC
    `, [domainId]);
  }

  getAllCustomHeaders() {
    return this.queryAll(`
      SELECT
        h.*,
        d.hostname
      FROM custom_headers h
      JOIN domains d ON h.domain_id = d.id
      ORDER BY d.hostname, h.created_at DESC
    `, []);
  }

  async deleteCustomHeader(id) {
    return this.execute('DELETE FROM custom_headers WHERE id = ?', [id]);
  }

  async toggleCustomHeaderActive(id) {
    await this.execute(`
      UPDATE custom_headers
      SET is_active = NOT is_active
      WHERE id = ?
    `, [id]);
    return this.getCustomHeaderById(id);
  }

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

  // ===== CDN SETTINGS METHODS =====

  getCDNSettings(userId) {
    return this.queryOne('SELECT * FROM cdn_settings WHERE user_id = ?', [userId]);
  }

  async upsertCDNSettings(userId, settings) {
    const {
      enabled,
      autoMinifyHtml,
      autoMinifyCss,
      autoMinifyJs,
      compressionGzip,
      compressionBrotli,
      imageOptimization,
      http2Enabled,
      http3Enabled
    } = settings;

    const existing = await this.getCDNSettings(userId);

    if (existing) {
      await this.execute(`
        UPDATE cdn_settings
        SET enabled = ?, auto_minify_html = ?, auto_minify_css = ?, auto_minify_js = ?,
            compression_gzip = ?, compression_brotli = ?, image_optimization = ?,
            http2_enabled = ?, http3_enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `, [
        enabled ? true : false,
        autoMinifyHtml ? true : false,
        autoMinifyCss ? true : false,
        autoMinifyJs ? true : false,
        compressionGzip ? true : false,
        compressionBrotli ? true : false,
        imageOptimization ? true : false,
        http2Enabled ? true : false,
        http3Enabled ? true : false,
        userId
      ]);
    } else {
      await this.execute(`
        INSERT INTO cdn_settings (user_id, enabled, auto_minify_html, auto_minify_css, auto_minify_js,
                                   compression_gzip, compression_brotli, image_optimization, http2_enabled, http3_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        userId,
        enabled ? true : false,
        autoMinifyHtml ? true : false,
        autoMinifyCss ? true : false,
        autoMinifyJs ? true : false,
        compressionGzip ? true : false,
        compressionBrotli ? true : false,
        imageOptimization ? true : false,
        http2Enabled ? true : false,
        http3Enabled ? true : false
      ]);
    }

    return this.getCDNSettings(userId);
  }

  // ===== NOTIFICATION SETTINGS METHODS =====

  async getNotificationSettings(userId) {
    return this.queryOne('SELECT * FROM notification_settings WHERE user_id = ?', [userId]);
  }

  async upsertNotificationSettings(userId, settings) {
    const { notificationsEnabled, emailEnabled } = settings;

    const existing = await this.getNotificationSettings(userId);

    if (existing) {
      await this.execute(`
        UPDATE notification_settings
        SET notifications_enabled = ?,
            email_enabled = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `, [notificationsEnabled ? true : false, emailEnabled ? true : false, userId]);
    } else {
      await this.execute(`
        INSERT INTO notification_settings (user_id, notifications_enabled, email_enabled)
        VALUES (?, ?, ?)
      `, [userId, notificationsEnabled ? true : false, emailEnabled ? true : false]);
    }

    return this.getNotificationSettings(userId);
  }

  async getTeamNotificationSettings(teamId) {
    return this.queryOne('SELECT * FROM team_notification_settings WHERE team_id = ?', [teamId]);
  }

  async upsertTeamNotificationSettings(teamId, settings) {
    const { notificationsEnabled, emailEnabled } = settings;
    const existing = await this.getTeamNotificationSettings(teamId);

    if (existing) {
      await this.execute(`
        UPDATE team_notification_settings
        SET notifications_enabled = ?,
            email_enabled = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE team_id = ?
      `, [notificationsEnabled ? true : false, emailEnabled ? true : false, teamId]);
    } else {
      await this.execute(`
        INSERT INTO team_notification_settings (team_id, notifications_enabled, email_enabled)
        VALUES (?, ?, ?)
      `, [teamId, notificationsEnabled ? true : false, emailEnabled ? true : false]);
    }

    return this.getTeamNotificationSettings(teamId);
  }

  // ===== DOMAIN HEALTH STATUS METHODS =====

  getDomainHealthStatus(domainId) {
    return this.queryOne('SELECT * FROM domain_health_status WHERE domain_id = ?', [domainId]);
  }

  async upsertDomainHealthStatus(domainId, status, isSuccess) {
    const existing = await this.getDomainHealthStatus(domainId);
    const newStatus = isSuccess ? 'up' : 'down';

    if (existing) {
      const statusChanged = existing.current_status !== newStatus;
      // Cap counters at 50 to prevent overflow (100K+ is useless and causes issues)
      const consecutiveFailures = isSuccess ? 0 : Math.min((existing.consecutive_failures || 0) + 1, 50);
      const consecutiveSuccesses = isSuccess ? Math.min((existing.consecutive_successes || 0) + 1, 50) : 0;

      await this.execute(`
        UPDATE domain_health_status
        SET current_status = ?,
            last_checked_at = CURRENT_TIMESTAMP,
            last_status_change_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_status_change_at END,
            consecutive_failures = ?,
            consecutive_successes = ?
        WHERE domain_id = ?
      `, [newStatus, statusChanged ? true : false, consecutiveFailures, consecutiveSuccesses, domainId]);

      return {
        statusChanged,
        previousStatus: existing.current_status,
        currentStatus: newStatus
      };
    } else {
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

  // ===== REQUEST LOGS METHODS =====

  async createRequestLog(logData) {
    const {
      domainId,
      hostname,
      method,
      path,
      queryString,
      statusCode,
      responseTime,
      responseSize,
      ipAddress,
      userAgent,
      referer,
      requestHeaders,
      responseHeaders,
      errorMessage
    } = logData;

    await this.execute(`
      INSERT INTO request_logs (
        domain_id, hostname, method, path, query_string, status_code,
        response_time, response_size, ip_address, user_agent, referer,
        request_headers, response_headers, error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      domainId || null,
      hostname,
      method,
      path,
      queryString || null,
      statusCode || null,
      responseTime || null,
      responseSize || null,
      ipAddress || null,
      userAgent || null,
      referer || null,
      requestHeaders ? JSON.stringify(requestHeaders) : null,
      responseHeaders ? JSON.stringify(responseHeaders) : null,
      errorMessage || null
    ]);

    // Broadcast log to WebSocket clients
    try {
      logBroadcastService.broadcastTrafficLog({
        id: Date.now(), // Temporary ID until we can get the actual one
        timestamp: new Date(),
        domain_id: domainId,
        domainId: domainId,
        hostname,
        method,
        path,
        query_string: queryString,
        queryString,
        status_code: statusCode,
        statusCode,
        response_time: responseTime,
        responseTime,
        ip_address: ipAddress,
        ipAddress,
        user_agent: userAgent,
        userAgent,
        error_message: errorMessage,
        errorMessage,
        protocol: 'HTTP'
      });
    } catch (error) {
      // Don't fail the log creation if broadcast fails
      console.error('[Database] Failed to broadcast request log:', error.message);
    }
  }

  // Get request logs by domain ID with pagination and filtering
  async getRequestLogsByDomain(domainId, options = {}) {
    const {
      method = null,
      statusCode = null,
      search = null,
      startDate = null,
      endDate = null
    } = options;

    let query = `
      SELECT *
      FROM request_logs
      WHERE domain_id = ?
    `;
    const params = [domainId];

    if (method) {
      query += ` AND method = ?`;
      params.push(method);
    }

    if (statusCode) {
      query += ` AND status_code = ?`;
      params.push(statusCode);
    }

    if (search) {
      query += ` AND (path LIKE ? OR query_string LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (startDate) {
      query += ` AND timestamp >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND timestamp <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY timestamp DESC`;

    return this.queryAll(query, params);
  }

  // Get request log statistics for a domain
  async getRequestLogStats(domainId, days = 7) {
    return this.queryOne(`
      SELECT
        COUNT(*) as total_requests,
        COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as success_count,
        COUNT(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 END) as client_error_count,
        COUNT(CASE WHEN status_code >= 500 THEN 1 END) as server_error_count,
        AVG(response_time) as avg_response_time,
        MAX(response_time) as max_response_time,
        MIN(response_time) as min_response_time,
        SUM(response_size) as total_bandwidth
      FROM request_logs
      WHERE domain_id = ?
        AND timestamp >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
    `, [domainId, days]);
  }

  // Get recent errors for a domain
  getRecentErrorLogs(domainId, limit = 20) {
    return this.queryAll(`
      SELECT *
      FROM request_logs
      WHERE domain_id = ? AND status_code >= 400
      ORDER BY timestamp DESC
      LIMIT ?
    `, [domainId, limit]);
  }

  // Get method distribution for a domain
  getMethodDistribution(domainId, days = 7) {
    return this.queryAll(`
      SELECT
        method,
        COUNT(*) as count
      FROM request_logs
      WHERE domain_id = ?
        AND timestamp >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
      GROUP BY method
      ORDER BY count DESC
    `, [domainId, days]);
  }

  // Get status code distribution for a domain
  getStatusCodeDistribution(domainId, days = 7) {
    return this.queryAll(`
      SELECT
        status_code,
        COUNT(*) as count
      FROM request_logs
      WHERE domain_id = ?
        AND timestamp >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
      GROUP BY status_code
      ORDER BY count DESC
    `, [domainId, days]);
  }

  // Clean old request logs (keep only last N days)
  async cleanOldRequestLogs(days = 30) {
    const result = await this.execute(`
      DELETE FROM request_logs
      WHERE timestamp < (CURRENT_TIMESTAMP - (? || ' days')::interval)
    `, [days]);
    return { deleted: result.rowCount || 0 };
  }

  // ===== REDIRECTION METHODS =====

  // Create a new redirection
  async createRedirection(redirectionData) {
    const { userId, shortCode, targetUrl, description, teamId } = redirectionData;

    const result = await this.execute(`
      INSERT INTO redirections (user_id, short_code, target_url, description, team_id)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `, [userId, shortCode, targetUrl, description || null, teamId || null]);

    return this.getRedirectionById(result.rows[0].id);
  }

  // Get redirection by ID
  getRedirectionById(id) {
    return this.queryOne('SELECT * FROM redirections WHERE id = ?', [id]);
  }

  // Get redirection by short code
  getRedirectionByShortCode(shortCode) {
    return this.queryOne('SELECT * FROM redirections WHERE short_code = ? AND is_active = TRUE', [shortCode]);
  }

  // Get all redirections for a user (personal + team redirections)
  getRedirectionsByUserId(userId) {
    return this.queryAll(`
      SELECT * FROM redirections
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [userId]);
  }

  // Get all redirections accessible by a user (personal + team redirections)
  getRedirectionsByUserIdWithTeams(userId) {
    return this.queryAll(`
      SELECT
        r.*,
        u.username,
        u.display_name as user_display_name,
        t.name as team_name,
        CASE
          WHEN r.team_id IS NULL THEN 'personal'
          ELSE 'team'
        END as ownership_type
      FROM redirections r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN teams t ON r.team_id = t.id
      WHERE r.user_id = ?
         OR r.team_id IN (
           SELECT team_id FROM team_members WHERE user_id = ?
         )
      ORDER BY r.created_at DESC
    `, [userId, userId]);
  }

  // Get all redirections (admin only)
  getAllRedirections() {
    return this.queryAll(`
      SELECT
        r.*,
        u.username,
        u.display_name as user_display_name,
        t.name as team_name
      FROM redirections r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN teams t ON r.team_id = t.id
      ORDER BY r.created_at DESC
    `, []);
  }

  // Count redirections by user ID
  async countRedirectionsByUserId(userId) {
    const result = await this.queryOne('SELECT COUNT(*) as count FROM redirections WHERE user_id = ?', [userId]);
    return Number(result?.count || 0);
  }

  // Update redirection
  async updateRedirection(redirectionId, updates) {
    const { shortCode, targetUrl, description, isActive } = updates;

    await this.execute(`
      UPDATE redirections
      SET
        short_code = COALESCE(?, short_code),
        target_url = COALESCE(?, target_url),
        description = COALESCE(?, description),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      shortCode ?? null,
      targetUrl ?? null,
      description ?? null,
      isActive !== undefined && isActive !== null ? isActive : null,
      redirectionId
    ]);

    return this.getRedirectionById(redirectionId);
  }

  // Delete redirection
  async deleteRedirection(redirectionId) {
    return this.execute('DELETE FROM redirections WHERE id = ?', [redirectionId]);
  }

  // Toggle redirection active status
  async toggleRedirectionActive(redirectionId) {
    await this.execute(`
      UPDATE redirections
      SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [redirectionId]);
    return this.getRedirectionById(redirectionId);
  }

  // Increment click count
  async incrementRedirectionClicks(redirectionId) {
    await this.execute(`
      UPDATE redirections
      SET click_count = click_count + 1
      WHERE id = ?
    `, [redirectionId]);
  }

  // Update user redirection quota
  async updateUserRedirectionQuota(userId, maxRedirections) {
    await this.execute(`
      UPDATE users
      SET max_redirections = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [maxRedirections, userId]);
    return this.getUserById(userId);
  }

  // Get redirection statistics
  async getRedirectionStats(redirectionId, days = 30) {
    const redirection = await this.getRedirectionById(redirectionId);
    if (!redirection) return null;

    return {
      total_clicks: redirection.click_count,
      short_code: redirection.short_code,
      target_url: redirection.target_url,
      is_active: redirection.is_active
    };
  }

  // ===== DOMAIN GROUPS METHODS =====

  /**
   * Create a new domain group (personal or team)
   */
  async createDomainGroup(groupData) {
    const { name, description, color, icon, userId, teamId, createdBy } = groupData;

    // Validate: must be either personal OR team
    if ((userId && teamId) || (!userId && !teamId)) {
      throw new Error('Group must be either personal or team-owned');
    }

    const result = await this.execute(`
      INSERT INTO domain_groups (name, description, color, icon, user_id, team_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `, [name, description || null, color || '#9D4EDD', icon || null, userId || null, teamId || null, createdBy]);

    return this.getDomainGroupById(result.rows[0].id);
  }

  /**
   * Get domain group by ID with ownership info
   */
  getDomainGroupById(groupId) {
    return this.queryOne(`
      SELECT
        dg.*,
        u.username as owner_username,
        u.display_name as owner_display_name,
        t.name as team_name,
        creator.username as created_by_username,
        creator.display_name as created_by_display_name,
        CASE
          WHEN dg.user_id IS NOT NULL THEN 'personal'
          ELSE 'team'
        END as ownership_type
      FROM domain_groups dg
      LEFT JOIN users u ON dg.user_id = u.id
      LEFT JOIN teams t ON dg.team_id = t.id
      LEFT JOIN users creator ON dg.created_by = creator.id
      WHERE dg.id = ?
    `, [groupId]);
  }

  /**
   * Get all groups accessible by a user (personal + team groups)
   */
  getDomainGroupsByUserId(userId) {
    return this.queryAll(`
      SELECT
        dg.*,
        u.username as owner_username,
        u.display_name as owner_display_name,
        t.name as team_name,
        creator.username as created_by_username,
        CASE
          WHEN dg.user_id IS NOT NULL THEN 'personal'
          ELSE 'team'
        END as ownership_type,
        COUNT(DISTINCT CASE
          WHEN d.team_id IS NOT NULL OR d.user_id = ? THEN dga.domain_id
          ELSE NULL
        END) as domain_count,
        CASE
          WHEN dg.user_id = ? THEN TRUE
          WHEN dg.team_id IS NOT NULL THEN
            EXISTS(SELECT 1 FROM team_members tm WHERE tm.team_id = dg.team_id AND tm.user_id = ? AND tm.role = 'owner')
          ELSE FALSE
        END as is_owner
      FROM domain_groups dg
      LEFT JOIN users u ON dg.user_id = u.id
      LEFT JOIN teams t ON dg.team_id = t.id
      LEFT JOIN users creator ON dg.created_by = creator.id
      LEFT JOIN domain_group_assignments dga ON dg.id = dga.group_id
      LEFT JOIN domains d ON dga.domain_id = d.id
      WHERE (
        dg.user_id = ?  -- Personal groups
        OR dg.team_id IN (  -- Team groups where user is member
          SELECT team_id FROM team_members WHERE user_id = ?
        )
      ) AND dg.is_active = TRUE
      GROUP BY dg.id, u.id, t.id, creator.id
      ORDER BY dg.created_at DESC
    `, [userId, userId, userId, userId, userId]);
  }

  /**
   * Get groups by team ID
   */
  getDomainGroupsByTeamId(teamId) {
    return this.queryAll(`
      SELECT
        dg.*,
        t.name as team_name,
        creator.username as created_by_username,
        COUNT(DISTINCT dga.domain_id) as domain_count
      FROM domain_groups dg
      LEFT JOIN teams t ON dg.team_id = t.id
      LEFT JOIN users creator ON dg.created_by = creator.id
      LEFT JOIN domain_group_assignments dga ON dg.id = dga.group_id
      WHERE dg.team_id = ? AND dg.is_active = TRUE
      GROUP BY dg.id, t.id, creator.id
      ORDER BY dg.created_at DESC
    `, [teamId]);
  }

  /**
   * Update domain group
   */
  async updateDomainGroup(groupId, updates) {
    const { name, description, color, icon, isActive } = updates;

    await this.execute(`
      UPDATE domain_groups
      SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        color = COALESCE(?, color),
        icon = COALESCE(?, icon),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      name ?? null,
      description ?? null,
      color ?? null,
      icon ?? null,
      isActive !== undefined ? isActive : null,
      groupId
    ]);

    return this.getDomainGroupById(groupId);
  }

  /**
   * Delete domain group
   */
  async deleteDomainGroup(groupId) {
    return this.execute('DELETE FROM domain_groups WHERE id = ?', [groupId]);
  }

  /**
   * Get domain's current group assignment (if any)
   */
  getDomainGroupAssignment(domainId) {
    return this.queryOne(`
      SELECT dga.*, dg.name as group_name
      FROM domain_group_assignments dga
      JOIN domain_groups dg ON dga.group_id = dg.id
      WHERE dga.domain_id = ?
    `, [domainId]);
  }

  /**
   * Assign domain to group
   */
  async assignDomainToGroup(domainId, groupId, assignedBy) {
    try {
      await this.execute(`
        INSERT INTO domain_group_assignments (domain_id, group_id, assigned_by)
        VALUES (?, ?, ?)
      `, [domainId, groupId, assignedBy]);
      return { success: true };
    } catch (err) {
      if (err.code === '23505') { // Unique constraint violation
        return { success: false, error: 'Domain already in this group' };
      }
      throw err;
    }
  }

  /**
   * Remove domain from group
   */
  async removeDomainFromGroup(domainId, groupId) {
    return this.execute(`
      DELETE FROM domain_group_assignments
      WHERE domain_id = ? AND group_id = ?
    `, [domainId, groupId]);
  }

  /**
   * Get all domains in a group
   */
  getDomainsInGroup(groupId, userId = null) {
    // If userId is provided, filter personal domains (only show if owned by user)
    // Team domains are visible to all team members
    const userFilter = userId ? `
      AND (
        d.team_id IS NOT NULL  -- Team domains visible to all
        OR d.user_id = ?       -- Personal domains only visible to owner
      )
    ` : '';

    const params = userId ? [groupId, userId] : [groupId];

    return this.queryAll(`
      SELECT
        d.*,
        u.username,
        u.display_name as user_display_name,
        t.name as team_name,
        dga.assigned_at,
        assigner.username as assigned_by_username,
        CASE
          WHEN d.team_id IS NULL THEN 'personal'
          ELSE 'team'
        END as ownership_type
      FROM domains d
      JOIN domain_group_assignments dga ON d.id = dga.domain_id
      JOIN users u ON d.user_id = u.id
      LEFT JOIN teams t ON d.team_id = t.id
      LEFT JOIN users assigner ON dga.assigned_by = assigner.id
      WHERE dga.group_id = ?
      ${userFilter}
      ORDER BY dga.assigned_at DESC
    `, params);
  }

  /**
   * Get all groups a domain belongs to
   */
  getGroupsForDomain(domainId) {
    return this.queryAll(`
      SELECT
        dg.*,
        u.username as owner_username,
        t.name as team_name,
        dga.assigned_at,
        CASE
          WHEN dg.user_id IS NOT NULL THEN 'personal'
          ELSE 'team'
        END as ownership_type
      FROM domain_groups dg
      JOIN domain_group_assignments dga ON dg.id = dga.group_id
      LEFT JOIN users u ON dg.user_id = u.id
      LEFT JOIN teams t ON dg.team_id = t.id
      WHERE dga.domain_id = ? AND dg.is_active = TRUE
      ORDER BY dga.assigned_at DESC
    `, [domainId]);
  }

  /**
   * Check if user has permission to manage a group
   */
  async hasGroupPermission(groupId, userId, permission) {
    const group = await this.getDomainGroupById(groupId);
    if (!group) return false;

    // Personal group: only owner can manage
    if (group.user_id) {
      return group.user_id === userId;
    }

    // Team group: check team permissions
    if (group.team_id) {
      // Team owner has all permissions
      const teamRole = await this.getTeamMemberRole(group.team_id, userId);
      if (teamRole === 'owner') return true;

      // Check specific group member permissions
      const member = await this.queryOne(`
        SELECT ${permission} as has_permission
        FROM domain_group_members
        WHERE group_id = ? AND user_id = ?
      `, [groupId, userId]);

      return member ? member.has_permission === true : false;
    }

    return false;
  }

  /**
   * Add member to team group with permissions
   */
  async addGroupMember(groupId, userId, permissions, addedBy) {
    const { canManageGroup = false, canAssignDomains = false, canViewDomains = true } = permissions;

    try {
      await this.execute(`
        INSERT INTO domain_group_members (group_id, user_id, can_manage_group, can_assign_domains, can_view_domains, added_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [groupId, userId, canManageGroup, canAssignDomains, canViewDomains, addedBy]);
      return { success: true };
    } catch (err) {
      if (err.code === '23505') {
        return { success: false, error: 'User already has access to this group' };
      }
      throw err;
    }
  }

  /**
   * Update group member permissions
   */
  async updateGroupMemberPermissions(groupId, userId, permissions) {
    const { canManageGroup, canAssignDomains, canViewDomains } = permissions;

    await this.execute(`
      UPDATE domain_group_members
      SET can_manage_group = ?,
          can_assign_domains = ?,
          can_view_domains = ?
      WHERE group_id = ? AND user_id = ?
    `, [canManageGroup, canAssignDomains, canViewDomains, groupId, userId]);

    return this.getGroupMembers(groupId).then(members =>
      members.find(m => m.user_id === userId)
    );
  }

  /**
   * Remove member from group
   */
  async removeGroupMember(groupId, userId) {
    return this.execute(`
      DELETE FROM domain_group_members
      WHERE group_id = ? AND user_id = ?
    `, [groupId, userId]);
  }

  /**
   * Get all members of a group
   */
  getGroupMembers(groupId) {
    return this.queryAll(`
      SELECT
        dgm.*,
        u.username,
        u.display_name,
        u.avatar_url,
        u.email
      FROM domain_group_members dgm
      JOIN users u ON dgm.user_id = u.id
      WHERE dgm.group_id = ?
      ORDER BY dgm.added_at ASC
    `, [groupId]);
  }

  /**
   * Bulk assign multiple domains to a group
   */
  async bulkAssignDomainsToGroup(domainIds, groupId, assignedBy) {
    const results = {
      success: [],
      failed: []
    };

    for (const domainId of domainIds) {
      try {
        const result = await this.assignDomainToGroup(domainId, groupId, assignedBy);
        if (result.success) {
          results.success.push(domainId);
        } else {
          results.failed.push({ domainId, error: result.error });
        }
      } catch (err) {
        results.failed.push({ domainId, error: err.message });
      }
    }

    return results;
  }

  /**
   * Get domains with their groups (enriched query for domain list)
   */
  getDomainsWithGroups(userId) {
    return this.queryAll(`
      SELECT
        d.*,
        u.username,
        u.display_name as user_display_name,
        t.name as team_name,
        CASE
          WHEN d.team_id IS NULL THEN 'personal'
          ELSE 'team'
        END as ownership_type,
        json_agg(
          DISTINCT jsonb_build_object(
            'id', dg.id,
            'name', dg.name,
            'color', dg.color,
            'icon', dg.icon
          )
        ) FILTER (WHERE dg.id IS NOT NULL) as groups
      FROM domains d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN teams t ON d.team_id = t.id
      LEFT JOIN domain_group_assignments dga ON d.id = dga.domain_id
      LEFT JOIN domain_groups dg ON dga.group_id = dg.id AND dg.is_active = TRUE
      WHERE d.user_id = ?
         OR d.team_id IN (
           SELECT team_id FROM team_members WHERE user_id = ?
         )
      GROUP BY d.id, u.id, t.id
      ORDER BY d.created_at DESC
    `, [userId, userId]);
  }

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

  // ==========================================
  // Retry Queue & Dead Letter Queue Methods
  // ==========================================

  /**
   * Insert job to Dead Letter Queue
   * @param {object} job - Job object
   * @returns {void}
   */
  async insertJobToDLQ(job) {
    await this.execute(`
      INSERT INTO job_dead_letter_queue (job_id, job_type, payload, attempt_count, failure_reason, last_error)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (job_id) DO UPDATE SET
        attempt_count = EXCLUDED.attempt_count,
        failure_reason = EXCLUDED.failure_reason,
        last_error = EXCLUDED.last_error,
        failed_at = CURRENT_TIMESTAMP
    `, [job.jobId, job.jobType, JSON.stringify(job.payload), job.attemptCount, job.failureReason, job.lastError]);
  }

  /**
   * Get jobs from Dead Letter Queue with optional filters
   * @param {object} filters - Filter criteria
   * @returns {Array} - Array of DLQ jobs
   */
  async getJobsFromDLQ(filters = {}) {
    let query = 'SELECT * FROM job_dead_letter_queue';
    const conditions = [];
    const values = [];

    if (filters.jobType) {
      conditions.push(`job_type = $${values.length + 1}`);
      values.push(filters.jobType);
    }
    if (filters.notifiedAdmin !== undefined) {
      conditions.push(`notified_admin = $${values.length + 1}`);
      values.push(filters.notifiedAdmin);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY failed_at DESC LIMIT 100';

    const result = await this.execute(query, values);
    return result.rows || [];
  }

  /**
   * Get Dead Letter Queue count
   * @returns {number} - Count of jobs in DLQ
   */
  async getDLQCount() {
    const result = await this.execute('SELECT COUNT(*) as count FROM job_dead_letter_queue');
    return parseInt(result.rows[0]?.count || 0, 10);
  }

  /**
   * Retry job from Dead Letter Queue (remove from DLQ and return job data)
   * @param {string} jobId - Job ID (UUID)
   * @returns {object|null} - Job data or null if not found
   */
  async retryJobFromDLQ(jobId) {
    const result = await this.execute('SELECT * FROM job_dead_letter_queue WHERE job_id = $1', [jobId]);
    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    const job = result.rows[0];
    await this.execute('DELETE FROM job_dead_letter_queue WHERE job_id = $1', [jobId]);

    return {
      jobType: job.job_type,
      payload: typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload
    };
  }

  /**
   * Delete job from Dead Letter Queue
   * @param {string} jobId - Job ID (UUID)
   * @returns {void}
   */
  async deleteJobFromDLQ(jobId) {
    await this.execute('DELETE FROM job_dead_letter_queue WHERE job_id = $1', [jobId]);
  }

  /**
   * Mark DLQ job as notified (admin has been alerted)
   * @param {string} jobId - Job ID (UUID)
   * @returns {void}
   */
  async markDLQJobNotified(jobId) {
    await this.execute('UPDATE job_dead_letter_queue SET notified_admin = TRUE WHERE job_id = $1', [jobId]);
  }

  /**
   * Insert retry job audit log entry
   * @param {string} jobId - Job ID (UUID)
   * @param {string} jobType - Job type
   * @param {number} attemptNumber - Attempt number
   * @param {string} status - Status (queued, processing, success, retry, failed)
   * @param {string} errorMessage - Error message if any
   * @returns {void}
   */
  async insertRetryAudit(jobId, jobType, attemptNumber, status, errorMessage) {
    await this.execute(`
      INSERT INTO retry_job_audit (job_id, job_type, attempt_number, status, error_message)
      VALUES ($1, $2, $3, $4, $5)
    `, [jobId, jobType, attemptNumber, status, errorMessage]);
  }

  /**
   * Get retry audit log for a job
   * @param {string} jobId - Job ID (UUID)
   * @returns {Array} - Array of audit entries
   */
  async getRetryAuditLog(jobId) {
    const result = await this.execute(
      'SELECT * FROM retry_job_audit WHERE job_id = $1 ORDER BY created_at ASC',
      [jobId]
    );
    return result.rows || [];
  }

  /**
   * Clean old DLQ entries (older than specified days)
   * @param {number} days - Number of days to keep (default: 90)
   * @returns {object} - Number of deleted records
   */
  async cleanOldDLQEntries(days = 90) {
    const result = await this.execute(`
      DELETE FROM job_dead_letter_queue
      WHERE created_at < (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
    `, [days]);
    return { deleted: result.rowCount || 0 };
  }

  /**
   * Clean old retry audit entries (older than specified days)
   * @param {number} days - Number of days to keep (default: 90)
   * @returns {object} - Number of deleted records
   */
  async cleanOldRetryAudit(days = 90) {
    const result = await this.execute(`
      DELETE FROM retry_job_audit
      WHERE created_at < (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
    `, [days]);
    return { deleted: result.rowCount || 0 };
  }

  // ===== NOTIFICATION METHODS =====

  /**
   * Create a team notification for a specific user
   */
  async createTeamNotification(data) {
    const { userId, teamId, actorId, actionType, entityType, entityId, entityName, message } = data;

    await this.execute(`
      INSERT INTO notifications (user_id, team_id, actor_id, action_type, entity_type, entity_id, entity_name, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, teamId, actorId, actionType, entityType, entityId, entityName, message]);
  }

  /**
   * Create notifications for all team members except the actor
   */
  async createTeamNotificationForMembers(data) {
    const { teamId, actorId, actionType, entityType, entityId, entityName, message } = data;

    // Get all team members except the actor
    const members = await this.queryAll(`
      SELECT DISTINCT user_id
      FROM team_members
      WHERE team_id = ? AND user_id != ?
    `, [teamId, actorId]);

    // Create notification for each member
    for (const member of members) {
      await this.createTeamNotification({
        userId: member.user_id,
        teamId,
        actorId,
        actionType,
        entityType,
        entityId,
        entityName,
        message
      });
    }
  }

  /**
   * Get user's notifications
   */
  async getUserNotifications(userId, limit = 50, offset = 0) {
    return this.queryAll(`
      SELECT
        n.*,
        u.username as actor_username,
        u.display_name as actor_display_name,
        t.name as team_name
      FROM notifications n
      LEFT JOIN users u ON n.actor_id = u.id
      LEFT JOIN teams t ON n.team_id = t.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);
  }

  /**
   * Get unread notification count
   */
  async getUnreadNotificationCount(userId) {
    const result = await this.queryOne(`
      SELECT COUNT(*) as count
      FROM notifications
      WHERE user_id = ? AND read_at IS NULL
    `, [userId]);
    return parseInt(result?.count || 0, 10);
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(notificationId, userId) {
    await this.execute(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND read_at IS NULL
    `, [notificationId, userId]);
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(userId) {
    await this.execute(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND read_at IS NULL
    `, [userId]);
  }

  /**
   * Delete old read notifications (cleanup)
   */
  async deleteOldNotifications(days = 30) {
    const result = await this.execute(`
      DELETE FROM notifications
      WHERE read_at IS NOT NULL
      AND read_at < (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
    `, [days]);
    return { deleted: result.rowCount || 0 };
  }

  close() {
    // PostgreSQL connections are managed by the pool
    // Pool is closed via closePool() in config/database.js
    console.log('[Database] Close called (pool managed externally)');
  }
}

export const database = new DatabaseService();
