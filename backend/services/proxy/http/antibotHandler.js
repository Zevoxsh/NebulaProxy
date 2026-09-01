// Anubis anti-bot integration (https://anubis.techaro.lol).
// Mixed into HttpProxy.prototype in httpProxy.js.
//
// Flow for a domain with antibot_enabled:
//   client → shared HTTP(S) server → _forwardToAnubis() → anubis container
//          → anubis challenges the client (proof-of-work) or, once verified,
//            proxies the request to the re-entry listener below
//          → re-entry listener → _proxyHttpRequest() with req._antibotReentry
//            set, so the anti-bot step is skipped and the normal pipeline
//            (quota, rate limit, DDoS, URL filter, logging) runs exactly once.
//
// WebSocket upgrades never go through Anubis: the shared servers hand them to
// _handleWebSocketUpgrade before _proxyHttpRequest runs, and Anubis' challenge
// is aimed at browsers fetching pages, not at established app sockets.

import http from 'http';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/config.js';
import { renderBadGatewayPage } from '../renderers.js';
import { httpKeepAliveAgent } from './requestProxy.js';

// Hop-by-hop headers must not be forwarded (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

// The re-entry listener trusts X-Real-IP/X-Forwarded-Proto, so even though it
// binds a non-public address, only accept connections from loopback or the
// private ranges the docker bridge lives in (defense in depth).
const PRIVATE_SOURCE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fd)/;

export class AntibotHandler {

/**
 * Tunnel a request to the Anubis sidecar. Terminal on success — Anubis either
 * serves its challenge or proxies the request back through the re-entry
 * listener. If Anubis is unreachable, fail open for bodyless requests
 * (continue the normal pipeline via onBypass) since no body was consumed;
 * requests with a body can't be replayed, so those get a 502.
 */
_forwardToAnubis(req, res, domain, clientIp, onBypass) {
  const headers = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = val;
  }
  headers['Host'] = req.headers.host || domain.hostname;
  headers['X-Real-IP'] = clientIp;
  headers['X-Forwarded-For'] = clientIp;
  headers['X-Forwarded-Proto'] = req.socket.encrypted ? 'https' : 'http';
  headers['X-Forwarded-Host'] = req.headers.host;

  const anubisReq = http.request({
    hostname: config.proxy.antibot.upstreamHost,
    port: config.proxy.antibot.upstreamPort,
    path: req.url,
    method: req.method,
    agent: httpKeepAliveAgent,
    headers,
  }, (anubisRes) => {
    anubisRes.on('error', (err) => {
      logger.warn(`[Antibot ${domain.id}] anubis response stream error: ${err.message}`);
      if (!res.writableEnded) res.destroy(err);
    });
    res.writeHead(anubisRes.statusCode, { ...anubisRes.headers });
    anubisRes.pipe(res);
  });

  let bodyStarted = false;
  const canFailOpen = req.method === 'GET' || req.method === 'HEAD';

  anubisReq.on('error', (error) => {
    if (!bodyStarted && !res.headersSent && canFailOpen) {
      // Anubis down — never take every protected domain down with it.
      logger.warn(`[Antibot ${domain.id}] anubis unreachable (${error.code || error.message}) — failing open`);
      onBypass();
      return;
    }
    logger.error(`[Antibot ${domain.id}] anubis forward failed: ${error.message}`);
    if (!res.headersSent) {
      if ((req.headers.accept || '').includes('text/html')) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderBadGatewayPage(domain.hostname, { errorCode: error.code, errorMessage: error.message }));
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway', message: 'Anti-bot service unavailable' }));
      }
    }
  });

  req.on('error', (err) => { anubisReq.destroy(err); });
  if (canFailOpen) {
    anubisReq.end();
  } else {
    req.on('data', () => { bodyStarted = true; });
    req.pipe(anubisReq);
  }
}

/**
 * Start the loopback/bridge listener Anubis proxies verified traffic back
 * into (its TARGET). Idempotent; failure is non-fatal — anti-bot domains
 * then fail open through _forwardToAnubis's error path.
 */
_ensureAntibotReentryServer() {
  if (this.antibotReentryServer !== undefined) return;
  this.antibotReentryServer = null; // claimed — don't retry on every domain start

  const bindAddr = config.proxy.antibot.reentryBind;
  const bindPort = config.proxy.antibot.reentryPort;

  const server = http.createServer((req, res) => {
    const source = req.socket?.remoteAddress || '';
    if (!PRIVATE_SOURCE.test(source.replace('::ffff:', ''))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    const hostname = this._extractHostname(req.headers.host);
    const domain = this._findDomainByHostname(hostname, 'http');
    // Only serve domains that actually route through Anubis — the listener
    // must not become a side door around the public entry points.
    if (!domain || !domain.antibot_enabled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found', message: `No anti-bot domain for hostname: ${hostname}` }));
      return;
    }

    req._antibotReentry = true;
    this._proxyHttpRequest(req, res, domain);
  });

  server.on('upgrade', (req, socket) => { socket.destroy(); });
  server.on('error', (err) => {
    logger.warn(`[Antibot] re-entry listener failed on ${bindAddr}:${bindPort} (${err.code || err.message}) — anti-bot domains will fail open`);
    this.antibotReentryServer = null;
  });
  server.listen(bindPort, bindAddr, () => {
    this.antibotReentryServer = server;
    logger.info(`[Antibot] re-entry listener on ${bindAddr}:${bindPort} (anubis target)`);
  });
}

}
