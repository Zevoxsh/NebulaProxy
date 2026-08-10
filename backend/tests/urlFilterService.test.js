import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/database.js', () => ({
  database: {
    getUrlFilterRulesForDomain: vi.fn(async () => []),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { UrlFilterService } = await import('../services/urlFilterService.js');

describe('UrlFilterService', () => {
  let svc;

  beforeEach(() => {
    svc = new UrlFilterService();
  });

  // ─── matchPattern ──────────────────────────────────────────────────────────

  describe('matchPattern – exact', () => {
    it('matches identical path', () => {
      expect(svc.matchPattern('/api/users', '/api/users', 'exact')).toBe(true);
    });

    it('does not match prefix or longer path', () => {
      expect(svc.matchPattern('/api/users/1', '/api/users', 'exact')).toBe(false);
    });

    it('is case-sensitive', () => {
      expect(svc.matchPattern('/API/users', '/api/users', 'exact')).toBe(false);
    });
  });

  describe('matchPattern – prefix', () => {
    it('matches same path', () => {
      expect(svc.matchPattern('/api/users', '/api/users', 'prefix')).toBe(true);
    });

    it('matches path with sub-segments', () => {
      expect(svc.matchPattern('/api/users/123', '/api/users', 'prefix')).toBe(true);
    });

    it('does not match partial segment names', () => {
      expect(svc.matchPattern('/api/userSettings', '/api/users', 'prefix')).toBe(false);
    });

    it('does not match shorter path', () => {
      expect(svc.matchPattern('/api', '/api/users', 'prefix')).toBe(false);
    });
  });

  describe('matchPattern – wildcard', () => {
    it('* matches any segment', () => {
      expect(svc.matchPattern('/api/users/123', '/api/users/*', 'wildcard')).toBe(true);
    });

    it('* spans multiple segments (maps to .*)', () => {
      expect(svc.matchPattern('/api/users/123/posts', '/api/users/*', 'wildcard')).toBe(true);
    });

    it('** is not special — treated as two *', () => {
      expect(svc.matchPattern('/a/b', '/a/*', 'wildcard')).toBe(true);
    });

    it('exact path matches with wildcard pattern', () => {
      expect(svc.matchPattern('/static/main.js', '/static/*.js', 'wildcard')).toBe(true);
    });

    it('does not match wrong extension', () => {
      expect(svc.matchPattern('/static/main.css', '/static/*.js', 'wildcard')).toBe(false);
    });

    it('caches compiled pattern', () => {
      svc.matchPattern('/path', '/path*', 'wildcard');
      svc.matchPattern('/path', '/path*', 'wildcard');
      expect(svc.compiledPatterns.size).toBe(1);
    });
  });

  describe('matchPattern – regex', () => {
    it('matches valid regex', () => {
      expect(svc.matchPattern('/api/v1/users', '^/api/v[0-9]+/users$', 'regex')).toBe(true);
    });

    it('does not match on non-matching pattern', () => {
      expect(svc.matchPattern('/api/vX/users', '^/api/v[0-9]+/users$', 'regex')).toBe(false);
    });

    it('returns false for invalid regex', () => {
      expect(svc.matchPattern('/test', '[invalid', 'regex')).toBe(false);
    });
  });

  describe('matchPattern – unknown type', () => {
    it('returns false for unknown pattern type', () => {
      expect(svc.matchPattern('/test', '/test', 'unknown')).toBe(false);
    });
  });

  // ─── isIpAllowed ──────────────────────────────────────────────────────────

  describe('isIpAllowed', () => {
    it('allows all IPs when allowedIps is empty', () => {
      expect(svc.isIpAllowed('1.2.3.4', [])).toBe(true);
    });

    it('blocks IP not in allow list', () => {
      expect(svc.isIpAllowed('10.0.0.1', ['192.168.1.1'])).toBe(false);
    });

    it('allows IP matching exact entry', () => {
      expect(svc.isIpAllowed('192.168.1.1', ['192.168.1.1'])).toBe(true);
    });

    it('allows IP matching CIDR', () => {
      expect(svc.isIpAllowed('192.168.1.50', ['192.168.1.0/24'])).toBe(true);
    });

    it('blocks IP outside CIDR range', () => {
      expect(svc.isIpAllowed('192.168.2.1', ['192.168.1.0/24'])).toBe(false);
    });

    it('normalizes IPv6 loopback to 127.0.0.1', () => {
      expect(svc.isIpAllowed('::1', ['127.0.0.1'])).toBe(true);
    });

    it('normalizes IPv4-mapped IPv6 (::ffff:1.2.3.4)', () => {
      expect(svc.isIpAllowed('::ffff:1.2.3.4', ['1.2.3.4'])).toBe(true);
    });

    it('returns false for empty clientIp', () => {
      expect(svc.isIpAllowed('', ['192.168.1.1'])).toBe(false);
    });
  });

  // ─── checkUrl (integration) ───────────────────────────────────────────────

  describe('checkUrl', () => {
    it('returns not-blocked when no rules', async () => {
      const result = await svc.checkUrl(1, '/test', 'GET', '1.2.3.4');
      expect(result.blocked).toBe(false);
      expect(result.rule).toBeNull();
    });

    it('blocks path matching a block rule', async () => {
      svc.getRulesForDomain = vi.fn(async () => [
        { id: 1, action: 'block', pattern: '/admin', pattern_type: 'prefix', allowed_ips: [], response_code: 403, response_message: 'Forbidden' }
      ]);
      const result = await svc.checkUrl(1, '/admin/settings', 'GET', '5.5.5.5');
      expect(result.blocked).toBe(true);
      expect(result.response.code).toBe(403);
    });

    it('allows path not matching any rule', async () => {
      svc.getRulesForDomain = vi.fn(async () => [
        { id: 1, action: 'block', pattern: '/admin', pattern_type: 'prefix', allowed_ips: [], response_code: 403, response_message: 'Forbidden' }
      ]);
      const result = await svc.checkUrl(1, '/public', 'GET', '5.5.5.5');
      expect(result.blocked).toBe(false);
    });

    it('allow rule stops evaluation', async () => {
      svc.getRulesForDomain = vi.fn(async () => [
        { id: 1, action: 'allow', pattern: '/api', pattern_type: 'prefix', allowed_ips: [] },
        { id: 2, action: 'block', pattern: '/api', pattern_type: 'prefix', allowed_ips: [], response_code: 403, response_message: 'Blocked' }
      ]);
      const result = await svc.checkUrl(1, '/api/data', 'GET', '1.2.3.4');
      expect(result.blocked).toBe(false);
    });

    it('defaults to allow on internal error', async () => {
      svc.getRulesForDomain = vi.fn(async () => { throw new Error('DB error'); });
      const result = await svc.checkUrl(1, '/any', 'GET', '1.2.3.4');
      expect(result.blocked).toBe(false);
    });
  });

  // ─── _normalizeIp ─────────────────────────────────────────────────────────

  describe('_normalizeIp', () => {
    it('passes through plain IPv4', () => {
      expect(svc._normalizeIp('1.2.3.4')).toBe('1.2.3.4');
    });

    it('converts ::1 to 127.0.0.1', () => {
      expect(svc._normalizeIp('::1')).toBe('127.0.0.1');
    });

    it('strips ::ffff: prefix', () => {
      expect(svc._normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    });

    it('returns empty string for null/undefined', () => {
      expect(svc._normalizeIp(null)).toBe('');
      expect(svc._normalizeIp(undefined)).toBe('');
    });
  });
});
