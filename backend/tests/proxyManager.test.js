import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { proxyManager } from '../services/proxyManager.js';

describe('ProxyManager hostname matching', () => {
  const originalProxies = proxyManager.proxies;
  const originalDomainCache = proxyManager.domainCache;

  beforeEach(() => {
    proxyManager.proxies = new Map();
    proxyManager.domainCache = new Map();
  });

  afterAll(() => {
    proxyManager.proxies = originalProxies;
    proxyManager.domainCache = originalDomainCache;
  });

  it('matches exact hostnames regardless of case or trailing dot', () => {
    proxyManager.proxies.set(1, {
      type: 'http',
      meta: { id: 1, hostname: 'example.com' }
    });

    expect(proxyManager._findDomainByHostname('example.com', 'http')?.id).toBe(1);
    expect(proxyManager._findDomainByHostname('Example.COM', 'http')?.id).toBe(1);
    expect(proxyManager._findDomainByHostname('example.com.', 'http')?.id).toBe(1);
  });

  it('matches single-level wildcard hostnames only for subdomains', () => {
    proxyManager.proxies.set(1, {
      type: 'http',
      meta: { id: 1, hostname: '*.example.com' }
    });

    expect(proxyManager._findDomainByHostname('app.example.com', 'http')?.id).toBe(1);
    expect(proxyManager._findDomainByHostname('deep.app.example.com', 'http')).toBeNull();
    expect(proxyManager._findDomainByHostname('example.com', 'http')).toBeNull();
  });
});