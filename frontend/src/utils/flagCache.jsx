/**
 * flagCache — Country flag images from flagcdn.com
 *
 * Usage:
 *   import { FlagImg } from '../utils/flagCache';
 *   <FlagImg code="FR" className="w-5 h-3" />
 */

import { normalizeCountryCode } from './countryUtils';

const FLAG_URL = (code) => `https://flagcdn.com/w20/${code.toLowerCase()}.png`;

/**
 * React component: renders the flag image for a country code using a direct img tag.
 * Browser handles caching natively — no fetch/blob/data-URL conversion needed.
 */
export function FlagImg({ code, className = 'w-5 h-3.5', title }) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode || normalizedCode.length !== 2) {
    return (
      <span
        className={`inline-block bg-white/10 rounded-sm ${className}`}
        title="?"
      />
    );
  }

  return (
    <img
      src={FLAG_URL(normalizedCode)}
      alt={normalizedCode}
      title={title || normalizedCode}
      className={`inline-block rounded-sm object-cover ${className}`}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}
