const COUNTRY_ALIASES = {
  USA: 'US',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  AMERICA: 'US',
  UK: 'GB',
  'UNITED KINGDOM': 'GB',
  'GREAT BRITAIN': 'GB',
  BRITAIN: 'GB'
};

export function normalizeCountryCode(country) {
  if (!country) return null;
  const code = String(country).trim().toUpperCase();
  if (!code) return null;
  return COUNTRY_ALIASES[code] || code;
}