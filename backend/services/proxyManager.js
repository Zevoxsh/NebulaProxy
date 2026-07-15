// @ts-check
/**
 * ProxyManager - Core proxy management service
 *
 * Manages TCP, UDP, HTTP, and HTTPS proxies for NebulaProxy
 * Adapted from neb project with simplifications for NebulaProxy architecture
 */

import { EventEmitter } from 'events';
import { config } from '../config/config.js';
import { database } from './database.js';
import { logger } from '../utils/logger.js';


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

      // Per-IP TCP connection tracking: ip -> activeCount
      this.tcpConnectionsPerIp = new Map();

      // Timeouts
      this.TCP_TIMEOUT = config.tcpProxy.idleTimeoutMs;
      this.TCP_CONNECT_TIMEOUT = config.tcpProxy.connectTimeoutMs;
      this.TCP_KEEPALIVE_MS = config.tcpProxy.keepAliveMs;
      this.TCP_BACKLOG = config.tcpProxy.backlog;
      this.TCP_MAX_CONNECTIONS = config.tcpProxy.maxConnections;
      this.TCP_MAX_CONNECTIONS_PER_IP = config.tcpProxy.maxConnectionsPerIp;
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
    logger.info('[ProxyManager] Initialized');
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
      logger.warn(`[ProxyManager] Proxy ${domain.id} already running`);
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
      logger.error(`[ProxyManager] Failed to start proxy ${domain.id}:`, error.message);
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
      logger.warn(`[ProxyManager] Proxy ${id} not found`);
      return;
    }

    return new Promise((resolve) => {
      try {
        if (entry.type === 'udp') {
          // Close UDP server
          try {
            entry.server.close();
          } catch (e) {
            logger.error(`[ProxyManager] Error closing UDP server:`, e.message);
          }

          // Close all upstream sockets
          if (entry.upstreams) {
            for (const [clientKey, upstreamEntry] of entry.upstreams) {
              try {
                if (upstreamEntry.timeout) clearTimeout(upstreamEntry.timeout);
                upstreamEntry.upstream.close();
              } catch (e) {
                logger.error(`[ProxyManager] Error closing upstream for ${clientKey}:`, e.message);
              }
            }
          }

          this.proxies.delete(id);
          logger.info(`[ProxyManager] UDP proxy ${id} stopped`);
          resolve(true);
        } else if (entry.type === 'tcp') {
          // Close TCP server
          entry.server.close(() => {
            this.proxies.delete(id);
            logger.info(`[ProxyManager] TCP proxy ${id} stopped`);
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
          this._invalidateDomainCache(entry.meta?.hostname);
          this.proxies.delete(id);
          logger.info(`[ProxyManager] HTTP proxy ${id} unregistered`);
          resolve(true);
        } else if (entry.type === 'minecraft') {
          // Minecraft proxies are handled by shared server
          // Just remove from map
          this.proxies.delete(id);
          logger.info(`[ProxyManager] Minecraft proxy ${id} unregistered`);
          resolve(true);
        } else {
          this.proxies.delete(id);
          resolve(true);
        }
      } catch (error) {
        logger.error(`[ProxyManager] Error stopping proxy ${id}:`, error.message);
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
      await new Promise(resolve => { setTimeout(resolve, 10); });
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
            logger.warn(`[ProxyManager] startProxy failed for domain ${numId}, restored old entry:`, startErr.message);
          } else {
            logger.error(`[ProxyManager] startProxy failed for domain ${numId} (no old entry to restore):`, startErr.message);
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
    logger.info('[ProxyManager] Reloading all proxies from database...');

    const activeDomains = await database.getAllActiveDomains();
    const currentIds = Array.from(this.proxies.keys());
    const desiredIds = new Set(activeDomains.map(d => d.id));

    // Stop proxies that are no longer active
    for (const currentId of currentIds) {
      if (!desiredIds.has(currentId)) {
        try {
          await this.stopProxy(currentId);
        } catch (error) {
          logger.error(`[ProxyManager] Error stopping proxy ${currentId}:`, error.message);
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
        logger.error(`[ProxyManager] Error reloading proxy ${domain.id}:`, error.message);
        failed.push(domain);
      }
    }

    // Retry failed proxies once after a short delay (handles transient boot errors)
    if (failed.length > 0) {
      logger.info(`[ProxyManager] Retrying ${failed.length} failed proxies in 3s...`);
      await new Promise(r => { setTimeout(r, 3000); });
      for (const domain of failed) {
        try {
          await this.reloadProxy(domain.id);
          successCount++;
          logger.info(`[ProxyManager] Retry succeeded for proxy ${domain.id}`);
        } catch (error) {
          logger.error(`[ProxyManager] Retry failed for proxy ${domain.id}:`, error.message);
        }
      }
    }

    logger.info(`[ProxyManager] Reloaded ${successCount}/${activeDomains.length} proxies`);
  }

  /**
   * Stop all proxies
   */
  async stopAll() {
    logger.info('[ProxyManager] Stopping all proxies...');

    const ids = Array.from(this.proxies.keys());
    const promises = [];

    for (const id of ids) {
      promises.push(this.stopProxy(id));
    }

    await Promise.all(promises);
    logger.info('[ProxyManager] All proxies stopped');
  }

}

import { TcpProxy } from './proxy/tcpProxy.js';
import { UdpProxy } from './proxy/udpProxy.js';
import { MinecraftProxy } from './proxy/minecraftProxy.js';
import { HttpProxy } from './proxy/httpProxy.js';
import { ProxyHelpers } from './proxy/proxyHelpers.js';
const _proxyModules = [
  TcpProxy,
  UdpProxy,
  MinecraftProxy,
  HttpProxy,
  ProxyHelpers
];
for (const Mod of _proxyModules) {
  Object.getOwnPropertyNames(Mod.prototype)
    .filter(n => n !== 'constructor')
    .forEach(n => { ProxyManager.prototype[n] = Mod.prototype[n]; });
}


// Export singleton instance
export const proxyManager = new ProxyManager();
