/**
 * Migration runner — zero external dependencies.
 *
 * Rules:
 *  - Migration files: migrations/NNNN_description.sql  (e.g. 0001_initial_schema.sql)
 *  - Each file runs in a transaction; if it throws the migration is rolled back.
 *  - Applied migrations are recorded in the `schema_migrations` table.
 *  - Running the runner twice is safe (idempotent — already-applied migrations are skipped).
 *
 * Usage in server.js:
 *   import { runMigrations } from './migrations/runner.js';
 *   await runMigrations(pool);
 */

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum    TEXT
    )
  `);
}

async function getAppliedVersions(client) {
  const { rows } = await client.query(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  return new Set(rows.map(r => r.version));
}

async function getPendingFiles() {
  const files = await readdir(__dirname);
  return files
    .filter(f => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

async function checksum(content) {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export async function runMigrations(pool, logger = console) {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedVersions(client);
    const files = await getPendingFiles();

    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      logger.info?.('[Migrations] All migrations applied — schema is up to date');
      return { applied: 0 };
    }

    logger.info?.(`[Migrations] ${pending.length} pending migration(s)`);
    let count = 0;

    for (const file of pending) {
      const sql = await readFile(join(__dirname, file), 'utf8');
      const cs = await checksum(sql);

      logger.info?.(`[Migrations] Applying ${file}…`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [file, cs]
        );
        await client.query('COMMIT');
        count++;
        logger.info?.(`[Migrations] ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`[Migrations] Failed on ${file}: ${err.message}`);
      }
    }

    logger.info?.(`[Migrations] Done — ${count} migration(s) applied`);
    return { applied: count };
  } finally {
    client.release();
  }
}
