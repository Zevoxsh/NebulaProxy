// @ts-check
import cron from 'node-cron';
import { pool } from '../config/database.js';

const RETENTION_DAYS = 30;

class LogCleanupService {
  constructor(logger) {
    this.logger = logger;
    this.cronJob = null;
  }

  async runCleanup() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000).toISOString();
    this.logger.info(`[LogCleanup] Purging logs older than ${RETENTION_DAYS} days (before ${cutoff})`);

    try {
      const [r1, r2] = await Promise.all([
        pool.query('DELETE FROM request_logs WHERE timestamp < $1', [cutoff]),
        pool.query('DELETE FROM proxy_logs   WHERE created_at < $1', [cutoff]),
      ]);

      const deleted = (r1.rowCount ?? 0) + (r2.rowCount ?? 0);
      this.logger.info(`[LogCleanup] Deleted ${r1.rowCount ?? 0} request_logs + ${r2.rowCount ?? 0} proxy_logs`);

      if (deleted > 0) {
        await pool.query('VACUUM ANALYZE request_logs, proxy_logs').catch(() => {});
      }
    } catch (err) {
      this.logger.error({ err }, '[LogCleanup] Purge failed');
    }
  }

  async start() {
    // Run immediately on startup to catch up if the service was down
    await this.runCleanup();

    // Then every day at 03:00
    this.cronJob = cron.schedule('0 3 * * *', () => {
      this.runCleanup().catch((err) => this.logger.error({ err }, '[LogCleanup] Cron error'));
    });

    this.logger.info('[LogCleanup] Scheduled — daily at 03:00, retention = 30 days');
  }

  stop() {
    this.cronJob?.stop();
  }
}

export const logCleanupService = new LogCleanupService(console);

export function createLogCleanupService(logger) {
  return new LogCleanupService(logger);
}
