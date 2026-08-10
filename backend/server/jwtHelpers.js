import crypto from 'crypto';

// Verifies an HS256 JWT against an explicit secret without using @fastify/jwt.
export function verifyHs256(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const [header, payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  if (expected !== sig) throw new Error('Invalid JWT signature');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) throw new Error('JWT expired');
  return decoded;
}

/**
 * Returns a verifyJwt function bound to the fastify instance.
 * Tries the current JWT secret first, then each previous secret for zero-downtime rotation.
 * Call AFTER fastify.jwt plugin is registered.
 */
export function createVerifyJwt(fastify, config) {
  return function verifyJwt(token) {
    try {
      return fastify.jwt.verify(token);
    } catch (primaryErr) {
      for (const secret of config.jwtSecretPrevious) {
        try { return verifyHs256(token, secret); } catch { /* try next */ }
      }
      throw primaryErr;
    }
  };
}
