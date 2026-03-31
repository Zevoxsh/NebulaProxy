/**
 * GeoIP Service — Country lookup for IP addresses
 *
 * Primary:  ipwho.is  (HTTPS, free, no key, no documented rate limit)
 * Fallback: ip-api.com (HTTP, free, 45 req/min)
 *
 * Results cached in Redis for 24 hours.
 * Private/reserved IPs always return null (not sent to any API).
 */

import https from 'https';
import http  from 'http';

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^localhost$/i,
  /^0\.0\.0\.0$/
];

// Simple HTTP/HTTPS GET helper — resolves with body string or null on error
function httpGet(opts, useHttps = true) {
  return new Promise((resolve) => {
    const lib = useHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

class GeoIpService {
  constructor() {
    this.redis        = null;
    this.CACHE_TTL    = 86400;   // 24h for successful lookups
    this.FAIL_TTL     = 90;      // 90s for failed lookups (retry soon)
    this.CACHE_PREFIX = 'geoip:';
    this.TIMEOUT      = 4000;
    this.pendingLookups = new Map();
  }

  init(redisClient) {
    this.redis = redisClient;
  }

  _isPrivateIp(ip) {
    if (!ip) return true;
    return PRIVATE_IP_PATTERNS.some(p => p.test(ip));
  }

  /**
   * Returns ISO 3166-1 alpha-2 country code (e.g. 'FR') or null.
   */
  async getCountryCode(ip) {
    if (!ip || this._isPrivateIp(ip)) return null;

    const cacheKey = this.CACHE_PREFIX + ip;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) return cached || null;
      } catch (_) {}
    }

    if (this.pendingLookups.has(ip)) return this.pendingLookups.get(ip);

    const promise = this._lookup(ip).then(async (code) => {
      if (this.redis) {
        try {
          await this.redis.setex(cacheKey, code ? this.CACHE_TTL : this.FAIL_TTL, code || '');
        } catch (_) {}
      }
      this.pendingLookups.delete(ip);
      return code;
    }).catch(() => {
      this.pendingLookups.delete(ip);
      return null;
    });

    this.pendingLookups.set(ip, promise);
    return promise;
  }

  /**
   * Try ipwho.is first, fall back to ip-api.com.
   */
  async _lookup(ip) {
    const code = await this._fetchIpwho(ip);
    if (code) return code;
    return this._fetchIpApi(ip);
  }

  /** ipwho.is — HTTPS, free, generous limits */
  async _fetchIpwho(ip) {
    try {
      const body = await httpGet({
        hostname: 'ipwho.is',
        path:     `/${encodeURIComponent(ip)}?fields=country_code,success`,
        method:   'GET',
        timeout:  this.TIMEOUT,
      }, true);
      if (!body) return null;
      const data = JSON.parse(body);
      if (data.success && data.country_code && data.country_code.length === 2) {
        return data.country_code.toUpperCase();
      }
      return null;
    } catch {
      return null;
    }
  }

  /** ip-api.com — HTTP fallback */
  async _fetchIpApi(ip) {
    try {
      const body = await httpGet({
        hostname: 'ip-api.com',
        path:     `/json/${encodeURIComponent(ip)}?fields=status,countryCode`,
        method:   'GET',
        timeout:  this.TIMEOUT,
      }, false);
      if (!body) return null;
      const data = JSON.parse(body);
      if (data.status === 'success' && data.countryCode) {
        return data.countryCode.toUpperCase();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check whether a request from `ip` should be blocked for `domain`.
   */
  async checkAccess(domain, ip) {
    if (!domain.geoip_blocking_enabled) {
      return { blocked: false, countryCode: null, reason: null };
    }

    const countryCode = await this.getCountryCode(ip);

    if (!countryCode) {
      return { blocked: false, countryCode: null, reason: null };
    }

    const allowList = domain.geoip_allowed_countries;
    const blockList = domain.geoip_blocked_countries;

    if (allowList && allowList.length > 0) {
      const allowed = allowList.includes(countryCode);
      return {
        blocked: !allowed,
        countryCode,
        reason: !allowed ? `Country ${countryCode} not in allowed list` : null
      };
    }

    if (blockList && blockList.length > 0) {
      const blocked = blockList.includes(countryCode);
      return {
        blocked,
        countryCode,
        reason: blocked ? `Country ${countryCode} is blocked` : null
      };
    }

    return { blocked: false, countryCode, reason: null };
  }

  async invalidate(ip) {
    if (this.redis) {
      try { await this.redis.del(this.CACHE_PREFIX + ip); } catch (_) {}
    }
  }
}

export const geoIpService = new GeoIpService();
