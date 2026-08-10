// @ts-check
// Generic at-rest encryption for small secrets (VPN private keys, etc.),
// same AES-256-GCM-keyed-off-JWT_SECRET approach already proven for TOTP
// secrets in routes/auth/helpers.js — factored out here so callers outside
// the auth routes (e.g. the WireGuard repository) don't need to reach into
// that module for an unrelated concern.
import crypto from 'crypto';
import { config } from '../config/config.js';

export function encryptSecret(plaintext) {
  const key = crypto.createHash('sha256').update(config.jwtSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(payload) {
  if (!payload || typeof payload !== 'string') return '';
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return '';
  const key = crypto.createHash('sha256').update(config.jwtSecret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}
