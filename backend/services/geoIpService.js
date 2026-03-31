/**
 * GeoIP Service — Country lookup via ipwho.is
 *
 * API: https://ipwho.is/{ip}  (free, HTTPS, no key, no documented rate limit)
 * Results cached in Redis: 24h on success, 90s on failure.
 * Private/reserved IPs always return null.
 */

import https from 'https';

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

class GeoIpService {
  constructor() {
    this.redis          = null;
    this.CACHE_TTL      = 86400;  // 24h for successes
    this.FAIL_TTL       = 90;     // 90s for failures — retry soon
    this.CACHE_PREFIX   = 'geoip:';
    this.TIMEOUT        = 5000;
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

    const promise = this._fetch(ip).then(async (code) => {
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
   * Fetch from ipwho.is — returns country code string or null.
   */
  _fetch(ip) {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'ipwho.is',
        path:     `/${encodeURIComponent(ip)}`,
        method:   'GET',
        headers:  { 'Accept': 'application/json' },
        timeout:  this.TIMEOUT,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.success === true && typeof data.country_code === 'string' && data.country_code.length === 2) {
              resolve(data.country_code.toUpperCase());
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error',   () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  /**
   * Force a fresh lookup for an IP (bypasses Redis cache).
   */
  async invalidate(ip) {
    if (this.redis) {
      try { await this.redis.del(this.CACHE_PREFIX + ip); } catch (_) {}
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
}

export const geoIpService = new GeoIpService();
