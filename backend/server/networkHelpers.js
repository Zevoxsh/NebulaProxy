import { networkInterfaces } from 'os';
import { isIP } from 'net';

export function normalizeHost(host) {
  let value = String(host || '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  return value;
}

export function getServerInterfaceHosts() {
  const hosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
  Object.values(networkInterfaces()).forEach((iface) => {
    (iface || []).forEach((entry) => {
      const addr = normalizeHost(entry?.address);
      if (addr) hosts.add(addr);
    });
  });
  return hosts;
}

export function isDynamicAllowedOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = normalizeHost(parsed.hostname);
    if (!hostname) return false;
    if (isIP(hostname)) return true;
    return getServerInterfaceHosts().has(hostname);
  } catch {
    return false;
  }
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) >>> 0) + ((nums[1] << 16) >>> 0) + ((nums[2] << 8) >>> 0) + (nums[3] >>> 0);
}

export function isIpTrustedByRule(ip, rule) {
  const rawRule = String(rule || '').trim();
  if (!rawRule) return false;
  if (!rawRule.includes('/')) return ip === rawRule;
  const [cidrIp, prefixRaw] = rawRule.split('/');
  const prefix = Number.parseInt(prefixRaw, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const cidrInt = ipv4ToInt(cidrIp);
  if (ipInt === null || cidrInt === null) return false;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipInt & mask) === (cidrInt & mask);
}

export function isTrustedProxyIp(clientIp, trustedProxies = []) {
  if (!clientIp) return false;
  if (!Array.isArray(trustedProxies) || trustedProxies.length === 0) return false;
  return trustedProxies.some((rule) => isIpTrustedByRule(clientIp, rule));
}
