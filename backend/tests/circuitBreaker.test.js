import { describe, it, expect, beforeEach, vi } from 'vitest';

// Set env vars before importing config-dependent modules
process.env.CB_FAILURE_THRESHOLD = '3';
process.env.CB_SUCCESS_THRESHOLD = '1';
process.env.CB_TIMEOUT_MS = '100';

// Mock net to prevent real TCP connections in background probes
vi.mock('net', () => ({
  default: {
    createConnection: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      end: vi.fn(),
    })),
    isIP: vi.fn(() => 0),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { CircuitBreaker } = await import('../services/circuitBreaker.js');

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker();
  });

  describe('initial state', () => {
    it('starts CLOSED for unknown keys', () => {
      expect(cb.isAvailable('domain:host:8080')).toBe(true);
    });

    it('has empty status initially', () => {
      const status = cb.getStatus();
      expect(Object.keys(status)).toHaveLength(0);
    });
  });

  describe('CLOSED → OPEN transition', () => {
    it('stays CLOSED below failure threshold', () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      cb.onFailure(key);
      expect(cb.isAvailable(key)).toBe(true);
    });

    it('opens circuit after threshold failures', () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      cb.onFailure(key);
      cb.onFailure(key); // threshold = 3
      expect(cb.isAvailable(key)).toBe(false);
    });

    it('resets failure count on success in CLOSED state', () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      cb.onFailure(key);
      cb.onSuccess(key); // resets failures
      cb.onFailure(key);
      cb.onFailure(key);
      // Only 2 failures after reset, still CLOSED
      expect(cb.isAvailable(key)).toBe(true);
    });
  });

  describe('OPEN → HALF_OPEN transition', () => {
    it('transitions to HALF_OPEN after timeout', async () => {
      const key = 'test:host:80';
      // Open the circuit
      cb.onFailure(key);
      cb.onFailure(key);
      cb.onFailure(key);
      expect(cb.isAvailable(key)).toBe(false);

      // Wait for timeout (CB_TIMEOUT_MS = 100ms)
      await new Promise(r => { setTimeout(r, 150); });
      expect(cb.isAvailable(key)).toBe(true); // now HALF_OPEN
    });
  });

  describe('HALF_OPEN → CLOSED recovery', () => {
    it('closes circuit after successful probe', async () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      cb.onFailure(key);
      cb.onFailure(key);
      await new Promise(r => { setTimeout(r, 150); });

      cb.isAvailable(key); // triggers HALF_OPEN
      cb.onSuccess(key);   // CB_SUCCESS_THRESHOLD = 1
      expect(cb.isAvailable(key)).toBe(true);
      // Confirm state is truly CLOSED (multiple calls work)
      cb.onSuccess(key);
      expect(cb.isAvailable(key)).toBe(true);
    });
  });

  describe('HALF_OPEN → OPEN on probe failure', () => {
    it('reopens circuit if probe fails', async () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      cb.onFailure(key);
      cb.onFailure(key);
      await new Promise(r => { setTimeout(r, 150); });

      cb.isAvailable(key); // HALF_OPEN
      cb.onFailure(key);   // probe failed → back to OPEN
      expect(cb.isAvailable(key)).toBe(false);
    });
  });

  describe('reset', () => {
    it('manually resets an open circuit', () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      cb.onFailure(key);
      cb.onFailure(key);
      expect(cb.isAvailable(key)).toBe(false);

      cb.reset(key);
      expect(cb.isAvailable(key)).toBe(true);
    });

    it('resets failure counters on manual reset', () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      cb.reset(key);
      // After reset, needs full threshold again to open
      cb.onFailure(key);
      cb.onFailure(key);
      expect(cb.isAvailable(key)).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('reports state for breakers that have been touched', () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      const status = cb.getStatus();
      expect(status[key]).toBeDefined();
      expect(status[key].state).toBe('CLOSED');
      expect(status[key].failures).toBe(1);
    });

    it('reports OPEN state with openedAt timestamp', () => {
      const key = 'test:host:80';
      cb.onFailure(key);
      cb.onFailure(key);
      cb.onFailure(key);
      const status = cb.getStatus();
      expect(status[key].state).toBe('OPEN');
      expect(status[key].openedAt).toBeGreaterThan(0);
    });
  });

  describe('independent breakers per key', () => {
    it('tracks separate state per key', () => {
      const key1 = '1:host1:80';
      const key2 = '2:host2:80';
      cb.onFailure(key1);
      cb.onFailure(key1);
      cb.onFailure(key1);
      expect(cb.isAvailable(key1)).toBe(false);
      expect(cb.isAvailable(key2)).toBe(true);
    });
  });
});
