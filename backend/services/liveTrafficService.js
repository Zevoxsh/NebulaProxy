/**
 * LiveTrafficService - Real-time connection/request tracking per domain
 * Stores hits in Redis hashes with a hard retention window.
 * Fire-and-forget design: errors are silently suppressed.
 */

import { geoIpService } from './geoIpService.js';

const RETENTION_DAYS = Math.max(1, parseInt(process.env.LIVE_TRAFFIC_RETENTION_DAYS || '30', 10) || 30);
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const HASH_TTL_SEC = RETENTION_DAYS * 24 * 60 * 60;
const CLEANUP_INTERVAL_MS = Math.max(60_000, parseInt(process.env.LIVE_TRAFFIC_CLEANUP_INTERVAL_MS || '3600000', 10) || 3600000);
const PREFIX = 'live:traffic:';
const ACTIVE_SET = 'live:traffic:active';

class LiveTrafficService {
  constructor() {
    this._redis = null;
  }

  init(redisClient) {
    this._redis = redisClient;
    // Periodically enrich entries that are missing country codes
    setInterval(() => this._enrichMissingCountries(), 30_000);
    // Hard retention: prune entries older than configured window
    setInterval(() => this._cleanupExpiredEntries(), CLEANUP_INTERVAL_MS);
  }

  _key(domainId) {
    return `${PREFIX}${domainId}`;
  }

  _isExpired(entry, now = Date.now()) {
    const lastSeen = Number(entry?.lastSeen || 0);
    return !lastSeen || (now - lastSeen) > RETENTION_MS;
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
        try {
          entry = JSON.parse(raw);
        } catch (_) {
          entry = null;
        }
        if (entry && !this._isExpired(entry, now)) {
          entry.reqCount += 1;
          entry.bytes += bytes;
          entry.lastSeen = now;
          if (backend) entry.backend = backend;
          // Retry country lookup if it was missing
          if (!entry.country) {
            try { entry.country = await geoIpService.getCountryCode(ip); } catch (_) {}
          }
        } else {
          let country = null;
          try { country = await geoIpService.getCountryCode(ip); } catch (_) {}
          entry = { ip, country, protocol, backend: backend || null, reqCount: 1, bytes, firstSeen: now, lastSeen: now };
        }
      } else {
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
   * Get all connections for one domain — no time filtering, keeps full history.
   */
  async getForDomain(domainId) {
    const redis = this._redis;
    if (!redis) return [];
    try {
      const now = Date.now();
      const hash = await redis.hgetall(this._key(domainId));
      if (!hash) return [];
      return Object.values(hash)
        .map(v => { try { return JSON.parse(v); } catch (_) { return null; } })
        .filter(v => v && !this._isExpired(v, now))
        .filter(Boolean)
        .sort((a, b) => b.lastSeen - a.lastSeen);
    } catch (_) {
      return [];
    }
  }

  /**
   * Get all connections across all domains.
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

  /**
   * Background job: scan all active domains and fill in missing country codes.
   * Runs every 30s — throttled to ~40 req/min to stay within ip-api.com free tier.
   */
  async _enrichMissingCountries() {
    const redis = this._redis;
    if (!redis) return;
    try {
      const ids = await redis.smembers(ACTIVE_SET);

      // Collect all entries missing a country across all domains
      const toEnrich = []; // [{ key, field, entry }]
      for (const id of ids) {
        const key  = this._key(id);
        const hash = await redis.hgetall(key);
        if (!hash) continue;
        for (const [field, raw] of Object.entries(hash)) {
          let entry;
          try { entry = JSON.parse(raw); } catch (_) { continue; }
          if (this._isExpired(entry)) continue;
          if (!entry.country) toEnrich.push({ key, field, entry });
        }
      }

      // Throttle: one lookup per 500ms — ipwho.is has no strict rate limit
      for (const item of toEnrich) {
        // Invalidate cached failure so getCountryCode actually hits the API
        try { await geoIpService.invalidate(item.entry.ip); } catch (_) {}

        let country = null;
        try { country = await geoIpService.getCountryCode(item.entry.ip); } catch (_) {}

        if (country) {
          item.entry.country = country;
          try { await redis.hset(item.key, item.field, JSON.stringify(item.entry)); } catch (_) {}
        }
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (_) {}
  }

  async _cleanupExpiredEntries() {
    const redis = this._redis;
    if (!redis) return;
    const now = Date.now();
    try {
      const ids = await redis.smembers(ACTIVE_SET);
      for (const id of ids) {
        const key = this._key(id);
        const hash = await redis.hgetall(key);
        if (!hash || Object.keys(hash).length === 0) {
          await redis.srem(ACTIVE_SET, String(id));
          continue;
        }

        const toDelete = [];
        let keepCount = 0;
        for (const [field, raw] of Object.entries(hash)) {
          let entry;
          try {
            entry = JSON.parse(raw);
          } catch (_) {
            toDelete.push(field);
            continue;
          }

          if (this._isExpired(entry, now)) {
            toDelete.push(field);
          } else {
            keepCount += 1;
          }
        }

        if (toDelete.length > 0) {
          const delPipe = redis.pipeline();
          for (const field of toDelete) delPipe.hdel(key, field);
          await delPipe.exec();
        }

        if (keepCount === 0) {
          const purgePipe = redis.pipeline();
          purgePipe.del(key);
          purgePipe.srem(ACTIVE_SET, String(id));
          await purgePipe.exec();
        } else {
          await redis.expire(key, HASH_TTL_SEC);
        }
      }
    } catch (_) {
      // silently ignore
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

  /** Stats snapshot */
  async getStats() {
    const redis = this._redis;
    if (!redis) return { uniqueIps: 0, activeDomains: 0, totalReqs: 0 };
    try {
      const all = await this.getAll();
      const uniqueIps     = new Set(all.map(e => e.ip)).size;
      const activeDomains = new Set(all.map(e => e.domainId)).size;
      const totalReqs     = all.reduce((s, e) => s + e.reqCount, 0);
      return { uniqueIps, activeDomains, totalReqs };
    } catch (_) {
      return { uniqueIps: 0, activeDomains: 0, totalReqs: 0 };
    }
  }
}

export const liveTrafficService = new LiveTrafficService();
