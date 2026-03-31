/**
 * LiveTrafficService - Real-time connection/request tracking per domain
 * Stores recent hits in Redis hashes with auto-expiry.
 * Fire-and-forget design: errors are silently suppressed.
 */

import { geoIpService } from './geoIpService.js';

const HASH_TTL_SEC  = 300;            // 5-minute TTL on the whole domain hash
const STALE_MS      = 5 * 60 * 1000; // Filter entries older than 5 min on read
const PREFIX        = 'live:traffic:';
const ACTIVE_SET    = 'live:traffic:active';

class LiveTrafficService {
  constructor() {
    this._redis = null;
  }

  init(redisClient) {
    this._redis = redisClient;
  }

  _key(domainId) {
    return `${PREFIX}${domainId}`;
  }

  /**
   * Record a hit from an IP on a domain.
   * Fire-and-forget — never throws.
   */
  async recordHit(domainId, ip, protocol, backend, bytes = 0) {
    const redis = this._redis;
    if (!redis || !domainId || !ip) return;
    try {
      const field = `${ip}|${protocol}`;
      const key   = this._key(domainId);
      const now   = Date.now();

      const raw = await redis.hget(key, field);
      let entry;
      if (raw) {
        entry          = JSON.parse(raw);
        entry.reqCount += 1;
        entry.bytes    += bytes;
        entry.lastSeen  = now;
        if (backend) entry.backend = backend;
        // Retry country lookup if it was missing (e.g. from a failed previous lookup)
        if (!entry.country) {
          try { entry.country = await geoIpService.getCountryCode(ip); } catch (_) {}
        }
      } else {
        // Lookup country (cached in Redis 24h by geoIpService)
        let country = null;
        try { country = await geoIpService.getCountryCode(ip); } catch (_) {}
        entry = { ip, country, protocol, backend: backend || null, reqCount: 1, bytes, firstSeen: now, lastSeen: now };
      }

      const pl = redis.pipeline();
      pl.hset(key, field, JSON.stringify(entry));
      pl.expire(key, HASH_TTL_SEC);
      pl.sadd(ACTIVE_SET, String(domainId));
      await pl.exec();
    } catch (_) {
      // silently ignore
    }
  }

  /**
   * Get recent connections for one domain.
   * Filters out entries not seen in the last 5 minutes.
   */
  async getForDomain(domainId) {
    const redis = this._redis;
    if (!redis) return [];
    try {
      const hash = await redis.hgetall(this._key(domainId));
      if (!hash) return [];
      const threshold = Date.now() - STALE_MS;
      return Object.values(hash)
        .map(v => { try { return JSON.parse(v); } catch (_) { return null; } })
        .filter(e => e && e.lastSeen > threshold)
        .sort((a, b) => b.lastSeen - a.lastSeen);
    } catch (_) {
      return [];
    }
  }

  /**
   * Get all recent connections across all domains.
   * Returns entries enriched with domainId.
   */
  async getAll() {
    const redis = this._redis;
    if (!redis) return [];
    try {
      const ids = await redis.smembers(ACTIVE_SET);
      if (!ids.length) return [];
      const result = [];
      for (const id of ids) {
        const entries = await this.getForDomain(id);
        for (const e of entries) {
          result.push({ ...e, domainId: parseInt(id, 10) });
        }
      }
      return result.sort((a, b) => b.lastSeen - a.lastSeen);
    } catch (_) {
      return [];
    }
  }

  async clearDomain(domainId) {
    const redis = this._redis;
    if (!redis) return;
    try {
      await redis.del(this._key(domainId));
      await redis.srem(ACTIVE_SET, String(domainId));
    } catch (_) {}
  }

  async clearAll() {
    const redis = this._redis;
    if (!redis) return;
    try {
      const ids = await redis.smembers(ACTIVE_SET);
      const pl  = redis.pipeline();
      for (const id of ids) pl.del(this._key(id));
      pl.del(ACTIVE_SET);
      await pl.exec();
    } catch (_) {}
  }

  /** Stats snapshot for display */
  async getStats() {
    const redis = this._redis;
    if (!redis) return { uniqueIps: 0, activeDomains: 0, totalReqs: 0 };
    try {
      const all = await this.getAll();
      const uniqueIps = new Set(all.map(e => e.ip)).size;
      const activeDomains = new Set(all.map(e => e.domainId)).size;
      const totalReqs = all.reduce((s, e) => s + e.reqCount, 0);
      return { uniqueIps, activeDomains, totalReqs };
    } catch (_) {
      return { uniqueIps: 0, activeDomains: 0, totalReqs: 0 };
    }
  }
}

export const liveTrafficService = new LiveTrafficService();
