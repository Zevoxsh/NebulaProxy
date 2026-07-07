// @ts-check
/**
 * Log Batch Queue
 * Database-only batching for request_logs and proxy_logs.
 */
import { database } from './database.js';
import { geoIpService } from './geoIpService.js';
import { logger } from '../utils/logger.js';

class LogBatchQueue {
  constructor(batchSize = 50, flushIntervalMs = 500) {
    this.requestLogs = [];
    this.proxyLogs = [];
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.flushTimer = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info(`[LogBatchQueue] Started — backend=db batchSize=${this.batchSize}`);

    this._scheduleFlush();
  }

  async _withCountry(logData) {
    if (!logData || logData.country || !logData.ipAddress) return logData;

    try {
      const country = await geoIpService.getCountryCode(logData.ipAddress);
      if (!country) return logData;
      return { ...logData, country };
    } catch (_) {
      return logData;
    }
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.requestLogs.length > 0 || this.proxyLogs.length > 0) await this._flush();
    logger.info('[LogBatchQueue] Stopped');
  }

  queueRequestLog(logData) {
    void this._withCountry(logData).then((preparedLog) => {
      if (!this.isRunning) {
        database.createRequestLog(preparedLog).catch((err) => {
          logger.error('[LogBatchQueue] Failed to write request log (degraded mode):', err);
        });
        return;
      }
      this.requestLogs.push(preparedLog);
      if (this.requestLogs.length >= this.batchSize) {
        this._flush().catch((err) => logger.error('[LogBatchQueue] Flush error:', err));
      }
    });
  }

  queueProxyLog(logData) {
    void this._withCountry(logData).then((preparedLog) => {
      if (!this.isRunning) {
        database.createProxyLog(preparedLog).catch((err) => {
          logger.error('[LogBatchQueue] Failed to write proxy log (degraded mode):', err);
        });
        return;
      }
      this.proxyLogs.push(preparedLog);
      if (this.proxyLogs.length >= this.batchSize) {
        this._flush().catch((err) => logger.error('[LogBatchQueue] Flush error:', err));
      }
    });
  }

  _scheduleFlush() {
    this.flushTimer = setTimeout(() => {
      if (this.isRunning) {
        this._flush()
          .catch((err) => logger.error('[LogBatchQueue] Flush error:', err))
          .finally(() => this._scheduleFlush());
      }
    }, this.flushIntervalMs);
  }

  async _flush() {
    const requestLogsToFlush = this.requestLogs.splice(0);
    const proxyLogsToFlush   = this.proxyLogs.splice(0);
    if (requestLogsToFlush.length === 0 && proxyLogsToFlush.length === 0) return;

    // Database backend
    try {
      const promises = [];
      if (requestLogsToFlush.length > 0) promises.push(this._insertRequestLogs(requestLogsToFlush));
      if (proxyLogsToFlush.length > 0)   promises.push(this._insertProxyLogs(proxyLogsToFlush));
      await Promise.all(promises);
    } catch (error) {
      logger.error('[LogBatchQueue] Flush operation failed:', error.message);
      this.requestLogs.unshift(...requestLogsToFlush);
      this.proxyLogs.unshift(...proxyLogsToFlush);
    }
  }

  async _insertRequestLogs(logs) {
    if (logs.length === 1) { await database.createRequestLog(logs[0]); return; }
    if (database.createRequestLogsBatch) {
      await database.createRequestLogsBatch(logs);
    } else {
      await Promise.all(logs.map(log => database.createRequestLog(log)));
    }
  }

  async _insertProxyLogs(logs) {
    if (logs.length === 1) { await database.createProxyLog(logs[0]); return; }
    if (database.createProxyLogsBatch) {
      await database.createProxyLogsBatch(logs);
    } else {
      await Promise.all(logs.map(log => database.createProxyLog(log)));
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      backend: 'db',
      requestLogsQueued: this.requestLogs.length,
      proxyLogsQueued:   this.proxyLogs.length,
      totalQueued:       this.requestLogs.length + this.proxyLogs.length,
      batchSize:         this.batchSize,
      flushIntervalMs:   this.flushIntervalMs
    };
  }
}

const logBatchQueue = new LogBatchQueue();

export { logBatchQueue };
