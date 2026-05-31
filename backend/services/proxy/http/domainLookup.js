// Auto-extracted from httpProxy.js — do not edit directly.
// Mixed into HttpProxy.prototype in httpProxy.js.


import { logger } from '../../../utils/logger.js';
export class DomainLookup {
_findDomainByHostname(hostname, proxyType = null) {
const normalizedHostname = this._normalizeHostname(hostname);
if (!normalizedHostname) return null;

logger.info(`[ProxyManager] lookup hostname=${hostname || ''} normalized=${normalizedHostname} proxyType=${proxyType || 'any'} cacheSize=${this.domainCache.size} proxyCount=${this.proxies.size}`);

// Cache key includes type when specified so HTTP and Minecraft
// domains with the same hostname don't collide in cache.
const cacheKey = proxyType ? `${proxyType}:${normalizedHostname}` : normalizedHostname;

// Check cache first
const cached = this.domainCache.get(cacheKey);
if (cached && Date.now() - cached.timestamp < this.DOMAIN_CACHE_TTL) {
  logger.info(`[ProxyManager] lookup cache hit key=${cacheKey} domainId=${cached.domain?.id || 'n/a'} hostname=${cached.domain?.hostname || 'n/a'}`);
  return cached.domain;
}

// Cache miss - do lookup
let found = null;
for (const [domainId, entry] of this.proxies) {
  const typeMatch = proxyType
    ? entry.type === proxyType
    : (entry.type === 'http' || entry.type === 'minecraft');
  const entryHostname = this._normalizeHostname(entry?.meta?.hostname);
  logger.info(`[ProxyManager] lookup candidate id=${domainId} type=${entry?.type || 'n/a'} stored=${entryHostname || '-'} requested=${normalizedHostname} typeMatch=${typeMatch ? 'yes' : 'no'}`);
  if (typeMatch && this._matchesHostname(entryHostname, normalizedHostname)) {
    found = entry.meta;
    logger.info(`[ProxyManager] lookup matched id=${domainId} stored=${entry.meta?.hostname || '-'} requested=${normalizedHostname}`);
    break;
  }
}

// Only cache positive results to avoid stale "not found" errors
if (found) {
  this.domainCache.set(cacheKey, {
    domain: found,
    timestamp: Date.now()
  });
} else {
  logger.warn(`[ProxyManager] lookup miss hostname=${normalizedHostname} proxyType=${proxyType || 'any'}`);
}

return found;
}

/**
 * Invalidate domain cache (call when domain is added/removed/updated)
 */
_invalidateDomainCache(hostname) {
if (hostname) {
  const normalizedHostname = this._normalizeHostname(hostname);
  // Remove both the plain key and all type-prefixed keys for this hostname
  this.domainCache.delete(normalizedHostname);
  for (const key of this.domainCache.keys()) {
    if (key.endsWith(`:${normalizedHostname}`)) {
      this.domainCache.delete(key);
    }
  }
} else {
  // Clear entire cache
  this.domainCache.clear();
}
}
}
