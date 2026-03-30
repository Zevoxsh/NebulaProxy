/**
 * Traffic Stats Service
 * Records traffic events in Redis for realtime chart persistence and 24h history.
 *
 * Keys:
 *   traffic:sec:{domainId}:{secBucket}   STRING  per-second request count  TTL 75s
 *   traffic:hour:{domainId}:{hourBucket} HASH {requests, bytes}             TTL 26h
 */

import { redisService } from './redis.js';

const SEC_TTL  = 75;      // 75 seconds
const HOUR_TTL = 93600;   // 26 hours

/**
 * Record one traffic event for a domain.
 * Fire-and-forget — never throws.
 */
async function recordEvent(domainId, bytes = 0) {
  if (!redisService.isConnected || !redisService.getClient()) return;
  try {
    const client     = redisService.getClient();
    const now        = Date.now();
    const secBucket  = Math.floor(now / 1000);
    const hourBucket = Math.floor(now / 3600000);

    const pipeline = client.pipeline();

    // Per-second bucket (realtime 60s chart)
    pipeline.incr  (`traffic:sec:${domainId}:${secBucket}`);
    pipeline.expire(`traffic:sec:${domainId}:${secBucket}`, SEC_TTL);

    // Per-hour bucket (24h chart)
    pipeline.hincrby(`traffic:hour:${domainId}:${hourBucket}`, 'requests', 1);
    if (bytes > 0) pipeline.hincrby(`traffic:hour:${domainId}:${hourBucket}`, 'bytes', bytes);
    pipeline.expire(`traffic:hour:${domainId}:${hourBucket}`, HOUR_TTL);

    await pipeline.exec();
  } catch (_) { /* non-critical */ }
}

/**
 * Return per-second counts for the last 60s, keyed by domainId.
 * @param {number[]} domainIds
 * @returns {Object} { [domainId]: [{ts: ms, count: N}, ...] }
 */
async function getRealtimeHistory(domainIds) {
  if (!redisService.isConnected || !redisService.getClient() || !domainIds.length) return {};
  try {
    const client     = redisService.getClient();
    const now        = Date.now();
    const currentSec = Math.floor(now / 1000);
    const startSec   = currentSec - 60;

    const pipeline = client.pipeline();
    for (const domainId of domainIds) {
      for (let s = startSec; s <= currentSec; s++) {
        pipeline.get(`traffic:sec:${domainId}:${s}`);
      }
    }

    const results = await pipeline.exec();
    const history  = {};
    let   idx      = 0;
    const RANGE    = currentSec - startSec + 1;

    for (const domainId of domainIds) {
      history[domainId] = [];
      for (let s = startSec; s <= currentSec; s++) {
        const [, val] = results[idx++];
        const count   = val ? parseInt(val, 10) : 0;
        if (count > 0) history[domainId].push({ ts: s * 1000, count });
      }
    }

    return history;
  } catch (_) { return {}; }
}

/**
 * Return per-hour totals for the last 24h, keyed by domainId.
 * @param {number[]} domainIds
 * @returns {{ [domainId]: { ts: number, time: string, requests: number }[] }}  24 entries per domain
 */
async function get24hHistory(domainIds) {
  if (!redisService.isConnected || !redisService.getClient() || !domainIds.length) return {};
  try {
    const client      = redisService.getClient();
    const now         = Date.now();
    const currentHour = Math.floor(now / 3600000);
    const startHour   = currentHour - 23; // 24 hours total

    const pipeline = client.pipeline();
    for (const domainId of domainIds) {
      for (let h = startHour; h <= currentHour; h++) {
        pipeline.hgetall(`traffic:hour:${domainId}:${h}`);
      }
    }

    const results = await pipeline.exec();

    // Build per-domain hourly series
    const history = {};
    let idx = 0;
    for (const domainId of domainIds) {
      history[domainId] = [];
      for (let h = startHour; h <= currentHour; h++) {
        const [, data] = results[idx++];
        const endMs    = (h + 1) * 3600000;
        const d        = new Date(endMs);
        history[domainId].push({
          ts:       endMs,
          time:     d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          requests: parseInt(data?.requests || 0, 10),
          bytes:    parseInt(data?.bytes    || 0, 10),
        });
      }
    }

    return history;
  } catch (_) { return {}; }
}

export const trafficStatsService = { recordEvent, getRealtimeHistory, get24hHistory };
