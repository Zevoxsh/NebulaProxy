import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { pool } from '../config/database.js';
import { config } from '../config/config.js';

const LOCAL_BACKUP_LIMIT = 3;

/**
 * Execute command with spawn (prevents command injection)
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - Spawn options
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: false, // Critical: Disable shell to prevent injection
      timeout: options.timeout || 120000 // 2 min default for DB operations
    });

    let stdout = '';
    let stderr = '';

    if (options.input && proc.stdin) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    }

    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    proc.on('error', (error) => {
      reject(new Error(`Failed to execute ${command}: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Spawn a command and pipe its stdout directly to a file (avoids string size limits).
 */
function execCommandToFile(command, args = [], outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: false,
      timeout: options.timeout || 300000
    });

    let stderr = '';
    const outStream = fsSync.createWriteStream(outputPath);

    proc.stdout.pipe(outStream);

    if (proc.stderr) {
      proc.stderr.on('data', (data) => { stderr += data.toString(); });
    }

    proc.on('error', (error) => {
      outStream.destroy();
      reject(new Error(`Failed to execute ${command}: ${error.message}`));
    });

    outStream.on('error', (error) => {
      reject(new Error(`Failed to write output: ${error.message}`));
    });

    proc.on('close', (code) => {
      outStream.end();
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stderr });
      }
    });
  });
}

function isPgVersionMismatch(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('server version mismatch');
}

function isPgDumpCatalogCorruption(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('cannot open relation')
    || message.includes('pg_sequence')
    || message.includes('this operation is not supported for indexes');
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

export class DatabaseBackupService {
  constructor() {
    this.backupDir = process.env.BACKUP_DIR || '/app/backups';
    this.activeBackupJob = null;
    this.lastBackupJob = null;
  }

  startBackupJob() {
    if (this.activeBackupJob && this.activeBackupJob.status === 'running') {
      return { alreadyRunning: true, job: this.activeBackupJob };
    }

    const job = {
      id: `backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      backup: null,
      error: null
    };

    this.activeBackupJob = job;
    this.lastBackupJob = job;

    (async () => {
      try {
        const backup = await this.createBackup();
        job.status = 'completed';
        job.backup = backup;
      } catch (error) {
        job.status = 'failed';
        job.error = error.message;
      } finally {
        job.finished_at = new Date().toISOString();
        if (this.activeBackupJob?.id === job.id) {
          this.activeBackupJob = null;
        }
      }
    })();

    return { alreadyRunning: false, job };
  }

  getLatestBackupJob() {
    return this.activeBackupJob || this.lastBackupJob;
  }

  getBackupJob(jobId) {
    if (!jobId) return null;
    if (this.activeBackupJob?.id === jobId) return this.activeBackupJob;
    if (this.lastBackupJob?.id === jobId) return this.lastBackupJob;
    return null;
  }

  sanitizeBackupFilename(filename) {
    if (typeof filename !== 'string' || filename.trim() === '') {
      throw new Error('Invalid backup filename');
    }
    const normalized = path.basename(filename.trim());
    if (normalized !== filename.trim()) {
      throw new Error('Invalid backup filename');
    }
    if (!/^[a-zA-Z0-9._-]+\.(sql|json)$/.test(normalized)) {
      throw new Error('Invalid backup filename');
    }
    return normalized;
  }

  async createJsonBackup(timestamp) {
    await this.ensureBackupDir();

    const filename = `nebula_backup_${timestamp}.json`;
    const filepath = path.join(this.backupDir, filename);
    const failedTables = [];

    const tablesResult = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    const fileHandle = await fs.open(filepath, 'w');
    
    try {
      // Write header
      await fileHandle.write('{\n');
      await fileHandle.write('  "meta": {\n');
      await fileHandle.write('    "format": "nebula-json-backup-v1",\n');
      await fileHandle.write(`    "created_at": "${new Date().toISOString()}",\n`);
      await fileHandle.write('    "db": {\n');
      await fileHandle.write(`      "host": "${config.database.host}",\n`);
      await fileHandle.write(`      "port": ${config.database.port},\n`);
      await fileHandle.write(`      "name": "${config.database.name}"\n`);
      await fileHandle.write('    },\n');
      await fileHandle.write('    "failed_tables": []\n');
      await fileHandle.write('  },\n');
      await fileHandle.write('  "tables": {\n');

      let firstTable = true;

      for (const row of tablesResult.rows) {
        const table = row.tablename;
        
        try {
          if (!firstTable) {
            await fileHandle.write(',\n');
          }
          firstTable = false;

          await fileHandle.write(`    "${table}": [\n`);
          
          // Stream rows in batches of 100
          const batchSize = 100;
          let offset = 0;
          let firstRow = true;

          while (true) {
            const result = await pool.query(
              `SELECT * FROM ${quoteIdentifier(table)} LIMIT ${batchSize} OFFSET ${offset}`
            );

            if (result.rows.length === 0) break;

            for (const rowData of result.rows) {
              if (!firstRow) {
                await fileHandle.write(',\n');
              }
              firstRow = false;
              await fileHandle.write(`      ${JSON.stringify(rowData)}`);
            }

            offset += batchSize;
            
            // Break if we got fewer rows than batch size (last batch)
            if (result.rows.length < batchSize) break;
          }

          await fileHandle.write('\n    ]');
        } catch (error) {
          failedTables.push({
            table,
            error: error.message
          });
          if (!firstTable) {
            await fileHandle.write(`    "${table}": []`);
          }
        }
      }

      await fileHandle.write('\n  }\n');
      await fileHandle.write('}\n');

    } finally {
      await fileHandle.close();
    }

    const stats = await fs.stat(filepath);

    await this.enforceBackupLimit(LOCAL_BACKUP_LIMIT);

    return {
      filename,
      filepath,
      size: stats.size,
      created_at: new Date(),
      format: 'json',
      failedTables
    };
  }

  /**
   * Ensure backup directory exists
   */
  async ensureBackupDir() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  /**
   * Create a new database backup
   */
  async createBackup() {
    await this.ensureBackupDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_').split('Z')[0];
    const filename = `nebula_backup_${timestamp}.sql`;
    const filepath = path.join(this.backupDir, filename);

    // Import dbConfig to get live configuration from Redis
    const { dbConfig } = await import('../config/database.js');
    const pgConfig = dbConfig.postgresql;
    
    const dbHost = pgConfig.host;
    const dbPort = pgConfig.port;
    const dbName = pgConfig.database;
    const dbUser = pgConfig.user;
    const dbPassword = pgConfig.password;

    // Set PGPASSWORD environment variable for pg_dump
    const env = {
      ...process.env,
      PGPASSWORD: dbPassword
    };

    try {
      // Execute pg_dump (local client)
      try {
        await execCommand('pg_dump', [
          '-h', dbHost,
          '-p', String(dbPort),
          '-U', dbUser,
          '-d', dbName,
          '-F', 'p',
          '-f', filepath
        ], { env });
      } catch (error) {
        const msg = String(error?.message || '').toLowerCase();

        // pg_dump not installed at all → fallback to JSON immediately
        if (msg.includes('enoent') || msg.includes('not found') || msg.includes('cannot find')) {
          return await this.createJsonBackup(timestamp);
        }

        // Fallback for client/server mismatch (e.g. server v18, local pg_dump v17)
        if (!isPgVersionMismatch(error)) {
          throw error;
        }

        try {
          await execCommandToFile('docker', [
            'run', '--rm', '--network', 'host',
            '-e', `PGPASSWORD=${dbPassword}`,
            'postgres:18',
            'pg_dump',
            '-h', dbHost,
            '-p', String(dbPort),
            '-U', dbUser,
            '-d', dbName,
            '-F', 'p'
          ], filepath, { env: process.env, timeout: 300000 });
        } catch (dockerError) {
          // Docker not available either → fallback to JSON
          return await this.createJsonBackup(timestamp);
        }
      }

      // Get file stats
      const stats = await fs.stat(filepath);

      await this.enforceBackupLimit(LOCAL_BACKUP_LIMIT);

      return {
        filename,
        filepath,
        size: stats.size,
        created_at: new Date(),
        format: 'sql'
      };
    } catch (error) {
      // If pg_dump cannot run due catalog corruption, fallback to JSON export
      if (isPgDumpCatalogCorruption(error)) {
        try {
          return await this.createJsonBackup(timestamp);
        } catch (jsonError) {
          throw new Error(`Backup failed (sql and json fallback): ${jsonError.message}`);
        }
      }

      // Clean up failed backup
      try {
        await fs.unlink(filepath);
      } catch {}
      throw new Error(`Backup failed: ${error.message}`);
    }
  }

  /**
   * Keep only the most recent local backups to prevent disk overuse.
   */
  async enforceBackupLimit(maxBackups = LOCAL_BACKUP_LIMIT) {
    try {
      const backups = await this.listBackups();
      if (backups.length <= maxBackups) {
        return { deleted: 0 };
      }

      const toDelete = backups.slice(maxBackups);
      let deleted = 0;

      for (const backup of toDelete) {
        try {
          await this.deleteBackup(backup.filename);
          deleted += 1;
        } catch (error) {
          console.warn(`[DatabaseBackupService] Failed to prune old backup ${backup.filename}: ${error.message}`);
        }
      }

      return { deleted };
    } catch (error) {
      console.warn(`[DatabaseBackupService] Failed to enforce backup retention: ${error.message}`);
      return { deleted: 0 };
    }
  }

  /**
   * List all backups
   */
  async listBackups() {
    await this.ensureBackupDir();

    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];

      for (const file of files) {
        if (file.endsWith('.sql') || file.endsWith('.json')) {
          const filepath = path.join(this.backupDir, file);
          const stats = await fs.stat(filepath);

          backups.push({
            id: file,
            filename: file,
            filepath,
            size: stats.size,
            sizeFormatted: this.formatBytes(stats.size),
            created_at: stats.birthtime,
            type: file.includes('manual') ? 'manual' : 'auto',
            format: file.endsWith('.json') ? 'json' : 'sql'
          });
        }
      }

      // Sort by creation date (newest first)
      backups.sort((a, b) => b.created_at - a.created_at);

      return backups;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get backup file path
   */
  async getBackupPath(filename) {
    const safeFilename = this.sanitizeBackupFilename(filename);
    const backupRoot = path.resolve(this.backupDir);
    const filepath = path.resolve(backupRoot, safeFilename);
    if (!filepath.startsWith(`${backupRoot}${path.sep}`) && filepath !== backupRoot) {
      throw new Error('Backup file not found');
    }

    // Check if file exists
    try {
      await fs.access(filepath);
      return filepath;
    } catch {
      throw new Error('Backup file not found');
    }
  }

  /**
   * Restore database from a backup file
   */
  async restoreBackup(filename) {
    const safeFilename = this.sanitizeBackupFilename(filename);
    const filepath = await this.getBackupPath(safeFilename);

    if (safeFilename.endsWith('.json')) {
      const content = await fs.readFile(filepath, 'utf8');
      const parsed = JSON.parse(content);
      const tables = parsed?.tables;

      if (!tables || typeof tables !== 'object') {
        throw new Error('Invalid JSON backup format');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET session_replication_role = replica');

        const tableNames = Object.keys(tables);
        for (const tableName of tableNames) {
          const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
          await client.query(`TRUNCATE TABLE ${quoteIdentifier(tableName)} CASCADE`);

          for (const row of rows) {
            const columns = Object.keys(row);
            if (columns.length === 0) continue;

            const values = columns.map((column) => row[column]);
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
            await client.query(
              `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`,
              values
            );
          }
        }

        // Re-sync sequences for serial/identity columns
        const seqRows = await client.query(`
          SELECT
            c.table_name,
            c.column_name,
            pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) AS seq_name
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.column_default LIKE 'nextval(%'
        `);

        for (const seq of seqRows.rows) {
          if (!seq.seq_name) continue;
          await client.query(
            `SELECT setval($1, COALESCE((SELECT MAX(${quoteIdentifier(seq.column_name)}) FROM ${quoteIdentifier(seq.table_name)}), 1), true)`,
            [seq.seq_name]
          );
        }

        await client.query('SET session_replication_role = DEFAULT');
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
          await client.query('SET session_replication_role = DEFAULT');
        } catch {}
        throw error;
      } finally {
        client.release();
      }

      return {
        success: true,
        filename: safeFilename,
        restored_at: new Date().toISOString(),
        format: 'json'
      };
    }

    // Import dbConfig to get live configuration from Redis
    const { dbConfig } = await import('../config/database.js');
    const pgConfig = dbConfig.postgresql;
    
    const dbHost = pgConfig.host;
    const dbPort = pgConfig.port;
    const dbName = pgConfig.database;
    const dbUser = pgConfig.user;
    const dbPassword = pgConfig.password;

    const env = {
      ...process.env,
      PGPASSWORD: dbPassword
    };

    try {
      await execCommand('psql', [
        '-h', dbHost,
        '-p', String(dbPort),
        '-U', dbUser,
        '-d', dbName,
        '-f', filepath
      ], { env, timeout: 300000 });
    } catch (error) {
      if (!isPgVersionMismatch(error)) {
        throw error;
      }

      const sqlContent = await fs.readFile(filepath, 'utf8');
      await execCommand('docker', [
        'run', '--rm', '--network', 'host', '-i',
        '-e', `PGPASSWORD=${dbPassword}`,
        'postgres:18',
        'psql',
        '-h', dbHost,
        '-p', String(dbPort),
        '-U', dbUser,
        '-d', dbName,
        '-v', 'ON_ERROR_STOP=1',
        '-f', '-'
      ], { env: process.env, timeout: 300000, input: sqlContent });
    }

    return {
      success: true,
      filename: safeFilename,
      restored_at: new Date().toISOString()
    };
  }

  /**
   * Delete a backup
   */
  async deleteBackup(filename) {
    const safeFilename = this.sanitizeBackupFilename(filename);
    const backupRoot = path.resolve(this.backupDir);
    const filepath = path.resolve(backupRoot, safeFilename);
    if (!filepath.startsWith(`${backupRoot}${path.sep}`) && filepath !== backupRoot) {
      throw new Error('Failed to delete backup: invalid file');
    }

    try {
      await fs.unlink(filepath);
      return true;
    } catch (error) {
      throw new Error(`Failed to delete backup: ${error.message}`);
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    try {
      // Get database size
      const sizeResult = await pool.query(`
        SELECT pg_size_pretty(pg_database_size($1)) as size,
               pg_database_size($1) as size_bytes
      `, [config.database.name]);

      // Get table count
      const tableResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `);

      // Get total rows (approximate)
      const rowsResult = await pool.query(`
        SELECT SUM(n_live_tup) as total_rows
        FROM pg_stat_user_tables
      `);

      return {
        size: sizeResult.rows[0].size,
        sizeBytes: parseInt(sizeResult.rows[0].size_bytes),
        tableCount: parseInt(tableResult.rows[0].count),
        totalRows: parseInt(rowsResult.rows[0].total_rows) || 0
      };
    } catch (error) {
      throw new Error(`Failed to get database stats: ${error.message}`);
    }
  }

  /**
   * Run VACUUM on database
   */
  async vacuumDatabase() {
    try {
      // VACUUM cannot run inside a transaction block, so we use a direct connection
      const client = await pool.connect();
      try {
        await client.query('VACUUM ANALYZE');
        return { success: true, message: 'VACUUM ANALYZE completed successfully' };
      } finally {
        client.release();
      }
    } catch (error) {
      throw new Error(`VACUUM failed: ${error.message}`);
    }
  }

  /**
   * Run ANALYZE on database
   */
  async analyzeDatabase() {
    try {
      await pool.query('ANALYZE');
      return { success: true, message: 'ANALYZE completed successfully' };
    } catch (error) {
      throw new Error(`ANALYZE failed: ${error.message}`);
    }
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

export const databaseBackupService = new DatabaseBackupService();
