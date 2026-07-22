// @ts-check
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPgPool } from '../config/database.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { UserRepository } from '../repositories/userRepository.js';
import { DomainRepository } from '../repositories/domainRepository.js';
import { TunnelRepository } from '../repositories/tunnelRepository.js';
import { Socks5Repository } from '../repositories/socks5Repository.js';
import { SslRepository } from '../repositories/sslRepository.js';
import { TeamRepository } from '../repositories/teamRepository.js';
import { AuditLogRepository } from '../repositories/auditLogRepository.js';
import { StatsRepository } from '../repositories/statsRepository.js';
import { ProxyLogRepository } from '../repositories/proxyLogRepository.js';
import { HealthRepository } from '../repositories/healthRepository.js';
import { CustomHeaderRepository } from '../repositories/customHeaderRepository.js';
import { CacheSettingsRepository } from '../repositories/cacheSettingsRepository.js';
import { NotificationSettingsRepository } from '../repositories/notificationSettingsRepository.js';
import { DomainHealthRepository } from '../repositories/domainHealthRepository.js';
import { RequestLogRepository } from '../repositories/requestLogRepository.js';
import { RedirectionRepository } from '../repositories/redirectionRepository.js';
import { DomainGroupRepository } from '../repositories/domainGroupRepository.js';
import { BackendRepository } from '../repositories/backendRepository.js';
import { ApiKeyRepository } from '../repositories/apiKeyRepository.js';
import { QueueRepository } from '../repositories/queueRepository.js';
import { NotificationRepository } from '../repositories/notificationRepository.js';
import { MinecraftPlayerRepository } from '../repositories/minecraftPlayerRepository.js';

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
      logger.info('[Database] Using PostgreSQL');
    }
    await this.runMigrations();
    await this.verifySchema();
    await this.ensureTunnelPublicSlugs();
    if (!config.logging.quiet) {
      logger.info('[Database] Initialized successfully');
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
      'tunnel_access',
      'mc_players',
      'mc_player_ips'
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
      logger.info(`[Database] Applying migration: ${file}`);

      // Each migration runs in a transaction — partial failures roll back cleanly.
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});

        if (file === '001_initial_schema.sql' && error.code === '42710') {
          // Schema already existed before migrations were introduced — safe to mark as applied.
          logger.warn('[Database] Base schema already exists. Marking 001_initial_schema.sql as applied.');
          await this.pgPool.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file]
          );
          client.release();
          continue;
        }

        client.release();
        throw new Error(`[Database] Migration failed — rolled back: ${file}\n${error.message}`);
      }
      client.release();
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
    const pgParams = [...params];
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

    const result = await this.pgPool.query(pgSql, pgParams);
    return result.rows[0] || null;
  }

  // Helper: Execute a query and return all rows
  async queryAll(sql, params = []) {
    let pgSql = sql;
    const pgParams = [...params];
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

    const result = await this.pgPool.query(pgSql, pgParams);
    return result.rows;
  }

  // Helper: Execute a query (INSERT/UPDATE/DELETE)
  async execute(sql, params = []) {
    let pgSql = sql;
    const pgParams = [...params];
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

    const result = await this.pgPool.query(pgSql, pgParams);
    return result;
  }

  close() {
    // PostgreSQL connections are managed by the pool
    // Pool is closed via closePool() in config/database.js
    logger.info('[Database] Close called (pool managed externally)');
  }
}


const _repositories = [
  UserRepository,
  DomainRepository,
  TunnelRepository,
  Socks5Repository,
  SslRepository,
  TeamRepository,
  AuditLogRepository,
  StatsRepository,
  ProxyLogRepository,
  HealthRepository,
  CustomHeaderRepository,
  CacheSettingsRepository,
  NotificationSettingsRepository,
  DomainHealthRepository,
  RequestLogRepository,
  RedirectionRepository,
  DomainGroupRepository,
  BackendRepository,
  ApiKeyRepository,
  QueueRepository,
  NotificationRepository,
  MinecraftPlayerRepository
];
for (const Repo of _repositories) {
  Object.getOwnPropertyNames(Repo.prototype)
    .filter(n => n !== 'constructor')
    .forEach(n => { DatabaseService.prototype[n] = Repo.prototype[n]; });
}

export const database = new DatabaseService();
