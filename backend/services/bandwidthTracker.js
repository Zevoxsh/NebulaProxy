/**
 * Bandwidth Tracker
 *
 * Hot path: counts bytes per user in Redis (INCRBY — atomic, sub-millisecond).
 * Cold path: flushes Redis counters to PostgreSQL every 5 minutes.
 * Quota check: compares today's total against users.bandwidth_quota_bytes.
 *
 * Redis keys:
 *   nebula:bw:{userId}:in:{YYYYMMDD}   — bytes received from clients
 *   nebula:bw:{userId}:out:{YYYYMMDD}  — bytes sent to clients
 *   TTL: 3 days (keys auto-expire; DB is the source of truth after flush)
 */

import { pool } from '../config/database.js';
import { redisService } from './redis.js';

const KEY_TTL_S  = 3 * 24 * 60 * 60;   // 3 days
const FLUSH_MS   = 5 * 60 * 1000;        // 5 minutes

function todayKey() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function redisKey(userId, dir) {
  return `nebula:bw:${userId}:${dir}:${todayKey()}`;
}

class BandwidthTracker {
  #flushTimer = null;

  start() {
    if (this.#flushTimer) return;
    this.#flushTimer = setInterval(() => this.#flush().catch(console.error), FLUSH_MS);
  }

  stop() {
    if (this.#flushTimer) { clearInterval(this.#flushTimer); this.#flushTimer = null; }
  }

  /**
   * Record bytes for a user (fire-and-forget — never blocks the proxy).
   * @param {number|null} userId
   * @param {number} bytesIn  — request body bytes
   * @param {number} bytesOut — response body bytes
   */
  async record(userId, bytesIn, bytesOut) {
    if (!userId || (!bytesIn && !bytesOut)) return;
    if (!redisService.isConnected || !redisService.client) return;

    try {
      const pipe = redisService.client.pipeline();
      if (bytesIn > 0) {
        const k = redisKey(userId, 'in');
        pipe.incrby(k, bytesIn);
        pipe.expire(k, KEY_TTL_S);
      }
      if (bytesOut > 0) {
        const k = redisKey(userId, 'out');
        pipe.incrby(k, bytesOut);
        pipe.expire(k, KEY_TTL_S);
      }
      await pipe.exec();
    } catch { /* never block proxy on tracker error */ }
  }

  /**
   * Check if a user has exceeded their quota for today.
   * Returns { exceeded: bool, used: BigInt, quota: BigInt }.
   */
  async checkQuota(userId, quotaBytes) {
    if (!quotaBytes || quotaBytes <= 0) return { exceeded: false, used: 0n, quota: 0n };

    let used = 0n;

    // Fast path: read from Redis
    if (redisService.isConnected && redisService.client) {
      try {
        const [inVal, outVal] = await Promise.all([
          redisService.client.get(redisKey(userId, 'in')),
          redisService.client.get(redisKey(userId, 'out'))
        ]);
        used = BigInt(inVal || 0) + BigInt(outVal || 0);
      } catch { /* fall through to DB */ }
    }

    // Slow fallback: DB (if Redis was empty or unavailable)
    if (used === 0n) {
      try {
        const { rows } = await pool.query(
          `SELECT COALESCE(bytes_in,0) + COALESCE(bytes_out,0) AS total
           FROM bandwidth_usage WHERE user_id = $1 AND date = CURRENT_DATE`,
          [userId]
        );
        if (rows.length) used = BigInt(rows[0].total);
      } catch { /* ignore */ }
    }

    const quota = BigInt(quotaBytes);
    return { exceeded: used >= quota, used, quota };
  }

  async #flush() {
    if (!redisService.isConnected || !redisService.client) return;

    const date = todayKey();
    const pattern = `nebula:bw:*:*:${date}`;

    let cursor = '0';
    const toFlush = new Map();  // userId → { in, out }

    // SCAN all bandwidth keys for today
    do {
      const [nextCursor, keys] = await redisService.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;

      for (const key of keys) {
        // key format: nebula:bw:{userId}:{dir}:{date}
        const parts = key.split(':');
        if (parts.length < 5) continue;
        const userId = parseInt(parts[2], 10);
        const dir    = parts[3];
        if (isNaN(userId)) continue;

        const val = await redisService.client.get(key);
        if (!val) continue;

        if (!toFlush.has(userId)) toFlush.set(userId, { in: 0n, out: 0n });
        const entry = toFlush.get(userId);
        if (dir === 'in')  entry.in  += BigInt(val);
        if (dir === 'out') entry.out += BigInt(val);
      }
    } while (cursor !== '0');

    if (toFlush.size === 0) return;

    // Upsert into PostgreSQL
    const today = new Date().toISOString().slice(0, 10);
    for (const [userId, { in: bIn, out: bOut }] of toFlush) {
      await pool.query(
        `INSERT INTO bandwidth_usage (user_id, date, bytes_in, bytes_out)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, date) DO UPDATE
           SET bytes_in  = GREATEST(bandwidth_usage.bytes_in,  EXCLUDED.bytes_in),
               bytes_out = GREATEST(bandwidth_usage.bytes_out, EXCLUDED.bytes_out)`,
        [userId, today, bIn.toString(), bOut.toString()]
      ).catch(console.error);
    }
  }
}

export const bandwidthTracker = new BandwidthTracker();
