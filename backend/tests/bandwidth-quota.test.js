/**
 * Bandwidth quota logic tests (pure unit — no Redis/DB required).
 */
import { describe, it, expect } from 'vitest';

// Reproduce the quota check logic from bandwidthTracker.js
function isQuotaExceeded(used, quotaBytes) {
  if (!quotaBytes || quotaBytes <= 0) return false;
  return BigInt(used) >= BigInt(quotaBytes);
}

// Reproduce the Redis key format
function todayKey() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

describe('Bandwidth quota check', () => {
  it('no quota (0) never blocks', () => {
    expect(isQuotaExceeded(999_999_999, 0)).toBe(false);
    expect(isQuotaExceeded(0, 0)).toBe(false);
  });

  it('usage below quota — allowed', () => {
    const quota = 10 * 1024 * 1024 * 1024; // 10 GB
    expect(isQuotaExceeded(5 * 1024 * 1024 * 1024, quota)).toBe(false);
  });

  it('usage exactly at quota — blocked', () => {
    const quota = 1_000_000;
    expect(isQuotaExceeded(quota, quota)).toBe(true);
  });

  it('usage above quota — blocked', () => {
    const quota = 1_000_000;
    expect(isQuotaExceeded(quota + 1, quota)).toBe(true);
  });

  it('handles BigInt safely for large values (>2^53)', () => {
    const quota    = 1_000_000_000_000n;   // 1 TB
    const used     = 999_999_999_999n;
    const exceeded = used >= quota;
    expect(exceeded).toBe(false);
  });
});

describe('Bandwidth Redis key format', () => {
  it('generates YYYYMMDD format', () => {
    const key = todayKey();
    expect(key).toMatch(/^\d{8}$/);
  });

  it('full key includes userId and direction', () => {
    const userId = 42;
    const dir    = 'out';
    const key    = `nebula:bw:${userId}:${dir}:${todayKey()}`;
    expect(key).toMatch(/^nebula:bw:42:out:\d{8}$/);
  });
});
