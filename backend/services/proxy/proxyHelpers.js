// Auto-extracted from proxyManager.js — do not edit directly.
// Mixed into ProxyManager.prototype in proxyManager.js.


import net from 'net';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/config.js';
import { database } from '../database.js';
import { loadBalancer } from '../loadBalancer.js';

export class ProxyHelpers {
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

_normalizeHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return '';
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

_matchesHostname(registeredHostname, requestedHostname) {
  if (!registeredHostname || !requestedHostname) return false;

  const matched = registeredHostname === requestedHostname;
  if (logger.isLevelEnabled('debug')) {
    logger.debug(`[ProxyManager] hostname match registered=${registeredHostname} requested=${requestedHostname} match=${matched ? 'yes' : 'no'}`);
  }
  return matched;
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
      logger.warn('[ProxyManager] Redirection request missing short code');
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Redirection not found');
      return true;
    }

    logger.info(`[ProxyManager] Redirection lookup host=${req.headers.host || ''} code=${shortCode}`);
    database.getRedirectionByShortCode(shortCode).then(async (redirection) => {
      if (!redirection) {
        logger.warn(`[ProxyManager] Redirection not found code=${shortCode}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Redirection not found');
        return;
      }

      try {
        await database.incrementRedirectionClicks(redirection.id);
      } catch (error) {
        logger.warn('[ProxyManager] Failed to increment redirection clicks:', error.message);
      }

      logger.info(`[ProxyManager] Redirection hit code=${shortCode} -> ${redirection.target_url}`);
      res.writeHead(301, { Location: redirection.target_url });
      res.end();
    }).catch((error) => {
      logger.error('[ProxyManager] Failed to process redirection:', error.message);
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
    logger.warn(`[ProxyManager] No healthy backends for domain ${domain.id}, using default`);
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

  const listenPort = entry.meta.external_port_end && entry.meta.external_port_end > entry.meta.external_port
    ? `${entry.meta.external_port}-${entry.meta.external_port_end}`
    : entry.meta.external_port;

  return {
    running: true,
    type: entry.type,
    meta: {
      listen_port: listenPort,
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
