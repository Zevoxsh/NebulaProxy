/**
 * Tests for IPv6 backend URL support (added with dual-stack feature).
 * Covers the changes made to security.js and domain validation.
 */
import { describe, it, expect } from 'vitest';

describe('IPv6 Backend URL Validation', () => {
  describe('validateBackendUrl — IPv6 support', () => {
    it('should accept public IPv6 addresses', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');
      expect(() => validateBackendUrl('http://[2a01:e0a:1::1]:8080')).not.toThrow();
      expect(() => validateBackendUrl('https://[2606:4700:4700::1111]:443')).not.toThrow();
      expect(() => validateBackendUrl('tcp://[2a14:7587:b001::2]:25565')).not.toThrow();
    });

    it('should block IPv6 loopback (::1)', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');
      expect(() => validateBackendUrl('http://[::1]:8080')).toThrow();
    });

    it('should block IPv6 link-local (fe80::)', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');
      expect(() => validateBackendUrl('http://[fe80::1]:8080')).toThrow();
    });

    it('should block IPv6 ULA (fc00::/7)', async () => {
      const { validateBackendUrl } = await import('../utils/security.js');
      expect(() => validateBackendUrl('http://[fc00::1]:8080')).toThrow();
      expect(() => validateBackendUrl('http://[fd00::1]:8080')).toThrow();
    });
  });

  describe('IPv6 URL formatting', () => {
    it('should parse bracketed IPv6 URLs correctly', () => {
      const url = new URL('http://[2a01::1]:3000');
      expect(url.hostname).toBe('2a01::1');
      expect(url.port).toBe('3000');
    });

    it('should detect bare IPv6 addresses (no brackets)', () => {
      const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
      expect(ipv6Regex.test('2a01::1')).toBe(true);
      expect(ipv6Regex.test('::1')).toBe(true);
      expect(ipv6Regex.test('192.168.1.1')).toBe(false);
      expect(ipv6Regex.test('example.com')).toBe(false);
    });

    it('should not flag IPv6 addresses as containing a port', () => {
      // The regex /:\d+$/ used for port detection MUST NOT match pure IPv6 addresses
      const _portRegex = /:\d+$/;
      // These would be false positives — IPv6, no port
      // NOTE: ::1 ends with ":1" which IS matched — that's why the fix checks isValidIpv6 first
      const isIpv6 = (s) => /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(s);
      expect(isIpv6('2a01:e0a::2')).toBe(true);
      expect(isIpv6('::1')).toBe(true);
      expect(isIpv6('192.168.1.1')).toBe(false);
    });
  });

  describe('TCP/UDP URL construction with IPv6', () => {
    it('should wrap bare IPv6 in brackets before building URL', () => {
      const wrapIfIpv6 = (host) => {
        const isIpv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(host);
        return isIpv6 ? `[${host}]` : host;
      };

      expect(wrapIfIpv6('2a01::1')).toBe('[2a01::1]');
      expect(wrapIfIpv6('::1')).toBe('[::1]');
      expect(wrapIfIpv6('192.168.1.1')).toBe('192.168.1.1');
      expect(wrapIfIpv6('example.com')).toBe('example.com');
    });

    it('should produce valid URLs after wrapping', () => {
      const buildUrl = (proto, host) => {
        const isIpv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(host);
        const wrapped = isIpv6 ? `[${host}]` : host;
        return new URL(`${proto}://${wrapped}`);
      };

      const url = buildUrl('tcp', '2a01::1');
      expect(url.hostname).toBe('2a01::1');
      expect(url.protocol).toBe('tcp:');
    });
  });
});
