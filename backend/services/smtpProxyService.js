/**
 * SMTP Proxy Service with PROXY Protocol v2
 *
 * Transparent TCP relay for SMTP/Submission/SMTPS ports
 * Sends client IP via PROXY Protocol v2 to backend mail server (Postfix/Mailcow)
 *
 * Backend configuration required (Postfix):
 *   postscreen_upstream_proxy_protocol = haproxy
 *   OR
 *   smtpd_upstream_proxy_protocol = haproxy
 */

import net from 'net';
import { config } from '../config/config.js';
import { pool } from '../config/database.js';

class SmtpProxyService {
  constructor() {
    this.servers = [];
    this.isRunning = false;
    this.connections = new Map();
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      totalBytes: 0,
      errors: 0
    };
  }

  /**
   * Start SMTP proxy servers based on configuration
   */
  async start() {
    if (this.isRunning) {
      console.warn('[SMTP Proxy] Already running');
      return;
    }

    const smtpConfig = config.smtpProxy;

    if (!smtpConfig.enabled) {
      console.log('[SMTP Proxy] Disabled in configuration');
      return;
    }

    if (!smtpConfig.backendHost || !smtpConfig.backendPort) {
      console.error('[SMTP Proxy] Backend mail server not configured (SMTP_PROXY_BACKEND_HOST/PORT required)');
      return;
    }

    console.log(`[SMTP Proxy] Starting with backend: ${smtpConfig.backendHost}:${smtpConfig.backendPort}`);

    // Start SMTP server (port 25)
    if (smtpConfig.ports.smtp) {
      await this._startTcpProxy(smtpConfig.ports.smtp, 'SMTP');
    }

    // Start submission server (port 587 - STARTTLS)
    if (smtpConfig.ports.submission) {
      await this._startTcpProxy(smtpConfig.ports.submission, 'SUBMISSION');
    }

    // Start SMTPS server (port 465 - TLS)
    if (smtpConfig.ports.smtps) {
      await this._startTcpProxy(smtpConfig.ports.smtps, 'SMTPS');
    }

    this.isRunning = true;
    console.log('[SMTP Proxy] All configured servers started');
  }

  /**
   * Start TCP proxy server on specified port with PROXY Protocol v2
   */
  async _startTcpProxy(port, name) {
    const smtpConfig = config.smtpProxy;

    const server = net.createServer((clientSocket) => {
      this.stats.totalConnections++;
      this.stats.activeConnections++;

      const connectionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const clientIp = this._extractClientIp(clientSocket);
      const clientPort = clientSocket.remotePort;

      console.log(`[SMTP Proxy ${name}] New connection from ${clientIp}:${clientPort} (id: ${connectionId})`);

      // Track connection
      this.connections.set(connectionId, {
        clientSocket,
        backendSocket: null,
        clientIp,
        clientPort,
        startTime: Date.now(),
        bytesIn: 0,
        bytesOut: 0
      });

      // Connect to the same port on backend as the one we received the connection on
      // Port 25 → Backend 25, Port 465 → Backend 465, Port 587 → Backend 587
      const backendPort = port;

      console.log(`[SMTP Proxy ${name}] Connecting to backend ${smtpConfig.backendHost}:${backendPort}`);

      // Connect to backend mail server
      const backendSocket = net.createConnection({
        host: smtpConfig.backendHost,
        port: backendPort,
        timeout: smtpConfig.connectTimeout
      });

      this.connections.get(connectionId).backendSocket = backendSocket;

      // Send PROXY Protocol v2 header (skip for SMTPS port 465 as it starts with TLS immediately)
      backendSocket.once('connect', () => {
        try {
          // Only send PROXY Protocol for ports that don't start with immediate TLS
          if (name !== 'SMTPS' || port !== 465) {
            const proxyHeader = this._buildProxyProtocolV2Header(clientIp, clientPort, clientSocket.localAddress, clientSocket.localPort);
            backendSocket.write(proxyHeader);
            console.log(`[SMTP Proxy ${name}] Sent PROXY Protocol header for ${clientIp}:${clientPort}`);
          } else {
            console.log(`[SMTP Proxy ${name}] Skipping PROXY Protocol for SMTPS (immediate TLS) - ${clientIp}:${clientPort}`);
          }

          // Start bidirectional relay
          this._relay(clientSocket, backendSocket, connectionId, name);
        } catch (err) {
          console.error(`[SMTP Proxy ${name}] Failed to send PROXY header:`, err.message);
          this._closeConnection(connectionId, name);
        }
      });

      backendSocket.on('error', (err) => {
        this.stats.errors++;
        console.error(`[SMTP Proxy ${name}] Backend error for ${clientIp}:`, err.message);
        this._closeConnection(connectionId, name);
      });

      backendSocket.on('timeout', () => {
        console.warn(`[SMTP Proxy ${name}] Backend timeout for ${clientIp}`);
        this._closeConnection(connectionId, name);
      });

      clientSocket.on('error', (err) => {
        console.error(`[SMTP Proxy ${name}] Client error for ${clientIp}:`, err.message);
        this._closeConnection(connectionId, name);
      });

      clientSocket.on('timeout', () => {
        console.warn(`[SMTP Proxy ${name}] Client timeout for ${clientIp}`);
        this._closeConnection(connectionId, name);
      });

      // Set timeouts
      if (smtpConfig.idleTimeout > 0) {
        clientSocket.setTimeout(smtpConfig.idleTimeout);
        backendSocket.setTimeout(smtpConfig.idleTimeout);
      }

      // Log connection to database
      if (smtpConfig.logging.enabled) {
        this._logConnection(clientIp, name, 'connected').catch(err => {
          console.error('[SMTP Proxy] Failed to log connection:', err.message);
        });
      }
    });

    server.on('error', (err) => {
      this.stats.errors++;
      console.error(`[SMTP Proxy ${name}] Server error:`, err.message);
    });

    await new Promise((resolve, reject) => {
      server.listen(port, smtpConfig.bindAddress, (err) => {
        if (err) {
          console.error(`[SMTP Proxy ${name}] Failed to start on port ${port}:`, err.message);
          reject(err);
        } else {
          console.log(`[SMTP Proxy ${name}] Listening on ${smtpConfig.bindAddress}:${port}`);
          this.servers.push({ server, port, name });
          resolve();
        }
      });
    });
  }

  /**
   * Build PROXY Protocol v2 header
   * Format: https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt
   */
  _buildProxyProtocolV2Header(srcIp, srcPort, dstIp, dstPort) {
    // PROXY Protocol v2 signature
    const signature = Buffer.from([0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A]);

    // Version and command: version 2, PROXY command
    const verCmd = 0x21; // 0x20 (version 2) + 0x01 (PROXY command)

    // Address family and protocol
    const isIPv4 = !srcIp.includes(':');
    const fam = isIPv4 ? 0x11 : 0x21; // 0x1 = TCP/IPv4, 0x2 = TCP/IPv6

    let addressInfo;
    let length;

    if (isIPv4) {
      // IPv4: src_addr (4) + dst_addr (4) + src_port (2) + dst_port (2) = 12 bytes
      addressInfo = Buffer.alloc(12);

      const srcParts = srcIp.split('.').map(p => parseInt(p, 10));
      const dstParts = dstIp.split('.').map(p => parseInt(p, 10));

      addressInfo[0] = srcParts[0];
      addressInfo[1] = srcParts[1];
      addressInfo[2] = srcParts[2];
      addressInfo[3] = srcParts[3];

      addressInfo[4] = dstParts[0];
      addressInfo[5] = dstParts[1];
      addressInfo[6] = dstParts[2];
      addressInfo[7] = dstParts[3];

      addressInfo.writeUInt16BE(srcPort, 8);
      addressInfo.writeUInt16BE(dstPort, 10);

      length = 12;
    } else {
      // IPv6: src_addr (16) + dst_addr (16) + src_port (2) + dst_port (2) = 36 bytes
      addressInfo = Buffer.alloc(36);

      // Simplified IPv6 parsing (full implementation would handle :: notation)
      const srcBuffer = Buffer.from(srcIp.split(':').map(p => parseInt(p || '0', 16)));
      const dstBuffer = Buffer.from(dstIp.split(':').map(p => parseInt(p || '0', 16)));

      srcBuffer.copy(addressInfo, 0, 0, 16);
      dstBuffer.copy(addressInfo, 16, 0, 16);

      addressInfo.writeUInt16BE(srcPort, 32);
      addressInfo.writeUInt16BE(dstPort, 34);

      length = 36;
    }

    // Build complete header
    const header = Buffer.alloc(16 + length);
    signature.copy(header, 0);
    header[12] = verCmd;
    header[13] = fam;
    header.writeUInt16BE(length, 14);
    addressInfo.copy(header, 16);

    return header;
  }

  /**
   * Bidirectional relay between client and backend
   */
  _relay(clientSocket, backendSocket, connectionId, name) {
    const conn = this.connections.get(connectionId);

    // Client -> Backend
    clientSocket.on('data', (data) => {
      if (!backendSocket.destroyed) {
        backendSocket.write(data);
        conn.bytesIn += data.length;
        this.stats.totalBytes += data.length;
      }
    });

    // Backend -> Client
    backendSocket.on('data', (data) => {
      if (!clientSocket.destroyed) {
        clientSocket.write(data);
        conn.bytesOut += data.length;
        this.stats.totalBytes += data.length;
      }
    });

    // Handle close events
    const closeHandler = () => {
      this._closeConnection(connectionId, name);
    };

    clientSocket.on('close', closeHandler);
    backendSocket.on('close', closeHandler);
    clientSocket.on('end', closeHandler);
    backendSocket.on('end', closeHandler);
  }

  /**
   * Close connection and cleanup
   */
  _closeConnection(connectionId, name) {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    const duration = Date.now() - conn.startTime;

    console.log(`[SMTP Proxy ${name}] Connection closed: ${conn.clientIp}:${conn.clientPort} (${duration}ms, ${conn.bytesIn}↓ ${conn.bytesOut}↑)`);

    // Close sockets
    if (conn.clientSocket && !conn.clientSocket.destroyed) {
      conn.clientSocket.destroy();
    }
    if (conn.backendSocket && !conn.backendSocket.destroyed) {
      conn.backendSocket.destroy();
    }

    // Log to database
    if (config.smtpProxy.logging.enabled) {
      this._logConnection(conn.clientIp, name, 'closed', {
        duration,
        bytesIn: conn.bytesIn,
        bytesOut: conn.bytesOut
      }).catch(err => {
        console.error('[SMTP Proxy] Failed to log disconnection:', err.message);
      });
    }

    this.connections.delete(connectionId);
    this.stats.activeConnections--;
  }

  /**
   * Extract real client IP from socket
   */
  _extractClientIp(socket) {
    let ip = socket.remoteAddress;

    // Remove IPv6 prefix for IPv4-mapped addresses
    if (ip && ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }

    return ip || '0.0.0.0';
  }

  /**
   * Log SMTP connection to database
   */
  async _logConnection(clientIp, serverType, eventType, metadata = {}) {
    try {
      await pool.query(
        `INSERT INTO smtp_logs
         (client_ip, event_type, remote_address, message_size, status, timestamp)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          clientIp,
          `${serverType.toLowerCase()}_${eventType}`,
          clientIp,
          metadata.bytesIn || null,
          eventType === 'closed' ? 'completed' : 'active'
        ]
      );
    } catch (err) {
      // Don't throw - logging should not break the proxy
      console.error('[SMTP Proxy] Database log error:', err.message);
    }
  }

  /**
   * Stop all SMTP proxy servers
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('[SMTP Proxy] Stopping all servers...');

    // Close all active connections
    for (const [connectionId, conn] of this.connections.entries()) {
      if (conn.clientSocket && !conn.clientSocket.destroyed) {
        conn.clientSocket.destroy();
      }
      if (conn.backendSocket && !conn.backendSocket.destroyed) {
        conn.backendSocket.destroy();
      }
      this.connections.delete(connectionId);
    }

    // Close all servers
    for (const { server, name } of this.servers) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log(`[SMTP Proxy ${name}] Stopped`);
          resolve();
        });
      });
    }

    this.servers = [];
    this.isRunning = false;
    this.stats.activeConnections = 0;
    console.log('[SMTP Proxy] All servers stopped');
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      servers: this.servers.map(s => ({ port: s.port, name: s.name }))
    };
  }
}

// Singleton export
export const smtpProxyService = new SmtpProxyService();
