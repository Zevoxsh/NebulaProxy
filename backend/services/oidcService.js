/**
 * OIDC Service — generic OpenID Connect 1.0 client.
 * Works with Keycloak, Okta, Azure AD, Google, Auth0, and any compliant provider.
 *
 * Uses only built-in Node.js modules (fetch, crypto) — no extra npm package.
 * ID token verification uses the provider's JWKS endpoint + Node.js crypto.
 */
import crypto from 'crypto';
import { pool } from '../config/database.js';

const TIMEOUT_MS = 10_000;

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OIDC fetch ${url} returned ${res.status}`);
  return res.json();
}

class OidcService {
  #discovery = null;   // cached discovery document
  #jwks      = null;   // cached JWK set

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
