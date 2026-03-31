/**
 * flagCache — Downloads country flag images from flagcdn.com and caches them
 * in localStorage (persistent) + an in-memory Map (fast access).
 *
 * Usage:
 *   import { FlagImg } from '../utils/flagCache';
 *   <FlagImg code="FR" className="w-5 h-3" />
 */

import { useState, useEffect } from 'react';

const LS_PREFIX  = 'nebula_flag_v1_';
const FLAG_URL   = (code) => `https://flagcdn.com/w20/${code.toLowerCase()}.png`;
const inMemory   = new Map(); // session-level cache (data URLs)
const pending    = new Map(); // dedup concurrent fetches for same code

/**
 * Returns a data URL for the given ISO 3166-1 alpha-2 country code.
 * Downloads once, then served from memory / localStorage forever.
 */
export async function getFlagDataUrl(code) {
  if (!code || code.length !== 2) return null;
  const key = code.toLowerCase();

  // 1. In-memory hit (fastest)
  if (inMemory.has(key)) return inMemory.get(key);

  // 2. localStorage hit
  try {
    const stored = localStorage.getItem(LS_PREFIX + key);
    if (stored) {
      inMemory.set(key, stored);
      return stored;
    }
  } catch (_) {}

  // 3. Deduplicate concurrent fetches for the same code
  if (pending.has(key)) return pending.get(key);

  const promise = (async () => {
    try {
      const res = await fetch(FLAG_URL(key));
      if (!res.ok) return null;
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror  = reject;
        reader.readAsDataURL(blob);
      });
      inMemory.set(key, dataUrl);
      try { localStorage.setItem(LS_PREFIX + key, dataUrl); } catch (_) {}
      return dataUrl;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, promise);
  return promise;
}

/**
 * React component: renders the flag image for a country code.
 * Shows a small placeholder globe while loading.
 */
export function FlagImg({ code, className = 'w-5 h-3.5', title }) {
  const [src, setSrc] = useState(() => {
    if (!code) return null;
    return inMemory.get(code.toLowerCase()) || null;
  });

  useEffect(() => {
    if (!code) return;
    const key = code.toLowerCase();
    if (inMemory.has(key)) {
      setSrc(inMemory.get(key));
      return;
    }
    let cancelled = false;
    getFlagDataUrl(code).then(url => {
      if (!cancelled && url) setSrc(url);
    });
    return () => { cancelled = true; };
  }, [code]);

  if (!src) {
    return (
      <span
        className={`inline-block bg-white/10 rounded-sm ${className}`}
        title={title || code || '?'}
      />
    );
  }

  return (
    <img
      src={src}
      alt={code || ''}
      title={title || code || ''}
      className={`inline-block rounded-sm object-cover ${className}`}
      loading="lazy"
    />
  );
}
