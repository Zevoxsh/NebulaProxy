import { describe, it, expect, vi } from 'vitest';
import { urlFilterService } from '../../services/urlFilterService.js';

describe('UrlFilterService', () => {
  describe('matchPattern', () => {
    describe('exact matching', () => {
      it('should match exact paths', () => {
        expect(urlFilterService.matchPattern('/admin', '/admin', 'exact')).toBe(true);
        expect(urlFilterService.matchPattern('/api/users', '/api/users', 'exact')).toBe(true);
      });

      it('should not match different paths', () => {
        expect(urlFilterService.matchPattern('/admin/users', '/admin', 'exact')).toBe(false);
        expect(urlFilterService.matchPattern('/api', '/api/users', 'exact')).toBe(false);
      });
    });

    describe('prefix matching', () => {
      it('should match path prefixes', () => {
        expect(urlFilterService.matchPattern('/admin', '/admin', 'prefix')).toBe(true);
        expect(urlFilterService.matchPattern('/admin/users', '/admin', 'prefix')).toBe(true);
        expect(urlFilterService.matchPattern('/admin/settings/profile', '/admin', 'prefix')).toBe(true);
      });

      it('should not match non-prefixes', () => {
        expect(urlFilterService.matchPattern('/administrator', '/admin', 'prefix')).toBe(false);
        expect(urlFilterService.matchPattern('/api/admin', '/admin', 'prefix')).toBe(false);
      });
    });

    describe('wildcard matching', () => {
      it('should match wildcard patterns', () => {
        expect(urlFilterService.matchPattern('/api/users', '/api/*', 'wildcard')).toBe(true);
        expect(urlFilterService.matchPattern('/api/users/123', '/api/*', 'wildcard')).toBe(true);
        expect(urlFilterService.matchPattern('/api/settings/config', '/api/*/config', 'wildcard')).toBe(true);
      });

      it('should not match non-matching patterns', () => {
        expect(urlFilterService.matchPattern('/admin', '/api/*', 'wildcard')).toBe(false);
        expect(urlFilterService.matchPattern('/v1/api/users', '/api/*', 'wildcard')).toBe(false);
      });

      it('should handle multiple wildcards', () => {
        expect(urlFilterService.matchPattern('/api/v1/users/123', '/api/*/users/*', 'wildcard')).toBe(true);
      });
    });

    describe('regex matching', () => {
      it('should match regex patterns', () => {
        expect(urlFilterService.matchPattern('/user/123', '/user/\\d+', 'regex')).toBe(true);
        expect(urlFilterService.matchPattern('/user/456', '/user/\\d+', 'regex')).toBe(true);
        expect(urlFilterService.matchPattern('/api/v1/users', '/api/v[0-9]+/.*', 'regex')).toBe(true);
      });

      it('should not match non-matching patterns', () => {
        expect(urlFilterService.matchPattern('/user/abc', '/user/\\d+', 'regex')).toBe(false);
        expect(urlFilterService.matchPattern('/users/123', '/user/\\d+', 'regex')).toBe(false);
      });

      it('should handle invalid regex patterns', () => {
        expect(urlFilterService.matchPattern('/test', '[invalid(regex', 'regex')).toBe(false);
      });
    });
  });

  describe('validatePattern', () => {
    it('should validate valid patterns', () => {
      expect(urlFilterService.validatePattern('/admin', 'exact')).toEqual({
        valid: true,
        error: null
      });

      expect(urlFilterService.validatePattern('/api/*', 'wildcard')).toEqual({
        valid: true,
        error: null
      });

      expect(urlFilterService.validatePattern('/user/\\d+', 'regex')).toEqual({
        valid: true,
        error: null
      });
    });

    it('should reject invalid patterns', () => {
      expect(urlFilterService.validatePattern('', 'exact').valid).toBe(false);
      expect(urlFilterService.validatePattern(null, 'exact').valid).toBe(false);
    });

    it('should reject invalid regex patterns', () => {
      const result = urlFilterService.validatePattern('[invalid(regex', 'regex');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid regex');
    });
  });

  describe('priority ordering', () => {
    it('should handle priority correctly in rule evaluation', async () => {
      // Mock database query
      const mockRules = [
        {
          id: 1,
          pattern: '/admin/public',
          pattern_type: 'prefix',
          action: 'allow',
          priority: 200
        },
        {
          id: 2,
          pattern: '/admin',
          pattern_type: 'prefix',
          action: 'block',
          priority: 100,
          response_code: 403,
          response_message: 'Access denied'
        }
      ];

      // Mock getRulesForDomain
      vi.spyOn(urlFilterService, 'getRulesForDomain').mockResolvedValue(mockRules);

      // Test that higher priority allow rule overrides lower priority block rule
      const result1 = await urlFilterService.checkUrl(1, '/admin/public/docs', 'GET');
      expect(result1.blocked).toBe(false);

      // Test that block rule still applies to non-matching paths
      const result2 = await urlFilterService.checkUrl(1, '/admin/private', 'GET');
      expect(result2.blocked).toBe(true);
      expect(result2.response.code).toBe(403);
    });
  });

  describe('caching', () => {
    it('should cache rules for performance', async () => {
      // The previous test uses vi.spyOn without restoring — clean up first
      vi.restoreAllMocks();

      const mockRules = [
        { id: 1, pattern: '/admin', pattern_type: 'exact', action: 'block', priority: 100 }
      ];

      // Replace getRulesForDomain with a cache-aware version that counts DB hits
      let dbHits = 0;
      const originalMethod = urlFilterService.getRulesForDomain.bind(urlFilterService);
      urlFilterService.getRulesForDomain = async function(domainId) {
        const cacheKey = `domain_${domainId}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
          return cached.rules; // cache hit — no DB round-trip
        }
        dbHits++;
        this.cache.set(cacheKey, { rules: mockRules, timestamp: Date.now() });
        return mockRules;
      };

      urlFilterService.cache.delete('domain_1');

      // First call — cache miss → DB hit
      await urlFilterService.checkUrl(1, '/admin', 'GET');
      expect(dbHits).toBe(1);

      // Second call — cache hit → no DB round-trip
      await urlFilterService.checkUrl(1, '/admin', 'GET');
      expect(dbHits).toBe(1); // still 1

      // Restore
      urlFilterService.getRulesForDomain = originalMethod;
      urlFilterService.cache.delete('domain_1');
    });

    it('should invalidate cache when requested', () => {
      urlFilterService.invalidateCache(1);
      expect(urlFilterService.cache.has('domain_1')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should default to allow on errors', async () => {
      // Mock database error
      vi.spyOn(urlFilterService, 'getRulesForDomain').mockRejectedValue(
        new Error('Database error')
      );

      const result = await urlFilterService.checkUrl(1, '/admin', 'GET');
      expect(result.blocked).toBe(false);
      expect(result.rule).toBe(null);
    });
  });
});
