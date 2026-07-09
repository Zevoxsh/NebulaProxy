// Auto-extracted from proxyManager.js — do not edit directly.
// Mixed into ProxyManager.prototype in proxyManager.js.

import net from 'net';
import { lts, getLb } from '../proxyContext.js';
import { logger } from '../../utils/logger.js';
import { urlFilterService } from '../urlFilterService.js';
import { logBatchQueue } from '../logBatchQueue.js';
import * as activeConnections from '../activeConnectionsRegistry.js';

export class TcpProxy {
// ==================== TCP PROXY ====================

/**
 * Start a TCP proxy
 * Simple passthrough: client <-> target
 */
  _startTcpProxy(domain) {
    const server = net.createServer(async (clientSocket) => {
      let isClosing = false;
      let targetSocket = null;
      let connectTimeout = null;

      // Logging metrics
      const startTime = Date.now();
      const clientIp = this._normalizeIp(clientSocket.remoteAddress);
      let bytesReceived = 0;
      let bytesSent = 0;
      let errorMessage = null;
      let blockedByPolicy = false;
      let backendHost, backendPort;
      const connectionId = activeConnections.nextConnectionId('tcp');

      // Per-IP connection limit (layer 4 DDoS protection)
      if (this.TCP_MAX_CONNECTIONS_PER_IP > 0) {
        const ipCount = (this.tcpConnectionsPerIp.get(clientIp) || 0) + 1;
        if (ipCount > this.TCP_MAX_CONNECTIONS_PER_IP) {
          clientSocket.destroy();
          return;
        }
        this.tcpConnectionsPerIp.set(clientIp, ipCount);
        clientSocket.once('close', () => {
          const remaining = (this.tcpConnectionsPerIp.get(clientIp) || 1) - 1;
          if (remaining <= 0) this.tcpConnectionsPerIp.delete(clientIp);
          else this.tcpConnectionsPerIp.set(clientIp, remaining);
        });
      }

      // Check IP/CIDR network blocking rules before opening backend connection
      const policyStart = Date.now();
      try {
        const networkAccess = await urlFilterService.checkNetworkAccess(domain.id, clientIp);
        logger.debug(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} policy check ${Date.now() - policyStart}ms blocked=${networkAccess.blocked}`);
        if (networkAccess.blocked) {
          blockedByPolicy = true;
          errorMessage = networkAccess.response?.message || 'Connection blocked by network policy';
          logger.warn(`[TCP Proxy ${domain.id}] Blocked client ${clientIp}: ${errorMessage}`);
          clientSocket.destroy();
          return;
        }
      } catch (err) {
        logger.error(`[TCP Proxy ${domain.id}] Network policy check failed (${Date.now() - policyStart}ms):`, err.message);
      }

      // Load balancing: select backend
      const backendSelStart = Date.now();
      let tcpBackendId = null;
      try {
        const target = await this._selectBackendForDomain(domain, clientIp, 'tcp');
        backendHost = target.hostname;
        backendPort = target.port;
        tcpBackendId = target.backendId || null;
        if (tcpBackendId) { const lb = getLb(); if (lb) lb.incrementConnections(tcpBackendId); }
        logger.debug(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} backend selected ${backendHost}:${backendPort} in ${Date.now() - backendSelStart}ms t+${Date.now() - startTime}ms`);
      } catch (err) {
        logger.error(`[TCP Proxy ${domain.id}] Backend selection failed (${Date.now() - backendSelStart}ms):`, err.message);
        clientSocket.destroy();
        return;
      }

      // Live traffic tracking (fire-and-forget)
      { const s = lts(); if (s) s.recordHit(domain.id, clientIp, 'tcp', `${backendHost}:${backendPort}`); }

      activeConnections.register(connectionId, {
        domainId: domain.id,
        protocol: 'tcp',
        clientIp,
        connectedAt: startTime,
        label: `${backendHost}:${backendPort}`,
        // `cleanup` is defined below but not called until kick() actually
        // invokes this closure, well after `cleanup` is assigned.
        close: () => cleanup()
      });

      clientSocket.setNoDelay(true);
      if (this.TCP_KEEPALIVE_MS > 0) {
        clientSocket.setKeepAlive(true, this.TCP_KEEPALIVE_MS);
      }
      if (this.TCP_TIMEOUT > 0) {
        clientSocket.setTimeout(this.TCP_TIMEOUT);
      }

      const cleanup = () => {
        if (isClosing) return;
        isClosing = true;

        activeConnections.unregister(connectionId);

        // Least-connections: release the slot for this backend
        if (tcpBackendId) { const lb = getLb(); if (lb) lb.decrementConnections(tcpBackendId); }

        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }

        try {
          if (targetSocket) {
            clientSocket.unpipe(targetSocket);
            targetSocket.unpipe(clientSocket);
          }
      } catch (e) {
        // Ignore unpipe errors
      }

      try {
        if (!clientSocket.destroyed) clientSocket.destroy();
        if (targetSocket && !targetSocket.destroyed) targetSocket.destroy();
      } catch (e) {
        // Ignore destroy errors
      }

      // Log TCP connection after cleanup (batched)
      const responseTime = Date.now() - startTime;
      logger.debug(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} CLOSED duration=${responseTime}ms sent=${bytesSent}B recv=${bytesReceived}B${errorMessage ? ' error='+errorMessage : ''}`);
      logBatchQueue.queueRequestLog({
        domainId: domain.id,
        hostname: domain.hostname,
        method: 'TCP',
        path: `${backendHost}:${backendPort}`,
        queryString: null,
        statusCode: blockedByPolicy ? 403 : (errorMessage ? 502 : 200),
        responseTime: responseTime,
        responseSize: bytesSent,
        ipAddress: clientIp,
        userAgent: null,
        referer: null,
        requestHeaders: {
          'bytes-received': bytesReceived,
          'bytes-sent': bytesSent
        },
        responseHeaders: {},
        errorMessage: errorMessage
      });
    };

    // Client timeout
      clientSocket.on('timeout', () => {
        logger.warn(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} CLIENT IDLE TIMEOUT`);
        cleanup();
      });

      // Connect to backend
      logger.debug(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} TCP connect -> ${backendHost}:${backendPort} t+${Date.now() - startTime}ms`);
      const tcpConnectStart = Date.now();
      targetSocket = net.connect({
        host: backendHost,
        port: backendPort
      });

      targetSocket.setNoDelay(true);
      if (this.TCP_KEEPALIVE_MS > 0) {
        targetSocket.setKeepAlive(true, this.TCP_KEEPALIVE_MS);
      }

      if (this.TCP_CONNECT_TIMEOUT > 0) {
        connectTimeout = setTimeout(() => {
          if (targetSocket && targetSocket.connecting) {
            errorMessage = 'Backend connection timeout';
            logger.error(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} backend ${backendHost}:${backendPort} TCP TIMEOUT after ${this.TCP_CONNECT_TIMEOUT}ms`);
            cleanup();
          }
        }, this.TCP_CONNECT_TIMEOUT);
      }

      targetSocket.on('connect', () => {
        const tcpConnectMs = Date.now() - tcpConnectStart;
        logger.debug(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} backend ${backendHost}:${backendPort} TCP CONNECTED in ${tcpConnectMs}ms t+${Date.now() - startTime}ms`);

        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }

        // ── PROXY Protocol v1 ─────────────────────────────────────────
        if (domain.proxy_protocol) {
          const clientPort = clientSocket.remotePort || 0;
          const serverAddr = targetSocket.localAddress || '0.0.0.0';
          const serverPort = targetSocket.localPort || backendPort;
          const family = clientIp.includes(':') ? 'TCP6' : 'TCP4';
          targetSocket.write(
            Buffer.from(`PROXY ${family} ${clientIp} ${serverAddr} ${clientPort} ${serverPort}\r\n`, 'ascii')
          );
        }

        clientSocket.on('data', (chunk) => { bytesReceived += chunk.length; });
        targetSocket.on('data', (chunk) => { bytesSent += chunk.length; });
        clientSocket.pipe(targetSocket);
        targetSocket.pipe(clientSocket);
        logger.debug(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} relay ACTIVE (pipe mode)`);
      });

      // Backend timeout
      if (this.TCP_TIMEOUT > 0) {
        targetSocket.setTimeout(this.TCP_TIMEOUT);
        targetSocket.on('timeout', () => {
          logger.warn(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} backend ${backendHost}:${backendPort} IDLE TIMEOUT`);
          errorMessage = 'Backend timeout';
          cleanup();
        });
      }

      // Error handling
      targetSocket.on('error', (err) => {
        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        if (!isClosing && err.code !== 'EPIPE' && err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') {
          logger.error(`[DEBUG:TCP] domain=${domain.id} client=${clientIp} backend ERROR ${err.code}: ${err.message}`);
          errorMessage = `Backend error: ${err.message}`;
        }
        cleanup();
      });

    clientSocket.on('error', (err) => {
      if (!isClosing && err.code !== 'EPIPE' && err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') {
        logger.error(`[TCP Proxy ${domain.id}] Client error:`, err.message);
        errorMessage = `Client error: ${err.message}`;
      }
      cleanup();
    });

    // Clean disconnection
    clientSocket.on('end', () => {
      if (!isClosing && targetSocket) {
        try {
          targetSocket.end();
        } catch (e) {
          // Ignore
        }
      }
    });

    targetSocket.on('end', () => {
      if (!isClosing) {
        try {
          clientSocket.end();
        } catch (e) {
          // Ignore
        }
      }
    });

    // Final cleanup
    clientSocket.on('close', () => cleanup());
      targetSocket.on('close', () => cleanup());
    });

    server.on('error', (err) => {
      logger.error(`[TCP Proxy ${domain.id}] Server error:`, err.message);
    });

    if (this.TCP_MAX_CONNECTIONS > 0) {
      server.maxConnections = this.TCP_MAX_CONNECTIONS;
    }

    const listenArgs = [domain.external_port, '::'];
    if (this.TCP_BACKLOG > 0) {
      listenArgs.push(this.TCP_BACKLOG);
    }
    listenArgs.push(() => {
      logger.info(`[TCP Proxy ${domain.id}] Listening on [::]:${domain.external_port}`);
    });
    server.listen(...listenArgs);

  this.proxies.set(domain.id, {
    type: 'tcp',
    server,
    meta: domain
  });

  return server;
}
}
