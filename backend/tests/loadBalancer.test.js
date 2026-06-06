import { describe, it, expect, beforeEach } from 'vitest';
import { LoadBalancer } from '../services/loadBalancer.js';

const domain = (opts = {}) => ({
  id: 1,
  load_balancing_algorithm: 'round-robin',
  load_balancing_enabled: true,
  sticky_sessions_enabled: false,
  backend_url: 'fallback.example.com',
  backend_port: 8080,
  ...opts,
});

const backends = (count = 3) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    backend_url: `backend${i + 1}.example.com`,
    backend_port: 8080 + i,
    is_active: true,
    ab_weight: null,
  }));

describe('LoadBalancer', () => {
  let lb;

  beforeEach(() => {
    lb = new LoadBalancer();
  });

  describe('selectBackend', () => {
    it('returns null for empty backends', () => {
      expect(lb.selectBackend(domain(), [], '1.2.3.4')).toBeNull();
    });

    it('returns the single backend when only one available', () => {
      const [b] = backends(1);
      expect(lb.selectBackend(domain(), [b], '1.2.3.4')).toBe(b);
    });

    it('filters out inactive backends', () => {
      const bs = backends(3);
      bs[0].is_active = false;
      bs[2].is_active = false;
      const selected = lb.selectBackend(domain(), bs, '1.2.3.4');
      expect(selected).toBe(bs[1]);
    });

    it('returns null when all backends inactive', () => {
      const bs = backends(2);
      bs[0].is_active = false;
      bs[1].is_active = false;
      expect(lb.selectBackend(domain(), bs, '1.2.3.4')).toBeNull();
    });
  });

  describe('round-robin', () => {
    it('cycles through all backends evenly', () => {
      const bs = backends(3);
      const d = domain({ load_balancing_algorithm: 'round-robin' });
      const results = Array.from({ length: 6 }, () => lb.selectBackend(d, bs, '1.2.3.4'));
      expect(results[0]).toBe(bs[0]);
      expect(results[1]).toBe(bs[1]);
      expect(results[2]).toBe(bs[2]);
      expect(results[3]).toBe(bs[0]);
    });

    it('maintains separate counters per domain', () => {
      const bs = backends(3);
      const d1 = domain({ id: 1 });
      const d2 = domain({ id: 2 });
      lb.selectBackend(d1, bs, '1.2.3.4');
      lb.selectBackend(d1, bs, '1.2.3.4');
      // d2 should still start at 0
      expect(lb.selectBackend(d2, bs, '1.2.3.4')).toBe(bs[0]);
    });
  });

  describe('random', () => {
    it('always returns a valid backend', () => {
      const bs = backends(5);
      const d = domain({ load_balancing_algorithm: 'random' });
      for (let i = 0; i < 20; i++) {
        const result = lb.selectBackend(d, bs, '1.2.3.4');
        expect(bs).toContain(result);
      }
    });
  });

  describe('ip-hash', () => {
    it('returns consistent backend for same IP', () => {
      const bs = backends(4);
      const d = domain({ load_balancing_algorithm: 'ip-hash' });
      const ip = '203.0.113.42';
      const first = lb.selectBackend(d, bs, ip);
      for (let i = 0; i < 10; i++) {
        expect(lb.selectBackend(d, bs, ip)).toBe(first);
      }
    });

    it('distributes different IPs across backends', () => {
      const bs = backends(4);
      const d = domain({ load_balancing_algorithm: 'ip-hash' });
      // These IPs are known to hash to different indices (0,1,2,3) via djb2 % 4
      const ips = ['38.48.1.1', '1.142.1.1', '75.1.1.1', '1.1.1.1'];
      const selected = new Set(ips.map(ip => lb.selectBackend(d, bs, ip).id));
      expect(selected.size).toBeGreaterThan(1);
    });
  });

  describe('least-connections', () => {
    it('selects backend with fewest connections', () => {
      const bs = backends(3);
      const d = domain({ load_balancing_algorithm: 'least-connections' });
      lb.incrementConnections(2); // bs[1]
      lb.incrementConnections(2);
      lb.incrementConnections(3); // bs[2]
      // bs[0] has 0 connections, should be selected
      expect(lb.selectBackend(d, bs, '1.2.3.4')).toBe(bs[0]);
    });

    it('decrements connections correctly', () => {
      const bs = backends(2);
      const d = domain({ load_balancing_algorithm: 'least-connections' });
      lb.incrementConnections(1);
      lb.incrementConnections(1);
      lb.decrementConnections(1);
      // bs[0] has 1 connection, bs[1] has 0
      expect(lb.selectBackend(d, bs, '1.2.3.4')).toBe(bs[1]);
    });
  });

  describe('getBackendTarget', () => {
    it('uses selected backend when provided', () => {
      const d = domain();
      const [b] = backends(1);
      const target = lb.getBackendTarget(d, b, 'http');
      expect(target.hostname).toBe(b.backend_url);
      expect(target.port).toBe(b.backend_port);
    });

    it('falls back to domain defaults when no backend', () => {
      const d = domain({ backend_url: 'default.example.com', backend_port: 9090 });
      const target = lb.getBackendTarget(d, null, 'http');
      expect(target.hostname).toBe('default.example.com');
      expect(target.port).toBe(9090);
    });

    it('includes protocol in target', () => {
      const d = domain();
      const target = lb.getBackendTarget(d, null, 'http');
      expect(target.protocol).toMatch(/^https?:?$/);
    });
  });

  describe('_djb2Hash', () => {
    it('produces consistent hash for same input', () => {
      const h1 = lb._djb2Hash('192.168.1.1');
      const h2 = lb._djb2Hash('192.168.1.1');
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different inputs', () => {
      const h1 = lb._djb2Hash('192.168.1.1');
      const h2 = lb._djb2Hash('192.168.1.2');
      expect(h1).not.toBe(h2);
    });

    it('returns unsigned 32-bit integer', () => {
      const h = lb._djb2Hash('test');
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    });
  });
});
