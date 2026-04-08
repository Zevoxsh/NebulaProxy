import cron from 'node-cron';
import { pool } from '../config/database.js';
import { databaseBackupService } from './databaseBackupService.js';
import { s3BackupService } from './s3BackupService.js';

const LOCAL_BACKUP_LIMIT = 3;

class BackupScheduler {
  constructor(logger) {
    this.logger = logger;
    this.localCronJob = null;
    this.s3CronJob = null;
    this.schedule = null;
  }

  normalizeSchedule(raw) {
    const defaultItem = {
      enabled: false,
      frequency: 'daily',
      time: '02:00'
    };

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
        this.schedule = this.normalizeSchedule(JSON.parse(result.rows[0].value));
        if (this.schedule.local.enabled || this.schedule.s3.enabled) {
          this.start();
        }
      }

      this.logger.info('Backup scheduler initialized');
    } catch (error) {
      this.logger.error('Failed to initialize backup scheduler:', error);
    }
  }

  start() {
    if (!this.schedule) {
      return;
    }

    // Stop existing job
    this.stop();

    if (this.schedule.local.enabled) {
      const localCron = this.getCronExpression(this.schedule.local);
      if (!localCron) {
        this.logger.error('Invalid local backup cron expression');
      } else {
        this.logger.info(`Starting LOCAL backup scheduler: ${localCron}`);
        this.localCronJob = cron.schedule(localCron, async () => {
          this.logger.info('Running scheduled local backup...');
          await this.runLocalBackup();
        });
      }
    }

    if (this.schedule.s3.enabled) {
      const s3Cron = this.getCronExpression(this.schedule.s3);
      if (!s3Cron) {
        this.logger.error('Invalid S3 backup cron expression');
      } else {
        this.logger.info(`Starting S3 backup scheduler: ${s3Cron}`);
        this.s3CronJob = cron.schedule(s3Cron, async () => {
          this.logger.info('Running scheduled S3 backup...');
          await this.runS3Backup();
        });
      }
    }
  }

  stop() {
    if (this.localCronJob) {
      this.localCronJob.stop();
      this.localCronJob = null;
    }

    if (this.s3CronJob) {
      this.s3CronJob.stop();
      this.s3CronJob = null;
    }

    this.logger.info('Backup scheduler stopped');
  }

  async restart(newSchedule) {
    this.schedule = this.normalizeSchedule(newSchedule);
    this.stop();
    await this.enforceLimitsNow();
    if (this.schedule.local.enabled || this.schedule.s3.enabled) {
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

  getCronExpression(schedulePart) {
    const { frequency, time } = schedulePart;
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

  async runLocalBackup() {
    try {
      // Delegate backup creation to databaseBackupService (handles pg_dump,
      // Docker fallback, JSON fallback, and large-file streaming correctly)
      const backup = await databaseBackupService.createBackup();
      const { filename, size } = backup;

      this.logger.info(`Automatic local backup created: ${filename} (${size} bytes)`);

      // Clean old local backups
      await this.cleanOldBackups();

      await this.sendNotification('success', filename);

    } catch (error) {
      this.logger.error('Local backup failed:', error);
      await this.sendNotification('error', null, error.message);
    }
  }

  async runS3Backup() {
    try {
      const backup = await databaseBackupService.createBackup();
      const { filename, filepath, size } = backup;
      this.logger.info(`Automatic backup for S3 created locally: ${filename} (${size} bytes)`);

      await s3BackupService.loadConfig();
      if (!s3BackupService.isConfigured()) {
        throw new Error('S3 backup is not configured');
      }

      const s3Result = await s3BackupService.uploadBackup(filepath, filename);
      this.logger.info(`Backup uploaded to S3: ${s3Result.key} in bucket ${s3Result.bucket}`);

      await this.cleanOldBackups();

      const { deleted } = await s3BackupService.cleanOldBackups();
      if (deleted > 0) {
        this.logger.info(`Removed ${deleted} old backup(s) from S3`);
      }

      await this.sendNotification('success', `${filename} (S3)`);
    } catch (error) {
      this.logger.error('S3 backup failed:', error);
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
