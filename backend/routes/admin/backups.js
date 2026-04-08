import { pool } from '../../config/database.js';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import { s3BackupService } from '../../services/s3BackupService.js';

/**
 * Execute command safely with spawn (no shell injection risk)
 */
function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: false,
      timeout: options.timeout || 300000
    });

    let stdout = '';
    let stderr = '';

    if (options.input && proc.stdin) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    }

    if (proc.stdout) proc.stdout.on('data', (d) => { stdout += d.toString(); });
    if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (error) => reject(new Error(`Failed to execute ${command}: ${error.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}

/**
 * Admin Backup Schedule Routes
 * GET /api/admin/backups/schedule - Get backup schedule config
 * PUT /api/admin/backups/schedule - Update backup schedule
 * POST /api/admin/backups/export - Export full database as SQL
 * POST /api/admin/backups/import - Import database from SQL
 */
// ── In-memory S3 upload job store ───────────────────────────────────────────
const s3UploadJobs = new Map(); // jobId → { status, error, result, started_at, finished_at }

function createS3Job() {
  const id = `s3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, status: 'running', error: null, result: null, started_at: new Date().toISOString(), finished_at: null };
  s3UploadJobs.set(id, job);
  // Keep map small: evict jobs older than 1 hour
  for (const [k, v] of s3UploadJobs) {
    if (k !== id && Date.now() - new Date(v.started_at).getTime() > 3600_000) s3UploadJobs.delete(k);
  }
  return job;
}

export async function backupRoutes(fastify, options) {
  const normalizeSchedule = (raw) => {
    const defaultItem = {
      enabled: false,
      frequency: 'daily',
      time: '02:00'
    };

    // Backward compatibility: old flat schedule format.
    if (!raw || typeof raw !== 'object' || (!raw.local && !raw.s3)) {
      const legacy = {
        enabled: Boolean(raw?.enabled),
        frequency: raw?.frequency || 'daily',
        time: raw?.time || '02:00'
      };
      return {
        local: { ...defaultItem, ...legacy },
        s3: { ...defaultItem, ...legacy }
      };
    }

    return {
      local: { ...defaultItem, ...(raw.local || {}) },
      s3: { ...defaultItem, ...(raw.s3 || {}) }
    };
  };

  // Get backup schedule configuration
  fastify.get('/schedule', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['backup_schedule']
      );

      const schedule = result.rows.length > 0
        ? normalizeSchedule(JSON.parse(result.rows[0].value))
        : normalizeSchedule(null);

      reply.send({ schedule });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({
        message: 'Failed to fetch backup schedule',
        error: error.message
      });
    }
  });

  // Update backup schedule configuration
  fastify.put('/schedule', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const schedule = normalizeSchedule(request.body || {});

      const validateItem = (item, label) => {
        if (!['hourly', 'daily', 'weekly', 'monthly'].includes(item.frequency)) {
          return `${label}: invalid frequency. Must be hourly, daily, weekly, or monthly`;
        }

        if (!/^\d{2}:\d{2}$/.test(item.time)) {
          return `${label}: invalid time format. Expected HH:MM`;
        }

        const [h, m] = item.time.split(':').map(Number);
        if (h < 0 || h > 23 || m < 0 || m > 59) {
          return `${label}: time out of range`;
        }

        return null;
      };

      const localError = validateItem(schedule.local, 'local');
      if (localError) {
        return reply.status(400).send({ message: localError });
      }

      const s3Error = validateItem(schedule.s3, 's3');
      if (s3Error) {
        return reply.status(400).send({ message: s3Error });
      }

      // Upsert configuration
      await pool.query(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = $2, updated_at = NOW()`,
        ['backup_schedule', JSON.stringify(schedule)]
      );

      // Audit log
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          request.user.id,
          'update_backup_schedule',
          'system_config',
          null,
          `Updated backup schedule: local=${schedule.local.frequency}@${schedule.local.time} s3=${schedule.s3.frequency}@${schedule.s3.time}`,
          request.ip
        ]
      );

      // Restart backup scheduler
      if (fastify.backupScheduler) {
        await fastify.backupScheduler.restart(schedule);
      }

      reply.send({ success: true, schedule });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({
        message: 'Failed to update backup schedule',
        error: error.message
      });
    }
  });

  // Export full database as SQL via pg_dump
  fastify.post('/export', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tmpFile = path.join(os.tmpdir(), `nebula_export_${timestamp}.sql`);

    try {
      const dbConfig = fastify.dbConfig?.postgresql || {};
      const dbHost = dbConfig.host || 'localhost';
      const dbPort = String(dbConfig.port || 5432);
      const dbUser = dbConfig.user;
      const dbName = dbConfig.database;
      const dbPassword = dbConfig.password || '';

      const env = { ...process.env, PGPASSWORD: dbPassword };

      request.log.info('Starting database export via pg_dump...');

      try {
        await execCommand('pg_dump', [
          '-h', dbHost,
          '-p', dbPort,
          '-U', dbUser,
          '-d', dbName,
          '-F', 'p',
          '-f', tmpFile
        ], { env });
      } catch (error) {
        const msg = String(error?.message || '').toLowerCase();
        if (!msg.includes('server version mismatch')) throw error;

        request.log.warn('pg_dump version mismatch, using Docker fallback...');
        const { stdout } = await execCommand('docker', [
          'run', '--rm', '--network', 'host',
          '-e', `PGPASSWORD=${dbPassword}`,
          'postgres:18',
          'pg_dump',
          '-h', dbHost,
          '-p', dbPort,
          '-U', dbUser,
          '-d', dbName,
          '-F', 'p'
        ], { env: process.env, timeout: 300000 });

        await fs.writeFile(tmpFile, stdout, 'utf8');
      }

      const downloadName = `nebula_backup_${timestamp}.sql`;
      reply.header('Content-Type', 'application/sql');
      reply.header('Content-Disposition', `attachment; filename="${downloadName}"`);

      // Audit log
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [request.user.id, 'export_database', 'system_config', 'Database exported as SQL by admin', request.ip]
      );

      const stream = createReadStream(tmpFile);
      stream.on('end', () => fs.unlink(tmpFile).catch(() => {}));
      stream.on('error', () => fs.unlink(tmpFile).catch(() => {}));
      reply.send(stream);
    } catch (error) {
      await fs.unlink(tmpFile).catch(() => {});
      request.log.error(error);
      reply.status(500).send({ message: 'Failed to export database', error: error.message });
    }
  });

  // Export full database as JSON (tables)
  fastify.post('/export-json', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const backup = {};
      
      // Get all tables
      const tablesResult = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
      );

      for (const { tablename } of tablesResult.rows) {
        try {
          const dataResult = await pool.query(`SELECT * FROM "${tablename}"`);
          backup[tablename] = dataResult.rows;
          request.log.info(`Exported ${tablename}: ${dataResult.rows.length} rows`);
        } catch (err) {
          request.log.warn(`Failed to export ${tablename}: ${err.message}`);
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="nebula_backup_${timestamp}.json"`);
      
      // Audit log
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          request.user.id,
          'export_database_json',
          'system_config',
          `Database exported as JSON with ${Object.keys(backup).length} tables`,
          request.ip
        ]
      );

      reply.send(backup);
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({
        message: 'Failed to export database as JSON',
        error: error.message
      });
    }
  });

  // Import database (replace all data) — supports SQL (psql) and JSON formats
  fastify.post('/import', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const { backupData, format } = request.body;

      if (!backupData) {
        return reply.status(400).send({ message: 'No backup data provided' });
      }

      // Double-check user is admin
      if (request.user.role !== 'admin') {
        return reply.status(403).send({ message: 'Only admins can import backups' });
      }

      request.log.warn(`[CRITICAL] Admin ${request.user.username} initiated database import (format: ${format})`);

      if (format === 'sql') {
        // SQL import via psql
        const sqlContent = typeof backupData === 'string' ? backupData : Buffer.from(backupData).toString('utf8');
        const dbConfig = fastify.dbConfig?.postgresql || {};
        const dbHost = dbConfig.host || 'localhost';
        const dbPort = String(dbConfig.port || 5432);
        const dbUser = dbConfig.user;
        const dbName = dbConfig.database;
        const dbPassword = dbConfig.password || '';

        const env = { ...process.env, PGPASSWORD: dbPassword };

        try {
          await execCommand('psql', [
            '-h', dbHost,
            '-p', dbPort,
            '-U', dbUser,
            '-d', dbName,
            '-v', 'ON_ERROR_STOP=1'
          ], { env, input: sqlContent, timeout: 300000 });
        } catch (error) {
          const msg = String(error?.message || '').toLowerCase();
          if (!msg.includes('server version mismatch')) throw error;

          request.log.warn('psql version mismatch, using Docker fallback...');
          await execCommand('docker', [
            'run', '--rm', '--network', 'host', '-i',
            '-e', `PGPASSWORD=${dbPassword}`,
            'postgres:18',
            'psql',
            '-h', dbHost,
            '-p', dbPort,
            '-U', dbUser,
            '-d', dbName,
            '-v', 'ON_ERROR_STOP=1'
          ], { env: process.env, input: sqlContent, timeout: 300000 });
        }

        // Audit log
        await pool.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address)
           VALUES ($1, $2, $3, $4, $5)`,
          [request.user.id, 'import_database_sql', 'system_config', 'Database restored from SQL backup by admin', request.ip]
        );

        return reply.send({ success: true, message: 'Database imported successfully from SQL backup' });
      }

      if (format === 'json') {
        // JSON import
        const backup = typeof backupData === 'string' ? JSON.parse(backupData) : backupData;
        const client = await pool.connect();

        try {
          await client.query('BEGIN');
          await client.query('SET session_replication_role = replica');

          for (const [tableName, rows] of Object.entries(backup)) {
            try {
              await client.query(`TRUNCATE TABLE "${tableName}" CASCADE`);

              if (rows && rows.length > 0) {
                const columns = Object.keys(rows[0]);
                const placeholders = rows
                  .map((_, idx) => {
                    const values = columns.map((_, colIdx) => `$${idx * columns.length + colIdx + 1}`);
                    return `(${values.join(',')})`;
                  })
                  .join(',');

                const values = rows.flatMap(row => columns.map(col => row[col]));
                const sql = `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(',')}) VALUES ${placeholders}`;

                await client.query(sql, values);
                request.log.info(`Restored ${tableName}: ${rows.length} rows`);
              }
            } catch (err) {
              request.log.warn(`Failed to restore ${tableName}: ${err.message}`);
            }
          }

          await client.query('SET session_replication_role = DEFAULT');
          await client.query('COMMIT');

          await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              request.user.id,
              'import_database_json',
              'system_config',
              `Database restored from JSON backup with ${Object.keys(backup).length} tables`,
              request.ip
            ]
          );

          return reply.send({ success: true, message: 'Database imported successfully' });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }

      return reply.status(400).send({ message: 'Unsupported format. Use "sql" or "json"' });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({
        message: 'Failed to import database',
        error: error.message
      });
    }
  });

  // ── S3 / MinIO backup routes ────────────────────────────────────────────────

  /**
   * GET /api/admin/backups/s3/config
   * Return S3 config (secret_key masked for security)
   */
  fastify.get('/s3/config', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const cfg = await s3BackupService.loadConfig();
      // Mask secret key
      const safe = { ...cfg, secret_key: cfg.secret_key ? '••••••••' : '' };
      reply.send({ config: safe });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({ message: 'Failed to fetch S3 config', error: error.message });
    }
  });

  /**
   * PUT /api/admin/backups/s3/config
   * Save S3 config. Omit secret_key (or send '••••••••') to keep existing value.
   */
  fastify.put('/s3/config', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const body = request.body || {};

      // If caller sent the masked placeholder, preserve the stored secret
      if (body.secret_key === '••••••••' || body.secret_key === undefined) {
        const existing = await s3BackupService.loadConfig();
        body.secret_key = existing.secret_key;
      }

      const saved = await s3BackupService.saveConfig(body);
      let cleaned = 0;
      if (saved.enabled) {
        const cleanupResult = await s3BackupService.cleanOldBackups();
        cleaned = cleanupResult.deleted;
      }

      // Audit log
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [request.user.id, 'update_s3_backup_config', 'system_config',
          `S3 backup config updated (enabled=${saved.enabled}, endpoint=${saved.endpoint})`, request.ip]
      );

      reply.send({ success: true, config: { ...saved, secret_key: '••••••••' }, cleaned });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({ message: 'Failed to save S3 config', error: error.message });
    }
  });

  /**
   * POST /api/admin/backups/s3/test
   * Test connectivity to the configured S3 / MinIO bucket.
   */
  fastify.post('/s3/test', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      await s3BackupService.loadConfig();
      const result = await s3BackupService.testConnection();
      reply.send({ success: true, ...result });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({ success: false, message: 'S3 connection test failed', error: error.message });
    }
  });

  /**
   * GET /api/admin/backups/s3/list
   * List all backup objects stored in S3.
   */
  fastify.get('/s3/list', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      await s3BackupService.loadConfig();
      const backups = await s3BackupService.listBackups();
      reply.send({ backups });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({ message: 'Failed to list S3 backups', error: error.message });
    }
  });

  /**
   * POST /api/admin/backups/s3/upload/:filename
   * Start a background S3 upload job. Returns 202 + jobId immediately.
   */
  fastify.post('/s3/upload/:filename', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const { filename } = request.params;

    // Sanitize filename
    const safe = path.basename(filename);
    if (!/^[a-zA-Z0-9._-]+\.(sql|json)$/.test(safe)) {
      return reply.status(400).send({ message: 'Invalid filename' });
    }

    const backupDir = process.env.BACKUP_DIR || '/app/backups';
    const filepath = path.resolve(backupDir, safe);
    if (!filepath.startsWith(path.resolve(backupDir))) {
      return reply.status(400).send({ message: 'Invalid filename' });
    }

    try {
      await fs.access(filepath);
    } catch {
      return reply.status(404).send({ message: 'Backup file not found' });
    }

    await s3BackupService.loadConfig();
    if (!s3BackupService.isConfigured()) {
      return reply.status(400).send({ message: 'S3 backup not configured or disabled', error: 'S3 backup not configured or disabled' });
    }

    const job = createS3Job();
    const userId = request.user.id;
    const ip = request.ip;

    // Run upload in background
    (async () => {
      try {
        const s3Result = await s3BackupService.uploadBackup(filepath, safe);
        const cleanupResult = await s3BackupService.cleanOldBackups();

        // Mark record in DB if it exists
        await pool.query(
          `UPDATE backups SET s3_key = $1, s3_bucket = $2, uploaded_to_s3 = TRUE WHERE filename = $3`,
          [s3Result.key, s3Result.bucket, safe]
        );

        await pool.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address) VALUES ($1, $2, $3, $4, $5)`,
          [userId, 'upload_backup_s3', 'backups', `Backup ${safe} uploaded to S3 (key=${s3Result.key})`, ip]
        );

        job.status = 'completed';
        job.result = { ...s3Result, cleaned: cleanupResult.deleted };
      } catch (error) {
        fastify.log.error({ error }, 'S3 upload job failed');
        job.status = 'failed';
        job.error = error.message;
      } finally {
        job.finished_at = new Date().toISOString();
      }
    })();

    reply.code(202).send({ success: true, jobId: job.id, job });
  });

  /**
   * GET /api/admin/backups/s3/jobs/:jobId
   * Poll S3 upload job status.
   */
  fastify.get('/s3/jobs/:jobId', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const job = s3UploadJobs.get(request.params.jobId);
    if (!job) return reply.status(404).send({ message: 'Job not found' });
    reply.send({ success: true, job });
  });

  /**
   * DELETE /api/admin/backups/s3/:key
   * Delete a backup object from S3 (key is base64url-encoded to avoid path issues).
   */
  fastify.delete('/s3/:encodedKey', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const key = Buffer.from(request.params.encodedKey, 'base64url').toString('utf8');

      await s3BackupService.loadConfig();
      await s3BackupService.deleteBackup(key);

      // Audit log
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [request.user.id, 'delete_s3_backup', 'backups', `S3 backup deleted: ${key}`, request.ip]
      );

      reply.send({ success: true });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({ message: 'Failed to delete S3 backup', error: error.message });
    }
  });
}

export default backupRoutes;
