// Auto-extracted from httpProxy.js — do not edit directly.
// Mixed into HttpProxy.prototype in httpProxy.js.


import { logger } from '../../../utils/logger.js';
export class AcmeHandler {
async _handleAcmeChallenge(req, res) {
// Serve files from ACME webroot
const webrootDir = this.acmeManager?.webrootDir || '/var/www/letsencrypt';
const challengePath = req.url.replace('/.well-known/acme-challenge/', '');

// SECURITY FIX: Sanitize path to prevent directory traversal
// 1. Get only the filename (no directories allowed)
const sanitized = path.basename(challengePath);

// 2. Validate: ACME challenge tokens are [A-Za-z0-9_-]{43} (base64url)
// Allow alphanumeric, dash, underscore only
if (!/^[A-Za-z0-9_-]+$/.test(sanitized) || sanitized.length > 256) {
  res.writeHead(400, { 'Content-Type': 'text/plain' });
  res.end('Invalid challenge token format');
  return;
}

// 3. Build safe path
const safePath = path.join(webrootDir, '.well-known', 'acme-challenge', sanitized);

try {
  // 4. Verify resolved path is within webroot (prevent symlink attacks)
  const realPath = await fs.promises.realpath(safePath).catch(() => null);
  const realWebroot = await fs.promises.realpath(webrootDir).catch(() => webrootDir);

  if (!realPath || !realPath.startsWith(realWebroot)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // 5. Now safe to read
  const content = await fs.promises.readFile(realPath, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(content);

} catch (error) {
  if (error.code === 'ENOENT') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Challenge not found');
  } else {
    logger.error('[ProxyManager] ACME challenge error:', error.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
}
}

/**
 * Proxy HTTP request to backend with load balancing support
 */
}
