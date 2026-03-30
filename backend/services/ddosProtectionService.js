import https from 'https';
import http from 'http';
import { database } from './database.js';

const BLOCKLIST_SOURCES = [
  { key: 'blocklist_de',     url: 'https://lists.blocklist.de/lists/all.txt' },
  { key: 'emerging_threats', url: 'https://rules.emergingthreats.net/blockrules/compromised-ips.txt' },
  { key: 'ci_badguys',       url: 'https://cinsscore.com/list/ci-badguys.txt' }
];

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function isPrivateIp(ip) {
  if (!ip) return true;
  const cleaned = ip.replace(/^::ffff:/, '');
  return (
    cleaned === '127.0.0.1' ||
    cleaned === 'localhost' ||
    cleaned.startsWith('10.') ||
    cleaned.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(cleaned) ||
    cleaned.startsWith('::1')
  );
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
  });
}

function parseIpList(text) {
  const ips = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    // Extract IP (may have CIDR notation - take the IP part only for exact match)
    const ip = trimmed.split(/[\s,;#]/)[0].split('/')[0].trim();
    if (ip && /^[\d.:a-fA-F]+$/.test(ip)) {
      ips.add(ip);
    }
  }
  return ips;
}

class DdosProtectionService {
  constructor() {
    this.redis = null;
    this._syncTimer = null;
    // L1 in-process caches for hot path (rebuilt every sync)
    this._blocklistCache = new Set();
    this._banCache = new Map(); // ip -> { global: expiresAt|null, domains: Map<domainId, expiresAt|null> }
    this._initialized = false;
  }

  async init(redisClient) {
    this.redis = redisClient;
    this._initialized = true;
    // Initial sync (non-blocking, don't block server startup)
    this.syncAllBlocklists().catch(err => console.error('[DDoS] Initial blocklist sync failed:', err.message));
    // Schedule periodic sync
    this._syncTimer = setInterval(() => {
      this.syncAllBlocklists().catch(err => console.error('[DDoS] Periodic blocklist sync failed:', err.message));
    }, SYNC_INTERVAL_MS);
    console.log('[DDoS] Protection service initialized');
  }

  async syncAllBlocklists() {
    console.log('[DDoS] Syncing threat intelligence blocklists...');
    let totalIps = 0;
    const combined = new Set();

    for (const source of BLOCKLIST_SOURCES) {
      try {
        const text = await fetchUrl(source.url);
        const ips = parseIpList(text);
        totalIps += ips.size;

        // Store in Redis SET (rebuild atomically)
        const redisKey = `ddos:blocklist:${source.key}`;
        if (this.redis && ips.size > 0) {
          const pipeline = this.redis.pipeline();
          pipeline.del(redisKey);
          // Batch SADD in chunks of 1000
          const arr = Array.from(ips);
          for (let i = 0; i < arr.length; i += 1000) {
            pipeline.sadd(redisKey, ...arr.slice(i, i + 1000));
          }
          pipeline.expire(redisKey, 25 * 3600); // 25h TTL
          await pipeline.exec();
        }

        // Add to combined
        for (const ip of ips) combined.add(ip);

        // Update DB metadata
        try {
          await database.execute(
            `UPDATE ddos_blocklist_meta SET last_fetched = NOW(), ip_count = $1, last_error = NULL, updated_at = NOW() WHERE source = $2`,
            [ips.size, source.key]
          );
        } catch (_) {}

        console.log(`[DDoS] ${source.key}: loaded ${ips.size} IPs`);
      } catch (err) {
        console.error(`[DDoS] Failed to sync ${source.key}:`, err.message);
        try {
          await database.execute(
            `UPDATE ddos_blocklist_meta SET last_error = $1, updated_at = NOW() WHERE source = $2`,
            [err.message, source.key]
          );
        } catch (_) {}
      }
    }

    // Rebuild L1 cache
    this._blocklistCache = combined;
    console.log(`[DDoS] Blocklist sync complete. Total unique IPs: ${combined.size}`);
    return { totalIps: combined.size };
  }

  /**
   * Hot-path check: O(1) using L1 in-process cache
   * Returns { blocked: boolean, reason?: string }
   */
  async check(ip, domainId, domain) {
    if (!domain?.ddos_protection_enabled) return { blocked: false };
    if (!ip || isPrivateIp(ip)) return { blocked: false };

    const cleanIp = ip.replace(/^::ffff:/, '');

    // 1. L1 blocklist cache check (synchronous, microsecond)
    if (this._blocklistCache.has(cleanIp)) {
      // Auto-ban this IP in Redis and DB for future fast lookup
      this._banIpAsync(cleanIp, domainId, 'blocklist', 'auto', null); // permanent ban for blocklist IPs
      return { blocked: true, reason: 'blocklist' };
    }

    // 2. Check Redis ban (global)
    try {
      if (this.redis) {
        const globalBan = await this.redis.get(`ddos:ban:global:${cleanIp}`);
        if (globalBan) return { blocked: true, reason: `banned: ${globalBan}` };

        if (domainId) {
          const domainBan = await this.redis.get(`ddos:ban:domain:${domainId}:${cleanIp}`);
          if (domainBan) return { blocked: true, reason: `banned: ${domainBan}` };
        }
      }
    } catch (err) {
      // Fail open
    }

    // 3. Rate check
    return this._checkRate(cleanIp, domainId, domain);
  }

  async _checkRate(ip, domainId, domain) {
    if (!this.redis || !domainId) return { blocked: false };

    const threshold = domain?.ddos_req_per_second || 100;
    const banDuration = domain?.ddos_ban_duration_sec || 3600;
    const slotKey = Math.floor(Date.now() / 1000);
    const key1 = `ddos:rate:${domainId}:${ip}:${slotKey}`;
    const key2 = `ddos:rate:${domainId}:${ip}:${slotKey - 1}`;

    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(key1);
      pipeline.expire(key1, 5);
      pipeline.get(key2);
      const results = await pipeline.exec();
      const current = parseInt(results[0][1] || 0);
      const previous = parseInt(results[2][1] || 0);
      const total = current + previous;

      if (total > threshold) {
        await this.banIp(ip, domainId, 'rate-limit', 'auto', banDuration);
        return { blocked: true, reason: `rate-limit (${total} req/s > ${threshold})` };
      }
    } catch (err) {
      // Fail open
    }

    return { blocked: false };
  }

  /**
   * Ban an IP (public method, also called by admin API)
   */
  async banIp(ip, domainId, reason, bannedBy, durationSec) {
    const cleanIp = ip.replace(/^::ffff:/, '');
    const expiresAt = durationSec ? new Date(Date.now() + durationSec * 1000) : null;
    const ttl = durationSec || 0;

    try {
      if (this.redis) {
        const redisKey = domainId
          ? `ddos:ban:domain:${domainId}:${cleanIp}`
          : `ddos:ban:global:${cleanIp}`;
        if (ttl > 0) {
          await this.redis.setex(redisKey, ttl, reason);
        } else {
          await this.redis.set(redisKey, reason);
        }
      }
    } catch (_) {}

    try {
      await database.execute(
        `INSERT INTO ddos_ip_bans (ip_address, domain_id, reason, banned_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [cleanIp, domainId || null, reason, bannedBy, expiresAt]
      );
    } catch (_) {}
  }

  _banIpAsync(ip, domainId, reason, bannedBy, durationSec) {
    this.banIp(ip, domainId, reason, bannedBy, durationSec).catch(() => {});
  }

  async unbanIp(id) {
    // Get the ban record first
    const result = await database.execute(
      `UPDATE ddos_ip_bans SET expires_at = NOW() WHERE id = $1 RETURNING ip_address, domain_id`,
      [id]
    );
    const ban = result?.rows?.[0];
    if (!ban) return;

    try {
      if (this.redis) {
        const redisKey = ban.domain_id
          ? `ddos:ban:domain:${ban.domain_id}:${ban.ip_address}`
          : `ddos:ban:global:${ban.ip_address}`;
        await this.redis.del(redisKey);
      }
    } catch (_) {}
  }

  async getActiveBans({ ip, domainId, limit = 50, offset = 0 } = {}) {
    let query = `SELECT b.*, d.hostname FROM ddos_ip_bans b
      LEFT JOIN domains d ON b.domain_id = d.id
      WHERE (b.expires_at IS NULL OR b.expires_at > NOW())`;
    const params = [];
    if (ip) { params.push(`%${ip}%`); query += ` AND b.ip_address LIKE $${params.length}`; }
    if (domainId) { params.push(domainId); query += ` AND b.domain_id = $${params.length}`; }
    params.push(limit, offset);
    query += ` ORDER BY b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const result = await database.execute(query, params);
    return result?.rows || [];
  }

  async getBanStats() {
    const result = await database.execute(`
      SELECT
        COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) AS active_bans,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS blocked_today,
        COUNT(*) AS total_bans
      FROM ddos_ip_bans
    `);
    return result?.rows?.[0] || {};
  }

  async getBlocklistMeta() {
    const result = await database.execute(`SELECT * FROM ddos_blocklist_meta ORDER BY source`);
    return result?.rows || [];
  }

  destroy() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
  }
}

export const ddosProtectionService = new DdosProtectionService();
