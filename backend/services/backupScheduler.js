import cron from 'node-cron';
import { pool } from '../config/database.js';
import fs from 'fs/promises';
import { databaseBackupService } from './databaseBackupService.js';
import { s3BackupService } from './s3BackupService.js';

class BackupScheduler {
  constructor(logger) {
    this.logger = logger;
    this.cronJob = null;
    this.schedule = null;
  }

  async initialize() {
    try {
      // Load schedule from database
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['backup_schedule']
      );

      if (result.rows.length > 0) {
        this.schedule = JSON.parse(result.rows[0].value);
        if (this.schedule.enabled) {
          this.start();
        }
      }

      this.logger.info('Backup scheduler initialized');
    } catch (error) {
      this.logger.error('Failed to initialize backup scheduler:', error);
    }
  }

  start() {
    if (!this.schedule || !this.schedule.enabled) {
      return;
    }

    // Stop existing job
    if (this.cronJob) {
      this.cronJob.stop();
    }

    // Convert schedule to cron expression
    const cronExpression = this.getCronExpression();

    if (!cronExpression) {
      this.logger.error('Invalid cron expression');
      return;
    }

    this.logger.info(`Starting backup scheduler: ${cronExpression}`);

    this.cronJob = cron.schedule(cronExpression, async () => {
      this.logger.info('Running scheduled backup...');
      await this.runBackup();
    });
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      this.logger.info('Backup scheduler stopped');
    }
  }

  async restart(newSchedule) {
    this.schedule = newSchedule;
    this.stop();
    if (newSchedule.enabled) {
      this.start();
    }
  }

  getCronExpression() {
    const { frequency, time } = this.schedule;
    const [hour, minute] = time.split(':');

    switch (frequency) {
      case 'hourly':
        return `${minute} * * * *`; // Every hour at :minute
      case 'daily':
        return `${minute} ${hour} * * *`; // Every day at hour:minute
      case 'weekly':
        return `${minute} ${hour} * * 0`; // Every Sunday at hour:minute
      case 'monthly':
        return `${minute} ${hour} 1 * *`; // First day of month at hour:minute
      default:
        return null;
    }
  }

  async runBackup() {
    try {
      // Delegate backup creation to databaseBackupService (handles pg_dump,
      // Docker fallback, JSON fallback, and large-file streaming correctly)
      const backup = await databaseBackupService.createBackup();
      const { filename, filepath, size } = backup;

      this.logger.info(`Automatic backup created: ${filename} (${size} bytes)`);

      // ── Upload to S3 (MinIO) if configured ─────────────────────────────────
      try {
        await s3BackupService.loadConfig();
        if (s3BackupService.isConfigured()) {
          this.logger.info(`Uploading backup to S3: ${filename}`);
          const s3Result = await s3BackupService.uploadBackup(filepath, filename);

          this.logger.info(`Backup uploaded to S3: ${s3Result.key} in bucket ${s3Result.bucket}`);

          // Prune old S3 backups according to retention_count
          const { deleted } = await s3BackupService.cleanOldBackups();
          if (deleted > 0) {
            this.logger.info(`Removed ${deleted} old backup(s) from S3`);
          }
        }
      } catch (s3Error) {
        // Log but don't fail the overall backup job — local copy still exists
        this.logger.error({ err: s3Error }, 'S3 upload failed (local backup is intact)');
      }

      // Clean old local backups
      await this.cleanOldBackups();

      // Send notification
      await this.sendNotification('success', filename);

    } catch (error) {
      this.logger.error('Backup failed:', error);
      await this.sendNotification('error', null, error.message);
    }
  }

  async cleanOldBackups() {
    try {
      const retentionDays = this.schedule.retention_days || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Get old backups
      const result = await pool.query(
        `SELECT filename, filepath FROM backups
         WHERE type = 'auto' AND created_at < $1`,
        [cutoffDate]
      );

      // Delete files and records
      for (const backup of result.rows) {
        try {
          await fs.unlink(backup.filepath);
          this.logger.info(`Deleted old backup: ${backup.filename}`);
        } catch (err) {
          this.logger.error(`Failed to delete backup file: ${backup.filename}`, err);
        }
      }

      // Delete records from database
      await pool.query(
        `DELETE FROM backups WHERE type = 'auto' AND created_at < $1`,
        [cutoffDate]
      );

      this.logger.info(`Cleaned up backups older than ${retentionDays} days`);
    } catch (error) {
      this.logger.error('Failed to clean old backups:', error);
    }
  }

  async sendNotification(status, filename = null, errorMessage = null) {
    try {
      // Get notification config
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['notification_config']
      );

      if (result.rows.length === 0) {
        return;
      }

      const config = JSON.parse(result.rows[0].value);

      if (!config.alerts.failed_backup_enabled && status === 'error') {
        return;
      }

      const message = status === 'success'
        ? `Automatic backup created successfully: ${filename}`
        : `Automatic backup failed: ${errorMessage}`;

      // Send via notification service (will be implemented)
      if (global.notificationService) {
        await global.notificationService.send({
          title: status === 'success' ? 'Backup Success' : 'Backup Failed',
          message,
          severity: status === 'success' ? 'success' : 'error',
          event: 'backup'
        });
      }
    } catch (error) {
      this.logger.error('Failed to send backup notification:', error);
    }
  }
}

export default BackupScheduler;
