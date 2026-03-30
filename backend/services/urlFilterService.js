import net from 'net';
import { database } from './database.js';

/**
 * URL Filter Service
 * Handles URL pattern matching and filtering for proxy requests
 */
class UrlFilterService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 60000; // 1 minute
    this.regexTimeout = 100; // 100ms to prevent ReDoS
    // Compiled pattern cache — avoids recompiling RegExp on every request
    this.compiledPatterns = new Map();
    // In-flight query deduplication: domain_id -> Promise
    this.pendingQueries = new Map();
  }

  /**
   * Check if a URL should be blocked based on domain rules
   * @param {number} domainId - Domain ID
   * @param {string} path - URL path (without query string)
   * @param {string} method - HTTP method
   * @param {string} clientIp - Client IP address
   * @returns {Promise<{blocked: boolean, rule: Object|null, response: {code: number, message: string}}>}
   */
  async checkUrl(domainId, path, method = 'GET', clientIp = '') {
    try {
      const rules = await this.getRulesForDomain(domainId);

      if (!rules || rules.length === 0) {
        return { blocked: false, rule: null, response: null };
      }

      // Evaluate rules in priority order (highest first)
      for (const rule of rules) {
        const matches = this._ruleMatches(rule, path, clientIp);

        if (matches) {
          const allowedIps = Array.isArray(rule.allowed_ips) ? rule.allowed_ips : [];
          const hasAllowList = allowedIps.length > 0;
          const ipAllowed = this.isIpAllowed(clientIp, allowedIps);

          if (hasAllowList) {
            if (rule.action === 'allow' && !ipAllowed) {
              continue;
            }
            if (rule.action === 'block' && ipAllowed) {
              return { blocked: false, rule, response: null };
            }
          }

          if (rule.action === 'block') {
            return {
              blocked: true,
              rule,
              response: {
                code: rule.response_code || 403,
                message: rule.response_message || 'Access to this resource is forbidden.'
              }
            };
          } else if (rule.action === 'allow') {
            // Explicit allow - stop evaluation
            return { blocked: false, rule, response: null };
          }
        }
      }

      // No matching rules - default allow
      return { blocked: false, rule: null, response: null };
    } catch (error) {
      console.error('Error checking URL filter:', error);
      // On error, default to allow to prevent service disruption
      return { blocked: false, rule: null, response: null };
    }
  }

  /**
   * Match a path against a pattern
   * @param {string} path - URL path to test
   * @param {string} pattern - Pattern to match against
   * @param {string} type - Pattern type (exact, prefix, wildcard, regex)
   * @returns {boolean}
   */
  matchPattern(path, pattern, type) {
    try {
      switch (type) {
        case 'exact':
          return path === pattern;

        case 'prefix':
          return path === pattern || path.startsWith(pattern + '/');

        case 'wildcard': {
          // Compile once and cache to avoid recreating RegExp on every request
          const wildcardKey = `w:${pattern}`;
          if (!this.compiledPatterns.has(wildcardKey)) {
            const escaped = pattern
              .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*');
            this.compiledPatterns.set(wildcardKey, new RegExp(`^${escaped}$`));
          }
          return this.compiledPatterns.get(wildcardKey).test(path);
        }

        case 'regex':
          // Test regex with timeout to prevent ReDoS
          return this.testRegexWithTimeout(pattern, path, this.regexTimeout);

        default:
          console.warn(`Unknown pattern type: ${type}`);
          return false;
      }
    } catch (error) {
      console.error(`Error matching pattern: ${error.message}`, { pattern, type, path });
      return false;
    }
  }

  /**
   * Match client IP against rule pattern (single IP or CIDR)
   * @param {string} clientIp
   * @param {string} pattern
   * @param {'ip'|'cidr'} type
   * @returns {boolean}
   */
  matchIpPattern(clientIp, pattern, type) {
    const normalizedIp = this._normalizeIp(clientIp);
    if (!normalizedIp || !pattern) {
      return false;
    }

    if (type === 'ip') {
      return this._normalizeIp(pattern.trim()) === normalizedIp;
    }

    if (type === 'cidr') {
      return this._matchCidr(normalizedIp, pattern.trim());
    }

    return false;
  }

  /**
   * Test regex with timeout to prevent ReDoS attacks
   * @param {string} pattern - Regex pattern
   * @param {string} text - Text to test
   * @param {number} timeout - Timeout in milliseconds
   * @returns {boolean}
   */
  testRegexWithTimeout(pattern, text, timeout) {
    try {
      // Compile once and cache to avoid recreating RegExp on every request
      const regexKey = `r:${pattern}`;
      if (!this.compiledPatterns.has(regexKey)) {
        this.compiledPatterns.set(regexKey, new RegExp(pattern));
      }
      const regex = this.compiledPatterns.get(regexKey);

      let result = false;
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
      }, timeout);

      if (!timedOut) {
        result = regex.test(text);
      }

      clearTimeout(timeoutId);

      if (timedOut) {
        console.warn(`Regex timeout: ${pattern}`);
        return false;
      }

      return result;
    } catch (error) {
      console.error(`Invalid regex pattern: ${pattern}`, error);
      return false;
    }
  }

  /**
   * Get rules for a domain (with caching)
   * @param {number} domainId - Domain ID
   * @returns {Promise<Array>}
   */
  async getRulesForDomain(domainId) {
    const cacheKey = `domain_${domainId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.rules;
    }

    // Deduplicate concurrent DB queries for the same domain.
    // If a fetch is already in-flight, wait for it instead of issuing a new one.
    if (this.pendingQueries.has(cacheKey)) {
      try {
        return await this.pendingQueries.get(cacheKey);
      } catch {
        // If the shared query failed, fall through to stale cache below.
      }
      const afterWait = this.cache.get(cacheKey);
      if (afterWait) return afterWait.rules;
      return [];
    }

    const queryPromise = (async () => {
      const result = await database.pgPool.query(
        `SELECT * FROM url_blocking_rules
         WHERE domain_id = $1 AND is_active = TRUE
         ORDER BY priority DESC, id ASC`,
        [domainId]
      );
      return result.rows;
    })();

    this.pendingQueries.set(cacheKey, queryPromise);

    try {
      const rows = await queryPromise;
      this.cache.set(cacheKey, { rules: rows, timestamp: Date.now() });
      return rows;
    } catch (error) {
      // If we have stale cached data, serve it silently rather than flooding logs.
      if (cached) {
        // Only log at most once per TTL window to avoid log spam.
        const now = Date.now();
        const lastWarn = this._lastDbWarn?.get(cacheKey) || 0;
        if (now - lastWarn > this.cacheTTL) {
          console.warn(`[UrlFilter] DB unavailable for domain ${domainId}, serving stale cache:`, error.message);
          if (!this._lastDbWarn) this._lastDbWarn = new Map();
          this._lastDbWarn.set(cacheKey, now);
        }
        return cached.rules;
      }
      console.error('Error fetching URL blocking rules:', error);
      return [];
    } finally {
      this.pendingQueries.delete(cacheKey);
    }
  }

  /**
   * Invalidate cache for a domain
   * @param {number} domainId - Domain ID
   */
  invalidateCache(domainId) {
    const cacheKey = `domain_${domainId}`;
    this.cache.delete(cacheKey);
    console.log(`Cache invalidated for domain ${domainId}`);
  }

  /**
   * Invalidate all cache
   */
  invalidateAllCache() {
    this.cache.clear();
    // Also clear compiled patterns since rules (and their patterns) may have changed
    this.compiledPatterns.clear();
    console.log('All URL filter cache cleared');
  }

  /**
   * Validate a pattern before saving
   * @param {string} pattern - Pattern to validate
   * @param {string} type - Pattern type
   * @returns {{valid: boolean, error: string|null}}
   */
  validatePattern(pattern, type) {
    if (!pattern || typeof pattern !== 'string') {
      return { valid: false, error: 'Pattern must be a non-empty string' };
    }

    if (type === 'regex') {
      try {
        new RegExp(pattern);
        return { valid: true, error: null };
      } catch (error) {
        return { valid: false, error: `Invalid regex: ${error.message}` };
      }
    }

    if (type === 'ip') {
      const ip = this._normalizeIp(pattern.trim());
      if (net.isIP(ip) === 0) {
        return { valid: false, error: 'Invalid IP address format' };
      }
      return { valid: true, error: null };
    }

    if (type === 'cidr') {
      if (!this._parseCidr(pattern.trim())) {
        return { valid: false, error: 'Invalid CIDR format (example: 192.168.1.0/24)' };
      }
      return { valid: true, error: null };
    }

    return { valid: true, error: null };
  }

  _ruleMatches(rule, path, clientIp) {
    if (rule.pattern_type === 'ip' || rule.pattern_type === 'cidr') {
      return this.matchIpPattern(clientIp, rule.pattern, rule.pattern_type);
    }
    return this.matchPattern(path, rule.pattern, rule.pattern_type);
  }

  /**
   * Check if a client IP is blocked/allowed for non-HTTP flows (TCP/UDP/Minecraft)
   * @param {number} domainId
   * @param {string} clientIp
   * @returns {Promise<{blocked: boolean, rule: Object|null, response: {code: number, message: string}|null}>}
   */
  async checkNetworkAccess(domainId, clientIp = '') {
    try {
      const rules = await this.getRulesForDomain(domainId);

      if (!rules || rules.length === 0) {
        return { blocked: false, rule: null, response: null };
      }

      for (const rule of rules) {
        if (rule.pattern_type !== 'ip' && rule.pattern_type !== 'cidr') {
          continue;
        }

        const matches = this.matchIpPattern(clientIp, rule.pattern, rule.pattern_type);
        if (!matches) {
          continue;
        }

        if (rule.action === 'block') {
          return {
            blocked: true,
            rule,
            response: {
              code: 403,
              message: rule.response_message || 'Access denied for this IP address.'
            }
          };
        }

        if (rule.action === 'allow') {
          return { blocked: false, rule, response: null };
        }
      }

      return { blocked: false, rule: null, response: null };
    } catch (error) {
      console.error('Error checking network access rules:', error);
      return { blocked: false, rule: null, response: null };
    }
  }

  /**
   * Validate allowed IPs list
   * @param {string[]|undefined} allowedIps
   * @returns {{valid: boolean, error: string|null}}
   */
  validateAllowedIps(allowedIps) {
    if (allowedIps === undefined || allowedIps === null) {
      return { valid: true, error: null };
    }

    if (!Array.isArray(allowedIps)) {
      return { valid: false, error: 'Allowed IPs must be an array of IPs or CIDR ranges' };
    }

    for (const entry of allowedIps) {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        return { valid: false, error: 'Allowed IP entries must be non-empty strings' };
      }

      if (!this._isValidIpOrCidr(entry.trim())) {
        return { valid: false, error: `Invalid IP or CIDR: ${entry}` };
      }
    }

    return { valid: true, error: null };
  }

  /**
   * Check if a client IP is allowed by the allowlist
   * @param {string} clientIp
   * @param {string[]} allowedIps
   * @returns {boolean}
   */
  isIpAllowed(clientIp, allowedIps) {
    if (!allowedIps || allowedIps.length === 0) {
      return true;
    }

    if (!clientIp) {
      return false;
    }

    const normalizedIp = this._normalizeIp(clientIp);
    if (!normalizedIp) {
      return false;
    }

    for (const entry of allowedIps) {
      const value = entry.trim();
      if (!value) continue;

      if (value.includes('/')) {
        if (this._matchCidr(normalizedIp, value)) {
          return true;
        }
      } else if (this._normalizeIp(value) === normalizedIp) {
        return true;
      }
    }

    return false;
  }

  _normalizeIp(ip) {
    if (!ip) return '';
    if (ip === '::1') return '127.0.0.1';
    if (ip.startsWith('::ffff:')) {
      const ipv4 = ip.slice(7);
      return net.isIP(ipv4) === 4 ? ipv4 : ip;
    }
    return ip;
  }

  _isValidIpOrCidr(value) {
    if (!value) return false;
    if (value.includes('/')) {
      const parsed = this._parseCidr(value);
      return parsed !== null;
    }
    return net.isIP(this._normalizeIp(value)) !== 0;
  }

  _parseCidr(value) {
    const [base, prefixStr] = value.split('/');
    if (!base || prefixStr === undefined) return null;

    const normalizedBase = this._normalizeIp(base.trim());
    const version = net.isIP(normalizedBase);
    if (!version) return null;

    const prefix = Number(prefixStr);
    if (!Number.isInteger(prefix)) return null;

    if (version === 4 && (prefix < 0 || prefix > 32)) return null;
    if (version === 6 && (prefix < 0 || prefix > 128)) return null;

    return { base: normalizedBase, prefix, version };
  }

  _matchCidr(ip, cidr) {
    const parsed = this._parseCidr(cidr);
    if (!parsed) return false;

    const normalizedIp = this._normalizeIp(ip);
    const ipVersion = net.isIP(normalizedIp);
    if (!ipVersion || ipVersion !== parsed.version) return false;

    if (parsed.version === 4) {
      const ipInt = this._ipv4ToInt(normalizedIp);
      const baseInt = this._ipv4ToInt(parsed.base);
      const mask = parsed.prefix === 0 ? 0 : (~((1 << (32 - parsed.prefix)) - 1)) >>> 0;
      return (ipInt & mask) === (baseInt & mask);
    }

    const ipBig = this._ipv6ToBigInt(normalizedIp);
    const baseBig = this._ipv6ToBigInt(parsed.base);
    if (ipBig === null || baseBig === null) return false;

    const shift = BigInt(128 - parsed.prefix);
    const ipMasked = (ipBig >> shift) << shift;
    const baseMasked = (baseBig >> shift) << shift;
    return ipMasked === baseMasked;
  }

  _ipv4ToInt(ip) {
    const parts = ip.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) return 0;
    return (
      ((parts[0] << 24) >>> 0) +
      ((parts[1] << 16) >>> 0) +
      ((parts[2] << 8) >>> 0) +
      (parts[3] >>> 0)
    ) >>> 0;
  }

  _ipv6ToBigInt(ip) {
    const normalized = ip.toLowerCase();
    const hasIpv4 = normalized.includes('.');
    let address = normalized;

    if (hasIpv4) {
      const lastColon = normalized.lastIndexOf(':');
      if (lastColon === -1) return null;
      const ipv4Part = normalized.slice(lastColon + 1);
      const ipv4Int = this._ipv4ToInt(ipv4Part);
      const high = ((ipv4Int >>> 16) & 0xffff).toString(16);
      const low = (ipv4Int & 0xffff).toString(16);
      address = `${normalized.slice(0, lastColon)}:${high}:${low}`;
    }

    const pieces = address.split('::');
    if (pieces.length > 2) return null;

    const left = pieces[0] ? pieces[0].split(':').filter(Boolean) : [];
    const right = pieces[1] ? pieces[1].split(':').filter(Boolean) : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;

    const groups = [...left, ...Array(missing).fill('0'), ...right];
    if (groups.length !== 8) return null;

    let result = 0n;
    for (const group of groups) {
      const value = parseInt(group, 16);
      if (Number.isNaN(value) || value < 0 || value > 0xffff) {
        return null;
      }
      result = (result << 16n) + BigInt(value);
    }

    return result;
  }
}

// Export singleton instance
export const urlFilterService = new UrlFilterService();
