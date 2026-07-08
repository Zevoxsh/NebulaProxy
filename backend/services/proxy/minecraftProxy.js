// Auto-extracted from proxyManager.js — do not edit directly.
// Mixed into ProxyManager.prototype in proxyManager.js.

import net from 'net';
import { lts } from '../proxyContext.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/config.js';
import { database } from '../database.js';
import { parseHandshake } from '../minecraftProtocol.js';
import { urlFilterService } from '../urlFilterService.js';

export class MinecraftProxy {
// ==================== MINECRAFT PROXY ====================

/**
 * Start Minecraft proxy for a domain
 * Uses shared Minecraft server (port 25565) with hostname-based routing
 */
async _startMinecraftProxy(domain) {
  // Ensure shared Minecraft server is running
  if (!this.minecraftServer) {
    await this._startSharedMinecraftServer();
  }

  // Register domain in proxy map
  this.proxies.set(domain.id, {
    type: 'minecraft',
    server: this.minecraftServer,
    meta: domain
  });

  const backendPort = parseInt(domain.backend_port) || 25565;
  logger.info(`[ProxyManager] Minecraft proxy registered for ${domain.hostname} -> ${domain.backend_url}:${backendPort}`);
}

/**
 * Start shared Minecraft server (port 25565)
 * Parses handshake packets to extract hostname and routes to correct backend
 */
async _startSharedMinecraftServer() {
  return new Promise((resolve, reject) => {
    this.minecraftServer = net.createServer((clientSocket) => {
      // Connection state
      let handshakeBuffer = Buffer.alloc(0);
      let handshakeComplete = false;
      let handshakeTimeout = null;
      let connectTimeout = null;
      let targetSocket = null;
      let isClosing = false;

      // Metrics
      const startTime = Date.now();
      const clientIp = this._normalizeIp(clientSocket.remoteAddress);
      let bytesReceived = 0;
      let bytesSent = 0;
      let errorMessage = null;
      let blockedByPolicy = false;
      let routedHostname = null;
      let domain = null;
      let maxBackendSilenceMs = 0;
      let maxClientSilenceMs = 0;

      // Configure client socket
      clientSocket.setNoDelay(true);
      if (this.MINECRAFT_KEEPALIVE_MS > 0) {
        clientSocket.setKeepAlive(true, this.MINECRAFT_KEEPALIVE_MS);
      }
      if (this.MINECRAFT_TIMEOUT > 0) {
        clientSocket.setTimeout(this.MINECRAFT_TIMEOUT);
      }

      // Handshake timeout (5s max to receive complete handshake)
      handshakeTimeout = setTimeout(() => {
        errorMessage = 'Handshake timeout';
        cleanup();
      }, this.MINECRAFT_HANDSHAKE_TIMEOUT);

      let silenceTimer = null;

      const cleanup = () => {
        if (isClosing) return;
        isClosing = true;

        if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }

        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout);
          handshakeTimeout = null;
        }

        // Remove all listeners to prevent memory leaks
        try {
          clientSocket.removeAllListeners('data');
          clientSocket.removeAllListeners('drain');
          clientSocket.removeAllListeners('error');
          clientSocket.removeAllListeners('timeout');
          clientSocket.removeAllListeners('end');
          clientSocket.removeAllListeners('close');
        } catch (e) {}

        try {
          if (targetSocket) {
            targetSocket.removeAllListeners('data');
            targetSocket.removeAllListeners('drain');
            targetSocket.removeAllListeners('error');
            targetSocket.removeAllListeners('timeout');
            targetSocket.removeAllListeners('end');
            targetSocket.removeAllListeners('close');
            targetSocket.removeAllListeners('connect');
          }
        } catch (e) {}

        // Destroy sockets
        try {
          if (!clientSocket.destroyed) clientSocket.destroy();
          if (targetSocket && !targetSocket.destroyed) targetSocket.destroy();
        } catch (e) {}

        // Log connection
        if (domain) {
          const responseTime = Date.now() - startTime;

          // If the connection died after a long stretch of silence from the
          // backend and nothing else already explains it, surface that as the
          // reason — this is what a "Timed out" on the client usually traces
          // back to (backend/game server froze, not the proxy or the client link).
          const STALL_THRESHOLD_MS = 3000;
          if (!errorMessage && maxBackendSilenceMs > STALL_THRESHOLD_MS) {
            errorMessage = `Backend stalled ${(maxBackendSilenceMs / 1000).toFixed(1)}s before disconnect (no data from backend — likely server-side lag/GC pause, not the proxy)`;
          }

          database.createRequestLog({
            domainId: domain.id,
            hostname: domain.hostname,
            method: 'MINECRAFT',
            path: `${routedHostname || 'unknown'}`,
            queryString: null,
            statusCode: blockedByPolicy ? 403 : (errorMessage ? 502 : 200),
            responseTime,
            responseSize: bytesSent,
            ipAddress: clientIp,
            userAgent: null,
            referer: null,
            requestHeaders: {
              'bytes-received': bytesReceived,
              'bytes-sent': bytesSent,
              'max-backend-silence-ms': maxBackendSilenceMs,
              'max-client-silence-ms': maxClientSilenceMs
            },
            responseHeaders: {},
            errorMessage
          }).catch(err => {
            logger.error('[MinecraftProxy] Failed to write log:', err);
          });
        }
      };

      // SECURITY: Per-connection byte limit (DOS prevention)
      // Increased from 4KB to 16KB to accommodate various client handshake formats
      // Actual Minecraft handshakes are typically 50-200 bytes, well below this limit
      const MAX_HANDSHAKE_BYTES = Math.min(this.MINECRAFT_MAX_PACKET_SIZE, 16384); // 16KB max
      let totalBytesBuffered = 0;

      // Handle client data BEFORE handshake complete
      const onClientData = async (chunk) => {
        bytesReceived += chunk.length;

        // Handshake already parsed; buffer until backend connects
        if (handshakeComplete) {
          // Don't count in DOS limit after handshake is complete
          handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
          return;
        }

        // SECURITY FIX: Check total bytes BEFORE accumulating (only pre-handshake)
        totalBytesBuffered += chunk.length;

        if (totalBytesBuffered > MAX_HANDSHAKE_BYTES) {
          errorMessage = 'Handshake too large - possible DOS attack';
          logger.error(`[MinecraftProxy] Connection exceeded handshake limit: ${totalBytesBuffered} bytes from ${clientIp}`);
          cleanup();
          return;
        }

        // Now safe to accumulate
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);

        // Double-check buffer size (defense in depth)
        if (handshakeBuffer.length > MAX_HANDSHAKE_BYTES) {
          errorMessage = 'Buffer overflow protection';
          logger.error(`[MinecraftProxy] Buffer size protection triggered: ${handshakeBuffer.length} bytes`);
          cleanup();
          return;
        }

        // Try to parse handshake
        const parseStart = Date.now();
        const result = parseHandshake(handshakeBuffer);
        const parseMs = Date.now() - parseStart;

        if (result.incomplete) {
          logger.debug(`[DEBUG:MC] client=${clientIp} handshake incomplete (${handshakeBuffer.length}B so far, parse=${parseMs}ms)`);
          return;
        }

        if (!result.success) {
          errorMessage = result.error;
          logger.error(`[MinecraftProxy] Handshake parse error:`, result.error);
          cleanup();
          return;
        }

        // Handshake complete and valid!
        handshakeComplete = true;
        clearTimeout(handshakeTimeout);
        handshakeTimeout = null;

        const hostname = result.hostname;
        routedHostname = hostname;
        const t0 = Date.now();
        logger.debug(`[DEBUG:MC] client=${clientIp} handshake OK hostname="${hostname}" parse=${parseMs}ms bufLen=${handshakeBuffer.length}B t+${t0 - startTime}ms`);

        // Route to domain — filter by 'minecraft' so an HTTP domain
        // with the same hostname doesn't intercept MC connections.
        domain = this._findDomainByHostname(hostname, 'minecraft');
        if (!domain) {
          errorMessage = `Domain not found: ${hostname}`;
          logger.warn(`[MinecraftProxy] Domain not found: ${hostname}`);
          cleanup();
          return;
        }
        logger.debug(`[DEBUG:MC] client=${clientIp} domain found id=${domain.id} t+${Date.now() - startTime}ms`);

        const policyStart = Date.now();
        try {
          const networkAccess = await urlFilterService.checkNetworkAccess(domain.id, clientIp);
          logger.debug(`[DEBUG:MC] client=${clientIp} policy check ${Date.now() - policyStart}ms blocked=${networkAccess.blocked}`);
          if (networkAccess.blocked) {
            blockedByPolicy = true;
            errorMessage = networkAccess.response?.message || 'Connection blocked by network policy';
            logger.warn(`[MinecraftProxy] Blocked client ${clientIp} for ${hostname}: ${errorMessage}`);
            cleanup();
            return;
          }
        } catch (err) {
          logger.error(`[MinecraftProxy] Network policy check failed (${Date.now() - policyStart}ms):`, err.message);
        }

        // Select backend (with load balancing if enabled)
        let backendHost, backendPort, _backendId;
        const backendSelStart = Date.now();
        try {
          const target = await this._selectBackendForDomain(domain, clientIp, 'minecraft');
          backendHost = target.hostname;
          backendPort = target.port;
          _backendId = target.backendId;
          logger.debug(`[DEBUG:MC] client=${clientIp} backend selected ${backendHost}:${backendPort} in ${Date.now() - backendSelStart}ms t+${Date.now() - startTime}ms`);
        } catch (err) {
          errorMessage = `Backend selection failed: ${err.message}`;
          logger.error(`[MinecraftProxy] ${errorMessage} (${Date.now() - backendSelStart}ms)`);
          cleanup();
          return;
        }

        // Live traffic tracking (fire-and-forget)
        { const s = lts(); if (s) s.recordHit(domain.id, clientIp, 'minecraft', `${backendHost}:${backendPort}`); }

        logger.debug(`[DEBUG:MC] client=${clientIp} connecting to backend ${backendHost}:${backendPort} t+${Date.now() - startTime}ms`);
        const tcpConnectStart = Date.now();

        // Connect to backend
        targetSocket = net.connect({
          host: backendHost,
          port: backendPort
        });

        targetSocket.setNoDelay(true);
        if (this.MINECRAFT_KEEPALIVE_MS > 0) {
          targetSocket.setKeepAlive(true, this.MINECRAFT_KEEPALIVE_MS);
        }

        if (this.MINECRAFT_CONNECT_TIMEOUT > 0) {
          connectTimeout = setTimeout(() => {
            if (targetSocket && targetSocket.connecting) {
              errorMessage = 'Backend connection timeout';
              logger.error(`[DEBUG:MC] client=${clientIp} backend ${backendHost}:${backendPort} TIMEOUT after ${this.MINECRAFT_CONNECT_TIMEOUT}ms`);
              cleanup();
            }
          }, this.MINECRAFT_CONNECT_TIMEOUT);
        }

        if (this.MINECRAFT_TIMEOUT > 0) {
          targetSocket.setTimeout(this.MINECRAFT_TIMEOUT);
        }

        targetSocket.on('connect', () => {
          const tcpConnectMs = Date.now() - tcpConnectStart;
          logger.debug(`[DEBUG:MC] client=${clientIp} backend ${backendHost}:${backendPort} TCP CONNECTED in ${tcpConnectMs}ms t+${Date.now() - startTime}ms`);

          if (connectTimeout) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }

          // Send the buffered handshake packet, then forward live traffic.
          if (handshakeBuffer.length > 0) {
            targetSocket.write(handshakeBuffer);
            logger.debug(`[DEBUG:MC] client=${clientIp} flushed handshake buffer ${handshakeBuffer.length}B to backend`);
          }

          let mcBpClientCount = 0;
          let mcBpBackendCount = 0;
          let mcBpClientAt = 0;
          let mcBpBackendAt = 0;
          let lastDataFromBackend = Date.now();
          let lastDataFromClient = Date.now();

          // Silence detector: log if no data from backend for > 500ms (indicates VPN/backend stall)
          const silenceTimer = setInterval(() => {
            if (isClosing) { clearInterval(silenceTimer); return; }
            const now = Date.now();
            const backendSilence = now - lastDataFromBackend;
            const clientSilence  = now - lastDataFromClient;
            if (backendSilence > maxBackendSilenceMs) maxBackendSilenceMs = backendSilence;
            if (clientSilence > maxClientSilenceMs) maxClientSilenceMs = clientSilence;
            if (backendSilence > 500) {
              logger.warn(`[DEBUG:MC] client=${clientIp} SILENCE backend->client for ${backendSilence}ms (sent=${bytesSent}B recv=${bytesReceived}B)`);
            }
            if (clientSilence > 500) {
              logger.warn(`[DEBUG:MC] client=${clientIp} SILENCE client->backend for ${clientSilence}ms`);
            }
          }, 500);

          // FIXED: Replace direct piping with manual relay for better error handling
          // and back-pressure management, especially critical for VPN connections
          const relayClientToBackend = (chunk) => {
            if (!targetSocket.destroyed) {
              lastDataFromClient = Date.now();
              bytesReceived += chunk.length; // Count bytes received from client
              if (!targetSocket.write(chunk)) {
                mcBpClientCount++;
                mcBpClientAt = Date.now();
                logger.warn(`[DEBUG:MC] client=${clientIp} BACKPRESSURE #${mcBpClientCount} client->backend: pausing client (chunk=${chunk.length}B)`);
                clientSocket.pause();
              }
            }
          };

          const relayBackendToClient = (chunk) => {
            if (!clientSocket.destroyed) {
              lastDataFromBackend = Date.now();
              bytesSent += chunk.length; // Count bytes sent to client
              if (!clientSocket.write(chunk)) {
                mcBpBackendCount++;
                mcBpBackendAt = Date.now();
                logger.warn(`[DEBUG:MC] client=${clientIp} BACKPRESSURE #${mcBpBackendCount} backend->client: pausing backend (chunk=${chunk.length}B)`);
                targetSocket.pause();
              }
            }
          };

          clientSocket.on('data', relayClientToBackend);
          targetSocket.on('data', relayBackendToClient);

          // Resume on drain when back-pressure eases
          clientSocket.on('drain', () => {
            if (!targetSocket.destroyed && targetSocket.isPaused?.()) {
              if (mcBpBackendAt) {
                logger.debug(`[DEBUG:MC] client=${clientIp} DRAIN client socket after ${Date.now() - mcBpBackendAt}ms -> resuming backend`);
                mcBpBackendAt = 0;
              }
              targetSocket.resume();
            }
          });

          targetSocket.on('drain', () => {
            if (!clientSocket.destroyed && clientSocket.isPaused?.()) {
              if (mcBpClientAt) {
                logger.debug(`[DEBUG:MC] client=${clientIp} DRAIN backend socket after ${Date.now() - mcBpClientAt}ms -> resuming client`);
                mcBpClientAt = 0;
              }
              clientSocket.resume();
            }
          });
        });

        targetSocket.on('error', (err) => {
          if (connectTimeout) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
          
          // OPTIMIZATION: Invalidate backend health cache on critical errors
          // This forces a database refresh to detect if a backend is back online
          if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
            logger.warn(`[MinecraftProxy] Backend connection error (${err.code}) to ${backendHost}:${backendPort}, invalidating health cache for domain ${domain.id}`);
            this.backendHealthCache.delete(domain.id); // Force DB refresh next request
          }
          
          // Log connection errors with more detail for VPN debugging
          if (!isClosing) {
            if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
              logger.warn(`[MinecraftProxy] Backend connection closed (${err.code}) to ${backendHost}:${backendPort} - This may indicate VPN/network issues between proxy and backend`);
            } else {
              logger.error(`[MinecraftProxy] Backend error (${err.code || err.message}):`, err.message);
            }
            errorMessage = `Backend error: ${err.message}`;
          }
          cleanup();
        });

        targetSocket.on('timeout', () => {
          errorMessage = 'Backend timeout';
          cleanup();
        });

        targetSocket.on('end', () => {
          if (!isClosing) {
            try { clientSocket.end(); } catch (e) {}
          }
        });

        targetSocket.on('close', () => cleanup());
      };

      // Listen for client data
      clientSocket.on('data', onClientData);

      // Handle client errors
      clientSocket.on('error', (err) => {
        if (!isClosing && err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          logger.error(`[MinecraftProxy] Client error:`, err.message);
          errorMessage = `Client error: ${err.message}`;
        }
        cleanup();
      });

      clientSocket.on('timeout', () => {
        errorMessage = 'Client timeout';
        cleanup();
      });

      clientSocket.on('end', () => {
        if (!isClosing && targetSocket) {
          try { targetSocket.end(); } catch (e) {}
        }
      });

      clientSocket.on('close', () => cleanup());
    });

    // Server error handling
    this.minecraftServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`[MinecraftProxy] Port ${config.minecraftProxy.port} already in use`);
        this.minecraftServer = null;
        reject(err);
      } else {
        logger.error('[MinecraftProxy] Server error:', err.message);
      }
    });

    // Server configuration
    if (this.MINECRAFT_MAX_CONNECTIONS > 0) {
      this.minecraftServer.maxConnections = this.MINECRAFT_MAX_CONNECTIONS;
    }

    // Start listening
    const listenArgs = [config.minecraftProxy.port, '::'];
    if (this.MINECRAFT_BACKLOG > 0) {
      listenArgs.push(this.MINECRAFT_BACKLOG);
    }
    listenArgs.push(() => {
      logger.info(`[MinecraftProxy] Shared Minecraft server listening on port ${config.minecraftProxy.port}`);
      resolve();
    });

    this.minecraftServer.listen(...listenArgs);
  });
}
}
