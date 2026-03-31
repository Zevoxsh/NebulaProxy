/**
 * GeoIP Service — Country lookup for IP addresses
 *
 * Uses ip-api.com (free tier — 45 req/min, no API key needed for HTTP).
 * Results are cached in Redis for 24 hours to stay well within rate limits.
 *
 * Blocking logic per domain:
 *   - If geoip_blocked_countries is set → deny listed countries (blacklist)
 *   - If geoip_allowed_countries is set → allow only listed countries (whitelist)
 *   - Whitelist takes precedence over blacklist when both are set.
 *
 * Private/reserved IPs always pass (not sent to ip-api).
 */

import http from 'http';

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
    this.redis = null;        // set via init()
    this.CACHE_TTL = 86400;  // 24 hours in seconds
    this.CACHE_PREFIX = 'geoip:';
    this.REQUEST_TIMEOUT = 3000; // 3s timeout — fail open
    this.pendingLookups = new Map(); // Dedup concurrent lookups for same IP
  }

  /**
   * Initialize with a Redis client instance.
   */
  init(redisClient) {
    this.redis = redisClient;
  }

  /**
   * Check whether an IP is a private / reserved address.
   */
  _isPrivateIp(ip) {
    if (!ip) return true;
    return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip));
  }

  /**
   * Look up the country code for an IP address.
   * Returns a 2-letter ISO country code (e.g. 'FR') or null on failure.
   */
  async getCountryCode(ip) {
    if (!ip || this._isPrivateIp(ip)) {
      return null; // Private IPs → no country → don't block
    }

    const cacheKey = this.CACHE_PREFIX + ip;

    // Check Redis cache
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) {
          return cached || null; // Empty string = lookup failed, treat as null
        }
      } catch (_) {
        // Redis unavailable → continue without cache
      }
    }

    // Dedup: if another request is already looking up this IP, wait for it
    if (this.pendingLookups.has(ip)) {
      return this.pendingLookups.get(ip);
    }

    const lookupPromise = this._fetchCountry(ip).then(async (code) => {
      if (this.redis) {
        try {
          if (code) {
            // Cache successful lookups for 24h
            await this.redis.setex(cacheKey, this.CACHE_TTL, code);
          } else {
            // Cache failures for 90s so the enrichment job can retry soon
            await this.redis.setex(cacheKey, 90, '');
          }
        } catch (_) {}
      }
      this.pendingLookups.delete(ip);
      return code;
    }).catch(() => {
      this.pendingLookups.delete(ip);
      return null;
    });

    this.pendingLookups.set(ip, lookupPromise);
    return lookupPromise;
  }

  /**
   * Fetch country code from ip-api.com.
   * Returns ISO country code string or null on error.
   */
  _fetchCountry(ip) {
    return new Promise((resolve) => {
      const options = {
        hostname: 'ip-api.com',
        path: `/json/${encodeURIComponent(ip)}?fields=status,countryCode`,
        method: 'GET',
        timeout: this.REQUEST_TIMEOUT
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.status === 'success' && data.countryCode) {
              resolve(data.countryCode.toUpperCase());
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  /**
   * Check whether a request from `ip` should be blocked for `domain`.
   *
   * Returns { blocked: boolean, countryCode: string|null, reason: string|null }
   */
  async checkAccess(domain, ip) {
    if (!domain.geoip_blocking_enabled) {
      return { blocked: false, countryCode: null, reason: null };
    }

    const countryCode = await this.getCountryCode(ip);

    if (!countryCode) {
      // Unknown country → fail open (don't block)
      return { blocked: false, countryCode: null, reason: null };
    }

    const allowList = domain.geoip_allowed_countries; // string[] or null
    const blockList = domain.geoip_blocked_countries; // string[] or null

    // Whitelist mode (takes precedence)
    if (allowList && allowList.length > 0) {
      const allowed = allowList.includes(countryCode);
      return {
        blocked: !allowed,
        countryCode,
        reason: !allowed ? `Country ${countryCode} not in allowed list` : null
      };
    }

    // Blacklist mode
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

  /**
   * Invalidate cache for a given IP (useful for testing).
   */
  async invalidate(ip) {
    if (this.redis) {
      try {
        await this.redis.del(this.CACHE_PREFIX + ip);
      } catch (_) {}
    }
  }
}

export const geoIpService = new GeoIpService();
