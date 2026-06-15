// Auto-extracted from proxyManager.js — do not edit directly.
// Mixed into ProxyManager.prototype in proxyManager.js.

import http from 'http';
import https from 'https';
import tls from 'tls';
import { logger } from '../../utils/logger.js';
import { renderNotFoundPage } from './renderers.js';

export class HttpProxy {
// ==================== HTTP/HTTPS PROXY ====================

/**
 * Start HTTP proxy for a domain
 * Uses shared HTTP (port 80) and HTTPS (port 443) servers
 */
async _startHttpProxy(domain) {
  // Ensure shared HTTP server is running
  if (!this.httpServer) {
    await this._startSharedHttpServer();
  }

  // Ensure shared HTTPS server is running if SSL is enabled
  if (domain.ssl_enabled && !this.httpsServer) {
    await this._startSharedHttpsServer();
  }

  // Register domain in proxy map
  this.proxies.set(domain.id, {
    type: 'http',
    server: domain.ssl_enabled ? this.httpsServer : this.httpServer,
    meta: domain
  });

  logger.info(`[ProxyManager] HTTP${domain.ssl_enabled ? 'S' : ''} proxy registered for ${domain.hostname} -> ${domain.backend_url}`);
  logger.info(`[ProxyManager] HTTP proxy state id=${domain.id} hostname=${domain.hostname} ssl=${domain.ssl_enabled ? 'on' : 'off'} active=${domain.is_active ? 'yes' : 'no'} total=${this.proxies.size}`);

  // Load SSL certificate if enabled
  if (domain.ssl_enabled) {
    await this._loadCertificateForDomain(domain.hostname);
  }
}

/**
 * Start shared HTTP server (port 80)
 * Handles all HTTP domains and ACME challenges
 */
  async _startSharedHttpServer() {
    return new Promise((resolve) => {
      this.httpServer = http.createServer((req, res) => {
        if (this._handleProxyCheck(req, res)) {
          return;
        }

        const hostname = this._extractHostname(req.headers.host);
        const normalizedHostname = this._normalizeHostname(hostname);
        logger.info(`[HTTP Server] request method=${req.method || ''} host=${req.headers.host || ''} hostname=${hostname || '-'} normalized=${normalizedHostname || '-'} url=${req.url || ''}`);
        if (this._shouldHandleRedirection(hostname) && this._handlePublicRedirection(req, res)) {
          return;
        }

      // Check for ACME challenge (.well-known/acme-challenge/)
      if (req.url?.startsWith('/.well-known/acme-challenge/')) {
        this._handleAcmeChallenge(req, res);
        return;
      }

      // Find domain in proxies
      const domain = this._findDomainByHostname(hostname, 'http');
      if (!domain) {
        logger.warn(`[HTTP Server] Domain not found for hostname: ${hostname} normalized=${normalizedHostname || '-'} registered=${this.proxies.size}`);
        for (const [id, entry] of this.proxies) {
          if (entry?.type === 'http') {
            logger.warn(`[HTTP Server] candidate id=${id} stored=${entry?.meta?.hostname || '-'} active=${entry?.meta?.is_active ? 'yes' : 'no'} ssl=${entry?.meta?.ssl_enabled ? 'on' : 'off'}`);
          }
        }
        if ((req.headers.accept || '').includes('text/html')) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderNotFoundPage(hostname));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Not Found',
            message: `No proxy configured for hostname: ${hostname}`,
          }));
        }
        return;
      }

      // If SSL enabled, redirect to HTTPS
      if (domain.ssl_enabled) {
        const redirectUrl = `https://${hostname}${req.url}`;
        res.writeHead(301, { Location: redirectUrl });
        res.end();
        return;
      }

      // Proxy the request
      this._proxyHttpRequest(req, res, domain);
    });

    this.httpServer.on('upgrade', (req, socket, head) => {
      this._handleWebSocketUpgrade(req, socket, head, false);
    });

    this.httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn('[ProxyManager] Port 80 already in use, HTTP proxy not started');
        this.httpServer = null;
        resolve();
      } else {
        logger.error('[ProxyManager] HTTP server error:', err.message);
      }
    });

    this.httpServer.listen(80, '::', () => {
      logger.info('[ProxyManager] Shared HTTP server listening on port 80');
      resolve();
    });
  });
}

/**
 * Start shared HTTPS server (port 443)
 * Uses SNI (Server Name Indication) for multi-domain SSL
 */
  async _startSharedHttpsServer() {
    return new Promise((resolve) => {
    const options = {
      SNICallback: (servername, callback) => {
        this._getSniContext(servername, callback);
      },
      cert: STATIC_FALLBACK_CERT,
      key: STATIC_FALLBACK_KEY,
      minVersion: 'TLSv1.2',
      ciphers: [
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305',
        'ECDHE-RSA-CHACHA20-POLY1305',
        'DHE-RSA-AES128-GCM-SHA256',
        'DHE-RSA-AES256-GCM-SHA384'
      ].join(':'),
      honorCipherOrder: true
    };

      this.httpsServer = https.createServer(options, (req, res) => {
        if (this._handleProxyCheck(req, res)) {
          return;
        }

        const hostname = this._extractHostname(req.headers.host);
        const normalizedHostname = this._normalizeHostname(hostname);
        logger.info(`[HTTPS Server] request method=${req.method || ''} host=${req.headers.host || ''} hostname=${hostname || '-'} normalized=${normalizedHostname || '-'} url=${req.url || ''}`);
        if (this._shouldHandleRedirection(hostname) && this._handlePublicRedirection(req, res)) {
          return;
        }

      // Find domain in proxies
      const domain = this._findDomainByHostname(hostname, 'http');
      if (!domain) {
        logger.warn(`[HTTPS Server] Domain not found for hostname: ${hostname} normalized=${normalizedHostname || '-'} registered=${this.proxies.size}`);
        for (const [id, entry] of this.proxies) {
          if (entry?.type === 'http') {
            logger.warn(`[HTTPS Server] candidate id=${id} stored=${entry?.meta?.hostname || '-'} active=${entry?.meta?.is_active ? 'yes' : 'no'} ssl=${entry?.meta?.ssl_enabled ? 'on' : 'off'}`);
          }
        }
        if ((req.headers.accept || '').includes('text/html')) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderNotFoundPage(hostname));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Not Found',
            message: `No proxy configured for hostname: ${hostname}`,
          }));
        }
        return;
      }

      // Proxy the request
      this._proxyHttpRequest(req, res, domain);
    });

    this.httpsServer.on('upgrade', (req, socket, head) => {
      this._handleWebSocketUpgrade(req, socket, head, true);
    });

    this.httpsServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn('[ProxyManager] Port 443 already in use, HTTPS proxy not started');
        this.httpsServer = null;
        resolve();
      } else {
        logger.error('[ProxyManager] HTTPS server error:', err.message);
      }
    });

    this.httpsServer.listen(443, '::', () => {
      logger.info('[ProxyManager] Shared HTTPS server listening on port 443');
      resolve();
    });
  });
}

/**
 * SNI callback to select appropriate SSL certificate
 * SECURITY: Checks certificate expiration before serving from cache
 */
}

import { SniHandler, STATIC_FALLBACK_CERT, STATIC_FALLBACK_KEY } from './http/sniHandler.js';
import { AcmeHandler } from './http/acmeHandler.js';
import { RequestProxy } from './http/requestProxy.js';
import { WebSocketHandler } from './http/webSocketHandler.js';
import { DomainLookup } from './http/domainLookup.js';

const _httpModules = [SniHandler, AcmeHandler, RequestProxy, WebSocketHandler, DomainLookup];
for (const Mod of _httpModules) {
  Object.getOwnPropertyNames(Mod.prototype)
    .filter(n => n !== 'constructor')
    .forEach(n => { HttpProxy.prototype[n] = Mod.prototype[n]; });
}
