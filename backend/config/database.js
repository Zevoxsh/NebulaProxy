/**
 * NebulaProxy - Database configuration
 * PostgreSQL only
 */

import pg from 'pg';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';


const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Read the auto-generated PostgreSQL password from the shared secret volume.
 * Only used as a last-resort fallback when no password is configured in Redis
 * (i.e. local postgres container with auto-generated credentials).
 */
function readPgSecret() {
  const secretFile = process.env.PG_SECRET_FILE || '/run/pg-secret/postgres.secret';
  try {
    const pwd = fs.readFileSync(secretFile, 'utf-8').trim();
    if (pwd) return pwd;
  } catch (_) { /* file not present — fall through */ }
  return null;
}

/**
 * Redis/admin config takes priority over docker-compose env vars.
 * The user explicitly sets DB_HOST, DB_PORT, etc. via the admin panel (stored
 * in Redis). The compose env vars are only a fallback for a fresh install
 * before the wizard has run.
 */
function configFirst(configValue, envKey) {
  return configValue || process.env[envKey];
}

// Get database config from the unified config system (reads from Redis first, then .env)
export const dbConfig = {
  get type() { return config.database.type; },
  get postgresql() {
    // Redis config (admin panel) wins; docker-compose env vars are only a fallback
    const host     = configFirst(config.database.host,     'DB_HOST');
    const port     = configFirst(config.database.port,     'DB_PORT');
    const database = configFirst(config.database.name,     'DB_NAME');
    const user     = configFirst(config.database.user,     'DB_USER');

    // For the password: Redis config wins; pg-secret is only used when Redis
    // has no password (local container fresh install before wizard completes).
    const redisPassword = config.database.password;
    const password = redisPassword || process.env.DB_PASSWORD || readPgSecret();

    return {
      host,
      port:     parseInt(port, 10),
      database,
      user,
      password,

      // Pool settings
      max: parseInt(process.env.DB_POOL_MAX || '50', 10),
      min: parseInt(process.env.DB_POOL_MIN || '10', 10), // Increased from 5 to 10 for better startup latency
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '5000', 10),

      // SSL options
      ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
      } : false,

      application_name: process.env.INSTANCE_ID || 'nebula-proxy'
    };
  }
};

let pgPool = null;

export const getPgPool = () => {
  if (dbConfig.type !== 'postgresql') {
    throw new Error('PostgreSQL is required. Set DB_TYPE=postgresql');
  }

  if (!pgPool) {
    if (!dbConfig.postgresql.password) {
      throw new Error('DB_PASSWORD environment variable is required for PostgreSQL');
    }

    if (process.env.NODE_ENV !== 'production' && process.env.LOG_QUIET !== 'true') {
      console.log(`[DB] Creating PostgreSQL pool: ${dbConfig.postgresql.user}@${dbConfig.postgresql.host}:${dbConfig.postgresql.port}/${dbConfig.postgresql.database}`);
    }

    pgPool = new Pool(dbConfig.postgresql);

    pgPool.on('error', (err) => {
      console.error('[DB] Unexpected PostgreSQL pool error:', err);
    });

    pgPool.on('connect', () => {
      if (process.env.NODE_ENV !== 'production' && process.env.LOG_QUIET !== 'true') {
        console.log(`[DB] New PostgreSQL client connected (total: ${pgPool.totalCount})`);
      }
    });

    pgPool.on('remove', () => {
      if (pgPool && process.env.NODE_ENV !== 'production' && process.env.LOG_QUIET !== 'true') {
        console.log(`[DB] PostgreSQL client removed (total: ${pgPool.totalCount})`);
      }
    });
  }

  return pgPool;
};

export const testPostgresConnection = async () => {
  if (dbConfig.type !== 'postgresql') {
    throw new Error('PostgreSQL is required. Set DB_TYPE=postgresql');
  }

  const pool = getPgPool();

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version(), current_database(), current_user');

    console.log('[DB] PostgreSQL connection successful');
    console.log(`[DB]   Version: ${result.rows[0].version.split(' ')[0]} ${result.rows[0].version.split(' ')[1]}`);
    console.log(`[DB]   Database: ${result.rows[0].current_database}`);
    console.log(`[DB]   User: ${result.rows[0].current_user}`);

    client.release();
    return true;
  } catch (err) {
    console.error('[DB] PostgreSQL connection failed:', err.message);
    throw err;
  }
};

export const closePool = async () => {
  if (pgPool) {
    console.log('[DB] Closing PostgreSQL pool...');
    await pgPool.end();
    pgPool = null;
    console.log('[DB] PostgreSQL pool closed');
  }
};

// Export pool getter for backwards compatibility
export const pool = {
  get query() {
    return getPgPool().query.bind(getPgPool());
  },
  get connect() {
    return getPgPool().connect.bind(getPgPool());
  }
};

export default {
  dbConfig,
  getPgPool,
  testPostgresConnection,
  closePool,
  pool
};
