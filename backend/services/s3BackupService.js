import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs';
import { pool } from '../config/database.js';

const CONFIG_KEY = 's3_backup_config';
const S3_BACKUP_LIMIT = 5;

/**
 * S3-compatible backup service (MinIO / AWS S3)
 * Uploads DB backups to an S3 bucket automatically.
 */
export class S3BackupService {
  constructor() {
    this._client = null;
    this._config = null;
  }

  // ─── Config helpers ──────────────────────────────────────────────────────────

  defaultConfig() {
    return {
      enabled: false,
      endpoint: '',
      region: 'us-east-1',
      access_key: '',
      secret_key: '',
      bucket: 'nebula',
      prefix: 'backups/',
      retention_count: S3_BACKUP_LIMIT,
      force_path_style: true // mandatory for MinIO / most S3-compatible providers
    };
  }

  async loadConfig() {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        [CONFIG_KEY]
      );
      this._config = result.rows.length > 0
        ? { ...this.defaultConfig(), ...JSON.parse(result.rows[0].value) }
        : this.defaultConfig();
      // Enforce fixed retention policy for cloud backups.
      this._config.retention_count = S3_BACKUP_LIMIT;
    } catch {
      this._config = this.defaultConfig();
    }
    this._client = null; // reset cached client whenever config is refreshed
    return this._config;
  }

  async getConfig() {
    if (!this._config) await this.loadConfig();
    return this._config;
  }

  async saveConfig(newConfig) {
    // Merge with defaults so partial updates still work
    const merged = { ...this.defaultConfig(), ...newConfig };
    // Always keep only the 5 most recent cloud backups.
    merged.retention_count = S3_BACKUP_LIMIT;

    await pool.query(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = $2, updated_at = NOW()`,
      [CONFIG_KEY, JSON.stringify(merged)]
    );

    this._config = merged;
    this._client = null; // invalidate cached S3 client
    return merged;
  }

  isConfigured() {
    const c = this._config;
    return !!(c?.enabled && c?.endpoint && c?.access_key && c?.secret_key && c?.bucket);
  }

  // ─── S3 client ───────────────────────────────────────────────────────────────

  _buildClient(cfg) {
    return new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region || 'us-east-1',
      credentials: {
        accessKeyId: cfg.access_key,
        secretAccessKey: cfg.secret_key
      },
      forcePathStyle: cfg.force_path_style !== false // true by default for MinIO / S3-compatible
    });
  }

  getClient() {
    if (!this._client) {
      if (!this._config) throw new Error('S3 config not loaded');
      this._client = this._buildClient(this._config);
    }
    return this._client;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Test the connection and optionally create the bucket if missing.
   */
  async testConnection() {
    const cfg = await this.getConfig();

    if (!cfg.endpoint || !cfg.access_key || !cfg.secret_key || !cfg.bucket) {
      throw new Error('S3 configuration incomplete (endpoint, access_key, secret_key, bucket required)');
    }

    const client = this._buildClient(cfg);

    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    } catch (err) {
      // 404-like: bucket does not exist → try creating it
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchBucket') {
        await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
      } else {
        throw err;
      }
    }

    return { success: true, bucket: cfg.bucket, endpoint: cfg.endpoint };
  }

  /**
   * Upload a local backup file to S3.
   * @param {string} localFilePath - Absolute path on disk
   * @param {string} filename      - Final S3 object name (no directory part)
   */
  async uploadBackup(localFilePath, filename) {
    await this.getConfig();

    if (!this.isConfigured()) {
      throw new Error('S3 backup not configured or disabled');
    }

    const key = `${this._config.prefix || ''}${filename}`;
    const contentType = filename.endsWith('.json') ? 'application/json' : 'application/sql';

    const upload = new Upload({
      client: this.getClient(),
      params: {
        Bucket: this._config.bucket,
        Key: key,
        Body: fs.createReadStream(localFilePath),
        ContentType: contentType,
        Metadata: {
          'nebula-proxy-backup': 'true',
          'uploaded-at': new Date().toISOString()
        }
      }
    });

    await upload.done();

    return {
      key,
      bucket: this._config.bucket,
      endpoint: this._config.endpoint,
      size: (await fs.promises.stat(localFilePath)).size
    };
  }

  /**
   * List all backup objects in S3, newest first.
   */
  async listBackups() {
    const cfg = await this.getConfig();
    if (!this.isConfigured()) return [];

    const response = await this.getClient().send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix || '' })
    );

    return (response.Contents || [])
      .map((obj) => ({
        key: obj.Key,
        filename: obj.Key.replace(cfg.prefix || '', ''),
        size: obj.Size,
        sizeFormatted: this._formatBytes(obj.Size),
        created_at: obj.LastModified
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  /**
   * Delete a single backup object from S3 by its full key.
   */
  async deleteBackup(key) {
    const cfg = await this.getConfig();
    if (!this.isConfigured()) throw new Error('S3 backup not configured');

    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })
    );
    return true;
  }

  /**
   * Remove old backups from S3, keeping the most recent `retention_count`.
   */
  async cleanOldBackups() {
    const cfg = await this.getConfig();
    const keep = cfg.retention_count || S3_BACKUP_LIMIT;

    const backups = await this.listBackups();
    if (backups.length <= keep) return { deleted: 0 };

    const toDelete = backups.slice(keep);
    for (const b of toDelete) {
      await this.deleteBackup(b.key);
    }

    return { deleted: toDelete.length };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals < 0 ? 0 : decimals))} ${sizes[i]}`;
  }
}

export const s3BackupService = new S3BackupService();
