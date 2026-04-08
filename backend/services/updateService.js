import gitService from './gitService.js';
import { getPgPool } from '../config/database.js';
import { config } from '../config/config.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { emailNotificationService as emailService } from './emailNotificationService.js';
import { redisService } from './redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = process.env.REPO_PATH || path.resolve(__dirname, '../../');
const BACKUPS_DIR = path.join(REPO_ROOT, 'backups');

/**
 * Execute command with spawn (prevents command injection)
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - Spawn options
 * @returns {Promise<string>} Command output
 */
function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: false, // Critical: Disable shell to prevent injection
      timeout: options.timeout || 30000
    });

    let stdout = '';
    let stderr = '';

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
        resolve(stdout);
      }
    });
  });
}

/**
 * Update Service - Automated update system with rollback support
 * Checks for updates, applies them, and rolls back on failure
 */
class UpdateService {
  constructor() {
    this.cronInterval = null;
    this.updateInProgress = false;
    this.logger = console; // Will be replaced with fastify logger on init
    this._pool = null;
  }

  /**
   * Get PostgreSQL pool (lazy initialization)
   */
  get pool() {
    if (!this._pool) {
      this._pool = getPgPool();
    }
    return this._pool;
  }

  /**
   * Initialize the update service
   * @param {Object} fastify - Fastify instance
   */
  async init(fastify) {
    if (fastify && fastify.log) {
      this.logger = fastify.log;
    }

    this.logger.info('[UpdateService] Initializing...');

    // Ensure backups directory exists
    try {
      await fs.mkdir(BACKUPS_DIR, { recursive: true });
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to create backups directory: ${error.message}`);
    }

    // Clean expired locks
    await this.cleanExpiredLocks();

    // Clean up any stuck updates (doesn't require Git)
    await this.cleanupStuckUpdates(10);

    // Check for update success flag from watchdog
    await this.checkWatchdogSuccess();

    // Check for pending updates that completed successfully
    await this.checkPendingUpdates();

    // Start cron if auto-update is enabled
    const enabled = await this.isAutoUpdateEnabled();
    if (enabled) {
      this.startCron();
    }

    this.logger.info('[UpdateService] Initialized');
  }

  /**
   * Check if auto-update is enabled
   * @returns {Promise<boolean>}
   */
  async isAutoUpdateEnabled() {
    try {
      const result = await this.pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['AUTO_UPDATE_ENABLED']
      );
      return result.rows[0]?.value === 'true';
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to check auto-update status: ${error.message}`);
      return false;
    }
  }

  /**
   * Get configuration value from system_config
   * @param {string} key - Config key
   * @param {string} defaultValue - Default value
   * @returns {Promise<string>}
   */
  async getConfigValue(key, defaultValue) {
    try {
      const result = await this.pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        [key]
      );
      return result.rows[0]?.value || defaultValue;
    } catch (error) {
      return defaultValue;
    }
  }

  /**
   * Start the cron job for scheduled checks
   */
  startCron() {
    if (this.cronInterval) {
      this.logger.warn('[UpdateService] Cron already running');
      return;
    }

    const intervalMinutes = parseInt(config.updates.intervalMinutes, 10);
    const intervalMs = intervalMinutes * 60 * 1000;

    this.logger.info(`[UpdateService] Starting cron (interval: ${intervalMinutes} minutes)`);

    this.cronInterval = setInterval(async () => {
      await this.checkForUpdates();
    }, intervalMs);

    // Run initial check after 1 minute
    setTimeout(async () => {
      await this.checkForUpdates();
    }, 60000);
  }

  /**
   * Stop the cron job
   */
  stopCron() {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
      this.logger.info('[UpdateService] Cron stopped');
    }
  }

  /**
   * Check for updates and apply if available
   * @returns {Promise<Object>} Check result
   */
  async checkForUpdates() {
    this.logger.info('[UpdateService] Running scheduled update check...');

    const checkResult = {
      updateAvailable: false,
      currentCommit: null,
      remoteCommit: null,
      error: null
    };

    try {
      // Check if git is available (refresh cache to get latest status)
      if (!(await gitService.refreshAvailability())) {
        this.logger.warn('[UpdateService] Git repository not available, skipping update check');
        checkResult.error = 'Git repository not available. Ensure the repository is mounted correctly.';
        return checkResult;
      }

      // Verify repository
      const verification = await gitService.verifyRepository();
      if (!verification.valid) {
        const blockingErrors = verification.errors.filter(
          (msg) => msg !== 'Repository has uncommitted changes'
        );

        if (blockingErrors.length > 0) {
          throw new Error(`Repository validation failed: ${blockingErrors.join(', ')}`);
        }

        this.logger.warn('[UpdateService] Repository has local changes; update check will continue');
      }

      // Fetch latest changes
      await gitService.fetch();

      // Get current and remote commits
      const currentCommit = await gitService.getCurrentCommit();
      const remoteCommit = await gitService.getRemoteCommit();

      checkResult.currentCommit = currentCommit;
      checkResult.remoteCommit = remoteCommit;
      checkResult.updateAvailable = currentCommit !== remoteCommit;

      // Log check to database
      await this.pool.query(
        `INSERT INTO update_checks (current_commit, remote_commit, update_available, check_status)
         VALUES ($1, $2, $3, $4)`,
        [currentCommit, remoteCommit, checkResult.updateAvailable, 'success']
      );

      if (checkResult.updateAvailable) {
        this.logger.info(`[UpdateService] Update available: ${gitService.getShortCommit(currentCommit)} -> ${gitService.getShortCommit(remoteCommit)}`);

        // Auto-apply if enabled
        const autoUpdateEnabled = await this.isAutoUpdateEnabled();
        if (autoUpdateEnabled) {
          // Check minimum interval
          const canUpdate = await this.canApplyUpdate();
          if (canUpdate) {
            this.logger.info('[UpdateService] Auto-applying update...');
            await this.applyUpdate();
          } else {
            this.logger.info('[UpdateService] Update available but minimum interval not met');
          }
        }
      } else {
        this.logger.info('[UpdateService] No updates available');
      }

    } catch (error) {
      this.logger.error(`[UpdateService] Check failed: ${error.message}`);
      checkResult.error = error.message;

      // Log failed check
      try {
        await this.pool.query(
          `INSERT INTO update_checks (current_commit, remote_commit, update_available, check_status, error_message)
           VALUES ($1, $2, $3, $4, $5)`,
          [checkResult.currentCommit || 'unknown', checkResult.remoteCommit || 'unknown', false, 'failed', error.message]
        );
      } catch (logError) {
        this.logger.error(`[UpdateService] Failed to log check error: ${logError.message}`);
      }
    }

    return checkResult;
  }

  /**
   * Check if enough time has passed since last update
   * @returns {Promise<boolean>}
   */
  async canApplyUpdate() {
    try {
      const minIntervalHours = parseInt(await this.getConfigValue('AUTO_UPDATE_MIN_INTERVAL_HOURS', '1'), 10);
      const minIntervalMs = minIntervalHours * 60 * 60 * 1000;

      const result = await this.pool.query(
        `SELECT completed_at FROM update_history
         WHERE update_status = 'success'
         ORDER BY completed_at DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        return true; // No previous updates
      }

      const lastUpdate = new Date(result.rows[0].completed_at);
      const timeSince = Date.now() - lastUpdate.getTime();

      return timeSince >= minIntervalMs;
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to check update interval: ${error.message}`);
      return false;
    }
  }

  /**
   * Apply an update
   * @param {Object} options - Update options
   * @param {boolean} options.skipWait - Skip notification wait (for manual updates)
   * @returns {Promise<Object>} Update result
   */
  async applyUpdate(options = {}) {
    const { skipWait = false } = options;
    let keepLockForWatchdog = false;

    if (this.updateInProgress || await this.hasActiveUpdate()) {
      throw new Error('Update already in progress');
    }

    // Acquire lock
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      throw new Error('Failed to acquire update lock');
    }

    this.updateInProgress = true;
    const startTime = Date.now();
    let updateId = null;
    let rollbackTag = null;

    try {
      // Get current and remote commits
      const currentCommit = await gitService.getCurrentCommit();
      const remoteCommit = await gitService.getRemoteCommit();

      if (currentCommit === remoteCommit) {
        throw new Error('No update available');
      }

      // Create update record
      const updateResult = await this.pool.query(
        `INSERT INTO update_history (from_commit, to_commit, rollback_tag, update_status)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [currentCommit, remoteCommit, 'pending', 'in_progress']
      );
      updateId = updateResult.rows[0].id;

      this.logger.info(`[UpdateService] Starting update #${updateId}: ${gitService.getShortCommit(currentCommit)} -> ${gitService.getShortCommit(remoteCommit)}`);

      // Send pre-update notification
      await this.sendPreUpdateNotification(currentCommit, remoteCommit);

      // Wait configured time before applying (skip for manual updates)
      if (!skipWait) {
        const notifyBeforeMinutes = parseInt(await this.getConfigValue('AUTO_UPDATE_NOTIFY_BEFORE_MINUTES', '5'), 10);
        if (notifyBeforeMinutes > 0) {
          this.logger.info(`[UpdateService] Waiting ${notifyBeforeMinutes} minutes before applying update...`);
          await new Promise(resolve => setTimeout(resolve, notifyBeforeMinutes * 60 * 1000));
        }
      } else {
        this.logger.info(`[UpdateService] Skipping wait (manual update)`);
      }

      // Create rollback tag
      rollbackTag = await gitService.createRollbackTag(updateId);
      await this.pool.query(
        'UPDATE update_history SET rollback_tag = $1 WHERE id = $2',
        [rollbackTag, updateId]
      );

      this.logger.info(`[UpdateService] Created rollback tag: ${rollbackTag}`);

      // Backup database
      await this.backupDatabase(updateId);

      // Analyze changes to determine what needs rebuilding
      const analysis = await gitService.analyzeChanges(currentCommit, remoteCommit);
      this.logger.info(`[UpdateService] Change analysis:`, analysis);

      // Pull changes
      this.logger.info('[UpdateService] Pulling changes...');
      await gitService.pull();

      // Run migrations if needed
      let migrationsApplied = [];
      if (analysis.hasMigrations) {
        this.logger.info('[UpdateService] Running migrations...');
        migrationsApplied = await this.runMigrations(analysis.migrationFiles);
      }

      // Rebuild or restart based on analysis
      const needsRebuild = analysis.needsBackendRebuild || analysis.needsFrontendRebuild;

      if (needsRebuild) {
        this.logger.info('[UpdateService] Rebuild required - triggering docker compose rebuild');
        await this.dockerComposeRebuild(analysis.needsBackendRebuild, analysis.needsFrontendRebuild);
      } else {
        this.logger.info('[UpdateService] No rebuild needed - fast restart');
        await this.dockerComposeRestart();
      }

      // At this point, restart/rebuild is delegated to watchdog. The current
      // backend process may restart before local post-checks can run reliably.
      // Keep update in "in_progress" and let startup reconciliation mark final state.
      await this.pool.query(
        `UPDATE update_history
         SET migrations_applied = $1, frontend_rebuilt = $2, backend_rebuilt = $3
         WHERE id = $4`,
        [migrationsApplied, analysis.needsFrontendRebuild, analysis.needsBackendRebuild, updateId]
      );

      this.logger.info(`[UpdateService] Update #${updateId} handed off to watchdog; awaiting restart confirmation`);
      keepLockForWatchdog = true;

      return {
        success: true,
        updateId,
        pendingRestart: true,
        fromCommit: currentCommit,
        toCommit: remoteCommit
      };

    } catch (error) {
      this.logger.error(`[UpdateService] Update failed: ${error.message}`);

      // Rollback
      if (updateId && rollbackTag) {
        await this.rollback(updateId, rollbackTag, error.message);
      }

      throw error;

    } finally {
      if (!keepLockForWatchdog) {
        await this.releaseLock();
      }
      this.updateInProgress = false;
    }
  }

  /**
   * Rollback to previous version
   * @param {number} updateId - Update ID
   * @param {string} rollbackTag - Git tag to rollback to
   * @param {string} reason - Rollback reason
   */
  async rollback(updateId, rollbackTag, reason) {
    this.logger.warn(`[UpdateService] Rolling back update #${updateId} - Reason: ${reason}`);

    try {
      // Git reset to rollback tag
      this.logger.info(`[UpdateService] Resetting to ${rollbackTag}...`);
      await gitService.resetHard(rollbackTag);

      // Restore database
      await this.restoreDatabase(updateId);

      // Rebuild to ensure clean state
      this.logger.info('[UpdateService] Rebuilding containers after rollback...');
      await this.dockerComposeRebuild(true, true);

      // Wait and verify
      await new Promise(resolve => setTimeout(resolve, 5000));
      const healthCheckPassed = await this.performHealthCheck();

      // Update record
      await this.pool.query(
        `UPDATE update_history
         SET update_status = $1, rolled_back_at = CURRENT_TIMESTAMP,
             rollback_reason = $2, health_check_passed = $3, completed_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        ['rolled_back', reason, healthCheckPassed, updateId]
      );

      this.logger.info(`[UpdateService] Rollback completed for update #${updateId}`);

      // Send rollback notification
      await this.sendRollbackNotification(updateId, reason);

    } catch (rollbackError) {
      this.logger.error(`[UpdateService] Rollback failed: ${rollbackError.message}`);
      throw rollbackError;
    }
  }

  /**
   * Perform health check on the application
   * @returns {Promise<boolean>} Health check passed
   */
  async performHealthCheck() {
    const timeout = parseInt(await this.getConfigValue('AUTO_UPDATE_HEALTH_CHECK_TIMEOUT_SECONDS', '60'), 10) * 1000;
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds

    this.logger.info(`[UpdateService] Starting health check (timeout: ${timeout / 1000}s)...`);

    while (Date.now() - startTime < timeout) {
      try {
        // Check if backend is responding
        const response = await fetch('http://localhost:3000/proxy/check', {
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          this.logger.info('[UpdateService] Health check passed');
          return true;
        }
      } catch (error) {
        // Continue trying
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    this.logger.error('[UpdateService] Health check timeout');
    return false;
  }

  /**
   * Get Docker Compose project name
   * @returns {string}
   */
  getDockerProjectName() {
    // Use environment variable (set in docker-compose.yml)
    // With network_mode: host, hostname detection doesn't work
    const projectName = process.env.COMPOSE_PROJECT_NAME || 'dd';
    this.logger.debug(`[UpdateService] Using project name: ${projectName}`);
    return projectName;
  }

  /**
   * Rebuild docker containers
   * Uses Docker socket to control host Docker daemon
   * @param {boolean} backend - Rebuild backend
   * @param {boolean} frontend - Rebuild frontend
   */
  async dockerComposeRebuild(backend, frontend) {
    // Push a request to the Redis queue so the external watchdog process can
    // handle the Docker restart safely (avoids the backend restarting itself).
    this.logger.info('[UpdateService] Pushing update request to Redis queue: nebulaproxy:update:queue');
    this.logger.info('[UpdateService] External watchdog will handle the restart');

    try {
      await redisService.getClient().lpush('nebulaproxy:update:queue', JSON.stringify({
        timestamp: new Date().toISOString(),
        backend,
        frontend,
        triggeredBy: 'UpdateService'
      }));

      this.logger.info('[UpdateService] Update request pushed to Redis queue successfully');
      this.logger.info('[UpdateService] The watchdog will restart Docker in ~10 seconds');

    } catch (error) {
      this.logger.error(`[UpdateService] Failed to push update request to Redis: ${error.message}`);
      throw new Error(`Failed to signal update to watchdog: ${error.message}`);
    }
  }

  /**
   * Restart docker containers (fast path)
   * Uses Docker socket to control host Docker daemon
   */
  async dockerComposeRestart() {
    this.logger.info('[UpdateService] Delegating fast restart to watchdog queue');
    await this.dockerComposeRebuild(true, false);
  }

  /**
   * Backup database before update
   * @param {number} updateId - Update ID
   * @returns {Promise<string>} Backup file path
   */
  async backupDatabase(updateId) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUPS_DIR, `backup-update-${updateId}-${timestamp}.sql`);

    this.logger.info(`[UpdateService] Creating database backup: ${backupFile}`);

    await execCommand('pg_dump', [
      '-h', config.database.host,
      '-p', String(config.database.port),
      '-U', config.database.user,
      '-d', config.database.name,
      '-F', 'p',
      '-f', backupFile
    ], {
      env: { ...process.env, PGPASSWORD: config.database.password },
      timeout: 120000
    });

    // Get file size
    const stats = await fs.stat(backupFile);

    // Record backup
    await this.pool.query(
      `INSERT INTO database_backups (backup_path, backup_size_bytes, created_for_update_id)
       VALUES ($1, $2, $3)`,
      [backupFile, stats.size, updateId]
    );

    this.logger.info(`[UpdateService] Backup created (${Math.round(stats.size / 1024)} KB)`);

    return backupFile;
  }

  /**
   * Restore database from backup
   * @param {number} updateId - Update ID
   */
  async restoreDatabase(updateId) {
    // Find backup for this update
    const result = await this.pool.query(
      'SELECT backup_path FROM database_backups WHERE created_for_update_id = $1 ORDER BY created_at DESC LIMIT 1',
      [updateId]
    );

    if (result.rows.length === 0) {
      this.logger.warn(`[UpdateService] No backup found for update #${updateId}`);
      return;
    }

    const backupFile = result.rows[0].backup_path;
    this.logger.info(`[UpdateService] Restoring database from: ${backupFile}`);

    await execCommand('psql', [
      '-h', config.database.host,
      '-p', String(config.database.port),
      '-U', config.database.user,
      '-d', config.database.name,
      '-f', backupFile
    ], {
      env: { ...process.env, PGPASSWORD: config.database.password },
      timeout: 120000
    });

    // Mark backup as restored
    await this.pool.query(
      'UPDATE database_backups SET restored_at = CURRENT_TIMESTAMP WHERE backup_path = $1',
      [backupFile]
    );

    this.logger.info('[UpdateService] Database restored');
  }

  /**
   * Run database migrations
   * @param {string[]} migrationFiles - Migration files to run
   * @returns {Promise<string[]>} Applied migration names
   */
  async runMigrations(migrationFiles) {
    const applied = [];

    for (const file of migrationFiles) {
      const migrationPath = path.join(REPO_ROOT, file);
      this.logger.info(`[UpdateService] Running migration: ${file}`);

      try {
        const sql = await fs.readFile(migrationPath, 'utf8');
        await this.pool.query(sql);
        applied.push(file);
        this.logger.info(`[UpdateService] Migration completed: ${file}`);
      } catch (error) {
        this.logger.error(`[UpdateService] Migration failed: ${file} - ${error.message}`);
        throw error;
      }
    }

    return applied;
  }

  /**
   * Send pre-update notification
   */
  async sendPreUpdateNotification(fromCommit, toCommit) {
    try {
      const commits = await gitService.getCommitsBetween(fromCommit, toCommit);
      const changesList = commits.map(c => `- ${c.subject}`).join('\n');

      const subject = '[NebulaProxy] Update starting soon';
      const message = `
An automatic update will be applied in ${await this.getConfigValue('AUTO_UPDATE_NOTIFY_BEFORE_MINUTES', '5')} minutes.

Current Version: ${gitService.getShortCommit(fromCommit)}
New Version: ${gitService.getShortCommit(toCommit)}

Changes:
${changesList}

Expected downtime: < 30 seconds
      `.trim();

      await this.sendAdminEmail(subject, message);
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to send pre-update notification: ${error.message}`);
    }
  }

  /**
   * Send success notification
   */
  async sendSuccessNotification(updateId, fromCommit, toCommit, downtimeSeconds) {
    try {
      const subject = '[NebulaProxy] Update completed successfully';
      const message = `
Update #${updateId} completed successfully.

Previous Version: ${gitService.getShortCommit(fromCommit)}
New Version: ${gitService.getShortCommit(toCommit)}

Downtime: ${downtimeSeconds} seconds

All systems operational.
      `.trim();

      await this.sendAdminEmail(subject, message);

      await this.pool.query(
        'UPDATE update_history SET notification_sent = true, notified_at = CURRENT_TIMESTAMP WHERE id = $1',
        [updateId]
      );
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to send success notification: ${error.message}`);
    }
  }

  /**
   * Send rollback notification
   */
  async sendRollbackNotification(updateId, reason) {
    try {
      const subject = '[NebulaProxy] Update rolled back';
      const message = `
Update #${updateId} was rolled back due to an error.

Reason: ${reason}

The system has been restored to the previous version.
Please investigate the issue before attempting another update.
      `.trim();

      await this.sendAdminEmail(subject, message);
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to send rollback notification: ${error.message}`);
    }
  }

  /**
   * Send email to all admin users
   */
  async sendAdminEmail(subject, message) {
    try {
      const result = await this.pool.query(
        'SELECT email FROM users WHERE role = $1',
        ['admin']
      );

      for (const row of result.rows) {
        if (row.email) {
          await emailService.send(row.email, subject, message);
        }
      }
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to send admin email: ${error.message}`);
    }
  }

  /**
   * Acquire update lock
   * @returns {Promise<boolean>}
   */
  async acquireLock() {
    try {
      await this.cleanExpiredLocks();

      const expiresAt = new Date(Date.now() + 3600000); // 1 hour
      const insertResult = await this.pool.query(
        `INSERT INTO update_locks (lock_type, acquired_by, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (lock_type) DO NOTHING
         RETURNING id`,
        ['update_in_progress', 'updateService', expiresAt]
      );

      return insertResult.rows.length === 1;
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to acquire lock: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if an update is currently active in DB state.
   * @returns {Promise<boolean>}
   */
  async hasActiveUpdate() {
    try {
      await this.cleanExpiredLocks();

      const lockResult = await this.pool.query(
        `SELECT 1
         FROM update_locks
         WHERE lock_type = $1
           AND expires_at > CURRENT_TIMESTAMP
         LIMIT 1`,
        ['update_in_progress']
      );

      if (lockResult.rows.length > 0) {
        return true;
      }

      const historyResult = await this.pool.query(
        `SELECT 1
         FROM update_history
         WHERE update_status = 'in_progress'
         LIMIT 1`
      );

      return historyResult.rows.length > 0;
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to check active update state: ${error.message}`);
      return true;
    }
  }

  /**
   * Release update lock
   */
  async releaseLock() {
    try {
      await this.pool.query('DELETE FROM update_locks WHERE lock_type = $1', ['update_in_progress']);
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to release lock: ${error.message}`);
    }
  }

  /**
   * Clean expired locks
   */
  async cleanExpiredLocks() {
    try {
      await this.pool.query('DELETE FROM update_locks WHERE expires_at < CURRENT_TIMESTAMP');
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to clean expired locks: ${error.message}`);
    }
  }

  /**
   * Check for pending updates after restart
   * If the system restarted successfully, mark pending updates as success
   */
  async checkPendingUpdates() {
    try {
      // Check if git is available (use cached value for background checks)
      if (!(await gitService.isAvailable())) {
        this.logger.warn('[UpdateService] Git repository not available, skipping pending updates check');
        return;
      }

      // Get current commit to check against
      const currentCommit = await gitService.getCurrentCommit();

      // Find ALL updates that are still in_progress
      const result = await this.pool.query(
        `SELECT id, from_commit, to_commit, started_at
         FROM update_history
         WHERE update_status = 'in_progress'
         ORDER BY started_at DESC`
      );

      if (result.rows.length === 0) {
        return; // No pending updates
      }

      this.logger.info(`[UpdateService] Found ${result.rows.length} pending update(s), checking status...`);

      for (const update of result.rows) {
        const ageHours = (Date.now() - new Date(update.started_at).getTime()) / (1000 * 60 * 60);
        const targetCommit = update.to_commit;

        // Check if this update's target matches current commit
        if (currentCommit === targetCommit) {
          // This update was successful!
          const startTime = new Date(update.started_at).getTime();
          const endTime = Date.now();
          const downtimeSeconds = Math.round((endTime - startTime) / 1000);

          await this.pool.query(
            `UPDATE update_history
             SET update_status = 'success',
                 completed_at = CURRENT_TIMESTAMP,
                 downtime_seconds = $1,
                 health_check_passed = true
             WHERE id = $2`,
            [downtimeSeconds, update.id]
          );

          this.logger.info(`[UpdateService] Update #${update.id} marked as successful (${downtimeSeconds}s downtime)`);

          // Send success notification
          await this.sendSuccessNotification(update.id, update.from_commit, update.to_commit, downtimeSeconds);

        } else if (ageHours > 2) {
          // Old update that didn't complete - mark as failed
          this.logger.warn(`[UpdateService] Update #${update.id} is ${ageHours.toFixed(1)}h old and commit doesn't match - marking as failed`);

          await this.pool.query(
            `UPDATE update_history
             SET update_status = 'failed',
                 completed_at = CURRENT_TIMESTAMP,
                 health_check_passed = false,
                 health_check_error = 'Update timed out or was superseded by newer update'
             WHERE id = $1`,
            [update.id]
          );
        } else {
          // Recent update but commit doesn't match - might have been superseded by another update
          // Mark as failed since it's not the current version
          this.logger.info(`[UpdateService] Update #${update.id} was superseded - marking as failed`);

          await this.pool.query(
            `UPDATE update_history
             SET update_status = 'failed',
                 completed_at = CURRENT_TIMESTAMP,
                 health_check_passed = false,
                 health_check_error = 'Update was superseded by a newer update'
             WHERE id = $1`,
            [update.id]
          );
        }
      }

      const stillRunning = await this.pool.query(
        `SELECT COUNT(*)::int AS count
         FROM update_history
         WHERE update_status = 'in_progress'`
      );

      if ((stillRunning.rows[0]?.count || 0) === 0) {
        await this.releaseLock();
      }

    } catch (error) {
      this.logger.error(`[UpdateService] Failed to check pending updates: ${error.message}`);
    }
  }

  /**
   * Clean up stuck updates that have been in progress for too long
   * This doesn't require Git availability - just checks age
   * @param {number} timeoutMinutes - How long before marking as failed (default 10 minutes)
   */
  async cleanupStuckUpdates(timeoutMinutes = 10) {
    try {
      const timeoutMs = timeoutMinutes * 60 * 1000;
      const cutoffTime = new Date(Date.now() - timeoutMs);

      const result = await this.pool.query(
        `UPDATE update_history
         SET update_status = 'failed',
             completed_at = CURRENT_TIMESTAMP,
             health_check_passed = false,
             health_check_error = 'Update timed out after ${timeoutMinutes} minutes'
         WHERE update_status = 'in_progress'
           AND started_at < $1
         RETURNING id, from_commit, to_commit, started_at`,
        [cutoffTime]
      );

      if (result.rows.length > 0) {
        this.logger.info(`[UpdateService] Cleaned up ${result.rows.length} stuck update(s):`);
        result.rows.forEach(row => {
          const ageMinutes = Math.round((Date.now() - new Date(row.started_at).getTime()) / 60000);
          this.logger.info(`  - Update #${row.id} (${row.from_commit} → ${row.to_commit}) - stuck for ${ageMinutes} minutes`);
        });

        // Reset updateInProgress flag
        this.updateInProgress = false;
        await this.releaseLock();
      }

      return result.rows.length;
    } catch (error) {
      this.logger.error(`[UpdateService] Failed to cleanup stuck updates: ${error.message}`);
      return 0;
    }
  }

  /**
   * Check for update success flag from watchdog
   * The watchdog creates a flag file after successfully completing an update
   */
  async checkWatchdogSuccess() {
    try {
      // Check if success flag exists in Redis
      const flagContent = await redisService.getClient().get('nebulaproxy:update:success');

      if (!flagContent) {
        return; // No flag, nothing to do
      }

      const targetCommit = flagContent.trim();
      this.logger.info(`[UpdateService] Found watchdog success flag for commit: ${targetCommit}`);

      // Find the matching in_progress update for this commit (fallback: most recent)
      const result = await this.pool.query(
        `SELECT id, from_commit, to_commit, started_at
         FROM update_history
         WHERE update_status = 'in_progress'
           AND to_commit = $1
         ORDER BY started_at DESC
         LIMIT 1`,
        [targetCommit]
      );

      let update = result.rows[0];

      if (!update) {
        const fallback = await this.pool.query(
          `SELECT id, from_commit, to_commit, started_at
           FROM update_history
           WHERE update_status = 'in_progress'
           ORDER BY started_at DESC
           LIMIT 1`
        );
        update = fallback.rows[0];
      }

      if (!update) {
        this.logger.info('[UpdateService] No in_progress update found, removing Redis flag');
        await redisService.getClient().del('nebulaproxy:update:success').catch(() => {});
        return;
      }
      const startTime = new Date(update.started_at).getTime();
      const endTime = Date.now();
      const downtimeSeconds = Math.round((endTime - startTime) / 1000);

      // Mark the update as successful
      await this.pool.query(
        `UPDATE update_history
         SET update_status = 'success',
             completed_at = CURRENT_TIMESTAMP,
             downtime_seconds = $1,
             health_check_passed = true
         WHERE id = $2`,
        [downtimeSeconds, update.id]
      );

      this.logger.info(`[UpdateService] Update #${update.id} marked as successful (${downtimeSeconds}s downtime)`);

      // Reset updateInProgress flag
      this.updateInProgress = false;
      await this.releaseLock();

      // Remove the Redis success flag
      await redisService.getClient().del('nebulaproxy:update:success').catch(() => {});

      // Send success notification
      await this.sendSuccessNotification(update.id, update.from_commit, update.to_commit, downtimeSeconds);

    } catch (error) {
      this.logger.error(`[UpdateService] Failed to check watchdog success: ${error.message}`);
    }
  }

  /**
   * Get update status
   * @returns {Promise<Object>}
   */
  async getStatus() {
    try {
      // Check if git is available
      if (!(await gitService.isAvailable())) {
        return {
          currentCommit: 'unavailable',
          remoteCommit: 'unavailable',
          updateAvailable: false,
          autoUpdateEnabled: false,
          updateInProgress: this.updateInProgress,
          gitAvailable: false
        };
      }

      const currentCommit = await gitService.getCurrentCommit();
      await gitService.fetch();
      const remoteCommit = await gitService.getRemoteCommit();
      const updateAvailable = currentCommit !== remoteCommit && currentCommit !== 'unavailable';
      const autoUpdateEnabled = await this.isAutoUpdateEnabled();

      return {
        currentCommit: gitService.getShortCommit(currentCommit),
        remoteCommit: gitService.getShortCommit(remoteCommit),
        updateAvailable,
        autoUpdateEnabled,
        updateInProgress: this.updateInProgress,
        gitAvailable: true
      };
    } catch (error) {
      throw new Error(`Failed to get status: ${error.message}`);
    }
  }

  /**
   * Get update history
   * @param {number} limit - Max records to return
   * @returns {Promise<Array>}
   */
  async getHistory(limit = 10) {
    const result = await this.pool.query(
      `SELECT id, from_commit, to_commit, update_status, started_at, completed_at,
              downtime_seconds, migrations_applied, frontend_rebuilt, backend_rebuilt,
              rollback_reason
       FROM update_history
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      ...row,
      from_commit: gitService.getShortCommit(row.from_commit),
      to_commit: gitService.getShortCommit(row.to_commit)
    }));
  }

  /**
   * Toggle auto-update
   * @param {boolean} enabled
   */
  async toggleAutoUpdate(enabled) {
    await this.pool.query(
      'UPDATE system_config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2',
      [enabled ? 'true' : 'false', 'AUTO_UPDATE_ENABLED']
    );

    if (enabled) {
      this.startCron();
    } else {
      this.stopCron();
    }

    this.logger.info(`[UpdateService] Auto-update ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// Export singleton instance
export default new UpdateService();
