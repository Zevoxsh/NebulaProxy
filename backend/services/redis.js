/**
 * Redis service for JWT token blacklist and session management
 */

import Redis from 'ioredis';
import { config } from '../config/config.js';

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Initialize Redis connection
   */
  async init() {
    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false
      });

      this.client.on('connect', () => {
        console.log('[Redis] Connected successfully');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        console.log('[Redis] Connection closed');
        this.isConnected = false;
      });

      // Wait for connection
      await this.client.ping();
      console.log('[Redis] Ping successful');

      return this;
    } catch (error) {
      console.error('[Redis] Initialization failed:', error.message);
      console.warn('[Redis] Running without Redis - JWT revocation will not work!');
      this.client = null;
      this.isConnected = false;
      // Don't throw - allow app to run without Redis (degraded mode)
      return this;
    }
  }

  /**
   * Blacklist a JWT token until its expiration
   * @param {string} token - The JWT token to blacklist
   * @param {number} expiresAt - Unix timestamp when token expires
   */
  async blacklistToken(token, expiresAt) {
    if (!this.isConnected || !this.client) {
      console.warn('[Redis] Cannot blacklist token - Redis not connected');
      return false;
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const ttl = expiresAt - now;

      if (ttl <= 0) {
        // Token already expired, no need to blacklist
        return true;
      }

      // Store with TTL so Redis auto-deletes after expiration
      await this.client.setex(`blacklist:${token}`, ttl, '1');
      return true;
    } catch (error) {
      console.error('[Redis] Failed to blacklist token:', error.message);
      return false;
    }
  }

  /**
   * Check if a token is blacklisted
   * @param {string} token - The JWT token to check
   * @returns {Promise<boolean>}
   */
  async isTokenBlacklisted(token) {
    if (!this.isConnected || !this.client) {
      // If Redis is down, allow tokens (fail open for availability)
      // In production, you might want to fail closed instead
      return false;
    }

    try {
      const exists = await this.client.exists(`blacklist:${token}`);
      return exists === 1;
    } catch (error) {
      console.error('[Redis] Failed to check token blacklist:', error.message);
      // Fail open - assume not blacklisted if Redis error
      return false;
    }
  }

  /**
   * Store rate limit counter
   * @param {string} key - Rate limit key (usually IP or user ID)
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<number>} - Current count
   */
  async incrementRateLimit(key, ttl) {
    if (!this.isConnected || !this.client) {
      return 0;
    }

    try {
      const count = await this.client.incr(`ratelimit:${key}`);
      if (count === 1) {
        // First request, set expiration
        await this.client.expire(`ratelimit:${key}`, ttl);
      }
      return count;
    } catch (error) {
      console.error('[Redis] Failed to increment rate limit:', error.message);
      return 0;
    }
  }

  /**
   * Get rate limit count
   * @param {string} key - Rate limit key
   * @returns {Promise<number>}
   */
  async getRateLimitCount(key) {
    if (!this.isConnected || !this.client) {
      return 0;
    }

    try {
      const count = await this.client.get(`ratelimit:${key}`);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      console.error('[Redis] Failed to get rate limit count:', error.message);
      return 0;
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      console.log('[Redis] Connection closed gracefully');
    }
  }

  /**
   * Check API key rate limits (both per-minute and per-hour)
   * @param {string} apiKeyId - API key UUID
   * @param {number} limitRpm - Requests per minute limit
   * @param {number} limitRph - Requests per hour limit
   * @returns {Promise<{allowed: boolean, limitType: string|null, retryAfter: number|null}>}
   */
  async checkApiKeyRateLimit(apiKeyId, limitRpm, limitRph) {
    if (!this.isConnected || !this.client) {
      // Fail open if Redis is down - allow the request
      console.warn('[Redis] Rate limiting unavailable - allowing request');
      return { allowed: true, limitType: null, retryAfter: null };
    }

    try {
      const now = Date.now();
      const minuteKey = `apikey:ratelimit:${apiKeyId}:minute:${Math.floor(now / 60000)}`;
      const hourKey = `apikey:ratelimit:${apiKeyId}:hour:${Math.floor(now / 3600000)}`;

      // Check and increment per-minute limit
      const minuteCount = await this.client.incr(minuteKey);
      if (minuteCount === 1) {
        // First request in this minute, set expiration to 60 seconds
        await this.client.expire(minuteKey, 60);
      }

      if (minuteCount > limitRpm) {
        const ttl = await this.client.ttl(minuteKey);
        return {
          allowed: false,
          limitType: 'minute',
          retryAfter: ttl > 0 ? ttl : 60
        };
      }

      // Check and increment per-hour limit
      const hourCount = await this.client.incr(hourKey);
      if (hourCount === 1) {
        // First request in this hour, set expiration to 3600 seconds
        await this.client.expire(hourKey, 3600);
      }

      if (hourCount > limitRph) {
        const ttl = await this.client.ttl(hourKey);
        return {
          allowed: false,
          limitType: 'hour',
          retryAfter: ttl > 0 ? ttl : 3600
        };
      }

      // Both limits passed
      return { allowed: true, limitType: null, retryAfter: null };
    } catch (error) {
      console.error('[Redis] Failed to check API key rate limit:', error.message);
      // Fail open on error - allow the request
      return { allowed: true, limitType: null, retryAfter: null };
    }
  }

  /**
   * Health check
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    if (!this.client) {
      return false;
    }

    try {
      await this.client.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Expose the underlying ioredis client for direct commands.
   */
  getClient() {
    return this.client;
  }
}

// Singleton instance
export const redisService = new RedisService();
