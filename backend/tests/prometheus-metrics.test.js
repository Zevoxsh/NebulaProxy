/**
 * Prometheus text format tests — verifies the helper functions
 * used in routes/metrics.js produce valid Prometheus exposition format.
 */
import { describe, it, expect } from 'vitest';

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labelStr(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}="${esc(v)}"`).join(',');
}

function line(name, lbl, value) {
  if (value == null || (typeof value === 'number' && isNaN(value))) return '';
  const ls = labelStr(lbl);
  return `${name}${ls ? `{${ls}}` : ''} ${value}\n`;
}

describe('Prometheus text format', () => {
  it('produces valid gauge line without labels', () => {
    const out = line('nebula_system_cpu_usage_percent', {}, 42.5);
    expect(out).toBe('nebula_system_cpu_usage_percent 42.5\n');
  });

  it('produces valid gauge line with labels', () => {
    const out = line('nebula_domain_up', { hostname: 'example.com', proxy_type: 'http' }, 1);
    expect(out).toBe('nebula_domain_up{hostname="example.com",proxy_type="http"} 1\n');
  });

  it('escapes special characters in label values', () => {
    const out = line('m', { h: 'ex"ample\ntest' }, 1);
    expect(out).toContain('\\"');
    expect(out).toContain('\\n');
    expect(out).not.toContain('\n' + '{');
  });

  it('returns empty string for null value', () => {
    expect(line('m', {}, null)).toBe('');
  });

  it('returns empty string for NaN value', () => {
    expect(line('m', {}, NaN)).toBe('');
  });

  it('SSL days can be negative (expired certs)', () => {
    const out = line('nebula_ssl_expires_in_days', { hostname: 'old.example.com' }, -5);
    expect(out).toContain('-5');
  });
});
