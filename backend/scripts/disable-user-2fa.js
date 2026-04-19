/**
 * Disable all 2FA methods for a user (email + TOTP).
 *
 * Usage:
 *   node scripts/disable-user-2fa.js <username-or-email>
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import Redis from 'ioredis';

dotenv.config();

const identifier = (process.argv[2] || '').trim();

function readPgSecret() {
  const secretFile = process.env.PG_SECRET_FILE || '/run/pg-secret/postgres.secret';
  try {
    const value = fs.readFileSync(secretFile, 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
}

if (!identifier) {
  console.error('Usage: node scripts/disable-user-2fa.js <username-or-email>');
  process.exit(1);
}

async function readDbConfigFromRedis() {
  const redisHost = process.env.REDIS_HOST || '127.0.0.1';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisPassword = process.env.REDIS_PASSWORD || undefined;
  const redisDb = parseInt(process.env.REDIS_DB || '0', 10);

  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    db: redisDb,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    const raw = await redis.get('nebulaproxy:config');
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    return {
      host: cfg.DB_HOST,
      port: cfg.DB_PORT,
      database: cfg.DB_NAME,
      user: cfg.DB_USER,
      password: cfg.DB_PASSWORD,
    };
  } catch {
    return null;
  } finally {
    try {
      await redis.quit();
    } catch {
      // ignore redis shutdown errors
    }
  }
}

async function main() {
  const redisDbConfig = await readDbConfigFromRedis();
  const dbConfig = {
    host: redisDbConfig?.host || process.env.DB_HOST || '127.0.0.1',
    port: parseInt(redisDbConfig?.port || process.env.DB_PORT || '5432', 10),
    database: redisDbConfig?.database || process.env.DB_NAME || 'nebulaproxy',
    user: redisDbConfig?.user || process.env.DB_USER || 'nebulaproxy',
    password: redisDbConfig?.password || process.env.DB_PASSWORD || readPgSecret(),
  };

  const pool = new pg.Pool(dbConfig);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT id, username, email FROM users WHERE username = $1 OR email = $1 LIMIT 1',
      [identifier]
    );

    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      console.error(`No user found for: ${identifier}`);
      process.exit(1);
    }

    const user = userResult.rows[0];

    await client.query(
      `UPDATE user_two_factor_methods
       SET enabled = FALSE,
           totp_secret = NULL,
           updated_at = NOW()
       WHERE user_id = $1`,
      [user.id]
    );

    await client.query(
      `UPDATE users
       SET two_factor_enabled = FALSE,
           two_factor_method = NULL,
           two_factor_totp_secret = NULL,
           two_factor_enabled_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    await client.query('COMMIT');

    console.log(`2FA disabled for user: ${user.username} (${user.email || 'no-email'})`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to disable 2FA:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error('Unexpected error:', error.message);
  console.error('If needed, set REDIS_HOST/REDIS_PORT/REDIS_PASSWORD or DB_* env vars.');
  process.exit(1);
});
