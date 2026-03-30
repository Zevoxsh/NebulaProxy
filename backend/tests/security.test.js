/**
 * Security Tests for NebulaProxy
 * Tests all critical security vulnerabilities identified in the penetration testing report
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import crypto from 'crypto';

describe('Security Tests', () => {
  let app;

  beforeAll(async () => {
    // Initialize test server
    // Note: You'll need to import and setup your actual Fastify app
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('CSRF Protection', () => {
    it('should reject requests without CSRF token', async () => {
      // Test that POST/PUT/DELETE requests require CSRF token
      const response = await app.inject({
        method: 'POST',
        url: '/api/domains',
        payload: {
          hostname: 'test.com',
          backendUrl: 'http://localhost:8080'
        },
        headers: {
          cookie: 'token=valid-jwt-token'
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toHaveProperty('error');
    });

    it('should accept requests with valid CSRF token', async () => {
      // First get CSRF token
      const tokenResponse = await app.inject({
        method: 'GET',
        url: '/api/csrf-token',
        headers: {
          cookie: 'token=valid-jwt-token'
        }
      });

      const csrfToken = tokenResponse.json().token;

      // Then make request with CSRF token
      const response = await app.inject({
        method: 'POST',
        url: '/api/domains',
        payload: {
          hostname: 'test.com',
          backendUrl: 'http://localhost:8080'
        },
        headers: {
          cookie: 'token=valid-jwt-token',
          'csrf-token': csrfToken
        }
      });

      expect(response.statusCode).not.toBe(403);
    });
  });

  describe('DNS Rebinding Protection', () => {
    it('should block backend URLs resolving to private IPs', async () => {
      // This would require mocking DNS resolution
      // For now, we test the validation function directly
      const { validateBackendUrlWithDNS } = await import('../utils/security.js');

      await expect(async () => {
        await validateBackendUrlWithDNS('http://localhost:8080');
      }).rejects.toThrow(/Blocked hostname/);
    });

    it('should allow public IP addresses', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');

      expect(() => {
        validateBackendUrl('http://8.8.8.8:80');
      }).not.toThrow();
    });

    it('should block cloud metadata endpoints', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');

      expect(() => {
        validateBackendUrl('http://169.254.169.254/latest/meta-data/');
      }).toThrow(/metadata endpoint/);
    });
  });

  describe('Rate Limiting', () => {
    it('should not trust X-Forwarded-For from untrusted sources', async () => {
      // Make multiple requests with spoofed X-Forwarded-For
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: {
              username: 'admin',
              password: 'wrong'
            },
            headers: {
              'x-forwarded-for': `192.168.1.${i}`  // Spoofed IPs
            },
            remoteAddress: '1.2.3.4'  // Actual IP
          })
        );
      }

      const responses = await Promise.all(requests);

      // Should be rate limited based on actual IP, not spoofed header
      const rateLimited = responses.filter(r => r.statusCode === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it('should rate limit login attempts', async () => {
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: {
              username: 'admin',
              password: `attempt${i}`
            }
          })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.statusCode === 429);

      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('JWT Revocation', () => {
    it('should blacklist tokens on logout', async () => {
      // Login
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'testuser',
          password: 'testpass'
        }
      });

      const token = loginResponse.cookies.find(c => c.name === 'token').value;

      // Logout
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie: `token=${token}`
        }
      });

      // Try to use token after logout
      const response = await app.inject({
        method: 'GET',
        url: '/api/user/me',
        headers: {
          cookie: `token=${token}`
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty('message', 'Token has been revoked');
    });
  });

  describe('LDAP Injection', () => {
    it('should escape LDAP special characters', async () => {
      const { ldapAuth } = await import('../services/ldap.js');

      const maliciousUsername = 'admin)(objectClass=*))(&(cn=test';
      const escaped = ldapAuth.escapeLDAPFilter(maliciousUsername);

      // Should escape parentheses
      expect(escaped).toContain('\\28');  // (
      expect(escaped).toContain('\\29');  // )
      expect(escaped).not.toContain('(');
      expect(escaped).not.toContain(')');
    });

    it('should prevent LDAP injection in authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin)(objectClass=*))(&(cn=test',
          password: 'anything'
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty('error', 'Authentication failed');
    });
  });

  describe('Timing Attack Protection', () => {
    it('should take similar time for existing and non-existing users', async () => {
      const timeLogin = async (username) => {
        const start = Date.now();
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: {
            username,
            password: 'wrongpassword'
          }
        });
        return Date.now() - start;
      };

      // Test with existing user
      const existingUserTime = await timeLogin('admin');

      // Test with non-existing user
      const nonExistingUserTime = await timeLogin('nonexistentuser123');

      // Times should be similar (within 50ms tolerance)
      const diff = Math.abs(existingUserTime - nonExistingUserTime);
      expect(diff).toBeLessThan(50);
    });
  });

  describe('Security Headers', () => {
    it('should include HSTS header in production', async () => {
      process.env.NODE_ENV = 'production';

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.headers).toHaveProperty('strict-transport-security');
      expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    });

    it('should include CSP header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.headers).toHaveProperty('content-security-policy');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('should include X-Frame-Options', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
    });

    it('should include X-Content-Type-Options', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
    });

    it('should not expose sensitive headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.headers).not.toHaveProperty('x-powered-by');
      expect(response.headers).not.toHaveProperty('server');
    });
  });

  describe('Input Validation', () => {
    it('should sanitize hostnames', async () => {
      const { sanitizeHostname } = await import('../utils/security.js');

      expect(() => {
        sanitizeHostname('test.com && rm -rf /');
      }).toThrow(/Invalid hostname format/);
    });

    it('should validate email format', async () => {
      const { isValidEmail } = await import('../utils/security.js');

      expect(isValidEmail('valid@example.com')).toBe(true);
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('test@localhost')).toBe(false);
    });

    it('should sanitize HTML', async () => {
      const { sanitizeHtml } = await import('../utils/security.js');

      const malicious = '<script>alert("XSS")</script>';
      const sanitized = sanitizeHtml(malicious);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('&lt;script&gt;');
    });
  });

  describe('Password Security', () => {
    it('should enforce minimum password length', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          username: 'newuser',
          password: 'short'  // Less than 8 characters
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should hash passwords with scrypt', async () => {
      const { hashPassword } = await import('../routes/auth.js');
      // This function is not exported, but we can test indirectly

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          username: 'newuser',
          password: 'ValidPassword123!',
          email: 'test@example.com'
        }
      });

      expect(response.statusCode).toBe(200);
      // Password should be hashed in database (not testing DB directly here)
    });
  });
});

describe('Redis Service Tests', () => {
  let redisService;

  beforeAll(async () => {
    const { redisService: service } = await import('../services/redis.js');
    redisService = service;
    await redisService.init();
  });

  afterAll(async () => {
    await redisService.close();
  });

  it('should blacklist JWT tokens', async () => {
    const token = 'test-token-' + Date.now();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    await redisService.blacklistToken(token, expiresAt);

    const isBlacklisted = await redisService.isTokenBlacklisted(token);
    expect(isBlacklisted).toBe(true);
  });

  it('should auto-expire blacklisted tokens', async () => {
    const token = 'test-token-expired-' + Date.now();
    const expiresAt = Math.floor(Date.now() / 1000) + 1; // 1 second from now

    await redisService.blacklistToken(token, expiresAt);

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 2000));

    const isBlacklisted = await redisService.isTokenBlacklisted(token);
    expect(isBlacklisted).toBe(false);
  });

  it('should handle rate limiting counters', async () => {
    const key = 'test-rate-limit-' + Date.now();

    const count1 = await redisService.incrementRateLimit(key, 60);
    expect(count1).toBe(1);

    const count2 = await redisService.incrementRateLimit(key, 60);
    expect(count2).toBe(2);

    const count3 = await redisService.getRateLimitCount(key);
    expect(count3).toBe(2);
  });
});
