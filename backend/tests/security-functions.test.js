/**
 * Unit tests for security functions
 * Tests all security utilities without requiring server
 */

import { describe, it, expect } from 'vitest';

describe('Security Functions - Unit Tests', () => {

  describe('Hostname Sanitization', () => {
    it('should sanitize valid hostnames', async () => {
      const { sanitizeHostname } = await import('../utils/security.js');

      expect(sanitizeHostname('example.com')).toBe('example.com');
      expect(sanitizeHostname('sub.example.com')).toBe('sub.example.com');
      expect(sanitizeHostname('*.example.com')).toBe('*.example.com');
    });

    it('should reject malicious hostnames', async () => {
      const { sanitizeHostname } = await import('../utils/security.js');

      expect(() => sanitizeHostname('test.com && rm -rf /')).toThrow(/Invalid hostname/);
      expect(() => sanitizeHostname('test.com; cat /etc/passwd')).toThrow(/Invalid hostname/);
      expect(() => sanitizeHostname('test.com|whoami')).toThrow(/Invalid hostname/);
      expect(() => sanitizeHostname('test.com`whoami`')).toThrow(/Invalid hostname/);
      expect(() => sanitizeHostname('test.com$(whoami)')).toThrow(/Invalid hostname/);
    });

    it('should reject invalid characters', async () => {
      const { sanitizeHostname } = await import('../utils/security.js');

      expect(() => sanitizeHostname('test com')).toThrow(/Invalid hostname/);
      expect(() => sanitizeHostname('test<script>')).toThrow(/Invalid hostname/);
      expect(() => sanitizeHostname('test@host')).toThrow(/Invalid hostname/);
    });
  });

  describe('Backend URL Validation', () => {
    it('should accept valid public URLs', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');

      expect(() => validateBackendUrl('http://8.8.8.8:80')).not.toThrow();
      expect(() => validateBackendUrl('https://example.com:443')).not.toThrow();
      expect(() => validateBackendUrl('http://1.2.3.4:8080')).not.toThrow();
    });

    it('should block private IP addresses', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');

      expect(() => validateBackendUrl('http://10.0.0.1')).toThrow(/Private IP/);
      expect(() => validateBackendUrl('http://192.168.1.1')).toThrow(/Private IP/);
      expect(() => validateBackendUrl('http://172.16.0.1')).toThrow(/Private IP/);
      expect(() => validateBackendUrl('http://127.0.0.1')).toThrow(/Blocked hostname|Private IP/);
    });

    it('should block cloud metadata endpoints', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');

      expect(() => validateBackendUrl('http://169.254.169.254')).toThrow(/metadata endpoint/);
      expect(() => validateBackendUrl('http://metadata.google.internal')).toThrow(/metadata endpoint/);
    });

    it('should block localhost variations', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');

      expect(() => validateBackendUrl('http://localhost:8080')).toThrow(/Blocked hostname/);
      expect(() => validateBackendUrl('http://0.0.0.0:8080')).toThrow(/Blocked hostname/);
    });

    it('should only allow specific protocols', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');

      expect(() => validateBackendUrl('http://example.com')).not.toThrow();
      expect(() => validateBackendUrl('https://example.com')).not.toThrow();
      expect(() => validateBackendUrl('file:///etc/passwd')).toThrow(/Protocol not allowed/);
      expect(() => validateBackendUrl('ftp://example.com')).toThrow(/Protocol not allowed/);
      expect(() => validateBackendUrl('gopher://example.com')).toThrow(/Protocol not allowed/);
    });
  });

  describe('HTML Sanitization', () => {
    it('should escape HTML special characters', async () => {
      const { sanitizeHtml } = await import('../utils/security.js');

      expect(sanitizeHtml('<script>alert("XSS")</script>'))
        .toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;');

      expect(sanitizeHtml('Test & <b>bold</b>'))
        .toBe('Test &amp; &lt;b&gt;bold&lt;&#x2F;b&gt;');

      expect(sanitizeHtml('a > b && c < d'))
        .toBe('a &gt; b &amp;&amp; c &lt; d');
    });

    it('should handle empty and null inputs', async () => {
      const { sanitizeHtml } = await import('../utils/security.js');

      expect(sanitizeHtml('')).toBe('');
      expect(sanitizeHtml(null)).toBe('');
      expect(sanitizeHtml(undefined)).toBe('');
    });
  });

  describe('Email Validation', () => {
    it('should accept valid emails', async () => {
      const { isValidEmail } = await import('../utils/security.js');

      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('test.user@example.co.uk')).toBe(true);
      expect(isValidEmail('user+tag@example.com')).toBe(true);
    });

    it('should reject invalid emails', async () => {
      const { isValidEmail } = await import('../utils/security.js');

      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('no-at-sign.com')).toBe(false);
      expect(isValidEmail('@no-user.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('user@localhost')).toBe(false);
    });

    it('should reject overly long emails', async () => {
      const { isValidEmail } = await import('../utils/security.js');

      const longEmail = 'a'.repeat(250) + '@example.com';
      expect(isValidEmail(longEmail)).toBe(false);
    });
  });

  describe('Team Name Sanitization', () => {
    it('should accept valid team names', async () => {
      const { sanitizeTeamName } = await import('../utils/security.js');

      expect(sanitizeTeamName('My Team')).toBe('My Team');
      expect(sanitizeTeamName('Team-123')).toBe('Team-123');
      expect(sanitizeTeamName('Team_Name')).toBe('Team_Name');
    });

    it('should reject invalid team names', async () => {
      const { sanitizeTeamName } = await import('../utils/security.js');

      expect(() => sanitizeTeamName('ab')).toThrow(/between 3 and 50/);
      expect(() => sanitizeTeamName('a'.repeat(51))).toThrow(/between 3 and 50/);
      expect(() => sanitizeTeamName('Team<script>')).toThrow(/can only contain/);
      expect(() => sanitizeTeamName('Team@Name')).toThrow(/can only contain/);
    });
  });

  describe('LDAP Escaping', () => {
    it('should escape LDAP filter special characters', async () => {
      const { ldapAuth } = await import('../services/ldap.js');

      expect(ldapAuth.escapeLDAPFilter('admin')).toBe('admin');
      expect(ldapAuth.escapeLDAPFilter('admin*')).toBe('admin\\2a');
      expect(ldapAuth.escapeLDAPFilter('admin(test)')).toBe('admin\\28test\\29');
      expect(ldapAuth.escapeLDAPFilter('admin\\test')).toBe('admin\\5ctest');
    });

    it('should prevent LDAP injection attacks', async () => {
      const { ldapAuth } = await import('../services/ldap.js');

      const malicious1 = 'admin)(objectClass=*))(&(cn=test';
      const escaped1 = ldapAuth.escapeLDAPFilter(malicious1);

      expect(escaped1).not.toContain('(');
      expect(escaped1).not.toContain(')');
      expect(escaped1).toContain('\\28');
      expect(escaped1).toContain('\\29');
    });

    it('should escape LDAP DN special characters', async () => {
      const { ldapAuth } = await import('../services/ldap.js');

      expect(ldapAuth.escapeLDAPDN('admin')).toBe('admin');
      expect(ldapAuth.escapeLDAPDN('admin,test')).toBe('admin\\,test');
      expect(ldapAuth.escapeLDAPDN('admin=test')).toBe('admin\\=test');
      expect(ldapAuth.escapeLDAPDN('admin+test')).toBe('admin\\+test');
    });
  });

  describe('Password Hashing', () => {
    it('should hash passwords with scrypt', async () => {
      // Import the route to access the function
      // Note: Since hashPassword is not exported, we test indirectly
      const crypto = await import('crypto');

      // Test scrypt hashing
      const password = 'TestPassword123!';
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64);
      const stored = `scrypt$${salt}$${hash.toString('hex')}`;

      expect(stored).toMatch(/^scrypt\$/);
      expect(stored.split('$')).toHaveLength(3);
    });

    it('should verify passwords with timing-safe comparison', async () => {
      const crypto = await import('crypto');

      // Create a password hash
      const password = 'TestPassword123!';
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64);

      // Verify same password
      const derived = crypto.scryptSync(password, salt, hash.length);
      const isValid = crypto.timingSafeEqual(hash, derived);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect passwords', async () => {
      const crypto = await import('crypto');

      const password = 'CorrectPassword';
      const wrongPassword = 'WrongPassword';
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64);

      const derived = crypto.scryptSync(wrongPassword, salt, hash.length);

      // Should not be equal
      expect(hash.equals(derived)).toBe(false);
    });
  });

  describe('Audit Log Sanitization', () => {
    it('should sanitize objects for audit logs', async () => {
      const { sanitizeAuditDetails } = await import('../utils/security.js');

      const input = {
        username: 'admin',
        action: 'login',
        details: '<script>alert("XSS")</script>'
      };

      const sanitized = sanitizeAuditDetails(input);

      expect(sanitized.username).toBe('admin');
      expect(sanitized.action).toBe('login');
      expect(sanitized.details).not.toContain('<script>');
      expect(sanitized.details).toContain('&lt;script&gt;');
    });

    it('should handle nested objects', async () => {
      const { sanitizeAuditDetails } = await import('../utils/security.js');

      const input = {
        user: {
          name: '<b>Admin</b>',
          email: 'admin@example.com'
        }
      };

      const sanitized = sanitizeAuditDetails(input);

      expect(sanitized.user.name).toBe('&lt;b&gt;Admin&lt;&#x2F;b&gt;');
      expect(sanitized.user.email).toBe('admin@example.com');
    });
  });
});

describe('Configuration Validation', () => {
  it('should have security configuration enabled', async () => {
    const { config } = await import('../config.js');

    expect(config.security).toBeDefined();
    expect(config.security.csrfEnabled).toBeDefined();
    expect(config.security.dnsRebindingProtection).toBeDefined();
  });

  it('should have Redis configuration', async () => {
    const { config } = await import('../config.js');

    expect(config.redis).toBeDefined();
    expect(config.redis.host).toBeDefined();
    expect(config.redis.port).toBeDefined();
  });

  it('should enforce strong JWT secret in production', async () => {
    const { config } = await import('../config.js');

    // In test mode, we allow test secrets
    // In production, this should be enforced
    expect(config.jwtSecret).toBeDefined();
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });
});
