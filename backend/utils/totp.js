import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }

  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(input) {
  const normalized = (input || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  if (!normalized) return Buffer.alloc(0);

  let bits = '';
  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 secret');
    bits += idx.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(size = 20) {
  return base32Encode(crypto.randomBytes(size));
}

export function generateOtpAuthUrl({ issuer = 'NebulaProxy', accountName, secret }) {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(accountName || 'user');
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

function generateTotpAtTime(secret, timeMs) {
  const key = base32Decode(secret);
  const timestep = Math.floor(timeMs / 1000 / 30);
  const counter = Buffer.alloc(8);

  // 64-bit big-endian counter
  counter.writeUInt32BE(Math.floor(timestep / 0x100000000), 0);
  counter.writeUInt32BE(timestep >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secret, code, window = 1) {
  const normalizedCode = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedCode)) return false;
  if (!secret || typeof secret !== 'string') return false;

  const now = Date.now();
  for (let offset = -window; offset <= window; offset++) {
    const candidate = generateTotpAtTime(secret, now + offset * 30_000);
    if (candidate === normalizedCode) return true;
  }
  return false;
}

