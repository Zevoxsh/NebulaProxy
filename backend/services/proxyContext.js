// @ts-check
// Shared module-level helpers for ProxyManager modules.
// Lazy singletons are module-scoped so they remain singletons across all imports.

let _lb = null;
export const getLb = () => {
  if (!_lb) {
    import('./loadBalancer.js')
      .then(m => { _lb = m.loadBalancer; })
      .catch(() => {});
  }
  return _lb;
};

let _lts = null;
export const lts = () => {
  if (!_lts) {
    import('./liveTrafficService.js')
      .then(m => { _lts = m.liveTrafficService; })
      .catch(() => {});
  }
  return _lts;
};

let _ddos = null;
export const getDdos = () => {
  if (!_ddos) {
    import('./ddosProtectionService.js')
      .then(m => { _ddos = m.ddosProtectionService; })
      .catch(() => {});
  }
  return _ddos;
};

// Warm the lazy singletons shortly after startup so the FIRST request to a
// domain that needs them (e.g. the DDoS/anti-bot challenge) doesn't race the
// async import and fail open. Deferred a tick to avoid circular-import issues
// during initial module resolution.
setTimeout(() => { getDdos(); getLb(); lts(); }, 0);

export const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
