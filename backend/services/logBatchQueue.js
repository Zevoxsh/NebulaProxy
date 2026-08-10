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
          logger.error({ error: err }, '[LogBatchQueue] Failed to write request log (degraded mode):');
        });
        return;
      }
      this.requestLogs.push(preparedLog);
      if (this.requestLogs.length >= this.batchSize) {
        this._flush().catch((err) => logger.error({ error: err }, '[LogBatchQueue] Flush error:'));
      }
    });
  }

  queueProxyLog(logData) {
    void this._withCountry(logData).then((preparedLog) => {
      if (!this.isRunning) {
        database.createProxyLog(preparedLog).catch((err) => {
          logger.error({ error: err }, '[LogBatchQueue] Failed to write proxy log (degraded mode):');
        });
        return;
      }
      this.proxyLogs.push(preparedLog);
      if (this.proxyLogs.length >= this.batchSize) {
        this._flush().catch((err) => logger.error({ error: err }, '[LogBatchQueue] Flush error:'));
      }
    });
  }

  _scheduleFlush() {
    this.flushTimer = setTimeout(() => {
      if (this.isRunning) {
        this._flush()
          .catch((err) => logger.error({ error: err }, '[LogBatchQueue] Flush error:'))
          .finally(() => this._scheduleFlush());
      }
    }, this.flushIntervalMs);
  }

  async _flush() {
    const requestLogsToFlush = this.requestLogs.splice(0);
    const proxyLogsToFlush   = this.proxyLogs.splice(0);
    if (requestLogsToFlush.length === 0 && proxyLogsToFlush.length === 0) return;

    // Each entry is inserted independently (see _insertRequestLogs/_insertProxyLogs)
    // and only the ones that genuinely failed come back — a log referencing a
    // domain that's been deleted in the meantime (FK violation) can never
    // succeed and is dropped there rather than returned, so it's safe to
    // requeue whatever comes back here.
    const [failedRequestLogs, failedProxyLogs] = await Promise.all([
      requestLogsToFlush.length > 0 ? this._insertRequestLogs(requestLogsToFlush) : [],
      proxyLogsToFlush.length > 0 ? this._insertProxyLogs(proxyLogsToFlush) : []
    ]);
    if (failedRequestLogs.length > 0) this.requestLogs.unshift(...failedRequestLogs);
    if (failedProxyLogs.length > 0) this.proxyLogs.unshift(...failedProxyLogs);
  }

  // Postgres foreign_key_violation — the domain (or other row) this log
  // references no longer exists, almost always because it was deleted while
  // a request/connection that started before the deletion was still in
  // flight. Retrying is pointless (the row isn't coming back), so instead of
  // requeuing forever every flush interval this drops the entry and logs it
  // once. This used to be handled by letting Promise.all reject and blindly
  // requeuing the WHOLE original batch — which meant one permanently-broken
  // entry blocked the batch forever AND caused every other (valid, already
  // successfully inserted) log in that same batch to be silently retried
  // and duplicated on every subsequent flush tick.
  static FK_VIOLATION = '23503';

  _reapFailures(results, logs, kind) {
    const toRetry = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') return;
      const err = result.reason;
      if (err?.code === LogBatchQueue.FK_VIOLATION) {
        logger.warn(`[LogBatchQueue] Dropping orphaned ${kind} log (referenced row no longer exists): ${err.message}`);
        return;
      }
      logger.error(`[LogBatchQueue] Failed to insert ${kind} log, will retry:`, err?.message || err);
      toRetry.push(logs[i]);
    });
    return toRetry;
  }

  async _insertRequestLogs(logs) {
    const results = await Promise.allSettled(logs.map(log => database.createRequestLog(log)));
    return this._reapFailures(results, logs, 'request');
  }

  async _insertProxyLogs(logs) {
    const results = await Promise.allSettled(logs.map(log => database.createProxyLog(log)));
    return this._reapFailures(results, logs, 'proxy');
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
