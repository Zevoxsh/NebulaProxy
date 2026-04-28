/**
 * ProxyManager - Core proxy management service
 *
 * Manages TCP, UDP, HTTP, and HTTPS proxies for NebulaProxy
 * Adapted from neb project with simplifications for NebulaProxy architecture
 */

import net from 'net';
import dgram from 'dgram';
import http from 'http';
import https from 'https';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import selfsigned from 'selfsigned';
import { config } from '../config/config.js';
import { database } from './database.js';
import { certificateManager } from './certificateManager.js';
import { websocketProxy } from './websocketProxy.js';
import { parseHandshake } from './minecraftProtocol.js';
import { loadBalancer } from './loadBalancer.js';
import { urlFilterService } from './urlFilterService.js';
import { circuitBreaker } from './circuitBreaker.js';
import { geoIpService } from './geoIpService.js';
import { redisService } from './redis.js';
import { logBatchQueue } from './logBatchQueue.js';

// Lazy singleton for live traffic tracking (avoids circular deps at load time)
let _lts = null;
const lts = () => {
  if (!_lts) {
    import('./liveTrafficService.js')
      .then(m => { _lts = m.liveTrafficService; })
      .catch(() => {});
  }
  return _lts;
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\"/g, '&quot;')
  .replace(/'/g, '&#39;');

  class ProxyManager extends EventEmitter {
    constructor() {
      super();

    // Map of active proxies: domainId -> { type, server, meta }
    this.proxies = new Map();

    // Shared HTTP/HTTPS servers for multi-domain hosting
    this.httpServer = null;
    this.httpsServer = null;

    // Shared Minecraft server for multi-domain hosting
    this.minecraftServer = null;

    // SSL/TLS certificate cache for SNI
    this.secureContextCache = new Map();
    this.CACHE_DURATION_MS = 3600000; // 1 hour
      this.defaultSecureContext = null;

      // SECURITY: Domain lookup cache (O(1) instead of O(n))
      this.domainCache = new Map(); // hostname -> { domain, timestamp }
      this.DOMAIN_CACHE_TTL = 5000; // 5 seconds (reduced to avoid stale data)

      // SECURITY: Backend health cache
      this.backendHealthCache = new Map(); // domainId -> { backends, timestamp }
      this.BACKEND_HEALTH_CACHE_TTL = 30000; // 30 seconds

      // SECURITY: Reload lock for race condition prevention
      this.reloadLock = false;

      // Minecraft connection tracking (for buffer DOS prevention)
      this.minecraftConnections = new Map(); // socketId -> { buffer, bytesReceived, timeout }

      // Timeouts
      this.TCP_TIMEOUT = config.tcpProxy.idleTimeoutMs;
      this.TCP_CONNECT_TIMEOUT = config.tcpProxy.connectTimeoutMs;
      this.TCP_KEEPALIVE_MS = config.tcpProxy.keepAliveMs;
      this.TCP_BACKLOG = config.tcpProxy.backlog;
      this.TCP_MAX_CONNECTIONS = config.tcpProxy.maxConnections;
      this.UDP_CLIENT_TIMEOUT = config.udpProxy.clientTimeoutMs;
      this.MINECRAFT_TIMEOUT = config.minecraftProxy.idleTimeoutMs;
      this.MINECRAFT_CONNECT_TIMEOUT = config.minecraftProxy.connectTimeoutMs;
      this.MINECRAFT_KEEPALIVE_MS = config.minecraftProxy.keepAliveMs;
      this.MINECRAFT_HANDSHAKE_TIMEOUT = config.minecraftProxy.handshakeTimeoutMs;
      this.MINECRAFT_MAX_PACKET_SIZE = config.minecraftProxy.maxPacketSize;
      this.MINECRAFT_BACKLOG = config.minecraftProxy.backlog;
      this.MINECRAFT_MAX_CONNECTIONS = config.minecraftProxy.maxConnections;

    // ACME manager reference (will be set during initialization)
    this.acmeManager = null;
  }

  /**
   * Initialize proxy manager
   * This should be called once at startup
   */
  async init(acmeManager = null) {
    this.acmeManager = acmeManager;
    console.log('[ProxyManager] Initialized');
  }

  /**
   * Start a proxy for a given domain
   * @param {Object} domain - Domain configuration from database
   */
  async startProxy(domain) {
    if (!domain || !domain.id) {
      throw new Error('Invalid domain configuration');
    }

    // Check if proxy already running
    if (this.proxies.has(domain.id)) {
      console.warn(`[ProxyManager] Proxy ${domain.id} already running`);
      return;
    }

    const proxyType = (domain.proxy_type || 'http').toLowerCase();

    try {
      switch (proxyType) {
        case 'tcp':
          await this._startTcpProxy(domain);
          break;
        case 'udp':
          await this._startUdpProxy(domain);
          break;
        case 'minecraft':
          await this._startMinecraftProxy(domain);
          break;
        case 'http':
          await this._startHttpProxy(domain);
          break;
        default:
          throw new Error(`Unsupported proxy type: ${proxyType}`);
      }
    } catch (error) {
      console.error(`[ProxyManager] Failed to start proxy ${domain.id}:`, error.message);
      throw error;
    }

  }

  _parseBackendUrl(rawUrl, defaultProtocol) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('Invalid backend URL');
    }
    try {
      return new URL(rawUrl);
    } catch {
      return new URL(`${defaultProtocol}://${rawUrl}`);
    }
  }

  /**
   * Stop a proxy
   * @param {number|string} domainId - Domain ID (normalized to integer internally)
   */
  async stopProxy(domainId) {
    // Normalize: route params arrive as strings, but Map keys are numbers from the DB
    const id = parseInt(domainId, 10);
    const entry = this.proxies.get(id);
    if (!entry) {
      console.warn(`[ProxyManager] Proxy ${id} not found`);
      return;
    }

    return new Promise((resolve) => {
      try {
        if (entry.type === 'udp') {
          // Close UDP server
          try {
            entry.server.close();
          } catch (e) {
            console.error(`[ProxyManager] Error closing UDP server:`, e.message);
          }

          // Close all upstream sockets
          if (entry.upstreams) {
            for (const [clientKey, upstreamEntry] of entry.upstreams) {
              try {
                if (upstreamEntry.timeout) clearTimeout(upstreamEntry.timeout);
                upstreamEntry.upstream.close();
              } catch (e) {
                console.error(`[ProxyManager] Error closing upstream for ${clientKey}:`, e.message);
              }
            }
          }

          this.proxies.delete(id);
          console.log(`[ProxyManager] UDP proxy ${id} stopped`);
          resolve(true);
        } else if (entry.type === 'tcp') {
          // Close TCP server
          entry.server.close(() => {
            this.proxies.delete(id);
            console.log(`[ProxyManager] TCP proxy ${id} stopped`);
            resolve(true);
          });

          // Force close after timeout
          setTimeout(() => {
            if (this.proxies.has(id)) {
              this.proxies.delete(id);
              resolve(true);
            }
          }, 3000);
        } else if (entry.type === 'http') {
          // HTTP proxies are handled by shared servers
          // Just remove from map
          this.proxies.delete(id);
          console.log(`[ProxyManager] HTTP proxy ${id} unregistered`);
          resolve(true);
        } else if (entry.type === 'minecraft') {
          // Minecraft proxies are handled by shared server
          // Just remove from map
          this.proxies.delete(id);
          console.log(`[ProxyManager] Minecraft proxy ${id} unregistered`);
          resolve(true);
        } else {
          this.proxies.delete(id);
          resolve(true);
        }
      } catch (error) {
        console.error(`[ProxyManager] Error stopping proxy ${id}:`, error.message);
        this.proxies.delete(id);
        resolve(false);
      }
    });
  }

  /**
   * Reload a proxy (stop and start)
   * @param {number|string} domainId - Domain ID (string from route params is handled)
   */
  async reloadProxy(domainId) {
    // SECURITY: Acquire reload lock (prevent race conditions)
    while (this.reloadLock) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.reloadLock = true;

    try {
      const domain = await database.getDomainById(domainId);
      if (!domain) {
        throw new Error(`Domain ${domainId} not found`);
      }

      // Use domain.id (always a number from DB) for Map operations to avoid
      // the string/number key mismatch when domainId comes from request.params
      const numId = domain.id;

      // Save old entry so we can restore it if startProxy fails (avoids
      // permanent "Domain not found" until next restart)
      const oldEntry = this.proxies.get(numId);

      // Stop if running
      if (oldEntry) {
        await this.stopProxy(numId);
      }

      // SECURITY: Invalidate domain cache for this hostname
      this._invalidateDomainCache(domain.hostname);

      // Start if active
      if (domain.is_active) {
        try {
          await this.startProxy(domain);
        } catch (startErr) {
          // startProxy failed — restore old entry so the domain stays
          // reachable instead of disappearing permanently
          if (oldEntry) {
            this.proxies.set(numId, oldEntry);
            console.warn(`[ProxyManager] startProxy failed for domain ${numId}, restored old entry:`, startErr.message);
          } else {
            console.error(`[ProxyManager] startProxy failed for domain ${numId} (no old entry to restore):`, startErr.message);
          }
          throw startErr;
        }
      }
    } finally {
      this.reloadLock = false;
    }
  }

  /**
   * Reload all active proxies from database
   */
  async reloadAllProxies() {
    console.log('[ProxyManager] Reloading all proxies from database...');

    const activeDomains = await database.getAllActiveDomains();
    const currentIds = Array.from(this.proxies.keys());
    const desiredIds = new Set(activeDomains.map(d => d.id));

    // Stop proxies that are no longer active
    for (const currentId of currentIds) {
      if (!desiredIds.has(currentId)) {
        try {
          await this.stopProxy(currentId);
        } catch (error) {
          console.error(`[ProxyManager] Error stopping proxy ${currentId}:`, error.message);
        }
      }
    }

    // Start/reload active proxies
    let successCount = 0;
    const failed = [];
    for (const domain of activeDomains) {
      try {
        await this.reloadProxy(domain.id);
        successCount++;
      } catch (error) {
        console.error(`[ProxyManager] Error reloading proxy ${domain.id}:`, error.message);
        failed.push(domain);
      }
    }

    // Retry failed proxies once after a short delay (handles transient boot errors)
    if (failed.length > 0) {
      console.log(`[ProxyManager] Retrying ${failed.length} failed proxies in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
      for (const domain of failed) {
        try {
          await this.reloadProxy(domain.id);
          successCount++;
          console.log(`[ProxyManager] Retry succeeded for proxy ${domain.id}`);
        } catch (error) {
          console.error(`[ProxyManager] Retry failed for proxy ${domain.id}:`, error.message);
        }
      }
    }

    console.log(`[ProxyManager] Reloaded ${successCount}/${activeDomains.length} proxies`);
  }

  /**
   * Stop all proxies
   */
  async stopAll() {
    console.log('[ProxyManager] Stopping all proxies...');

    const ids = Array.from(this.proxies.keys());
    const promises = [];

    for (const id of ids) {
      promises.push(this.stopProxy(id));
    }

    await Promise.all(promises);
    console.log('[ProxyManager] All proxies stopped');
  }

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

        // Check IP/CIDR network blocking rules before opening backend connection
        try {
          const networkAccess = await urlFilterService.checkNetworkAccess(domain.id, clientIp);
          if (networkAccess.blocked) {
            blockedByPolicy = true;
            errorMessage = networkAccess.response?.message || 'Connection blocked by network policy';
            console.warn(`[TCP Proxy ${domain.id}] Blocked client ${clientIp}: ${errorMessage}`);
            clientSocket.destroy();
            return;
          }
        } catch (err) {
          console.error(`[TCP Proxy ${domain.id}] Network policy check failed:`, err.message);
        }

        // Load balancing: select backend
        try {
          const target = await this._selectBackendForDomain(domain, clientIp, 'tcp');
          backendHost = target.hostname;
          backendPort = target.port;
        } catch (err) {
          console.error(`[TCP Proxy ${domain.id}] Backend selection failed:`, err.message);
          clientSocket.destroy();
          return;
        }

        // Live traffic tracking (fire-and-forget)
        { const s = lts(); if (s) s.recordHit(domain.id, clientIp, 'tcp', `${backendHost}:${backendPort}`); }

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
          console.warn(`[TCP Proxy ${domain.id}] Client socket timeout`);
          cleanup();
        });

        // Connect to backend
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
              cleanup();
            }
          }, this.TCP_CONNECT_TIMEOUT);
        }

        targetSocket.on('connect', () => {
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
        });

        // Backend timeout
        if (this.TCP_TIMEOUT > 0) {
          targetSocket.setTimeout(this.TCP_TIMEOUT);
          targetSocket.on('timeout', () => {
            console.warn(`[TCP Proxy ${domain.id}] Backend timeout`);
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
            console.error(`[TCP Proxy ${domain.id}] Backend error:`, err.message);
            errorMessage = `Backend error: ${err.message}`;
          }
          cleanup();
        });

      clientSocket.on('error', (err) => {
        if (!isClosing && err.code !== 'EPIPE' && err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') {
          console.error(`[TCP Proxy ${domain.id}] Client error:`, err.message);
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
        console.error(`[TCP Proxy ${domain.id}] Server error:`, err.message);
      });

      if (this.TCP_MAX_CONNECTIONS > 0) {
        server.maxConnections = this.TCP_MAX_CONNECTIONS;
      }

      const listenArgs = [domain.external_port, '0.0.0.0'];
      if (this.TCP_BACKLOG > 0) {
        listenArgs.push(this.TCP_BACKLOG);
      }
      listenArgs.push(() => {
        console.log(`[TCP Proxy ${domain.id}] Listening on 0.0.0.0:${domain.external_port}`);
      });
      server.listen(...listenArgs);

    this.proxies.set(domain.id, {
      type: 'tcp',
      server,
      meta: domain
    });

    return server;
  }

  // ==================== UDP PROXY ====================

  /**
   * Build a HAProxy PROXY Protocol v2 binary header for a UDP packet.
   * Used to forward the real client IP to Geyser (use-proxy-protocol: true).
   *
   * Format (IPv4, 28 bytes total):
   *   12B signature + 1B version/cmd + 1B family + 2B addr_len + 4B src + 4B dst + 2B src_port + 2B dst_port
   */
  _buildProxyV2Header(srcIp, srcPort, dstIp, dstPort) {
    const isIPv6 = srcIp.includes(':');
    const sig = Buffer.from([0x0D,0x0A,0x0D,0x0A,0x00,0x0D,0x0A,0x51,0x55,0x49,0x54,0x0A]);
    const addrLen = isIPv6 ? 36 : 12;
    const header = Buffer.alloc(16 + addrLen);

    sig.copy(header, 0);
    header[12] = 0x21;                       // version 2, PROXY command
    header[13] = isIPv6 ? 0x22 : 0x12;       // AF_INET(6) + DGRAM
    header.writeUInt16BE(addrLen, 14);

    if (isIPv6) {
      const expand = (ip) => {
        const halves = ip.split('::');
        const left = halves[0] ? halves[0].split(':') : [];
        const right = halves[1] ? halves[1].split(':') : [];
        const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
        const buf = Buffer.alloc(16);
        groups.forEach((g, i) => { const v = parseInt(g || '0', 16); buf[i*2] = v>>8; buf[i*2+1] = v&0xFF; });
        return buf;
      };
      expand(srcIp).copy(header, 16);
      expand(dstIp).copy(header, 32);
      header.writeUInt16BE(srcPort, 48);
      header.writeUInt16BE(dstPort, 50);
    } else {
      const s = srcIp.split('.').map(Number);
      const d = (dstIp || '0.0.0.0').split('.').map(Number);
      header[16]=s[0]; header[17]=s[1]; header[18]=s[2]; header[19]=s[3];
      header[20]=d[0]; header[21]=d[1]; header[22]=d[2]; header[23]=d[3];
      header.writeUInt16BE(srcPort, 24);
      header.writeUInt16BE(dstPort, 26);
    }

    return header;
  }

  /**
   * Start a UDP proxy
   * Multi-client bidirectional forwarding with load balancing
   */
  _startUdpProxy(domain) {
    const serverSocket = dgram.createSocket('udp4');
    const upstreams = new Map(); // clientKey -> { upstream, timeout, metrics, backendHost, backendPort }

      serverSocket.on('error', (err) => {
        console.error(`[UDP Proxy ${domain.id}] Server error:`, err.message);
    });

    serverSocket.on('message', async (msg, rinfo) => {
      const clientKey = `${rinfo.address}:${rinfo.port}`;
      const clientIp = this._normalizeIp(rinfo.address);
      let upstreamEntry = upstreams.get(clientKey);

      if (!upstreamEntry) {
        try {
          const networkAccess = await urlFilterService.checkNetworkAccess(domain.id, clientIp);
          if (networkAccess.blocked) {
            const message = networkAccess.response?.message || 'Connection blocked by network policy';
            console.warn(`[UDP Proxy ${domain.id}] Blocked client ${clientKey}: ${message}`);

            logBatchQueue.queueRequestLog({
              domainId: domain.id,
              hostname: domain.hostname,
              method: 'UDP',
              path: 'network-policy',
              queryString: null,
              statusCode: 403,
              responseTime: 0,
              responseSize: 0,
              ipAddress: clientIp,
              userAgent: null,
              referer: null,
              requestHeaders: {
                'bytes-received': msg.length,
                'bytes-sent': 0
              },
              responseHeaders: {},
              errorMessage: message
            });

            return;
          }
        } catch (err) {
          console.error(`[UDP Proxy ${domain.id}] Network policy check failed:`, err.message);
        }

        // New client: select backend via load balancing and create dedicated upstream socket
        let backendHost, backendPort;
        try {
          const target = await this._selectBackendForDomain(domain, clientIp, 'udp');
          backendHost = target.hostname;
          backendPort = target.port;
        } catch (err) {
          console.error(`[UDP Proxy ${domain.id}] Backend selection failed:`, err.message);
          return;
        }

        const upstream = dgram.createSocket('udp4');

        // Initialize metrics for this client
        const metrics = {
          startTime: Date.now(),
          bytesReceived: 0,
          bytesSent: 0,
          errorMessage: null
        };

        upstream.on('message', (upMsg) => {
          // Track bytes sent to client
          metrics.bytesSent += upMsg.length;

          // Forward response back to original client
          serverSocket.send(upMsg, rinfo.port, rinfo.address, (err) => {
            if (err) {
              console.error(`[UDP Proxy ${domain.id}] Failed to forward response to ${clientKey}:`, err.message);
              metrics.errorMessage = `Forward error: ${err.message}`;
            }
          });
        });

        upstream.on('error', (err) => {
          console.error(`[UDP Proxy ${domain.id}] Upstream error for ${clientKey}:`, err.message);
          metrics.errorMessage = `Upstream error: ${err.message}`;
        });

        upstreamEntry = { upstream, timeout: null, metrics, clientIp, backendHost, backendPort, proxySent: false };
        upstreams.set(clientKey, upstreamEntry);
        // Live traffic tracking (fire-and-forget)
        { const s = lts(); if (s) s.recordHit(domain.id, clientIp, 'udp', `${backendHost}:${backendPort}`); }
        console.log(`[UDP Proxy ${domain.id}] New client ${clientKey} -> ${backendHost}:${backendPort}`);
      }

      // Track bytes received from client
      upstreamEntry.metrics.bytesReceived += msg.length;

        // Reset timeout for this client (inactivity)
        if (this.UDP_CLIENT_TIMEOUT > 0) {
          if (upstreamEntry.timeout) clearTimeout(upstreamEntry.timeout);
          upstreamEntry.timeout = setTimeout(() => {
            // Log UDP session before cleanup
            const responseTime = Date.now() - upstreamEntry.metrics.startTime;
            database.createRequestLog({
              domainId: domain.id,
              hostname: domain.hostname,
              method: 'UDP',
              path: `${upstreamEntry.backendHost}:${upstreamEntry.backendPort}`,
              queryString: null,
              statusCode: upstreamEntry.metrics.errorMessage ? 502 : 200,
              responseTime: responseTime,
              responseSize: upstreamEntry.metrics.bytesSent,
              ipAddress: upstreamEntry.clientIp,
              userAgent: null,
              referer: null,
              requestHeaders: {
                'bytes-received': upstreamEntry.metrics.bytesReceived,
                'bytes-sent': upstreamEntry.metrics.bytesSent
              },
              responseHeaders: {},
              errorMessage: upstreamEntry.metrics.errorMessage
            }).catch((err) => {
              console.error('[ProxyManager] Failed to write UDP log:', err);
            });

            try {
              upstreamEntry.upstream.close();
            } catch (e) {
              // Ignore
            }
            upstreams.delete(clientKey);
            console.log(`[UDP Proxy ${domain.id}] Client ${clientKey} timed out after ${this.UDP_CLIENT_TIMEOUT / 1000}s`);
          }, this.UDP_CLIENT_TIMEOUT);
        }

      // Forward packet to backend
      // If Geyser PROXY Protocol v2 is enabled, prepend the binary header to the FIRST
      // packet so Geyser can read the real Bedrock client IP (use-proxy-protocol: true).
      let packetToSend = msg;
      if (domain.geyser_proxy_protocol && !upstreamEntry.proxySent) {
        upstreamEntry.proxySent = true;
        const proxyHdr = this._buildProxyV2Header(
          upstreamEntry.clientIp, rinfo.port,
          upstreamEntry.backendHost, upstreamEntry.backendPort
        );
        packetToSend = Buffer.concat([proxyHdr, msg]);
      }
      upstreamEntry.upstream.send(packetToSend, upstreamEntry.backendPort, upstreamEntry.backendHost, (err) => {
        if (err) {
          console.error(`[UDP Proxy ${domain.id}] Failed to forward to backend:`, err.message);
          upstreamEntry.metrics.errorMessage = `Backend forward error: ${err.message}`;
        }
      });
    });

    // Get initial backend info for logging
    const defaultTarget = loadBalancer.getBackendTarget(domain, null, 'udp');
    serverSocket.bind(domain.external_port, '0.0.0.0', () => {
      const lbStatus = domain.load_balancing_enabled ? ' (load balanced)' : '';
      console.log(`[UDP Proxy ${domain.id}] Listening on 0.0.0.0:${domain.external_port} -> ${defaultTarget.hostname}:${defaultTarget.port}${lbStatus}`);
    });

    this.proxies.set(domain.id, {
      type: 'udp',
      server: serverSocket,
      upstreams,
      meta: domain
    });

    return serverSocket;
  }

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
    console.log(`[ProxyManager] Minecraft proxy registered for ${domain.hostname} -> ${domain.backend_url}:${backendPort}`);
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

        const cleanup = () => {
          if (isClosing) return;
          isClosing = true;

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
                'bytes-sent': bytesSent
              },
              responseHeaders: {},
              errorMessage
            }).catch(err => {
              console.error('[MinecraftProxy] Failed to write log:', err);
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
          // SECURITY FIX: Check total bytes BEFORE accumulating
          totalBytesBuffered += chunk.length;
          bytesReceived += chunk.length;

          if (totalBytesBuffered > MAX_HANDSHAKE_BYTES) {
            errorMessage = 'Handshake too large - possible DOS attack';
            console.error(`[MinecraftProxy] Connection exceeded handshake limit: ${totalBytesBuffered} bytes from ${clientIp}`);
            cleanup();
            return;
          }

          // Now safe to accumulate
          handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);

          // Double-check buffer size (defense in depth)
          if (handshakeBuffer.length > MAX_HANDSHAKE_BYTES) {
            errorMessage = 'Buffer overflow protection';
            console.error(`[MinecraftProxy] Buffer size protection triggered: ${handshakeBuffer.length} bytes`);
            cleanup();
            return;
          }

          // Handshake already parsed; buffer until backend connects
          if (handshakeComplete) {
            return;
          }

          // Try to parse handshake
          const result = parseHandshake(handshakeBuffer);

          if (result.incomplete) {
            // Wait for more data
            return;
          }

          if (!result.success) {
            // Parse error
            errorMessage = result.error;
            console.error(`[MinecraftProxy] Handshake parse error:`, result.error);
            cleanup();
            return;
          }

          // Handshake complete and valid!
          handshakeComplete = true;
          clearTimeout(handshakeTimeout);
          handshakeTimeout = null;

          const hostname = result.hostname;
          routedHostname = hostname;

          console.log(`[MinecraftProxy] Handshake parsed: ${hostname}`);

          // Route to domain — filter by 'minecraft' so an HTTP domain
          // with the same hostname doesn't intercept MC connections.
          domain = this._findDomainByHostname(hostname, 'minecraft');
          if (!domain) {
            errorMessage = `Domain not found: ${hostname}`;
            console.warn(`[MinecraftProxy] Domain not found: ${hostname}`);
            cleanup();
            return;
          }

          try {
            const networkAccess = await urlFilterService.checkNetworkAccess(domain.id, clientIp);
            if (networkAccess.blocked) {
              blockedByPolicy = true;
              errorMessage = networkAccess.response?.message || 'Connection blocked by network policy';
              console.warn(`[MinecraftProxy] Blocked client ${clientIp} for ${hostname}: ${errorMessage}`);
              cleanup();
              return;
            }
          } catch (err) {
            console.error(`[MinecraftProxy] Network policy check failed:`, err.message);
          }

          // Select backend (with load balancing if enabled)
          let backendHost, backendPort, backendId;
          try {
            const target = await this._selectBackendForDomain(domain, clientIp, 'minecraft');
            backendHost = target.hostname;
            backendPort = target.port;
            backendId = target.backendId;
          } catch (err) {
            errorMessage = `Backend selection failed: ${err.message}`;
            console.error(`[MinecraftProxy] ${errorMessage}`);
            cleanup();
            return;
          }

          // Live traffic tracking (fire-and-forget)
          { const s = lts(); if (s) s.recordHit(domain.id, clientIp, 'minecraft', `${backendHost}:${backendPort}`); }

          console.log(`[MinecraftProxy] Routing ${hostname} -> ${backendHost}:${backendPort}`);

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
                cleanup();
              }
            }, this.MINECRAFT_CONNECT_TIMEOUT);
          }

          if (this.MINECRAFT_TIMEOUT > 0) {
            targetSocket.setTimeout(this.MINECRAFT_TIMEOUT);
          }

          targetSocket.on('connect', () => {
            if (connectTimeout) {
              clearTimeout(connectTimeout);
              connectTimeout = null;
            }

            // Send the buffered handshake packet, then forward live traffic.
            if (handshakeBuffer.length > 0) {
              targetSocket.write(handshakeBuffer);
            }

            // FIXED: Replace direct piping with manual relay for better error handling
            // and back-pressure management, especially critical for VPN connections
            const relayClientToBackend = (chunk) => {
              if (!targetSocket.destroyed) {
                bytesReceived += chunk.length; // Count bytes received from client
                if (!targetSocket.write(chunk)) {
                  // Back-pressure: pause client socket if backend buffer is full
                  clientSocket.pause();
                }
              }
            };

            const relayBackendToClient = (chunk) => {
              if (!clientSocket.destroyed) {
                bytesSent += chunk.length; // Count bytes sent to client
                if (!clientSocket.write(chunk)) {
                  // Back-pressure: pause backend socket if client buffer is full
                  targetSocket.pause();
                }
              }
            };

            clientSocket.on('data', relayClientToBackend);
            targetSocket.on('data', relayBackendToClient);

            // Resume on drain when back-pressure eases
            clientSocket.on('drain', () => {
              if (!targetSocket.destroyed && targetSocket.isPaused?.()) {
                targetSocket.resume();
              }
            });

            targetSocket.on('drain', () => {
              if (!clientSocket.destroyed && clientSocket.isPaused?.()) {
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
              console.warn(`[MinecraftProxy] Backend connection error (${err.code}) to ${backendHost}:${backendPort}, invalidating health cache for domain ${domain.id}`);
              this.backendHealthCache.delete(domain.id); // Force DB refresh next request
            }
            
            // Log connection errors with more detail for VPN debugging
            if (!isClosing) {
              if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
                console.warn(`[MinecraftProxy] Backend connection closed (${err.code}) to ${backendHost}:${backendPort} - This may indicate VPN/network issues between proxy and backend`);
              } else {
                console.error(`[MinecraftProxy] Backend error (${err.code || err.message}):`, err.message);
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
            console.error(`[MinecraftProxy] Client error:`, err.message);
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
          console.error(`[MinecraftProxy] Port ${config.minecraftProxy.port} already in use`);
          this.minecraftServer = null;
          reject(err);
        } else {
          console.error('[MinecraftProxy] Server error:', err.message);
        }
      });

      // Server configuration
      if (this.MINECRAFT_MAX_CONNECTIONS > 0) {
        this.minecraftServer.maxConnections = this.MINECRAFT_MAX_CONNECTIONS;
      }

      // Start listening
      const listenArgs = [config.minecraftProxy.port, '0.0.0.0'];
      if (this.MINECRAFT_BACKLOG > 0) {
        listenArgs.push(this.MINECRAFT_BACKLOG);
      }
      listenArgs.push(() => {
        console.log(`[MinecraftProxy] Shared Minecraft server listening on port ${config.minecraftProxy.port}`);
        resolve();
      });

      this.minecraftServer.listen(...listenArgs);
    });
  }

  // ==================== HTTP/HTTPS PROXY ====================

  /**
   * Start HTTP proxy for a domain
   * Uses shared HTTP (port 80) and HTTPS (port 443) servers
   */
  async _startHttpProxy(domain) {
    // Ensure shared HTTP server is running
    if (!this.httpServer) {
      await this._startSharedHttpServer();
    }

    // Ensure shared HTTPS server is running if SSL is enabled
    if (domain.ssl_enabled && !this.httpsServer) {
      await this._startSharedHttpsServer();
    }

    // Register domain in proxy map
    this.proxies.set(domain.id, {
      type: 'http',
      server: domain.ssl_enabled ? this.httpsServer : this.httpServer,
      meta: domain
    });

    console.log(`[ProxyManager] HTTP${domain.ssl_enabled ? 'S' : ''} proxy registered for ${domain.hostname} -> ${domain.backend_url}`);

    // Load SSL certificate if enabled
    if (domain.ssl_enabled) {
      await this._loadCertificateForDomain(domain.hostname);
    }
  }

  /**
   * Start shared HTTP server (port 80)
   * Handles all HTTP domains and ACME challenges
   */
    async _startSharedHttpServer() {
      return new Promise((resolve, reject) => {
        this.httpServer = http.createServer((req, res) => {
          if (this._handleProxyCheck(req, res)) {
            return;
          }

          const hostname = this._extractHostname(req.headers.host);
          if (this._shouldHandleRedirection(hostname) && this._handlePublicRedirection(req, res)) {
            return;
          }

        // Check for ACME challenge (.well-known/acme-challenge/)
        if (req.url?.startsWith('/.well-known/acme-challenge/')) {
          this._handleAcmeChallenge(req, res);
          return;
        }

        // Find domain in proxies
        const domain = this._findDomainByHostname(hostname, 'http');
        if (!domain) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Domain not found');
          return;
        }

        // If SSL enabled, redirect to HTTPS
        if (domain.ssl_enabled) {
          const redirectUrl = `https://${hostname}${req.url}`;
          res.writeHead(301, { Location: redirectUrl });
          res.end();
          return;
        }

        // Proxy the request
        this._proxyHttpRequest(req, res, domain);
      });

      this.httpServer.on('upgrade', (req, socket, head) => {
        this._handleWebSocketUpgrade(req, socket, head, false);
      });

      this.httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn('[ProxyManager] Port 80 already in use, HTTP proxy not started');
          this.httpServer = null;
          resolve();
        } else {
          console.error('[ProxyManager] HTTP server error:', err.message);
        }
      });

      this.httpServer.listen(80, '0.0.0.0', () => {
        console.log('[ProxyManager] Shared HTTP server listening on port 80');
        resolve();
      });
    });
  }

  /**
   * Start shared HTTPS server (port 443)
   * Uses SNI (Server Name Indication) for multi-domain SSL
   */
    async _startSharedHttpsServer() {
      return new Promise((resolve, reject) => {
      // Create default self-signed certificate
      const defaultCert = this._generateSelfSignedCert('default.local');
      this.defaultSecureContext = tls.createSecureContext({
        cert: defaultCert.cert,
        key: defaultCert.private
      });

      const options = {
        SNICallback: (servername, callback) => {
          this._getSniContext(servername, callback);
        },
        cert: defaultCert.cert,
        key: defaultCert.private
      };

        this.httpsServer = https.createServer(options, (req, res) => {
          if (this._handleProxyCheck(req, res)) {
            return;
          }

          const hostname = this._extractHostname(req.headers.host);
          if (this._shouldHandleRedirection(hostname) && this._handlePublicRedirection(req, res)) {
            return;
          }

        // Find domain in proxies
        const domain = this._findDomainByHostname(hostname, 'http');
        if (!domain) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Domain not found');
          return;
        }

        // Proxy the request
        this._proxyHttpRequest(req, res, domain);
      });

      this.httpsServer.on('upgrade', (req, socket, head) => {
        this._handleWebSocketUpgrade(req, socket, head, true);
      });

      this.httpsServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn('[ProxyManager] Port 443 already in use, HTTPS proxy not started');
          this.httpsServer = null;
          resolve();
        } else {
          console.error('[ProxyManager] HTTPS server error:', err.message);
        }
      });

      this.httpsServer.listen(443, '0.0.0.0', () => {
        console.log('[ProxyManager] Shared HTTPS server listening on port 443');
        resolve();
      });
    });
  }

  /**
   * SNI callback to select appropriate SSL certificate
   * SECURITY: Checks certificate expiration before serving from cache
   */
  async _getSniContext(servername, callback) {
    try {
      if (!servername) {
        return callback(null, this.defaultSecureContext);
      }

      // Check cache
      const cached = this.secureContextCache.get(servername);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
        // SECURITY FIX: Check if cached certificate is expired
        if (cached.expiresAt && Date.now() > cached.expiresAt) {
          console.warn(`[ProxyManager] Cached certificate expired for ${servername}, reloading...`);
          this.secureContextCache.delete(servername);
        } else {
          return callback(null, cached.context);
        }
      }

      // Load certificate from database ONLY (no file fallback)
      let cert, key, expiresAt = null;

      const certData = await certificateManager.loadCertificate(servername);

      if (certData) {
        cert = certData.cert;
        key = certData.key;

        // Extract expiration date from certificate
        try {
          const certInfo = certificateManager.parseCertificateMetadata(cert);
          if (certInfo && certInfo.expiresAt) {
            expiresAt = new Date(certInfo.expiresAt).getTime();
          }
        } catch (err) {
          console.warn(`[ProxyManager] Failed to parse cert expiration for ${servername}:`, err.message);
        }
      }

      // Fallback to Nebula default certificate if no real cert available
      if (!cert || !key) {
        console.warn(`[ProxyManager] No certificate in DB for ${servername}, serving Nebula default fallback`);
        // Use the pre-generated default context — guaranteed to exist and never cause a cipher mismatch
        if (this.defaultSecureContext) {
          return callback(null, this.defaultSecureContext);
        }
        // Absolute last resort: try a fresh self-signed cert (should never reach here)
        try {
          const selfSigned = this._generateSelfSignedCert(servername);
          cert = selfSigned.cert;
          key = selfSigned.private;
          expiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000);
        } catch (genErr) {
          console.error(`[ProxyManager] Self-signed generation failed for ${servername}:`, genErr.message);
          return callback(null, this.defaultSecureContext);
        }
      }

      const context = tls.createSecureContext({ cert, key });

      // Cache it with expiration timestamp
      this.secureContextCache.set(servername, {
        context,
        timestamp: Date.now(),
        expiresAt
      });

      callback(null, context);
    } catch (error) {
      console.error(`[ProxyManager] Failed to create secure context for ${servername}:`, error.message);
      // Always fall back to the Nebula default — never pass an error to the TLS callback
      // (doing so causes ERR_SSL_VERSION_OR_CIPHER_MISMATCH in browsers)
      if (this.defaultSecureContext) {
        return callback(null, this.defaultSecureContext);
      }
      // If even defaultSecureContext is missing (startup issue), try one more time
      try {
        const emergency = this._generateSelfSignedCert('nebula.default.local');
        callback(null, tls.createSecureContext({ cert: emergency.cert, key: emergency.private }));
      } catch (fallbackError) {
        console.error(`[ProxyManager] Emergency fallback cert failed for ${servername}:`, fallbackError.message);
        callback(error);
      }
    }
  }

  /**
   * Load certificate for a domain (ACME or self-signed)
   */
  async _loadCertificateForDomain(hostname) {
    // Clear cache to force reload
    this.secureContextCache.delete(hostname);

    // Try to ensure ACME certificate exists
    if (this.acmeManager) {
      try {
        if (this._isIpAddress(hostname)) {
          console.log(`[ProxyManager] Skipping ACME for IP address ${hostname}`);
          return;
        }

        // Get domain info to check challenge type
        const domain = await database.getDomainByHostname(hostname);

        // Only auto-request certificate for HTTP-01 challenges
        // DNS-01 challenges must be done manually through the web interface
        if (domain && domain.acme_challenge_type === 'http-01') {
          await this.acmeManager.ensureCert(hostname);
          console.log(`[ProxyManager] ACME certificate loaded for ${hostname}`);
        } else if (domain && domain.acme_challenge_type === 'dns-01') {
          console.log(`[ProxyManager] Domain ${hostname} requires DNS-01 challenge (manual setup required)`);
        } else {
          await this.acmeManager.ensureCert(hostname);
          console.log(`[ProxyManager] ACME certificate loaded for ${hostname}`);
        }
      } catch (error) {
        console.warn(`[ProxyManager] Failed to load ACME cert for ${hostname}, will use Nebula default fallback:`, error.message);
        // Pre-cache the Nebula default context for this hostname so the next TLS request
        // gets a valid context immediately instead of hitting a cipher-mismatch error.
        // Use a short TTL (5 min) so we retry the real cert soon.
        if (this.defaultSecureContext) {
          this.secureContextCache.set(hostname, {
            context: this.defaultSecureContext,
            timestamp: Date.now(),
            expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes — retries cert after expiry
            isNebulaFallback: true
          });
        }
      }
    }
  }

  /**
   * Generate self-signed certificate
   */
  _generateSelfSignedCert(hostname) {
    const safeHost = hostname && typeof hostname === 'string' ? hostname : 'default.local';
    const attrs = [{ name: 'commonName', value: safeHost }];
    const extensions = [];

    if (this._isIpAddress(safeHost)) {
      extensions.push({
        name: 'subjectAltName',
        altNames: [{ type: 7, ip: safeHost }]
      });
    } else {
      extensions.push({
        name: 'subjectAltName',
        altNames: [{ type: 2, value: safeHost }]
      });
    }
    const pems = selfsigned.generate(attrs, {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions
    });

    return pems;
  }

  /**
   * Handle ACME HTTP-01 challenge
   * SECURITY: Prevents path traversal attacks
   */
  async _handleAcmeChallenge(req, res) {
    // Serve files from ACME webroot
    const webrootDir = this.acmeManager?.webrootDir || '/var/www/letsencrypt';
    const challengePath = req.url.replace('/.well-known/acme-challenge/', '');

    // SECURITY FIX: Sanitize path to prevent directory traversal
    // 1. Get only the filename (no directories allowed)
    const sanitized = path.basename(challengePath);

    // 2. Validate: ACME challenge tokens are [A-Za-z0-9_-]{43} (base64url)
    // Allow alphanumeric, dash, underscore only
    if (!/^[A-Za-z0-9_-]+$/.test(sanitized) || sanitized.length > 256) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid challenge token format');
      return;
    }

    // 3. Build safe path
    const safePath = path.join(webrootDir, '.well-known', 'acme-challenge', sanitized);

    try {
      // 4. Verify resolved path is within webroot (prevent symlink attacks)
      const realPath = await fs.promises.realpath(safePath).catch(() => null);
      const realWebroot = await fs.promises.realpath(webrootDir).catch(() => webrootDir);

      if (!realPath || !realPath.startsWith(realWebroot)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      // 5. Now safe to read
      const content = await fs.promises.readFile(realPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(content);

    } catch (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Challenge not found');
      } else {
        console.error('[ProxyManager] ACME challenge error:', error.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    }
  }

  /**
   * Proxy HTTP request to backend with load balancing support
   */
  async _proxyHttpRequest(req, res, domain) {
    const startTime = Date.now();
    const clientIp = this._getRealClientIp(req);

    // ── 0. WEBSOCKET UPGRADE FALLBACK ────────────────────────────────────────
    // Upstream proxies (e.g. 45.134.38.59) that don't emit a server-level
    // 'upgrade' event forward WebSocket upgrade requests as plain HTTP, which
    // means Upgrade and Connection headers are never tunnelled to the backend.
    // Intercept them here and hand off to the proper WebSocket upgrade handler
    // so buildUpgradeRequest() always sets Upgrade: websocket / Connection: Upgrade.
    if (req.headers['upgrade']?.toLowerCase() === 'websocket') {
      this._handleWebSocketUpgrade(req, req.socket, Buffer.alloc(0), !!req.socket.encrypted);
      return;
    }

    // Extract path without query string for URL filtering
    const urlPath = req.url.split('?')[0];
    const queryString = req.url.includes('?') ? req.url.split('?')[1] : null;

    // ── 1. MAINTENANCE MODE ──────────────────────────────────────────────────
    if (domain.maintenance_mode) {
      const html = domain.custom_maintenance_page
        ? this._renderCustomErrorPage(domain.custom_maintenance_page, 503)
        : this._renderMaintenancePage(domain);
      res.writeHead(503, {
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '3600'
      });
      res.end(html);
      return;
    }

    // ── 2. GEOIP BLOCKING ────────────────────────────────────────────────────
    if (domain.geoip_blocking_enabled) {
      try {
        const geoResult = await geoIpService.checkAccess(domain, clientIp);
        if (geoResult.blocked) {
          const wantsHtml = (req.headers.accept || '').includes('text/html');
          if (wantsHtml) {
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this._renderBlockedPage(
              `Access from ${geoResult.countryCode} is not permitted.`, 403
            ));
          } else {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden', message: geoResult.reason }));
          }
          return;
        }
      } catch (geoErr) {
        console.error(`[HTTP Proxy ${domain.id}] GeoIP check failed:`, geoErr.message);
        // Fail open — continue serving
      }
    }

    // ── 3. PER-DOMAIN RATE LIMITING ──────────────────────────────────────────
    if (domain.rate_limit_enabled) {
      try {
        const rlKey  = `domain_rl:${domain.id}:${clientIp}`;
        const rlMax  = domain.rate_limit_max  || 100;
        const rlWin  = domain.rate_limit_window || 60; // seconds

        if (redisService.isConnected && redisService.client) {
          const count = await redisService.client.incr(rlKey);
          if (count === 1) {
            await redisService.client.expire(rlKey, rlWin);
          }
          if (count > rlMax) {
            res.writeHead(429, {
              'Content-Type': 'application/json',
              'Retry-After': String(rlWin),
              'X-RateLimit-Limit': String(rlMax),
              'X-RateLimit-Remaining': '0'
            });
            res.end(JSON.stringify({ error: 'Too Many Requests', message: 'Rate limit exceeded' }));
            return;
          }
        }
      } catch (rlErr) {
        console.error(`[HTTP Proxy ${domain.id}] Rate limit check failed:`, rlErr.message);
        // Fail open
      }
    }

    // ── 3.5. DDOS PROTECTION ─────────────────────────────────────────────────
    if (domain?.ddos_protection_enabled) {
      try {
        const { ddosProtectionService } = await import('./ddosProtectionService.js');

        // Challenge mode: serve JS challenge directly (no redirect — avoids loops)
        if (domain.ddos_challenge_mode) {
          const reqUrl   = req.url || '/';
          const urlPath  = reqUrl.split('?')[0];

          // Handle challenge verify POST
          if (urlPath === '/__ddos_challenge/verify' && req.method === 'POST') {
            let body = '';
            req.on('data', c => { body += c; });
            req.on('end', () => {
              try {
                const { token, answer, return: ret = '/' } = JSON.parse(body);
                if (token && answer !== undefined && ddosProtectionService.verifyMathToken(clientIp, token, answer)) {
                  const cookie = ddosProtectionService.generateVerifiedCookie(clientIp, domain.hostname);
                  res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': `__ddos_bypass=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`
                  });
                  res.end(JSON.stringify({ ok: true, return: ret }));
                } else {
                  res.writeHead(403, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Challenge failed' }));
                }
              } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad request' }));
              }
            });
            return;
          }

          // Check bypass cookie
          const cookieHeader = req.headers['cookie'] || '';
          const bypassMatch  = cookieHeader.match(/__ddos_bypass=([^;]+)/);
          const bypassToken  = bypassMatch?.[1];

          if (!ddosProtectionService.verifyChallengeToken(clientIp, bypassToken, domain.hostname)) {
            // Serve challenge page inline (no redirect)
            const html = ddosProtectionService.generateChallengePage(clientIp, reqUrl);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Blocked-By': 'DDoS-Challenge' });
            res.end(html);
            return;
          }
        }

      } catch (ddosErr) {
        // Fail open
      }
    }

    // ── 4. URL FILTER ────────────────────────────────────────────────────────
    try {
      const filterResult = await urlFilterService.checkUrl(domain.id, urlPath, req.method, clientIp);

      if (filterResult.blocked) {
        await database.createRequestLog({
          domainId: domain.id,
          hostname: domain.hostname,
          method: req.method,
          path: urlPath,
          queryString: queryString,
          statusCode: filterResult.response.code,
          responseTime: Date.now() - startTime,
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'] || null,
          errorMessage: `Blocked by URL filter: ${filterResult.rule.pattern}`
        });

        const wantsHtml = (req.headers.accept || '').includes('text/html');
        if (wantsHtml) {
          res.writeHead(filterResult.response.code, { 'Content-Type': 'text/html' });
          res.end(this._renderBlockedPage(filterResult.response.message, filterResult.response.code));
        } else {
          res.writeHead(filterResult.response.code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied', message: filterResult.response.message }));
        }
        return;
      }
    } catch (error) {
      console.error(`[HTTP Proxy ${domain.id}] URL filter check failed:`, error.message);
    }

    // ── 5. BACKEND SELECTION (with sticky session) ───────────────────────────
    let backendHost, backendPort, backendProtocol, backendId;
    try {
      // Read sticky session cookie if needed
      let stickyValue = null;
      if (domain.sticky_sessions_enabled) {
        const cookies = this._parseCookies(req.headers.cookie || '');
        stickyValue = cookies['__nebula_srv'] || null;
      }

      const target = await this._selectBackendForDomain(domain, clientIp, 'http', { stickyValue });
      backendHost     = target.hostname;
      backendPort     = target.port;
      backendProtocol = target.protocol || 'http:';
      backendId       = target.backendId || null;
      // Live traffic tracking (fire-and-forget)
      { const s = lts(); if (s) s.recordHit(domain.id, clientIp, 'http', `${backendHost}:${backendPort}`); }
    } catch (err) {
      console.error(`[HTTP Proxy ${domain.id}] Backend selection failed:`, err.message);
      const html503 = domain.custom_503_page
        ? this._renderCustomErrorPage(domain.custom_503_page, 503)
        : null;
      if (html503) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html503);
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable', message: 'No available backend' }));
      }
      return;
    }

    // ── 6. CIRCUIT BREAKER CHECK ─────────────────────────────────────────────
    const cbKey = `${domain.id}:${backendHost}:${backendPort}`;
    if (!circuitBreaker.isAvailable(cbKey)) {
      console.warn(`[HTTP Proxy ${domain.id}] Circuit breaker OPEN for ${cbKey}`);
      const accept = String(req.headers.accept || '');
      const wantsHtml = accept.includes('text/html');
      const html503 = domain.custom_503_page
        ? this._renderCustomErrorPage(domain.custom_503_page, 503)
        : wantsHtml
          ? this._renderBadGatewayPage(domain.hostname)
          : null;
      if (html503) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html503);
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable', message: 'Backend temporarily unavailable' }));
      }
      return;
    }

    const options = {
      hostname: backendHost,
      port: backendPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        'X-Forwarded-For': clientIp,
        'X-Forwarded-Proto': req.connection.encrypted ? 'https' : 'http',
        'X-Forwarded-Host': req.headers.host,
        'X-Real-IP': clientIp
      }
    };

    // If backend is https, configure TLS
    if (backendProtocol === 'https:') {
      if (!this._isIpAddress(domain.hostname)) {
        options.servername = domain.hostname;
      }
      options.rejectUnauthorized = !config.proxy.allowInsecureBackends;
    }

    // Preserve the original host for virtual host routing
    if (req.headers.host) {
      options.headers.host = req.headers.host;
    }

    const acceptsHtml = String(req.headers.accept || '').includes('text/html');
    if (acceptsHtml && config.proxy.injectConsoleScript) {
      options.headers['accept-encoding'] = 'identity';
    }

    const protocol = backendProtocol === 'https:' ? https : http;
    const upstreamTimeoutMs = config.proxy.requestTimeoutMs || 4000;
    const consolePayload = {
      host: String(domain.hostname || req.headers.host || 'unknown-host'),
      path: String(req.url || '/'),
      timestamp: new Date().toISOString()
    };
    const consoleMessage = `var np=${JSON.stringify(consolePayload)};console.groupCollapsed('%cNebulaProxy %c// live route','color:#C77DFF;font-size:16px;font-weight:800;letter-spacing:0.02em;','color:#8b5cf6;font-size:11px;font-weight:700;letter-spacing:0.08em;');console.log('%cDomain:%c '+np.host,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cPath:%c '+np.path,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cTimestamp:%c '+np.timestamp,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cPowered by NebulaProxy','color:#22d3ee;font-size:12px;font-weight:700;');console.groupEnd();`;
    const consoleScript = `<script>(function(){try{${consoleMessage}}catch(e){}})();</script>`;

    const proxyReq = protocol.request(options, (proxyRes) => {
      const responseTime = Date.now() - startTime;
      const statusCode = proxyRes.statusCode;
      let responseSize = 0;
      const contentType = String(proxyRes.headers['content-type'] || '').toLowerCase();
      const isHtmlResponse = contentType.includes('text/html');

      // Circuit breaker: success
      circuitBreaker.onSuccess(cbKey);

      // Track response size
      proxyRes.on('data', (chunk) => {
        responseSize += chunk.length;
      });

      // Determine log level
      let logLevel = 'success';
      if (statusCode >= 500) logLevel = 'error';
      else if (statusCode >= 400) logLevel = 'warning';
      else if (statusCode >= 300) logLevel = 'info';

      // Log the request (batched for performance)
      proxyRes.on('end', () => {
        logBatchQueue.queueRequestLog({
          domainId: domain.id,
          hostname: domain.hostname,
          method: req.method,
          path: req.url.split('?')[0],
          queryString: req.url.includes('?') ? req.url.split('?')[1] : null,
          statusCode: statusCode,
          responseTime: responseTime,
          responseSize: responseSize,
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'] || null,
          referer: req.headers['referer'] || req.headers['referrer'] || null,
          requestHeaders: {
            'content-type': req.headers['content-type'],
            'accept': req.headers['accept'],
            'accept-language': req.headers['accept-language']
          },
          responseHeaders: {
            'content-type': proxyRes.headers['content-type'],
            'content-encoding': proxyRes.headers['content-encoding'],
            'cache-control': proxyRes.headers['cache-control']
          }
        });
      });

      // Legacy proxy log (batched)
      logBatchQueue.queueProxyLog({
        domainId: domain.id,
        hostname: domain.hostname,
        method: req.method,
        path: req.url,
        status: statusCode,
        responseTime: responseTime,
        ipAddress: clientIp,
        userAgent: req.headers['user-agent'] || null,
        level: logLevel
      });

      // Custom error pages for 404 / 502 / 503 from backend
      if (statusCode === 404 && domain.custom_404_page) {
        const html = this._renderCustomErrorPage(domain.custom_404_page, 404);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (statusCode === 502 && domain.custom_502_page) {
        const html = this._renderCustomErrorPage(domain.custom_502_page, 502);
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // Build response headers (copy from backend)
      const responseHeaders = { ...proxyRes.headers };

      if (isHtmlResponse && config.proxy.injectConsoleScript) {
        delete responseHeaders['content-length'];
        delete responseHeaders['content-encoding'];
        delete responseHeaders['transfer-encoding'];
        responseHeaders['content-type'] = responseHeaders['content-type'] || 'text/html; charset=utf-8';
      }

      // Sticky session: set cookie if enabled and we know the backend id
      if (domain.sticky_sessions_enabled && backendId) {
        const ttl = domain.sticky_sessions_ttl || 3600;
        const existing = responseHeaders['set-cookie'] || [];
        const cookieArr = Array.isArray(existing) ? existing : [existing];
        cookieArr.push(`__nebula_srv=${backendId}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Lax`);
        responseHeaders['set-cookie'] = cookieArr;
      }

      res.writeHead(proxyRes.statusCode, responseHeaders);

      if (isHtmlResponse && config.proxy.injectConsoleScript) {
        const chunks = [];
        proxyRes.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const injected = body.includes('</body>')
            ? body.replace('</body>', `${consoleScript}</body>`)
            : `${body}${consoleScript}`;
          res.end(injected);
        });
      } else {
        proxyRes.pipe(res);
      }

      // ── 7. TRAFFIC MIRRORING (fire-and-forget) ───────────────────────────
      if (domain.mirror_enabled && domain.mirror_backend_url) {
        this._fireMirrorRequest(req, domain.mirror_backend_url).catch(() => {});
      }
    });

    proxyReq.setTimeout(upstreamTimeoutMs, () => {
      const timeoutError = new Error(`Upstream request timeout after ${upstreamTimeoutMs}ms`);
      timeoutError.code = 'ETIMEDOUT';
      proxyReq.destroy(timeoutError);
    });

    proxyReq.on('error', (error) => {
      const responseTime = Date.now() - startTime;

      // Circuit breaker: failure
      circuitBreaker.onFailure(cbKey);

      console.error(`[ProxyManager] Backend error for ${domain.hostname}:`, error.message);

      database.createRequestLog({
        domainId: domain.id,
        hostname: domain.hostname,
        method: req.method,
        path: req.url.split('?')[0],
        queryString: req.url.includes('?') ? req.url.split('?')[1] : null,
        statusCode: 502,
        responseTime: responseTime,
        ipAddress: clientIp,
        userAgent: req.headers['user-agent'] || null,
        referer: req.headers['referer'] || req.headers['referrer'] || null,
        errorMessage: error.message,
        requestHeaders: {
          'content-type': req.headers['content-type'],
          'accept': req.headers['accept']
        }
      }).catch((err) => {
        console.error('[ProxyManager] Failed to write request log:', err);
      });

      database.createProxyLog({
        domainId: domain.id,
        hostname: domain.hostname,
        method: req.method,
        path: req.url,
        status: 502,
        responseTime: responseTime,
        ipAddress: clientIp,
        userAgent: req.headers['user-agent'] || null,
        level: 'error'
      }).catch((err) => {
        console.error('[ProxyManager] Failed to write proxy log:', err);
      });

      if (!res.headersSent) {
        const accept = String(req.headers.accept || '');
        const wantsHtml = accept.includes('text/html');
        if (wantsHtml) {
          // Use custom 502 page if configured, otherwise fall back to styled default
          const html = domain.custom_502_page
            ? this._renderCustomErrorPage(domain.custom_502_page, 502)
            : this._renderBadGatewayPage(domain.hostname);
          res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } else {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Bad Gateway',
            message: 'Upstream service unavailable'
          }));
        }
      }
    });

    // SECURITY: Enforce request body size limit (DOS prevention)
    const MAX_BODY_SIZE = config.proxy?.maxRequestBodySize || (100 * 1024 * 1024); // 100MB default
    let bytesReceived = 0;
    let bodySizeLimitExceeded = false;

    req.on('data', (chunk) => {
      bytesReceived += chunk.length;

      if (bytesReceived > MAX_BODY_SIZE && !bodySizeLimitExceeded) {
        bodySizeLimitExceeded = true;
        console.warn(`[HTTP Proxy ${domain.id}] Request body size limit exceeded: ${bytesReceived} bytes from ${clientIp}`);

        // Destroy both connections
        req.destroy();
        proxyReq.destroy();

        // Send 413 response if headers not sent
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Payload Too Large',
            message: `Request body exceeds maximum allowed size (${MAX_BODY_SIZE} bytes)`
          }));
        }
      }
    });

    // Pipe request body
    req.pipe(proxyReq);
  }

  /**
   * Parse a Cookie header string into a key→value object.
   * e.g. "a=1; b=2" → { a: '1', b: '2' }
   */
  _parseCookies(cookieHeader) {
    const result = {};
    if (!cookieHeader) return result;
    for (const pair of cookieHeader.split(';')) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key) result[key] = decodeURIComponent(val);
    }
    return result;
  }

  /**
   * Render a themed maintenance page for a domain.
   */
  _renderMaintenancePage(domain) {
    const safeHost = (domain.hostname || '').replace(/[<>"&]/g, '');
    const safeMsg  = (domain.maintenance_message || 'Service en maintenance. Veuillez réessayer plus tard.').replace(/[<>"&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]));
    let endInfo = '';
    if (domain.maintenance_end_time) {
      const end = new Date(domain.maintenance_end_time);
      endInfo = `<p class="eta">Reprise prévue : <strong>${end.toLocaleString()}</strong></p>`;
    }
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Maintenance — ${safeHost}</title>
<style>
  :root {
    color-scheme: dark;
    --background: #09090b;
    --surface: #18181b;
    --surface-2: #1f1f23;
    --border: #27272a;
    --border-strong: #3f3f46;
    --text: #fafafa;
    --muted: #a1a1aa;
    --subtle: #71717a;
    --accent: #f59e0b;
    --accent-strong: #fbbf24;
    --info: #22d3ee;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px 16px;
    color: var(--text);
    font-family: "Segoe UI", Tahoma, sans-serif;
    background:
      radial-gradient(1200px 600px at 8% -10%, rgba(255, 255, 255, 0.08), transparent 56%),
      radial-gradient(900px 480px at 92% -15%, rgba(255, 255, 255, 0.04), transparent 52%),
      var(--background);
  }
  .card {
    width: min(760px, 100%);
    border-radius: 24px;
    border: 1px solid var(--border);
    background: linear-gradient(180deg, rgba(24, 24, 27, 0.98) 0%, rgba(17, 17, 19, 0.98) 100%);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    padding: 24px;
  }
  .header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }
  .badge {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid rgba(245, 158, 11, 0.35);
    background: rgba(245, 158, 11, 0.12);
    color: var(--accent-strong);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 700;
  }
  h1 {
    margin: 0;
    font-size: clamp(28px, 4vw, 42px);
    line-height: 1.05;
    letter-spacing: -0.04em;
  }
  .subtitle {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.6;
    max-width: 62ch;
  }
  .content {
    padding-top: 18px;
    display: grid;
    gap: 16px;
  }
  .message {
    border-radius: 18px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03);
    padding: 18px;
  }
  .message p {
    margin: 0;
    color: var(--text);
    font-size: 15px;
    line-height: 1.7;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .tile {
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    padding: 16px;
  }
  .tile span {
    display: block;
    margin-bottom: 8px;
    color: var(--subtle);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .tile strong {
    display: block;
    color: var(--text);
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .button {
    appearance: none;
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    color: var(--text);
    padding: 11px 16px;
    border-radius: 14px;
    font-size: 13px;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }
  .button:hover {
    transform: translateY(-1px);
    border-color: #52525b;
    background: #27272a;
  }
  .button.primary {
    border-color: rgba(34, 211, 238, 0.35);
    background: rgba(34, 211, 238, 0.08);
    color: #a5f3fc;
  }
  .button.primary:hover {
    border-color: rgba(34, 211, 238, 0.5);
    background: rgba(34, 211, 238, 0.14);
  }
  footer {
    margin-top: 18px;
    color: var(--subtle);
    font-size: 11px;
    line-height: 1.5;
  }
  @media (max-width: 640px) {
    .card { padding: 18px; border-radius: 20px; }
    .grid { grid-template-columns: 1fr; }
  }
</style></head>
<body><div class="card"><div class="header"><div class="badge">Maintenance</div><h1>Service temporairement indisponible</h1><p class="subtitle">Le domaine est en maintenance ou le service est en cours de redémarrage. L’apparence suit le thème admin pour rester cohérente avec le panneau de gestion.</p></div><div class="content"><div class="message"><p>${safeMsg}</p>${endInfo}</div><div class="grid"><div class="tile"><span>Domaine</span><strong>${safeHost}</strong></div><div class="tile"><span>Plateforme</span><strong>NebulaProxy</strong></div></div><div class="actions"><button class="button primary" onclick="location.reload()">Rafraîchir</button><button class="button" onclick="history.back()">Retour</button></div></div><footer>Si le service reste indisponible, contactez l’administrateur. Timestamp: ${new Date().toISOString()}</footer></div></body></html>`;
  }

  /**
   * Wrap custom HTML error page content in a standard HTTP response.
   * The `html` is admin-defined content — render it as-is.
   */
  _renderCustomErrorPage(html, code) {
    return html;
  }

  /**
   * Fire-and-forget mirror request to shadowUrl.
   * Sends the same method + path as `req` but discards the response.
   */
  async _fireMirrorRequest(req, mirrorUrl) {
    try {
      let parsedUrl;
      try {
        parsedUrl = new URL(mirrorUrl);
      } catch {
        parsedUrl = new URL(`http://${mirrorUrl}`);
      }

      // Append the original path+query
      const targetPath = req.url || '/';
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: targetPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: parsedUrl.host,
          'X-Mirrored-From': req.headers.host || '',
          'X-Mirror': '1'
        },
        timeout: 5000 // 5s max for mirror requests
      };

      const proto = parsedUrl.protocol === 'https:' ? https : http;
      const mirrorReq = proto.request(options, (res) => {
        // Drain and discard mirror response
        res.resume();
      });
      mirrorReq.on('error', () => {}); // Swallow mirror errors silently
      mirrorReq.end();
    } catch (_) {
      // Mirror errors must never affect the real response
    }
  }

  _handleProxyCheck(req, res) {
    if (req.url !== '/.well-known/nebula-proxy') {
      return false;
    }

    const token = config.proxy.checkToken;
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
      'X-Nebula-Proxy': token
    });
    res.end(token);
    return true;
  }

  _renderBadGatewayPage(hostname) {
    const copy = config.proxy.badGatewayPage || {};
    const safeHost = escapeHtml(hostname || 'unknown-host');
    const htmlTitle = escapeHtml(copy.htmlTitle || 'Bad Gateway');
    const badge = escapeHtml(copy.badge || 'Bad Gateway');
    const title = escapeHtml(copy.title || 'Service amont indisponible');
    const subtitle = escapeHtml(copy.subtitle || "Le proxy ne peut pas joindre le backend pour ce domaine. L'ecran suit le meme theme que l'interface admin afin de garder une experience coherente.");
    const message = escapeHtml(copy.message || 'The backend server is temporarily unavailable');
    const domainLabel = escapeHtml(copy.domainLabel || 'Domaine');
    const proxyLabel = escapeHtml(copy.proxyLabel || 'Proxy');
    const proxyValue = escapeHtml(copy.proxyValue || 'NebulaProxy');
    const causeLabel = escapeHtml(copy.causeLabel || 'Cause');
    const causeValue = escapeHtml(copy.causeValue || 'Backend not reachable');
    const statusLabel = escapeHtml(copy.statusLabel || 'Statut');
    const statusValue = escapeHtml(copy.statusValue || '502 Service Unavailable');
    const retryButton = escapeHtml(copy.retryButton || 'Reessayer');
    const backButton = escapeHtml(copy.backButton || 'Retour');
    const footerText = escapeHtml(copy.footerText || "Contactez l'administrateur si le probleme persiste.");

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${htmlTitle}</title><style>
      :root {
        color-scheme: dark;
        --background: #09090b;
        --surface: #18181b;
        --surface-2: #1f1f23;
        --border: #27272a;
        --border-strong: #3f3f46;
        --text: #fafafa;
        --muted: #a1a1aa;
        --subtle: #71717a;
        --accent: #ef4444;
        --accent-strong: #f87171;
        --info: #22d3ee;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 16px;
        color: var(--text);
        font-family: "Segoe UI", Tahoma, sans-serif;
        background:
          radial-gradient(1200px 600px at 8% -10%, rgba(255, 255, 255, 0.08), transparent 56%),
          radial-gradient(900px 480px at 92% -15%, rgba(255, 255, 255, 0.04), transparent 52%),
          var(--background);
      }
      .card {
        width: min(760px, 100%);
        border-radius: 24px;
        border: 1px solid var(--border);
        background: linear-gradient(180deg, rgba(24, 24, 27, 0.98) 0%, rgba(17, 17, 19, 0.98) 100%);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        padding: 24px;
      }
      .header {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--border);
      }
      .badge {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.12);
        color: var(--accent-strong);
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        font-weight: 700;
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 42px);
        line-height: 1.05;
        letter-spacing: -0.04em;
      }
      .subtitle {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
        max-width: 68ch;
      }
      .content {
        padding-top: 18px;
        display: grid;
        gap: 16px;
      }
      .message {
        border-radius: 18px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.03);
        padding: 18px;
      }
      .message p {
        margin: 0;
        color: var(--text);
        font-size: 15px;
        line-height: 1.7;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .tile {
        border-radius: 18px;
        border: 1px solid var(--border);
        background: var(--surface-2);
        padding: 16px;
      }
      .tile span {
        display: block;
        margin-bottom: 8px;
        color: var(--subtle);
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      .tile strong {
        display: block;
        color: var(--text);
        font-size: 14px;
        line-height: 1.5;
        word-break: break-word;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .button {
        appearance: none;
        border: 1px solid var(--border-strong);
        background: var(--surface-2);
        color: var(--text);
        padding: 11px 16px;
        border-radius: 14px;
        font-size: 13px;
        cursor: pointer;
        transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
      }
      .button:hover {
        transform: translateY(-1px);
        border-color: #52525b;
        background: #27272a;
      }
      .button.primary {
        border-color: rgba(34, 211, 238, 0.35);
        background: rgba(34, 211, 238, 0.08);
        color: #a5f3fc;
      }
      .button.primary:hover {
        border-color: rgba(34, 211, 238, 0.5);
        background: rgba(34, 211, 238, 0.14);
      }
      footer {
        margin-top: 18px;
        color: var(--subtle);
        font-size: 11px;
        line-height: 1.5;
      }
      @media (max-width: 640px) {
        .card { padding: 18px; border-radius: 20px; }
        .grid { grid-template-columns: 1fr; }
      }
    </style></head><body><div class="card"><div class="header"><div class="badge">${badge}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="content"><div class="message"><p>${message}</p></div><div class="grid"><div class="tile"><span>${domainLabel}</span><strong>${safeHost}</strong></div><div class="tile"><span>${proxyLabel}</span><strong>${proxyValue}</strong></div><div class="tile"><span>${causeLabel}</span><strong>${causeValue}</strong></div><div class="tile"><span>${statusLabel}</span><strong>${statusValue}</strong></div></div><div class="actions"><button class="button primary" onclick="location.reload()">${retryButton}</button><button class="button" onclick="history.back()">${backButton}</button></div></div><footer>${footerText} Timestamp: ${new Date().toISOString()}</footer></div></body></html>`;
  }

  _renderBlockedPage(message, statusCode = 403) {
    const safeMessage = message || 'Access to this resource is forbidden.';
    const statusText = statusCode === 403 ? 'Forbidden' : statusCode === 401 ? 'Unauthorized' : 'Access Denied';
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${statusText}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b0c0f;
        --panel: rgba(22, 23, 34, 0.9);
        --border: rgba(255, 255, 255, 0.08);
        --text: #e6e7ef;
        --muted: rgba(255, 255, 255, 0.55);
        --accent: #c77dff;
        --accent-2: #22d3ee;
        --danger: #ef4444;
        --warning: #f59e0b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, sans-serif;
        background: radial-gradient(1200px 500px at 10% 10%, rgba(157, 78, 221, 0.15), transparent),
                    radial-gradient(900px 500px at 90% 20%, rgba(34, 211, 238, 0.12), transparent),
                    var(--bg);
        color: var(--text);
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 16px;
      }
      .card {
        width: min(720px, 100%);
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.3);
        color: #fbbf24;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 8px;
        font-weight: 300;
        font-size: 28px;
      }
      p {
        margin: 0 0 16px;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
      }
      .message-box {
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 16px;
        background: rgba(245, 158, 11, 0.05);
        margin-top: 18px;
      }
      .message-box p {
        margin: 0;
        color: var(--text);
      }
      .actions {
        margin-top: 22px;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .button {
        appearance: none;
        border: 1px solid rgba(157, 78, 221, 0.4);
        background: linear-gradient(135deg, rgba(157, 78, 221, 0.2), rgba(123, 44, 191, 0.15));
        color: #c77dff;
        padding: 10px 16px;
        border-radius: 12px;
        font-size: 13px;
        cursor: pointer;
        transition: 0.2s ease;
      }
      .button:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.25);
      }
      footer {
        margin-top: 26px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.35);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">${statusCode} ${statusText}</div>
      <h1>Access Denied</h1>
      <p>Your request has been blocked by the URL filtering system. Access to this resource is restricted.</p>
      <div class="message-box">
        <p>${safeMessage}</p>
      </div>
      <div class="actions">
        <button class="button" onclick="history.back()">Go back</button>
      </div>
      <footer>Contact your administrator for access. Timestamp: ${new Date().toISOString()}</footer>
    </div>
  </body>
</html>`;
  }

  _handleWebSocketUpgrade(req, socket, head, isTls) {
    const hostname = this._extractHostname(req.headers.host);
    const domain = this._findDomainByHostname(hostname, 'http');

    if (!domain) {
      socket.destroy();
      return;
    }

    if (domain.ssl_enabled && !isTls) {
      socket.destroy();
      return;
    }

    const clientIp = this._getRealClientIp(req);
    this._getWebSocketBackend(domain, clientIp).then((backend) => {
      websocketProxy.handleUpgrade(req, socket, head, backend, clientIp).catch((error) => {
        console.error('[ProxyManager] WebSocket upgrade failed:', error.message);
        try {
          socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        } catch (e) {}
        socket.destroy();
      });
    }).catch((error) => {
      console.error('[ProxyManager] WebSocket backend selection failed:', error.message);
      try {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      } catch (e) {}
      socket.destroy();
    });
  }

  async _getWebSocketBackend(domain, clientIp) {
    // Use load balancing if enabled
    const target = await this._selectBackendForDomain(domain, clientIp, 'http');
    const protocol = target.protocol ? target.protocol.replace(':', '') : 'http';

    return {
      target_host: target.hostname,
      target_port: Number(target.port),
      target_protocol: protocol
    };
  }

  /**
   * Find domain by hostname (with caching for performance)
   * SECURITY: O(1) lookup instead of O(n) to prevent performance DOS
   * @param {string} hostname
   * @param {string} [proxyType] - optional filter ('http', 'minecraft', etc.)
   */
  _findDomainByHostname(hostname, proxyType = null) {
    if (!hostname) return null;

    // Cache key includes type when specified so HTTP and Minecraft
    // domains with the same hostname don't collide in cache.
    const cacheKey = proxyType ? `${proxyType}:${hostname}` : hostname;

    // Check cache first
    const cached = this.domainCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.DOMAIN_CACHE_TTL) {
      return cached.domain;
    }

    // Cache miss - do lookup
    let found = null;
    for (const [domainId, entry] of this.proxies) {
      const typeMatch = proxyType
        ? entry.type === proxyType
        : (entry.type === 'http' || entry.type === 'minecraft');
      if (typeMatch && entry.meta.hostname === hostname) {
        found = entry.meta;
        break;
      }
    }

    // Only cache positive results to avoid stale "not found" errors
    if (found) {
      this.domainCache.set(cacheKey, {
        domain: found,
        timestamp: Date.now()
      });
    }

    return found;
  }

  /**
   * Invalidate domain cache (call when domain is added/removed/updated)
   */
  _invalidateDomainCache(hostname) {
    if (hostname) {
      // Remove both the plain key and all type-prefixed keys for this hostname
      this.domainCache.delete(hostname);
      for (const key of this.domainCache.keys()) {
        if (key.endsWith(`:${hostname}`)) {
          this.domainCache.delete(key);
        }
      }
    } else {
      // Clear entire cache
      this.domainCache.clear();
    }
  }

  // ==================== HELPERS ====================

  /**
   * Normalize IP address (remove IPv6 prefix)
   */
  _normalizeIp(ip) {
    if (!ip) return '';
    if (ip.startsWith('::ffff:')) return ip.replace('::ffff:', '');
    if (ip === '::1') return '127.0.0.1';
    return ip;
  }

    _extractHostname(hostHeader) {
      if (!hostHeader) return '';
      if (hostHeader.startsWith('[')) {
        const end = hostHeader.indexOf(']');
        if (end > -1) {
          return hostHeader.slice(1, end);
        }
      }
      return hostHeader.split(':')[0];
    }

    _shouldHandleRedirection(hostname) {
      if (!hostname) return false;
      if (!config.redirections.hosts.length) return false;
      return config.redirections.hosts.includes(hostname);
    }

    _handlePublicRedirection(req, res) {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length < 2 || segments[0] !== 'r') {
        return false;
      }

      const shortCode = segments[1];
      if (!shortCode) {
        console.warn('[ProxyManager] Redirection request missing short code');
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Redirection not found');
        return true;
      }

      console.log(`[ProxyManager] Redirection lookup host=${req.headers.host || ''} code=${shortCode}`);
      database.getRedirectionByShortCode(shortCode).then(async (redirection) => {
        if (!redirection) {
          console.warn(`[ProxyManager] Redirection not found code=${shortCode}`);
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Redirection not found');
          return;
        }

        try {
          await database.incrementRedirectionClicks(redirection.id);
        } catch (error) {
          console.warn('[ProxyManager] Failed to increment redirection clicks:', error.message);
        }

        console.log(`[ProxyManager] Redirection hit code=${shortCode} -> ${redirection.target_url}`);
        res.writeHead(301, { Location: redirection.target_url });
        res.end();
      }).catch((error) => {
        console.error('[ProxyManager] Failed to process redirection:', error.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to process redirection');
      });

      return true;
    }

  _isIpAddress(value) {
    return net.isIP(value) !== 0;
  }

  /**
   * Check if request comes from a trusted proxy
   * @param {string} ip - IP address to check
   * @returns {boolean} - True if IP is from trusted proxy
   */
  _isTrustedProxy(ip) {
    if (!ip) return false;

    // Get trusted proxies from config (CIDR notation supported)
    const trustedProxies = config.security?.trustedProxies || [];

    // If no trusted proxies configured, don't trust any proxy headers
    if (trustedProxies.length === 0) {
      return false;
    }

    // Normalize IP (remove IPv6 prefix if present)
    const normalizedIp = this._normalizeIp(ip);

    const ipv4ToInt = (value) => {
      const parts = String(value).split('.');
      if (parts.length !== 4) return null;
      const nums = parts.map((part) => Number.parseInt(part, 10));
      if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      return ((nums[0] << 24) >>> 0) + ((nums[1] << 16) >>> 0) + ((nums[2] << 8) >>> 0) + (nums[3] >>> 0);
    };

    // Check if IP matches any trusted proxy
    for (const trustedProxy of trustedProxies) {
      if (trustedProxy === normalizedIp) {
        return true;
      }

      // Check CIDR range with exact prefix matching
      if (trustedProxy.includes('/')) {
        const [network, bits] = trustedProxy.split('/');
        const prefixLength = parseInt(bits, 10);
        if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) continue;
        if (!normalizedIp.includes('.') || !network.includes('.')) continue;

        const ipInt = ipv4ToInt(normalizedIp);
        const networkInt = ipv4ToInt(network);
        if (ipInt === null || networkInt === null) continue;

        const mask = prefixLength === 0 ? 0 : ((0xffffffff << (32 - prefixLength)) >>> 0);
        if ((ipInt & mask) === (networkInt & mask)) return true;
      }
    }

    return false;
  }

  /**
   * Get the real client IP address, even behind proxies
   * SECURITY: Only trusts proxy headers if request comes from trusted proxy
   * Checks multiple proxy headers in order of priority
   */
  _getRealClientIp(req) {
    const remoteAddr = req.socket?.remoteAddress || req.connection?.remoteAddress;

    // If request does NOT come from trusted proxy, use socket IP directly
    if (!this._isTrustedProxy(remoteAddr)) {
      return this._normalizeIp(remoteAddr);
    }

    // Request is from trusted proxy - NOW we can trust proxy headers
    // Priority order for proxy headers
    const headers = [
      'cf-connecting-ip',      // Cloudflare
      'x-real-ip',             // Nginx
      'x-forwarded-for',       // Standard
      'x-client-ip',           // Apache
      'x-cluster-client-ip',   // Rackspace LB, Riverbed
      'forwarded-for',         // RFC 7239
      'forwarded'              // RFC 7239
    ];

    for (const header of headers) {
      const value = req.headers[header];
      if (value) {
        // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
        // The first one is the real client IP
        const ips = value.split(',').map(ip => ip.trim());
        const clientIp = ips[0];

        // Validate IP is not empty and normalize it
        if (clientIp && clientIp.length > 0) {
          return this._normalizeIp(clientIp);
        }
      }
    }

    // Fallback to socket remote address
    return this._normalizeIp(req.socket.remoteAddress);
  }

  /**
   * Select backend for a domain with load balancing support
   * If load balancing is disabled, returns the domain's default backend
   * @param {Object} domain - Domain configuration
   * @param {string} clientIp - Client IP for ip-hash algorithm
   * @param {string} protocol - Protocol type (http, tcp, udp, minecraft)
   * @returns {Object} { hostname, port, protocol }
   */
  async _selectBackendForDomain(domain, clientIp, protocol, opts = {}) {
    // Default port based on protocol
    const defaultPorts = {
      http: 80,
      https: 443,
      tcp: 443,
      udp: 53,
      minecraft: 25565
    };

    // FAST PATH: If load balancing is not enabled, use the default backend_url directly
    // This avoids querying the database entirely for simple single-backend domains
    if (!domain.load_balancing_enabled) {
      return loadBalancer.getBackendTarget(domain, null, protocol);
    }

    // OPTIMIZATION: Check local cache first (avoids database query 95% of the time)
    const now = Date.now();
    const cacheEntry = this.backendHealthCache.get(domain.id);
    let backends = null;

    if (cacheEntry && (now - cacheEntry.timestamp) < this.BACKEND_HEALTH_CACHE_TTL) {
      // Cache hit - use cached backends (valid for last 30 seconds)
      backends = cacheEntry.backends;
    } else {
      // Cache miss - query database for healthy backends
      backends = await database.getHealthyBackendsByDomainId(domain.id);
      
      // Update cache for next requests
      if (backends) {
        this.backendHealthCache.set(domain.id, {
          backends,
          timestamp: now
        });
      }
    }

    // If no backends configured, fall back to domain's default backend
    if (!backends || backends.length === 0) {
      return loadBalancer.getBackendTarget(domain, null, protocol);
    }

    // Select backend using load balancer
    const selectedBackend = loadBalancer.selectBackend(domain, backends, clientIp, opts);

    if (!selectedBackend) {
      // No healthy backend available, try domain's default
      console.warn(`[ProxyManager] No healthy backends for domain ${domain.id}, using default`);
      return loadBalancer.getBackendTarget(domain, null, protocol);
    }

    // Return selected backend target (attach the backend id for sticky sessions)
    const target = loadBalancer.getBackendTarget(domain, selectedBackend, protocol);
    target.backendId = selectedBackend.id;
    return target;
  }

  /**
   * Get proxy status for a domain
   */
  getProxyStatus(domainId) {
    const entry = this.proxies.get(domainId);
    if (!entry) {
      return { running: false };
    }

    return {
      running: true,
      type: entry.type,
      meta: {
        listen_port: entry.meta.external_port,
        target: `${entry.meta.backend_url}:${entry.meta.backend_port}`
      }
    };
  }

  /**
   * Get all proxies status
   */
  getAllProxiesStatus() {
    const statuses = [];
    for (const [domainId, entry] of this.proxies) {
      statuses.push({
        domain_id: domainId,
        type: entry.type,
        listen_port: entry.meta.external_port,
        target: `${entry.meta.backend_url}:${entry.meta.backend_port}`,
        hostname: entry.meta.hostname
      });
    }
    return statuses;
  }
}

// Export singleton instance
export const proxyManager = new ProxyManager();
