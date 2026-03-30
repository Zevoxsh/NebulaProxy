import { test, describe, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  hasRequiredScope,
  validateScopes,
  isValidApiKeyFormat,
  extractApiKeyFromHeaders,
  getRequiredScopes
} from '../utils/apiKey.js';

describe('API Key Utilities', () => {
  describe('generateApiKey', () => {
    test('should generate valid production API key', async () => {
      const { fullKey, prefix } = await generateApiKey(false);

      expect(fullKey).toMatch(/^nbp_live_[0-9a-f]{64}$/);
      expect(prefix).toBe(fullKey.substring(0, 16));
      expect(prefix.length).toBe(16);
    });

    test('should generate valid test API key', async () => {
      const { fullKey, prefix } = await generateApiKey(true);

      expect(fullKey).toMatch(/^nbp_test_[0-9a-f]{64}$/);
      expect(prefix).toBe(fullKey.substring(0, 16));
      expect(prefix.length).toBe(16);
    });

    test('should generate unique keys', async () => {
      const key1 = await generateApiKey(false);
      const key2 = await generateApiKey(false);

      expect(key1.fullKey).not.toBe(key2.fullKey);
      expect(key1.prefix).not.toBe(key2.prefix);
    });
  });

  describe('hashApiKey and verifyApiKey', () => {
    test('should hash and verify API key correctly', async () => {
      const { fullKey } = await generateApiKey(false);
      const hash = await hashApiKey(fullKey);

      expect(hash).toContain(':');
      const [salt, hashValue] = hash.split(':');
      expect(salt).toBeTruthy();
      expect(hashValue).toBeTruthy();

      const isValid = await verifyApiKey(fullKey, hash);
      expect(isValid).toBe(true);
    });

    test('should fail verification with wrong key', async () => {
      const { fullKey: key1 } = await generateApiKey(false);
      const { fullKey: key2 } = await generateApiKey(false);
      const hash = await hashApiKey(key1);

      const isValid = await verifyApiKey(key2, hash);
      expect(isValid).toBe(false);
    });

    test('should fail verification with invalid hash format', async () => {
      const { fullKey } = await generateApiKey(false);
      const isValid = await verifyApiKey(fullKey, 'invalid-hash');
      expect(isValid).toBe(false);
    });

    test('should be timing-safe (different keys take similar time)', async () => {
      const { fullKey } = await generateApiKey(false);
      const hash = await hashApiKey(fullKey);
      const { fullKey: wrongKey } = await generateApiKey(false);

      const start1 = Date.now();
      await verifyApiKey(fullKey, hash);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await verifyApiKey(wrongKey, hash);
      const time2 = Date.now() - start2;

      // Times should be within 10ms of each other (timing-safe)
      expect(Math.abs(time1 - time2)).toBeLessThan(10);
    });
  });

  describe('isValidApiKeyFormat', () => {
    test('should validate correct production key format', () => {
      const key = 'nbp_live_' + 'a'.repeat(64);
      expect(isValidApiKeyFormat(key)).toBe(true);
    });

    test('should validate correct test key format', () => {
      const key = 'nbp_test_' + 'b'.repeat(64);
      expect(isValidApiKeyFormat(key)).toBe(true);
    });

    test('should reject key with wrong prefix', () => {
      const key = 'nbp_prod_' + 'a'.repeat(64);
      expect(isValidApiKeyFormat(key)).toBe(false);
    });

    test('should reject key with wrong length', () => {
      const key = 'nbp_live_' + 'a'.repeat(32);
      expect(isValidApiKeyFormat(key)).toBe(false);
    });

    test('should reject key with non-hex characters', () => {
      const key = 'nbp_live_' + 'g'.repeat(64);
      expect(isValidApiKeyFormat(key)).toBe(false);
    });

    test('should reject non-string input', () => {
      expect(isValidApiKeyFormat(null)).toBe(false);
      expect(isValidApiKeyFormat(undefined)).toBe(false);
      expect(isValidApiKeyFormat(123)).toBe(false);
      expect(isValidApiKeyFormat({})).toBe(false);
    });
  });

  describe('extractApiKeyFromHeaders', () => {
    test('should extract API key from X-API-Key header', () => {
      const headers = {
        'x-api-key': 'nbp_live_abc123'
      };
      expect(extractApiKeyFromHeaders(headers)).toBe('nbp_live_abc123');
    });

    test('should extract API key from Authorization Bearer header', () => {
      const headers = {
        authorization: 'Bearer nbp_live_xyz789'
      };
      expect(extractApiKeyFromHeaders(headers)).toBe('nbp_live_xyz789');
    });

    test('should prioritize X-API-Key over Authorization', () => {
      const headers = {
        'x-api-key': 'nbp_live_from_header',
        authorization: 'Bearer nbp_live_from_auth'
      };
      expect(extractApiKeyFromHeaders(headers)).toBe('nbp_live_from_header');
    });

    test('should return null for non-API-key Bearer token', () => {
      const headers = {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      };
      expect(extractApiKeyFromHeaders(headers)).toBe(null);
    });

    test('should return null when no API key present', () => {
      const headers = {};
      expect(extractApiKeyFromHeaders(headers)).toBe(null);
    });
  });

  describe('hasRequiredScope', () => {
    test('should allow wildcard scope', () => {
      const userScopes = ['*'];
      const requiredScopes = ['domains:read', 'teams:write'];
      expect(hasRequiredScope(userScopes, requiredScopes)).toBe(true);
    });

    test('should allow exact scope match', () => {
      const userScopes = ['domains:read', 'teams:read'];
      const requiredScopes = ['domains:read'];
      expect(hasRequiredScope(userScopes, requiredScopes)).toBe(true);
    });

    test('should allow wildcard category scope', () => {
      const userScopes = ['domains:*'];
      const requiredScopes = ['domains:read', 'domains:write'];
      expect(hasRequiredScope(userScopes, requiredScopes)).toBe(true);
    });

    test('should reject missing scope', () => {
      const userScopes = ['domains:read'];
      const requiredScopes = ['domains:write'];
      expect(hasRequiredScope(userScopes, requiredScopes)).toBe(false);
    });

    test('should reject partial match without wildcard', () => {
      const userScopes = ['domains:read'];
      const requiredScopes = ['domains:read', 'teams:read'];
      expect(hasRequiredScope(userScopes, requiredScopes)).toBe(false);
    });

    test('should handle invalid input gracefully', () => {
      expect(hasRequiredScope(null, ['domains:read'])).toBe(false);
      expect(hasRequiredScope(['domains:read'], null)).toBe(false);
      expect(hasRequiredScope('not-array', ['domains:read'])).toBe(false);
    });

    test('should allow multiple wildcard scopes', () => {
      const userScopes = ['domains:*', 'teams:*'];
      const requiredScopes = ['domains:read', 'teams:write', 'domains:delete'];
      expect(hasRequiredScope(userScopes, requiredScopes)).toBe(true);
    });
  });

  describe('validateScopes', () => {
    test('should allow admin to have any scope', () => {
      const scopes = ['users:*', 'domains:*', 'teams:*'];
      const result = validateScopes(scopes, 'admin');
      expect(result.valid).toBe(true);
      expect(result.invalidScopes).toHaveLength(0);
    });

    test('should reject non-admin user with admin-only scopes', () => {
      const scopes = ['users:read', 'domains:*'];
      const result = validateScopes(scopes, 'user');
      expect(result.valid).toBe(false);
      expect(result.invalidScopes).toContain('users:read');
    });

    test('should allow non-admin user with regular scopes', () => {
      const scopes = ['domains:*', 'teams:read', 'ssl:write'];
      const result = validateScopes(scopes, 'user');
      expect(result.valid).toBe(true);
      expect(result.invalidScopes).toHaveLength(0);
    });

    test('should reject all admin-only scopes for non-admin', () => {
      const scopes = ['users:*', 'users:read', 'users:write', 'users:delete'];
      const result = validateScopes(scopes, 'user');
      expect(result.valid).toBe(false);
      expect(result.invalidScopes).toHaveLength(4);
    });
  });

  describe('getRequiredScopes', () => {
    test('should return correct scopes for domain routes', () => {
      expect(getRequiredScopes('GET', '/api/domains')).toEqual(['domains:read']);
      expect(getRequiredScopes('POST', '/api/domains')).toEqual(['domains:write']);
      expect(getRequiredScopes('PUT', '/api/domains/123')).toEqual(['domains:write']);
      expect(getRequiredScopes('DELETE', '/api/domains/456')).toEqual(['domains:delete']);
    });

    test('should return correct scopes for team routes', () => {
      expect(getRequiredScopes('GET', '/api/teams')).toEqual(['teams:read']);
      expect(getRequiredScopes('POST', '/api/teams')).toEqual(['teams:write']);
      expect(getRequiredScopes('DELETE', '/api/teams/123')).toEqual(['teams:delete']);
    });

    test('should return correct scopes for admin routes', () => {
      expect(getRequiredScopes('GET', '/api/admin/api-keys')).toEqual(['users:read']);
      expect(getRequiredScopes('DELETE', '/api/admin/api-keys/123')).toEqual(['users:delete']);
    });

    test('should return empty array for routes without scopes', () => {
      expect(getRequiredScopes('GET', '/api/unknown-route')).toEqual([]);
      expect(getRequiredScopes('POST', '/api/non-existent')).toEqual([]);
    });

    test('should normalize paths with IDs', () => {
      expect(getRequiredScopes('PUT', '/api/domains/123')).toEqual(['domains:write']);
      expect(getRequiredScopes('PUT', '/api/domains/456')).toEqual(['domains:write']);
      expect(getRequiredScopes('DELETE', '/api/teams/abc')).toEqual(['teams:delete']);
    });
  });

  describe('Integration: Full API Key Lifecycle', () => {
    test('should generate, hash, and verify API key successfully', async () => {
      // Generate key
      const { fullKey, prefix } = await generateApiKey(false);

      // Validate format
      expect(isValidApiKeyFormat(fullKey)).toBe(true);

      // Hash key
      const hash = await hashApiKey(fullKey);

      // Verify correct key
      expect(await verifyApiKey(fullKey, hash)).toBe(true);

      // Verify wrong key
      const { fullKey: wrongKey } = await generateApiKey(false);
      expect(await verifyApiKey(wrongKey, hash)).toBe(false);
    });

    test('should validate scopes and permissions correctly', () => {
      // Admin creates key with admin scopes
      const adminScopes = ['users:*', 'domains:*'];
      const adminValidation = validateScopes(adminScopes, 'admin');
      expect(adminValidation.valid).toBe(true);

      // User tries to create key with admin scopes (should fail)
      const userValidation = validateScopes(adminScopes, 'user');
      expect(userValidation.valid).toBe(false);

      // User creates key with regular scopes
      const userScopes = ['domains:*', 'teams:read'];
      const userValidation2 = validateScopes(userScopes, 'user');
      expect(userValidation2.valid).toBe(true);

      // Check if user scope allows domain read
      expect(hasRequiredScope(userScopes, ['domains:read'])).toBe(true);

      // Check if user scope allows domain write
      expect(hasRequiredScope(userScopes, ['domains:write'])).toBe(true);

      // Check if user scope allows teams write (should fail)
      expect(hasRequiredScope(userScopes, ['teams:write'])).toBe(false);
    });
  });

  describe('Security Tests', () => {
    test('should use sufficient entropy for key generation', async () => {
      const keys = new Set();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const { fullKey } = await generateApiKey(false);
        keys.add(fullKey);
      }

      // All keys should be unique
      expect(keys.size).toBe(iterations);
    });

    test('should not leak timing information in verification', async () => {
      const { fullKey } = await generateApiKey(false);
      const hash = await hashApiKey(fullKey);

      const times = [];

      for (let i = 0; i < 10; i++) {
        const { fullKey: wrongKey } = await generateApiKey(false);
        const start = Date.now();
        await verifyApiKey(wrongKey, hash);
        times.push(Date.now() - start);
      }

      // Calculate standard deviation
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const variance = times.reduce((sum, time) => sum + Math.pow(time - mean, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);

      // Standard deviation should be low (timing-safe)
      expect(stdDev).toBeLessThan(5);
    });

    test('should reject malformed API keys immediately', () => {
      const malformedKeys = [
        '',
        'nbp_',
        'nbp_live_',
        'invalid',
        'nbp_live_' + 'x'.repeat(32),
        'nbp_prod_' + 'a'.repeat(64),
        '../../../etc/passwd',
        '<script>alert("xss")</script>',
        'nbp_live_\x00\x00\x00'
      ];

      malformedKeys.forEach(key => {
        expect(isValidApiKeyFormat(key)).toBe(false);
      });
    });

    test('should handle scope injection attempts', () => {
      const maliciousScopes = [
        'domains:*; DROP TABLE api_keys; --',
        '../../../etc/passwd',
        '<script>alert("xss")</script>',
        'users:*\n\nadmin:*'
      ];

      const userScopes = ['domains:read'];

      maliciousScopes.forEach(scope => {
        expect(hasRequiredScope(userScopes, [scope])).toBe(false);
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty scopes', () => {
      expect(hasRequiredScope([], ['domains:read'])).toBe(false);
      expect(hasRequiredScope(['domains:read'], [])).toBe(true);
    });

    test('should handle case sensitivity', () => {
      const userScopes = ['domains:read'];
      expect(hasRequiredScope(userScopes, ['DOMAINS:READ'])).toBe(false);
      expect(hasRequiredScope(userScopes, ['domains:READ'])).toBe(false);
    });

    test('should handle whitespace in scopes', () => {
      const userScopes = ['domains:read', ' teams:write '];
      expect(hasRequiredScope(userScopes, ['domains:read'])).toBe(true);
      expect(hasRequiredScope(userScopes, [' teams:write '])).toBe(true);
    });
  });
});
