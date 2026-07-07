// @ts-check
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
   * Locate this server itself, for the traffic-origin map's destination
   * point. Calling ipwho.is with no IP suffix resolves the caller's own
   * public IP — same trusted API already used per-request, just aimed at
   * ourselves. Cached long-term (server location practically never changes).
   */
  async getSelfLocation() {
    const cacheKey = this.CACHE_PREFIX + 'self';

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (_) {}
    }

    const location = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'ipwho.is',
        path:     '/',
        method:   'GET',
        headers:  { 'Accept': 'application/json' },
        timeout:  this.TIMEOUT,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.success === true && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
              resolve({ lat: data.latitude, lng: data.longitude, country: data.country_code || null });
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

    if (location && this.redis) {
      try { await this.redis.setex(cacheKey, this.CACHE_TTL * 7, JSON.stringify(location)); } catch (_) {}
    }

    return location;
  }

  /**
   * Force a fresh lookup for an IP (bypasses Redis cache).
   */
  async invalidate(ip) {
    if (this.redis) {
      try { await this.redis.del(this.CACHE_PREFIX + ip); } catch (_) {}
    }
  }

}

export const geoIpService = new GeoIpService();
