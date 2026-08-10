// @ts-check
/**
 * Domain service — pure business-logic functions extracted from routes/domains.js.
 * None of these functions reference the Fastify instance, request, or reply objects.
 */
import http from 'http';
import https from 'https';
import dns from 'dns/promises';
import { database } from './database.js';
import { config } from '../config/config.js';
import { MIN_EXTERNAL_PORT, MAX_EXTERNAL_PORT } from './portAllocator.js';

export const ROUTE_CHECK_PATH = '/.well-known/nebula-proxy';
export const ROUTE_CHECK_TIMEOUT_MS = 5000;

// ── Input validation helpers ─────────────────────────────────────────────────

/**
 * Returns an error message if the backend URL includes a port (ports must use backendPort field).
 */
export const getBackendUrlPortError = (backendUrl) => {
  try {
    const parsedUrl = new URL(backendUrl);
    if (parsedUrl.port) {
      return 'Backend URL must not include a port. Use the backendPort field instead.';
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * Parses and validates a port number string.
 * Returns the integer port or null if invalid / out of range.
 */
export const parsePortNumber = (value) => {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port)) return null;
  if (port < MIN_EXTERNAL_PORT || port > MAX_EXTERNAL_PORT) return null;
  return port;
};

// ── DNS helpers ──────────────────────────────────────────────────────────────

/**
 * Resolves A, AAAA and CNAME records for a hostname.
 */
export const resolveDns = async (hostname) => {
  const results = { a: [], aaaa: [], cname: [] };
  const [a, aaaa, cname] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
    dns.resolveCname(hostname)
  ]);
  if (a.status    === 'fulfilled') results.a     = a.value;
  if (aaaa.status === 'fulfilled') results.aaaa  = aaaa.value;
  if (cname.status === 'fulfilled') results.cname = cname.value;
  return results;
};

// ── Route-check probe ────────────────────────────────────────────────────────

/**
 * Makes an HTTP/HTTPS request to check that the backend serves the Nebula route-check token.
 */
export const probeUrl = (url, hostname) => new Promise((resolve) => {
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    timeout: ROUTE_CHECK_TIMEOUT_MS,
    headers: {
      Host: hostname,
      'User-Agent': 'NebulaProxy-RouteCheck/1.0'
    }
  };
  if (isHttps) options.rejectUnauthorized = !config.proxy.allowInsecureBackends;

  const req = client.request(options, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; if (body.length > 512) body = body.slice(0, 512); });
    res.on('end', () => {
      const headerToken = res.headers['x-nebula-proxy'];
      const ok = headerToken === config.proxy.checkToken || body.trim() === config.proxy.checkToken;
      resolve({ ok, statusCode: res.statusCode });
    });
  });
  req.on('error', (error) => resolve({ ok: false, error: error.message }));
  req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  req.end();
});

// ── Permission helpers ───────────────────────────────────────────────────────

/** Returns true if the user can read the domain (owner or team member). */
export async function canAccessDomain(domain, userId) {
  if (domain.user_id === userId) return true;
  if (domain.team_id && await database.isTeamMember(domain.team_id, userId)) return true;
  return false;
}

/** Returns true if the user can mutate the domain (owner or team member with manage_domains). */
export async function canModifyDomain(domain, userId) {
  if (domain.user_id === userId) return true;
  if (domain.team_id) {
    return database.hasTeamPermission(domain.team_id, userId, 'can_manage_domains');
  }
  return false;
}

// ── Domain creation input validation ────────────────────────────────────────

/**
 * Validates external port assignment for TCP/UDP proxy types.
 * Returns { error, message } on failure, or null on success.
 */
export function validateExternalPortInput(proxyType, externalPort) {
  if (!['tcp', 'udp', 'minecraft'].includes(proxyType)) return null;
  if (proxyType !== 'minecraft' && externalPort == null) {
    return { error: 'Missing required field', message: 'externalPort is required for TCP/UDP proxies.' };
  }
  return null;
}
