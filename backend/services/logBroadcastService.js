// Log broadcast service for streaming proxy logs to WebSocket clients
import { trafficStatsService } from './trafficStatsService.js';

/**
 * Log Broadcasting Service
 * Streams proxy logs to WebSocket clients in real-time
 */
class LogBroadcastService {
  constructor() {
    this.websocketManager = null;
    this.messageQueue = [];
    this.isProcessing = false;
    this.maxQueueSize = 1000;
    this.batchSize = 100;
    this.batchInterval = 100; // 100ms
  }

  /**
   * Set the WebSocket manager instance
   * @param {Object} websocketManager - WebSocket manager instance
   */
  setWebSocketManager(websocketManager) {
    this.websocketManager = websocketManager;
    console.log('LogBroadcastService initialized with WebSocket manager');
  }

  /**
   * Broadcast a traffic log to all connected clients
   * @param {Object} logData - Log data to broadcast
   */
  broadcastTrafficLog(logData) {
    if (!this.websocketManager) {
      console.warn('WebSocket manager not initialized, skipping log broadcast');
      return;
    }

    try {
      const message = {
        type: 'traffic_log',
        payload: {
          id: logData.id,
          timestamp: logData.timestamp || logData.created_at || new Date().toISOString(),
          domainId: logData.domain_id || logData.domainId,
          hostname: logData.hostname,
          method: logData.method,
          path: logData.path,
          queryString: logData.query_string || logData.queryString,
          statusCode: logData.status_code || logData.statusCode,
          responseTime: logData.response_time || logData.responseTime,
          ipAddress: logData.ip_address || logData.ipAddress,
          userAgent: logData.user_agent || logData.userAgent,
          errorMessage: logData.error_message || logData.errorMessage,
          level: this.determineLevel(logData.status_code || logData.statusCode),
          protocol: logData.protocol || 'HTTP'
        }
      };

      // Record in Redis for persistence (fire-and-forget)
      const domainId = logData.domain_id || logData.domainId;
      const bytes    = logData.response_size || logData.responseSize || 0;
      if (domainId) trafficStatsService.recordEvent(domainId, bytes);

      // Add to queue for batch processing
      this.messageQueue.push(message);

      // Enforce max queue size
      if (this.messageQueue.length > this.maxQueueSize) {
        this.messageQueue = this.messageQueue.slice(-this.maxQueueSize);
      }

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processBatch();
      }
    } catch (error) {
      console.error('Error broadcasting traffic log:', error);
    }
  }

  /**
   * Process message queue in batches
   */
  async processBatch() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.messageQueue.length > 0) {
        const batch = this.messageQueue.splice(0, this.batchSize);

        for (const message of batch) {
          this.websocketManager.broadcastRaw(message);
        }

        // Wait before next batch to prevent overwhelming clients
        if (this.messageQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.batchInterval));
        }
      }
    } catch (error) {
      console.error('Error processing message batch:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Broadcast a proxy log (TCP/UDP/Minecraft)
   * @param {Object} logData - Proxy log data
   */
  broadcastProxyLog(logData) {
    if (!this.websocketManager) {
      return;
    }

    try {
      const message = {
        type: 'traffic_log',
        payload: {
          id: logData.id,
          timestamp: logData.timestamp || logData.created_at || new Date().toISOString(),
          domainId: logData.domain_id || logData.domainId,
          hostname: logData.hostname,
          protocol: (logData.protocol || 'TCP').toUpperCase(),
          statusCode: logData.error ? 500 : 200,
          responseTime: logData.duration || 0,
          ipAddress: logData.client_ip || logData.clientIp,
          errorMessage: logData.error,
          bytesReceived: logData.bytes_received || logData.bytesReceived,
          bytesSent: logData.bytes_sent || logData.bytesSent,
          level: logData.error ? 'error' : 'success'
        }
      };

      this.messageQueue.push(message);

      if (!this.isProcessing) {
        this.processBatch();
      }
    } catch (error) {
      console.error('Error broadcasting proxy log:', error);
    }
  }

  /**
   * Determine log level based on status code
   * @param {number} statusCode - HTTP status code
   * @returns {string} - Log level (success, info, warning, error)
   */
  determineLevel(statusCode) {
    if (!statusCode) return 'info';

    if (statusCode >= 200 && statusCode < 300) return 'success';
    if (statusCode >= 300 && statusCode < 400) return 'info';
    if (statusCode >= 400 && statusCode < 500) return 'warning';
    if (statusCode >= 500) return 'error';

    return 'info';
  }

  /**
   * Get queue statistics
   * @returns {Object}
   */
  getStats() {
    return {
      queueSize: this.messageQueue.length,
      isProcessing: this.isProcessing,
      hasWebSocket: !!this.websocketManager
    };
  }
}

// Export singleton instance
export const logBroadcastService = new LogBroadcastService();
