import cron from 'node-cron';
import { pool } from '../config/database.js';
import { databaseBackupService } from './databaseBackupService.js';
import { s3BackupService } from './s3BackupService.js';

const LOCAL_BACKUP_LIMIT = 3;

class BackupScheduler {
  constructor(logger) {
    this.logger = logger;
    this.cronJob = null;
    this.schedule = null;
  }

  async initialize() {
    try {
      await this.enforceLimitsNow();

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
    await this.enforceLimitsNow();
    if (newSchedule.enabled) {
      this.start();
    }
  }

  async enforceLimitsNow() {
    try {
      const local = await databaseBackupService.enforceBackupLimit(LOCAL_BACKUP_LIMIT);
      if (local.deleted > 0) {
        this.logger.info(`Startup cleanup: removed ${local.deleted} local backup(s), keeping ${LOCAL_BACKUP_LIMIT}`);
      }
    } catch (error) {
      this.logger.error('Failed immediate local backup cleanup:', error);
    }

    try {
      await s3BackupService.loadConfig();
      if (s3BackupService.isConfigured()) {
        const cloud = await s3BackupService.cleanOldBackups();
        if (cloud.deleted > 0) {
          this.logger.info(`Startup cleanup: removed ${cloud.deleted} S3 backup(s), keeping 5`);
        }
      }
    } catch (error) {
      this.logger.error('Failed immediate S3 backup cleanup:', error);
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
      const { deleted } = await databaseBackupService.enforceBackupLimit(LOCAL_BACKUP_LIMIT);
      if (deleted > 0) {
        this.logger.info(`Removed ${deleted} old local backup(s), keeping ${LOCAL_BACKUP_LIMIT}`);
      }
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
