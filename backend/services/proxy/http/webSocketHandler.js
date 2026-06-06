// Auto-extracted from httpProxy.js — do not edit directly.
// Mixed into HttpProxy.prototype in httpProxy.js.


import { logger } from '../../../utils/logger.js';
import { websocketProxy } from '../../websocketProxy.js';

export class WebSocketHandler {
_handleWebSocketUpgrade(req, socket, head, isTls) {
const hostname = this._extractHostname(req.headers.host);
const domain = this._findDomainByHostname(hostname, 'http');

if (!domain) {
  socket.destroy();
  return;
}

if (domain.ssl_enabled && !isTls) {
  socket.destroy();
  return;
}

const clientIp = this._getRealClientIp(req);
this._getWebSocketBackend(domain, clientIp).then((backend) => {
  websocketProxy.handleUpgrade(req, socket, head, backend, clientIp).catch((error) => {
    logger.error('[ProxyManager] WebSocket upgrade failed:', error.message);
    try {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    } catch (e) {}
    socket.destroy();
  });
}).catch((error) => {
  logger.error('[ProxyManager] WebSocket backend selection failed:', error.message);
  try {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
  } catch (e) {}
  socket.destroy();
});
}

async _getWebSocketBackend(domain, clientIp) {
// Use load balancing if enabled
const target = await this._selectBackendForDomain(domain, clientIp, 'http');
const protocol = target.protocol ? target.protocol.replace(':', '') : 'http';

return {
  target_host: target.hostname,
  target_port: Number(target.port),
  target_protocol: protocol
};
}

/**
 * Find domain by hostname (with caching for performance)
 * SECURITY: O(1) lookup instead of O(n) to prevent performance DOS
 * @param {string} hostname
 * @param {string} [proxyType] - optional filter ('http', 'minecraft', etc.)
 */
}
