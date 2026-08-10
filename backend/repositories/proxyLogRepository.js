// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

import { logger } from '../utils/logger.js';
import { logBroadcastService } from '../services/logBroadcastService.js';

export class ProxyLogRepository {
// ===== PROXY LOGS METHODS =====

async createProxyLog(logData) {
  const { domainId, hostname, method, path, status, responseTime, ipAddress, userAgent, level } = logData;

  await this.execute(`
    INSERT INTO proxy_logs (domain_id, hostname, method, path, status, response_time, ip_address, user_agent, level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [domainId || null, hostname, method, path, status, responseTime, ipAddress || null, userAgent || null, level]);

  // Broadcast log to WebSocket clients
  try {
    logBroadcastService.broadcastProxyLog({
      id: Date.now(),
      timestamp: new Date(),
      domain_id: domainId,
      domainId: domainId,
      hostname,
      method,
      path,
      status,
      statusCode: status,
      response_time: responseTime,
      responseTime,
      ip_address: ipAddress,
      ipAddress,
      user_agent: userAgent,
      userAgent,
      level,
      protocol: method || 'TCP' // Determine protocol from method if available
    });
  } catch (error) {
    // Don't fail the log creation if broadcast fails
    logger.error('[Database] Failed to broadcast proxy log:', error.message);
  }
}

getProxyLogs(limit = 100, offset = 0, level = null) {
  const query = `
    SELECT * FROM proxy_logs
    ${level ? 'WHERE level = ?' : ''}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return level
    ? this.queryAll(query, [level, limit, offset])
    : this.queryAll(query, [limit, offset]);
}

getProxyLogsByDomain(domainId, limit = 50) {
  return this.queryAll(`
    SELECT * FROM proxy_logs
    WHERE domain_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [domainId, limit]);
}
}
