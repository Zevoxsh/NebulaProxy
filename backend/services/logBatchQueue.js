// @ts-check
/**
 * Log Batch Queue
 * Backends: 'db' (default) → PostgreSQL bulk insert
 *           'syslog'       → UDP/TCP RFC5424 syslog server (no DB writes)
 */
import dgram from 'dgram';
import net from 'net';
import { database } from './database.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';

// RFC5424 severity mapping from HTTP status / log level string
const SEVERITY = { emerg: 0, alert: 1, crit: 2, error: 3, warning: 4, notice: 5, info: 6, debug: 7 };

function severityFromStatus(statusCode) {
  if (!statusCode) return SEVERITY.info;
  if (statusCode >= 500) return SEVERITY.error;
  if (statusCode >= 400) return SEVERITY.warning;
  return SEVERITY.info;
}

function severityFromLevel(level) {
  if (!level) return SEVERITY.info;
  const l = level.toLowerCase();
  if (l === 'error') return SEVERITY.error;
  if (l === 'warning' || l === 'warn') return SEVERITY.warning;
  return SEVERITY.info;
}

/**
 * Build an RFC5424 syslog message string.
 * <PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
 */
function buildSyslogMessage(facility, severity, appName, msgid, structuredData, msg) {
  const pri = (facility * 8) + severity;
  const ts = new Date().toISOString();
  const hostname = process.env.HOSTNAME || 'nebulaproxy';
  const procid = process.pid;
  const sd = structuredData || '-';
  return `<${pri}>1 ${ts} ${hostname} ${appName} ${procid} ${msgid} ${sd} ${msg}`;
}

class SyslogTransport {
  constructor(host, port, protocol, facility, appName) {
    this.host = host;
    this.port = port;
    this.protocol = protocol; // 'udp' | 'tcp'
    this.facility = facility;
    this.appName = appName;
    this._tcpSocket = null;
    this._connecting = false;
  }

  send(severity, msgid, structuredData, msg) {
    const line = buildSyslogMessage(this.facility, severity, this.appName, msgid, structuredData, msg);
    const buf = Buffer.from(line + '\n');

    if (this.protocol === 'tcp') {
      this._sendTcp(buf);
    } else {
      this._sendUdp(buf);
    }
  }

  _sendUdp(buf) {
    const sock = dgram.createSocket('udp4');
    sock.send(buf, 0, buf.length, this.port, this.host, () => sock.close());
    sock.on('error', () => sock.close());
  }

  _sendTcp(buf) {
    if (this._tcpSocket && !this._tcpSocket.destroyed) {
      try { this._tcpSocket.write(buf); } catch { this._resetTcp(); }
      return;
    }
    if (this._connecting) return;
    this._connecting = true;
    const sock = net.createConnection({ host: this.host, port: this.port }, () => {
      this._connecting = false;
      this._tcpSocket = sock;
      sock.write(buf);
    });
    sock.on('error', () => { this._connecting = false; this._resetTcp(); });
    sock.on('close', () => this._resetTcp());
  }

  _resetTcp() {
    if (this._tcpSocket) { try { this._tcpSocket.destroy(); } catch {} }
    this._tcpSocket = null;
  }

  // Send a full batch of request logs as individual syslog messages
  sendRequestLogs(logs) {
    for (const log of logs) {
      const sev = severityFromStatus(log.statusCode);
      const sd = [
        `[request`,
        log.domainId   != null ? ` domainId="${log.domainId}"`   : '',
        log.hostname               ? ` host="${log.hostname}"`             : '',
        log.method                 ? ` method="${log.method}"`             : '',
        log.statusCode != null     ? ` status="${log.statusCode}"`         : '',
        log.responseTime != null   ? ` rt="${log.responseTime}ms"`         : '',
        log.ipAddress              ? ` ip="${log.ipAddress}"`              : '',
        `]`
      ].join('');
      const msg = `${log.method || '-'} ${log.path || '/'} ${log.statusCode || '-'} ${log.responseTime || 0}ms ${log.ipAddress || '-'}`;
      this.send(sev, 'REQUEST', sd, msg);
    }
  }

  sendProxyLogs(logs) {
    for (const log of logs) {
      const sev = severityFromLevel(log.level);
      const sd = [
        `[proxy`,
        log.domainId != null ? ` domainId="${log.domainId}"` : '',
        log.hostname         ? ` host="${log.hostname}"`     : '',
        log.method           ? ` method="${log.method}"`     : '',
        log.status  != null  ? ` status="${log.status}"`     : '',
        log.ipAddress        ? ` ip="${log.ipAddress}"`      : '',
        `]`
      ].join('');
      const msg = `${log.method || '-'} ${log.path || '/'} ${log.status || '-'} ${log.responseTime || 0}ms`;
      this.send(sev, 'PROXY', sd, msg);
    }
  }
}

class LogBatchQueue {
  constructor(batchSize = 50, flushIntervalMs = 500) {
    this.requestLogs = [];
    this.proxyLogs = [];
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.flushTimer = null;
    this.isRunning = false;
    this._syslog = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const backend = config.logs.backend;
    if (backend === 'syslog') {
      const { host, port, protocol, facility, appName } = config.logs.syslog;
      this._syslog = new SyslogTransport(host, port, protocol, facility, appName);
      logger.info(`[LogBatchQueue] Started — backend=syslog ${protocol}://${host}:${port}`);
    } else {
      logger.info(`[LogBatchQueue] Started — backend=db batchSize=${this.batchSize}`);
    }

    this._scheduleFlush();
  }

  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.requestLogs.length > 0 || this.proxyLogs.length > 0) await this._flush();
    if (this._syslog) this._syslog._resetTcp();
    logger.info('[LogBatchQueue] Stopped');
  }

  queueRequestLog(logData) {
    if (!this.isRunning) {
      if (config.logs.backend !== 'syslog') {
        database.createRequestLog(logData).catch((err) => {
          logger.error('[LogBatchQueue] Failed to write request log (degraded mode):', err);
        });
      }
      return;
    }
    this.requestLogs.push(logData);
    if (this.requestLogs.length >= this.batchSize) {
      this._flush().catch((err) => logger.error('[LogBatchQueue] Flush error:', err));
    }
  }

  queueProxyLog(logData) {
    if (!this.isRunning) {
      if (config.logs.backend !== 'syslog') {
        database.createProxyLog(logData).catch((err) => {
          logger.error('[LogBatchQueue] Failed to write proxy log (degraded mode):', err);
        });
      }
      return;
    }
    this.proxyLogs.push(logData);
    if (this.proxyLogs.length >= this.batchSize) {
      this._flush().catch((err) => logger.error('[LogBatchQueue] Flush error:', err));
    }
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

    if (config.logs.backend === 'syslog') {
      if (!this._syslog) {
        // Transport not created yet (race at startup) — lazy-init now
        const { host, port, protocol, facility, appName } = config.logs.syslog;
        this._syslog = new SyslogTransport(host, port, protocol, facility, appName);
        logger.warn(`[LogBatchQueue] SyslogTransport lazy-initialized ${protocol}://${host}:${port}`);
      }
      if (requestLogsToFlush.length > 0) this._syslog.sendRequestLogs(requestLogsToFlush);
      if (proxyLogsToFlush.length > 0)   this._syslog.sendProxyLogs(proxyLogsToFlush);
      return;
    }

    // Default: database backend
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
      backend: config.logs.backend,
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
