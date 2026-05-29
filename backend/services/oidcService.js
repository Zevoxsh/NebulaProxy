/**
 * OIDC Service — generic OpenID Connect 1.0 client.
 * Works with Keycloak, Okta, Azure AD, Google, Auth0, and any compliant provider.
 *
 * Uses only built-in Node.js modules (fetch, crypto) — no extra npm package.
 * ID token verification uses the provider's JWKS endpoint + Node.js crypto.
 */
import crypto from 'crypto';
import { pool } from '../config/database.js';

// ── JWT / JWKS verification (no external deps) ────────────────────────────────

function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseJwtUnsafe(token) {
  const [h, p] = token.split('.');
  const header  = JSON.parse(b64urlDecode(h));
  const payload = JSON.parse(b64urlDecode(p));
  return { header, payload };
}

function jwkToPublicKey(jwk) {
  if (jwk.kty === 'RSA') {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }
  if (jwk.kty === 'EC') {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }
  throw new Error(`Unsupported JWK key type: ${jwk.kty}`);
}

const ALG_MAP = {
  RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512',
  ES256: 'SHA256',     ES384: 'SHA384',     ES512: 'SHA512',
  PS256: 'SHA256',     PS384: 'SHA384',     PS512: 'SHA512'
};

function verifyJwtSignature(token, publicKey, alg) {
  const signingAlg = ALG_MAP[alg];
  if (!signingAlg) throw new Error(`Unsupported JWT algorithm: ${alg}`);

  const [headerB64, payloadB64, sigB64] = token.split('.');
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature    = b64urlDecode(sigB64);

  if (alg.startsWith('PS')) {
    return crypto.verify(signingAlg, signingInput, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }, signature);
  }
  return crypto.verify(signingAlg, signingInput, publicKey, signature);
}

async function verifyIdToken(idToken, disc, cfg, jwksCache) {
  if (!idToken) throw new Error('No ID token returned by provider');

  const { header, payload } = parseJwtUnsafe(idToken);

  // Fetch JWKS (use cache)
  let jwks = jwksCache.get(disc.jwks_uri);
  if (!jwks) {
    const res = await fetch(disc.jwks_uri, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    jwks = (await res.json()).keys;
    jwksCache.set(disc.jwks_uri, jwks);
  }

  // Find matching key (by kid, or first key)
  const jwk = jwks.find(k => !header.kid || k.kid === header.kid) || jwks[0];
  if (!jwk) throw new Error('No matching JWK found for ID token');

  const publicKey = jwkToPublicKey(jwk);
  const valid     = verifyJwtSignature(idToken, publicKey, header.alg);
  if (!valid) throw new Error('ID token signature verification failed');

  // Validate standard claims
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now)       throw new Error('ID token is expired');
  if (payload.iat && payload.iat > now + 60)  throw new Error('ID token issued in the future');
  if (payload.iss !== disc.issuer)            throw new Error(`ID token issuer mismatch: ${payload.iss}`);
  if (cfg.client_id && payload.aud) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(cfg.client_id)) throw new Error('ID token audience mismatch');
  }

  return payload;
}

const TIMEOUT_MS = 10_000;

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OIDC fetch ${url} returned ${res.status}`);
  return res.json();
}

class OidcService {
  #discovery  = null;                 // cached discovery document
  #jwks       = null;                 // cached JWK set (raw, legacy)
  #jwksCache  = new Map();            // jwks_uri → keys[] for signature verification

  async loadConfig() {
    const { rows } = await pool.query(
      "SELECT value FROM system_config WHERE key = 'oidc_config' LIMIT 1"
    );
    if (!rows.length) return null;
    return JSON.parse(rows[0].value);
  }

  async isEnabled() {
    const cfg = await this.loadConfig();
    return Boolean(cfg?.enabled && cfg?.issuer_url && cfg?.client_id && cfg?.client_secret);
  }

  async getDiscovery(issuerUrl) {
    if (this.#discovery?.issuer === issuerUrl) return this.#discovery;
    const url = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    this.#discovery = await fetchJson(url);
    this.#jwks = null;  // reset JWKs when issuer changes
    return this.#discovery;
  }

  async getAuthorizationUrl(cfg, state) {
    const disc = await this.getDiscovery(cfg.issuer_url);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     cfg.client_id,
      redirect_uri:  cfg.redirect_uri,
      scope:         cfg.scope || 'openid email profile',
      state
    });
    return `${disc.authorization_endpoint}?${params}`;
  }

  async exchangeCode(cfg, code) {
    const disc = await this.getDiscovery(cfg.issuer_url);
    const body = new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: cfg.redirect_uri,
      client_id:    cfg.client_id,
      client_secret: cfg.client_secret
    });

    const res = await fetch(disc.token_endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
      signal:  AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async getUserInfo(disc, accessToken) {
    const res = await fetch(disc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal:  AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`UserInfo failed: ${res.status}`);
    return res.json();
  }

  /**
   * Full OIDC callback flow: exchange code → get user info → map to Nebula user.
   * Returns { user, isNew } where user is the DB row.
   */
  async handleCallback(code) {
    const cfg = await this.loadConfig();
    if (!cfg?.enabled) throw new Error('OIDC is not enabled');

    const disc    = await this.getDiscovery(cfg.issuer_url);
    const tokens  = await this.exchangeCode(cfg, code);

    // Verify ID token signature + claims cryptographically (JWKS)
    await verifyIdToken(tokens.id_token, disc, cfg, this.#jwksCache);

    const info    = await this.getUserInfo(disc, tokens.access_token);

    const email    = info.email;
    const username = info.preferred_username || info.sub || email?.split('@')[0];
    const name     = info.name || info.given_name || username;

    if (!email) throw new Error('OIDC provider did not return an email address');

    // Determine role
    let role = 'user';
    if (cfg.admin_group && cfg.role_claim) {
      const claims = info[cfg.role_claim] || [];
      const groups = Array.isArray(claims) ? claims : [claims];
      if (groups.some(g => g === cfg.admin_group)) role = 'admin';
    }

    // Find or create user
    const existing = await pool.query(
      "SELECT * FROM users WHERE email = $1 LIMIT 1",
      [email]
    );

    if (existing.rows.length) {
      const u = existing.rows[0];
      // Update role if it changed via group membership
      if (u.role !== role && cfg.sync_roles) {
        await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, u.id]);
        u.role = role;
      }
      return { user: u, isNew: false };
    }

    if (!cfg.auto_create_users) {
      throw new Error('This account is not registered in NebulaProxy. Contact your administrator.');
    }

    const { rows } = await pool.query(
      `INSERT INTO users (username, email, display_name, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [username, email, name, role, `oidc:${crypto.randomBytes(16).toString('hex')}`]
    );
    return { user: rows[0], isNew: true };
  }

  generateState() {
    return crypto.randomBytes(24).toString('hex');
  }
}

export const oidcService = new OidcService();
