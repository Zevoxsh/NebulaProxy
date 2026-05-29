/**
 * Proxy utility functions — extracted from ProxyManager.
 *
 * Pure functions with no class state. Independently importable and testable.
 */

// ── IP helpers ────────────────────────────────────────────────────────────────

export function normalizeIp(ip) {
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1')             return '127.0.0.1';
  return ip;
}

/** Build a PROXY Protocol v2 binary header (RFC, used for TCP/UDP backends). */
export function buildProxyV2Header(srcIp, srcPort, dstIp, dstPort) {
  const isIPv6 = (srcIp || '').includes(':');
  const sig     = Buffer.from([0x0D,0x0A,0x0D,0x0A,0x00,0x0D,0x0A,0x51,0x55,0x49,0x54,0x0A]);
  const addrLen = isIPv6 ? 36 : 12;
  const header  = Buffer.alloc(16 + addrLen);

  sig.copy(header, 0);
  header[12] = 0x21;                         // version 2, PROXY command
  header[13] = isIPv6 ? 0x22 : 0x12;         // AF_INET(6) + DGRAM
  header.writeUInt16BE(addrLen, 14);

  if (isIPv6) {
    const expand = (ip) => {
      const halves = ip.split('::');
      const left   = halves[0] ? halves[0].split(':') : [];
      const right  = halves[1] ? halves[1].split(':') : [];
      const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
      const buf    = Buffer.alloc(16);
      groups.forEach((g, i) => { const v = parseInt(g || '0', 16); buf[i*2] = v>>8; buf[i*2+1] = v&0xFF; });
      return buf;
    };
    expand(srcIp).copy(header, 16);
    expand(dstIp).copy(header, 32);
    header.writeUInt16BE(srcPort, 48);
    header.writeUInt16BE(dstPort, 50);
  } else {
    const s = srcIp.split('.').map(Number);
    const d = (dstIp || '0.0.0.0').split('.').map(Number);
    header[16]=s[0]; header[17]=s[1]; header[18]=s[2]; header[19]=s[3];
    header[20]=d[0]; header[21]=d[1]; header[22]=d[2]; header[23]=d[3];
    header.writeUInt16BE(srcPort, 24);
    header.writeUInt16BE(dstPort, 26);
  }

  return header;
}

// ── Hostname extraction ───────────────────────────────────────────────────────

export function extractHostname(hostHeader) {
  if (!hostHeader) return '';
  const bracketed = hostHeader.match(/^\[([^\]]+)\]/);
  if (bracketed) return bracketed[1].toLowerCase();
  return hostHeader.split(':')[0].toLowerCase();
}
