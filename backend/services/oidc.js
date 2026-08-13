// @ts-check
/**
 * OIDC (OpenID Connect, authorization code flow) auth service — the
 * enterprise-SSO counterpart to ldap.js, with the same group-based role
 * mapping (adminGroup/userGroup/requireGroup), just sourced from a claim in
 * the userinfo response instead of an LDAP memberOf search.
 *
 * Deliberately does NOT verify the id_token's JWT signature / implement a
 * JWKS client: the code exchange happens over a direct, authenticated
 * backend-to-IdP HTTPS call (not through the browser), so instead of parsing
 * the id_token we call the standard /userinfo endpoint with the access token
 * we just received directly from the token endpoint — equivalent trust for
 * a confidential-client authorization-code flow, without pulling in a JWT/
 * JWKS dependency or hand-rolling RS256 verification. If a provider has no
 * userinfo_endpoint this fails loudly rather than falling back to trusting
 * an unverified id_token.
 */
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const DISCOVERY_CACHE_MS = 10 * 60 * 1000;

class OidcService {
  constructor() {
    this._discoveryCache = null;
    this._discoveryCacheAt = 0;
  }

  get cfg() {
    return config.oidc;
  }

  async discover() {
    const now = Date.now();
    if (this._discoveryCache && now - this._discoveryCacheAt < DISCOVERY_CACHE_MS) {
      return this._discoveryCache;
    }
    if (!this.cfg.issuer) {
      throw new Error('OIDC_ISSUER is not configured');
    }
    const issuer = this.cfg.issuer.replace(/\/+$/, '');
    const res = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!res.ok) {
      throw new Error(`OIDC discovery failed (HTTP ${res.status})`);
    }
    const doc = await res.json();
    if (!doc.authorization_endpoint || !doc.token_endpoint) {
      throw new Error('OIDC discovery document is missing required endpoints');
    }
    this._discoveryCache = doc;
    this._discoveryCacheAt = now;
    return doc;
  }

  // OIDC redirect_uri must exactly match what's registered at the IdP —
  // unlike WebAuthn's per-request origin, this can't safely vary by
  // hostname on a multi-domain proxy appliance. Prefer the explicit
  // override; fall back to a same-origin guess for simple single-hostname
  // deployments.
  getRedirectUri(request) {
    if (this.cfg.redirectUri) return this.cfg.redirectUri;
    const cleanHost = String(request.hostname || '').split(',')[0].trim();
    return `${request.protocol}://${cleanHost}/api/auth/oidc/callback`;
  }

  async buildAuthorizationUrl(request, state, nonce) {
    const doc = await this.discover();
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.cfg.clientId);
    url.searchParams.set('redirect_uri', this.getRedirectUri(request));
    url.searchParams.set('scope', this.cfg.scopes);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    return url.toString();
  }

  async exchangeCode(request, code) {
    const doc = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri(request),
      client_id: this.cfg.clientId
    });
    const basicAuth = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');

    const res = await fetch(doc.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`
      },
      body: body.toString()
    });
    const tokens = await res.json().catch(() => ({}));
    if (!res.ok || !tokens.access_token) {
      throw new Error(tokens.error_description || tokens.error || `OIDC token exchange failed (HTTP ${res.status})`);
    }
    return tokens;
  }

  async fetchUserInfo(accessToken) {
    const doc = await this.discover();
    if (!doc.userinfo_endpoint) {
      throw new Error('OIDC provider has no userinfo_endpoint');
    }
    const res = await fetch(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch OIDC userinfo (HTTP ${res.status})`);
    }
    return res.json();
  }

  resolveRole(groupsClaimValue) {
    const { adminGroup, userGroup, requireGroup } = this.cfg;
    const groups = Array.isArray(groupsClaimValue)
      ? groupsClaimValue
      : (groupsClaimValue ? [groupsClaimValue] : []);

    if (adminGroup && groups.includes(adminGroup)) return 'admin';
    if (userGroup && groups.includes(userGroup)) return 'user';

    if (requireGroup && (adminGroup || userGroup)) {
      const err = new Error('User is not a member of an authorized OIDC group');
      err.code = 'UNAUTHORIZED_GROUP';
      throw err;
    }

    logger.info('[OIDC] No group match / no group required, default USER role');
    return 'user';
  }

  mapClaims(claims) {
    const username = claims[this.cfg.usernameClaim] || claims.preferred_username || claims.email || claims.sub;
    if (!username) {
      throw new Error('OIDC userinfo response has no usable username claim');
    }
    const groupsValue = claims[this.cfg.groupsClaim];
    const groups = Array.isArray(groupsValue) ? groupsValue : (groupsValue ? [groupsValue] : []);

    return {
      username: String(username),
      displayName: claims.name || claims.preferred_username || String(username),
      email: claims.email || '',
      role: this.resolveRole(groupsValue),
      groups
    };
  }

  async verifyConnection() {
    const doc = await this.discover();
    if (!doc.authorization_endpoint || !doc.token_endpoint) {
      throw new Error('Invalid discovery document (missing endpoints)');
    }
    return true;
  }
}

export const oidcAuth = new OidcService();
