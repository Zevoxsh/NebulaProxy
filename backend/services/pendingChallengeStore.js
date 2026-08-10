// @ts-check
import { redisService } from './redis.js';

// Namespaced store for short-lived WebAuthn challenge state. Backed by Redis
// so pending state survives across cluster workers — with CLUSTER_ENABLED=true
// and SCHED_NONE (no connection stickiness), the /options and /verify requests
// of a single WebAuthn ceremony can land on two different worker processes,
// whose in-memory Maps would be independent. Falls back to an in-process Map
// if Redis is unavailable.
export function createPendingChallengeStore(namespace, ttlSeconds) {
  const fallback = new Map();
  const redisKey = (key) => `webauthn:${namespace}:${key}`;

  return {
    async set(key, value) {
      const redis = redisService.getClient();
      if (redis) {
        await redis.setex(redisKey(key), ttlSeconds, JSON.stringify(value));
        return;
      }
      fallback.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },

    async get(key) {
      const redis = redisService.getClient();
      if (redis) {
        const raw = await redis.get(redisKey(key));
        return raw ? JSON.parse(raw) : null;
      }
      const entry = fallback.get(key);
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        fallback.delete(key);
        return null;
      }
      return entry.value;
    },

    async delete(key) {
      const redis = redisService.getClient();
      if (redis) {
        await redis.del(redisKey(key));
        return;
      }
      fallback.delete(key);
    }
  };
}
