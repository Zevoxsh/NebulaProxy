// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

import { logger } from '../utils/logger.js';
import { logBroadcastService } from '../services/logBroadcastService.js';

export class RequestLogRepository {
// ===== REQUEST LOGS METHODS =====

async createRequestLog(logData) {
  const {
    domainId,
    hostname,
    method,
    path,
    queryString,
    statusCode,
    responseTime,
    responseSize,
    ipAddress,
    userAgent,
    referer,
    requestHeaders,
    responseHeaders,
    errorMessage
  } = logData;

  await this.execute(`
    INSERT INTO request_logs (
      domain_id, hostname, method, path, query_string, status_code,
      response_time, response_size, ip_address, user_agent, referer,
      request_headers, response_headers, error_message
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    domainId || null,
    hostname,
    method,
    path,
    queryString || null,
    statusCode || null,
    responseTime || null,
    responseSize || null,
    ipAddress || null,
    userAgent || null,
    referer || null,
    requestHeaders ? JSON.stringify(requestHeaders) : null,
    responseHeaders ? JSON.stringify(responseHeaders) : null,
    errorMessage || null
  ]);

  // Broadcast log to WebSocket clients
  try {
    logBroadcastService.broadcastTrafficLog({
      id: Date.now(), // Temporary ID until we can get the actual one
      timestamp: new Date(),
      domain_id: domainId,
      domainId: domainId,
      hostname,
      method,
      path,
      query_string: queryString,
      queryString,
      status_code: statusCode,
      statusCode,
      response_time: responseTime,
      responseTime,
      ip_address: ipAddress,
      ipAddress,
      user_agent: userAgent,
      userAgent,
      error_message: errorMessage,
      errorMessage,
      protocol: 'HTTP'
    });
  } catch (error) {
    // Don't fail the log creation if broadcast fails
    logger.error('[Database] Failed to broadcast request log:', error.message);
  }
}

// Get request logs by domain ID with pagination and filtering
async getRequestLogsByDomain(domainId, options = {}) {
  const {
    method = null,
    statusCode = null,
    search = null,
    startDate = null,
    endDate = null
  } = options;

  let query = `
    SELECT *
    FROM request_logs
    WHERE domain_id = ?
  `;
  const params = [domainId];

  if (method) {
    query += ` AND method = ?`;
    params.push(method);
  }

  if (statusCode) {
    query += ` AND status_code = ?`;
    params.push(statusCode);
  }

  if (search) {
    query += ` AND (path LIKE ? OR query_string LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  if (startDate) {
    query += ` AND timestamp >= ?`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND timestamp <= ?`;
    params.push(endDate);
  }

  query += ` ORDER BY timestamp DESC`;

  return this.queryAll(query, params);
}

// OPTIMIZED: Get combined request log statistics (stats + distributions in 1 query)
async getCombinedRequestLogStats(domainId, days = 7) {
  const result = await this.queryOne(`
    WITH date_filter AS (
      SELECT 
        COUNT(*) as total_requests,
        COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as success_count,
        COUNT(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 END) as client_error_count,
        COUNT(CASE WHEN status_code >= 500 THEN 1 END) as server_error_count,
        ROUND(CAST(AVG(response_time) AS numeric), 2) as avg_response_time,
        ROUND(CAST(PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY response_time) AS numeric), 2) as p50_response_time,
        ROUND(CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time) AS numeric), 2) as p95_response_time,
        ROUND(CAST(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time) AS numeric), 2) as p99_response_time,
        MAX(response_time) as max_response_time,
        MIN(response_time) as min_response_time,
        COALESCE(SUM(response_size), 0) as total_bandwidth
      FROM request_logs
      WHERE domain_id = ? AND timestamp >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
    ),
    method_dist AS (
      SELECT json_object_agg(method, cnt ORDER BY cnt DESC) as methods
      FROM (
        SELECT method, COUNT(*) as cnt
        FROM request_logs
        WHERE domain_id = ? AND timestamp >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
        GROUP BY method
      ) m
    ),
    status_dist AS (
      SELECT json_object_agg(CAST(status_code AS text), cnt ORDER BY cnt DESC) as statuses
      FROM (
        SELECT status_code, COUNT(*) as cnt
        FROM request_logs
        WHERE domain_id = ? AND timestamp >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
        GROUP BY status_code
      ) s
    )
    SELECT
      date_filter.*,
      COALESCE(method_dist.methods, '{}'::json) as method_distribution,
      COALESCE(status_dist.statuses, '{}'::json) as status_distribution
    FROM date_filter, method_dist, status_dist
  `, [domainId, days, domainId, days, domainId, days]);
  
  return result;
}

// Get request log statistics for a domain (uses optimized combined query)
async getRequestLogStats(domainId, days = 7) {
  const combined = await this.getCombinedRequestLogStats(domainId, days);
  const { method_distribution, status_distribution, ...stats } = combined;
  return stats;
}

// Get recent errors for a domain
getRecentErrorLogs(domainId, limit = 20) {
  return this.queryAll(`
    SELECT *
    FROM request_logs
    WHERE domain_id = ? AND status_code >= 400
    ORDER BY timestamp DESC
    LIMIT ?
  `, [domainId, limit]);
}

// Get method distribution for a domain
getMethodDistribution(domainId, days = 7) {
  return this.queryAll(`
    SELECT
      method,
      COUNT(*) as count
    FROM request_logs
    WHERE domain_id = ?
      AND timestamp >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
    GROUP BY method
    ORDER BY count DESC
  `, [domainId, days]);
}

// Get status code distribution for a domain
getStatusCodeDistribution(domainId, days = 7) {
  return this.queryAll(`
    SELECT
      status_code,
      COUNT(*) as count
    FROM request_logs
    WHERE domain_id = ?
      AND timestamp >= (CURRENT_TIMESTAMP - (? || ' days')::interval)
    GROUP BY status_code
    ORDER BY count DESC
  `, [domainId, days]);
}

// Clean old request logs (keep only last N days)
async cleanOldRequestLogs(days = 30) {
  const result = await this.execute(`
    DELETE FROM request_logs
    WHERE timestamp < (CURRENT_TIMESTAMP - (? || ' days')::interval)
  `, [days]);
  return { deleted: result.rowCount || 0 };
}
}
