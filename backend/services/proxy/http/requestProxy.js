// Auto-extracted from httpProxy.js — do not edit directly.
// Mixed into HttpProxy.prototype in httpProxy.js.

import http from 'http';
import https from 'https';
import { lts, getDdos, escapeHtml, getLb } from '../../proxyContext.js';
import {
  renderMaintenancePage,
  renderBadGatewayPage,
  renderServiceUnavailablePage,
  renderBlockedPage,
  renderBandwidthExceededPage,
  renderRateLimitPage,
  renderPayloadTooLargePage,
} from '../renderers.js';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/config.js';
import { database } from '../../database.js';
import { circuitBreaker } from '../../circuitBreaker.js';
import { geoIpService } from '../../geoIpService.js';
import { redisService } from '../../redis.js';
import { bandwidthTracker } from '../../bandwidthTracker.js';
import { urlFilterService } from '../../urlFilterService.js';
import { logBatchQueue } from '../../logBatchQueue.js';

export class RequestProxy {
async _proxyHttpRequest(req, res, domain) {
const startTime = Date.now();
const clientIp = this._getRealClientIp(req);

// ── 0. WEBSOCKET UPGRADE FALLBACK ────────────────────────────────────────
// Upstream proxies (e.g. 45.134.38.59) that don't emit a server-level
// 'upgrade' event forward WebSocket upgrade requests as plain HTTP, which
// means Upgrade and Connection headers are never tunnelled to the backend.
// Intercept them here and hand off to the proper WebSocket upgrade handler
// so buildUpgradeRequest() always sets Upgrade: websocket / Connection: Upgrade.
if (req.headers['upgrade']?.toLowerCase() === 'websocket') {
  this._handleWebSocketUpgrade(req, req.socket, Buffer.alloc(0), !!req.socket.encrypted);
  return;
}

// Extract path without query string for URL filtering
const urlPath = req.url.split('?')[0];
const queryString = req.url.includes('?') ? req.url.split('?')[1] : null;

// ── 1. MAINTENANCE MODE ──────────────────────────────────────────────────
if (domain.maintenance_mode) {
  const html = domain.custom_maintenance_page
    ? this._renderCustomErrorPage(domain.custom_maintenance_page, 503)
    : renderMaintenancePage(domain);
  res.writeHead(503, {
    'Content-Type': 'text/html; charset=utf-8',
    'Retry-After': '3600'
  });
  res.end(html);
  return;
}

// ── 2. GEOIP BLOCKING ────────────────────────────────────────────────────
if (domain.geoip_blocking_enabled) {
  try {
    const geoResult = await geoIpService.checkAccess(domain, clientIp);
    if (geoResult.blocked) {
      const wantsHtml = (req.headers.accept || '').includes('text/html');
      if (wantsHtml) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderBlockedPage(
          `Access from ${geoResult.countryCode} is not permitted.`, 403
        ));
      } else {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden', message: geoResult.reason }));
      }
      return;
    }
  } catch (geoErr) {
    logger.error(`[HTTP Proxy ${domain.id}] GeoIP check failed:`, geoErr.message);
    // Fail open — continue serving
  }
}

// ── 2.5. BANDWIDTH QUOTA CHECK ──────────────────────────────────────────────
// Quota is cached in Redis for 5 min to avoid a DB hit on every request.
if (domain.user_id) {
  try {
    const quotaCacheKey = `nebula:bwquota:${domain.user_id}`;
    let quotaBytes = 0;

    if (redisService.isConnected && redisService.client) {
      const cached = await redisService.client.get(quotaCacheKey);
      if (cached !== null) {
        quotaBytes = parseInt(cached, 10);
      } else {
        const row = await database.queryOne(
          'SELECT bandwidth_quota_bytes FROM users WHERE id = $1', [domain.user_id]
        );
        quotaBytes = Number(row?.bandwidth_quota_bytes ?? 0);
        await redisService.client.setex(quotaCacheKey, 300, String(quotaBytes));
      }
    }

    if (quotaBytes > 0) {
      const { exceeded } = await bandwidthTracker.checkQuota(domain.user_id, quotaBytes);
      if (exceeded) {
        const wantsHtml = (req.headers.accept || '').includes('text/html');
        if (wantsHtml) {
          res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '3600' });
          res.end(renderBandwidthExceededPage(domain));
        } else {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' });
          res.end(JSON.stringify({ error: 'Bandwidth Quota Exceeded', message: 'Monthly bandwidth limit reached.' }));
        }
        return;
      }
    }
  } catch (bwErr) {
    // Fail open — never block traffic due to quota check errors
    logger.error(`[HTTP Proxy ${domain.id}] Bandwidth quota check failed:`, bwErr.message);
  }
}

// ── 3. PER-DOMAIN RATE LIMITING ──────────────────────────────────────────
if (domain.rate_limit_enabled) {
  try {
    const rlKey  = `domain_rl:${domain.id}:${clientIp}`;
    const rlMax  = domain.rate_limit_max  || 100;
    const rlWin  = domain.rate_limit_window || 60; // seconds

    if (redisService.isConnected && redisService.client) {
      const count = await redisService.client.incr(rlKey);
      if (count === 1) {
        await redisService.client.expire(rlKey, rlWin);
      }
      if (count > rlMax) {
        const rlWantsHtml = (req.headers.accept || '').includes('text/html');
        if (rlWantsHtml) {
          res.writeHead(429, {
            'Content-Type': 'text/html; charset=utf-8',
            'Retry-After': String(rlWin),
            'X-RateLimit-Limit': String(rlMax),
            'X-RateLimit-Remaining': '0'
          });
          res.end(renderRateLimitPage(domain.hostname));
        } else {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(rlWin),
            'X-RateLimit-Limit': String(rlMax),
            'X-RateLimit-Remaining': '0'
          });
          res.end(JSON.stringify({ error: 'Too Many Requests', message: 'Rate limit exceeded' }));
        }
        return;
      }
    }
  } catch (rlErr) {
    logger.error(`[HTTP Proxy ${domain.id}] Rate limit check failed:`, rlErr.message);
    // Fail open
  }
}

// ── 3.5. DDOS PROTECTION ─────────────────────────────────────────────────
if (domain?.ddos_protection_enabled) {
  try {
    const ddosProtectionService = getDdos();

    // Challenge mode: serve JS challenge directly (no redirect — avoids loops)
    if (domain.ddos_challenge_mode) {
      const reqUrl   = req.url || '/';
      const urlPath  = reqUrl.split('?')[0];

      // Handle challenge verify POST
      if (urlPath === '/__ddos_challenge/verify' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { token, answer, return: ret = '/' } = JSON.parse(body);
            if (token && answer !== undefined && ddosProtectionService.verifyMathToken(clientIp, token, answer)) {
              const cookie = ddosProtectionService.generateVerifiedCookie(clientIp, domain.hostname);
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': `__ddos_bypass=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`
              });
              res.end(JSON.stringify({ ok: true, return: ret }));
            } else {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Challenge failed' }));
            }
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Bad request' }));
          }
        });
        return;
      }

      // Check bypass cookie
      const cookieHeader = req.headers['cookie'] || '';
      const bypassMatch  = cookieHeader.match(/__ddos_bypass=([^;]+)/);
      const bypassToken  = bypassMatch?.[1];

      if (!ddosProtectionService.verifyChallengeToken(clientIp, bypassToken, domain.hostname)) {
        // Serve challenge page inline (no redirect)
        const html = ddosProtectionService.generateChallengePage(clientIp, reqUrl);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Blocked-By': 'DDoS-Challenge' });
        res.end(html);
        return;
      }
    }

  } catch (ddosErr) {
    // Fail open
  }
}

// ── 4. URL FILTER ────────────────────────────────────────────────────────
try {
  const filterResult = await urlFilterService.checkUrl(domain.id, urlPath, req.method, clientIp);

  if (filterResult.blocked) {
    logBatchQueue.queueRequestLog({
      domainId: domain.id,
      hostname: domain.hostname,
      method: req.method,
      path: urlPath,
      queryString: queryString,
      statusCode: filterResult.response.code,
      responseTime: Date.now() - startTime,
      ipAddress: clientIp,
      userAgent: req.headers['user-agent'] || null,
      errorMessage: `Blocked by URL filter: ${filterResult.rule.pattern}`
    });

    const wantsHtml = (req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      res.writeHead(filterResult.response.code, { 'Content-Type': 'text/html' });
      res.end(renderBlockedPage(filterResult.response.message, filterResult.response.code));
    } else {
      res.writeHead(filterResult.response.code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access Denied', message: filterResult.response.message }));
    }
    return;
  }
} catch (error) {
  logger.error(`[HTTP Proxy ${domain.id}] URL filter check failed:`, error.message);
}

// ── 5. BACKEND SELECTION (with sticky session) ───────────────────────────
let backendHost, backendPort, backendProtocol, backendId;
try {
  // Read sticky session cookie if needed
  let stickyValue = null;
  if (domain.sticky_sessions_enabled) {
    const cookies = this._parseCookies(req.headers.cookie || '');
    stickyValue = cookies['__nebula_srv'] || null;
  }

  const target = await this._selectBackendForDomain(domain, clientIp, 'http', { stickyValue });
  backendHost     = target.hostname;
  backendPort     = target.port;
  backendProtocol = target.protocol || 'http:';
  backendId       = target.backendId || null;

  // Least-connections tracking: increment active count for selected backend
  if (backendId) { const lb = getLb(); if (lb) lb.incrementConnections(backendId); }

  // Debug logging for troubleshooting connection issues
  if (req.url.includes('/System/') || req.url.includes('/Branding/') || req.url.includes('/QuickConnect/')) {
    logger.info(`[HTTP Proxy] Forwarding ${req.method} ${req.url} to ${backendProtocol}//${backendHost}:${backendPort}`);
  }
  
  // Live traffic tracking (fire-and-forget)
  { const s = lts(); if (s) s.recordHit(domain.id, clientIp, 'http', `${backendHost}:${backendPort}`); }
} catch (err) {
  logger.error(`[HTTP Proxy ${domain.id}] Backend selection failed:`, err.message);
  if (domain.custom_503_page) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(this._renderCustomErrorPage(domain.custom_503_page, 503));
  } else {
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/html')) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderServiceUnavailablePage(domain.hostname));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service Unavailable', message: 'No available backend' }));
    }
  }
  return;
}

// ── 6. CIRCUIT BREAKER CHECK ─────────────────────────────────────────────
const cbKey = `${domain.id}:${backendHost}:${backendPort}`;
if (!circuitBreaker.isAvailable(cbKey)) {
  // Breaker is open. Log it, but allow one attempt to pass through.
  // This helps with "cold start" where the backend might be slow on first request.
  logger.warn(`[HTTP Proxy ${domain.id}] Circuit breaker is OPEN for ${cbKey}. Allowing a pass-through attempt.`);
}

// ── 7. PROXY REQUEST SETUP ───────────────────────────────────────────────
// Create a clean header object instead of copying all incoming headers.
// This prevents issues with headers like 'Host', 'Connection', etc.
const headers = {
  'X-Forwarded-For': clientIp,
  'X-Forwarded-Proto': req.socket.encrypted ? 'https' : 'http',
  'X-Forwarded-Host': req.headers.host,
  'X-Real-IP': clientIp,
  // Use the original domain name as Host so SNI-based backends (Plesk, nginx vhosts) route correctly.
  'Host': req.headers.host || domain.hostname
};

// Add other relevant headers if they exist
if (req.headers['user-agent'])      headers['User-Agent']       = req.headers['user-agent'];
if (req.headers['accept'])          headers['Accept']           = req.headers['accept'];
if (req.headers['accept-language']) headers['Accept-Language']  = req.headers['accept-language'];
if (req.headers['accept-encoding']) headers['Accept-Encoding']  = req.headers['accept-encoding'];
if (req.headers['content-type'])    headers['Content-Type']     = req.headers['content-type'];
if (req.headers['content-length'])  headers['Content-Length']   = req.headers['content-length'];
if (req.headers.authorization)      headers.Authorization       = req.headers.authorization;
if (req.headers.cookie)             headers.Cookie              = req.headers.cookie;

// Forward custom application headers (CSRF tokens, API keys, etc.)
const hopByHopHeaders = new Set(['host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailers','transfer-encoding','upgrade']);
const alreadySet = new Set(Object.keys(headers).map(h => h.toLowerCase()));
for (const [key, val] of Object.entries(req.headers)) {
  const lkey = key.toLowerCase();
  if (!hopByHopHeaders.has(lkey) && !alreadySet.has(lkey)) {
    headers[key] = val;
  }
}

const options = {
  hostname: backendHost,
  port: backendPort,
  path: req.url,
  method: req.method,
  agent: false, // Use a new agent for each request
  headers: headers
};

// If backend is https, configure TLS
if (backendProtocol === 'https:') {
  // Use the requested domain for SNI when connecting to HTTPS backend
  // This is correct for most use cases (backend has cert for domain)
  if (!this._isIpAddress(req.headers.host?.split(':')[0])) {
    options.servername = req.headers.host?.split(':')[0] || backendHost;
  } else {
    // IP address in request header - fall back to backend host for SNI
    options.servername = backendHost;
  }
  options.rejectUnauthorized = !config.proxy.allowInsecureBackends;
}

const acceptsHtml = String(req.headers.accept || '').includes('text/html');
if (acceptsHtml && config.proxy.injectConsoleScript) {
  options.headers['accept-encoding'] = 'identity';
}

const protocol = backendProtocol === 'https:' ? https : http;
const upstreamTimeoutMs = config.proxy.requestTimeoutMs > 0 ? config.proxy.requestTimeoutMs : 300000;
const consolePayload = {
  host: String(domain.hostname || req.headers.host || 'unknown-host'),
  path: String(req.url || '/'),
  timestamp: new Date().toISOString()
};
const consoleMessage = `var np=${JSON.stringify(consolePayload)};console.groupCollapsed('%cNebulaProxy %c// live route','color:#C77DFF;font-size:16px;font-weight:800;letter-spacing:0.02em;','color:#8b5cf6;font-size:11px;font-weight:700;letter-spacing:0.08em;');console.log('%cDomain:%c '+np.host,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cPath:%c '+np.path,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cTimestamp:%c '+np.timestamp,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cPowered by NebulaProxy','color:#22d3ee;font-size:12px;font-weight:700;');console.groupEnd();`;
const consoleScript = `<script>(function(){try{${consoleMessage}}catch(e){}})();</script>`;

// Debug logging: show request details for Jellyfin
if (req.url.includes('/System/') || req.url.includes('/Branding/') || req.url.includes('/MediaBar/') || req.url.includes('/QuickConnect/')) {
  logger.debug(`[DEBUG:HTTP] Sending to ${backendProtocol}//${backendHost}:${backendPort}${req.url}`);
  logger.info(`  Method: ${req.method}`);
  logger.info(`  Headers: ${JSON.stringify({
    host: options.headers.host,
    'x-forwarded-for': options.headers['x-forwarded-for'],
    'x-forwarded-proto': options.headers['x-forwarded-proto'],
    'x-real-ip': options.headers['x-real-ip']
  })}`);
}

logger.info(`[HTTP Proxy ${domain.id}] upstream request ${req.method || 'GET'} ${req.url || '/'} -> ${backendProtocol}//${backendHost}:${backendPort} host=${req.headers.host || '-'} client=${clientIp}`);

const proxyReq = protocol.request(options, (proxyRes) => {
  const responseTime = Date.now() - startTime;
  const statusCode = proxyRes.statusCode;
  let responseSize = 0;
  const contentType = String(proxyRes.headers['content-type'] || '').toLowerCase();
  const isHtmlResponse = contentType.includes('text/html');

  logger.info(`[HTTP Proxy ${domain.id}] upstream response ${statusCode} ${req.method || 'GET'} ${req.url || '/'} -> ${backendHost}:${backendPort} in ${responseTime}ms contentType=${contentType || '-'} client=${clientIp}`);

  // Circuit breaker: success
  circuitBreaker.onSuccess(cbKey);

  // Track response size
  proxyRes.on('data', (chunk) => {
    responseSize += chunk.length;
  });

  // Determine log level
  let logLevel = 'success';
  if (statusCode >= 500) logLevel = 'error';
  else if (statusCode >= 400) logLevel = 'warning';
  else if (statusCode >= 300) logLevel = 'info';

  // Least-connections: decrement when response is done
  proxyRes.on('end', () => {
    if (backendId) { const lb = getLb(); if (lb) lb.decrementConnections(backendId); }
  });

  // Bandwidth tracking (fire-and-forget — never blocks response)
  proxyRes.on('end', () => {
    if (domain.user_id) {
      bandwidthTracker.record(domain.user_id, bytesReceived, responseSize).catch(() => {});
    }
  });

  // Log the request (batched for performance)
  proxyRes.on('end', () => {
    logBatchQueue.queueRequestLog({
      domainId: domain.id,
      hostname: domain.hostname,
      method: req.method,
      path: req.url.split('?')[0],
      queryString: req.url.includes('?') ? req.url.split('?')[1] : null,
      statusCode: statusCode,
      responseTime: responseTime,
      responseSize: responseSize,
      ipAddress: clientIp,
      userAgent: req.headers['user-agent'] || null,
      referer: req.headers['referer'] || req.headers['referrer'] || null,
      requestHeaders: {
        'content-type': req.headers['content-type'],
        'accept': req.headers['accept'],
        'accept-language': req.headers['accept-language']
      },
      responseHeaders: {
        'content-type': proxyRes.headers['content-type'],
        'content-encoding': proxyRes.headers['content-encoding'],
        'cache-control': proxyRes.headers['cache-control']
      }
    });
  });

  // Legacy proxy log (batched)
  logBatchQueue.queueProxyLog({
    domainId: domain.id,
    hostname: domain.hostname,
    method: req.method,
    path: req.url,
    status: statusCode,
    responseTime: responseTime,
    ipAddress: clientIp,
    userAgent: req.headers['user-agent'] || null,
    level: logLevel
  });

  // Custom error pages for 404 / 502 / 503 from backend
  if (statusCode === 404 && domain.custom_404_page) {
    const html = this._renderCustomErrorPage(domain.custom_404_page, 404);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (statusCode === 502 && domain.custom_502_page) {
    const html = this._renderCustomErrorPage(domain.custom_502_page, 502);
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Build response headers (copy from backend)
  const responseHeaders = { ...proxyRes.headers };

  const requestedHost = String(req.headers.host || '').trim();
  const upstreamLocation = responseHeaders.location || responseHeaders.Location;
  if (upstreamLocation && requestedHost) {
    try {
      const parsedLocation = new URL(upstreamLocation, `${backendProtocol}//${backendHost}:${backendPort}`);
      const upstreamHost = parsedLocation.hostname.toLowerCase();
      const requestedHostname = requestedHost.split(':')[0].toLowerCase();

      const publicPort = req.socket.encrypted ? 443 : 80;
      const locPort = parsedLocation.port ? parseInt(parsedLocation.port, 10) : (parsedLocation.protocol === "https:" ? 443 : 80);
      const hostnameNeedsRewrite = parsedLocation.origin && upstreamHost === String(backendHost).toLowerCase() && requestedHostname && requestedHostname !== upstreamHost;
      const portNeedsRewrite = parsedLocation.origin && upstreamHost === requestedHostname && locPort === parseInt(String(backendPort), 10) && locPort !== publicPort;

      if (hostnameNeedsRewrite || portNeedsRewrite) {
        parsedLocation.hostname = requestedHostname;
        parsedLocation.port = (publicPort === 443 || publicPort === 80) ? "" : String(publicPort);
        const rewrittenLocation = parsedLocation.toString();
        responseHeaders.location = rewrittenLocation;
        delete responseHeaders.Location;
        logger.info("[HTTP Proxy " + domain.id + "] rewrote Location " + upstreamLocation + " -> " + rewrittenLocation + " requestedHost=" + requestedHost);
      }
    } catch (err) {
      logger.warn(`[HTTP Proxy ${domain.id}] failed to inspect Location header ${String(upstreamLocation)}: ${err.message}`);
    }
  }

  if (isHtmlResponse && config.proxy.injectConsoleScript) {
    delete responseHeaders['content-length'];
    delete responseHeaders['content-encoding'];
    delete responseHeaders['transfer-encoding'];
    responseHeaders['content-type'] = responseHeaders['content-type'] || 'text/html; charset=utf-8';
  }

  // Sticky session: set cookie if enabled and we know the backend id
  if (domain.sticky_sessions_enabled && backendId) {
    const ttl = domain.sticky_sessions_ttl || 3600;
    const existing = responseHeaders['set-cookie'] || [];
    const cookieArr = Array.isArray(existing) ? existing : [existing];
    cookieArr.push(`__nebula_srv=${backendId}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Lax`);
    responseHeaders['set-cookie'] = cookieArr;
  }

  res.writeHead(proxyRes.statusCode, responseHeaders);

  if (isHtmlResponse && config.proxy.injectConsoleScript) {
    const chunks = [];
    proxyRes.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const injected = body.includes('</body>')
        ? body.replace('</body>', `${consoleScript}</body>`)
        : `${body}${consoleScript}`;
      res.end(injected);
    });
  } else {
    proxyRes.pipe(res);
  }

  // ── 7. TRAFFIC MIRRORING (fire-and-forget) ───────────────────────────
  if (domain.mirror_enabled && domain.mirror_backend_url) {
    this._fireMirrorRequest(req, domain.mirror_backend_url).catch(() => {});
  }
});

proxyReq.setTimeout(upstreamTimeoutMs, () => {
  const timeoutError = new Error(`Upstream request timeout after ${upstreamTimeoutMs}ms`);
  timeoutError.code = 'ETIMEDOUT';
  proxyReq.destroy(timeoutError);
});

proxyReq.on('error', (error) => {
  const responseTime = Date.now() - startTime;

  // Least-connections: decrement on error so the backend isn't penalised indefinitely
  if (backendId) { const lb = getLb(); if (lb) lb.decrementConnections(backendId); }

  // Circuit breaker: failure (but not for ECONNRESET which might be normal close)
  if (error.code !== 'ECONNRESET') {
    circuitBreaker.onFailure(cbKey);
  }

  // Suppress ECONNRESET errors if response was already started (client received data)
  if (error.code === 'ECONNRESET' && res.headersSent) {
    logger.debug(`[DEBUG:HTTP] Backend closed connection after sending response (normal): ${domain.hostname} ${req.method} ${req.url}`);
    return;
  }

  logger.error(`[ProxyManager] Backend error for ${domain.hostname} (${req.method} ${req.url}):`);
  logger.error(`  Target: ${backendProtocol}//${backendHost}:${backendPort}`);
  logger.error(`  Error: ${error.code} - ${error.message}`);
  logger.error(`  Client IP: ${clientIp}`);
  logger.error(`  Host header: ${req.headers.host}`);

  logBatchQueue.queueRequestLog({
    domainId: domain.id,
    hostname: domain.hostname,
    method: req.method,
    path: req.url.split('?')[0],
    queryString: req.url.includes('?') ? req.url.split('?')[1] : null,
    statusCode: 502,
    responseTime: responseTime,
    ipAddress: clientIp,
    userAgent: req.headers['user-agent'] || null,
    referer: req.headers['referer'] || req.headers['referrer'] || null,
    errorMessage: error.message,
    requestHeaders: {
      'content-type': req.headers['content-type'],
      'accept': req.headers['accept']
    }
  });

  logBatchQueue.queueProxyLog({
    domainId: domain.id,
    hostname: domain.hostname,
    method: req.method,
    path: req.url,
    status: 502,
    responseTime: responseTime,
    ipAddress: clientIp,
    userAgent: req.headers['user-agent'] || null,
    level: 'error'
  });

  if (!res.headersSent) {
    const accept = String(req.headers.accept || '');
    const wantsHtml = accept.includes('text/html');
    if (wantsHtml) {
      // Use custom 502 page if configured, otherwise fall back to styled default
      const html = domain.custom_502_page
        ? this._renderCustomErrorPage(domain.custom_502_page, 502)
        : renderBadGatewayPage(domain.hostname, { errorCode: error.code, errorMessage: error.message });
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad Gateway',
        message: 'Upstream service unavailable'
      }));
    }
  }
});

// SECURITY: Enforce request body size limit (DOS prevention)
const MAX_BODY_SIZE = config.proxy?.maxRequestBodySize || (100 * 1024 * 1024); // 100MB default
let bytesReceived = 0;
let bodySizeLimitExceeded = false;

req.on('data', (chunk) => {
  bytesReceived += chunk.length;

  if (bytesReceived > MAX_BODY_SIZE && !bodySizeLimitExceeded) {
    bodySizeLimitExceeded = true;
    logger.warn(`[HTTP Proxy ${domain.id}] Request body size limit exceeded: ${bytesReceived} bytes from ${clientIp}`);

    // Destroy both connections
    req.destroy();
    proxyReq.destroy();

    // Send 413 response if headers not sent
    if (!res.headersSent) {
      const plWantsHtml = (req.headers.accept || '').includes('text/html');
      if (plWantsHtml) {
        res.writeHead(413, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderPayloadTooLargePage(domain.hostname, MAX_BODY_SIZE));
      } else {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Payload Too Large',
          message: `Request body exceeds maximum allowed size (${MAX_BODY_SIZE} bytes)`
        }));
      }
    }
  }
});

// Pipe request body
req.pipe(proxyReq);
}

/**
 * Parse a Cookie header string into a key→value object.
 * e.g. "a=1; b=2" → { a: '1', b: '2' }
 */
_parseCookies(cookieHeader) {
const result = {};
if (!cookieHeader) return result;
for (const pair of cookieHeader.split(';')) {
  const idx = pair.indexOf('=');
  if (idx < 0) continue;
  const key = pair.slice(0, idx).trim();
  const val = pair.slice(idx + 1).trim();
  if (key) result[key] = decodeURIComponent(val);
}
return result;
}

/**
 * Wrap custom HTML error page content in a standard HTTP response.
 * The `html` is admin-defined content — render it as-is.
 */
_renderCustomErrorPage(html, _code) {
return html;
}

/**
 * Fire-and-forget mirror request to shadowUrl.
 * Sends the same method + path as `req` but discards the response.
 */
async _fireMirrorRequest(req, mirrorUrl) {
try {
  let parsedUrl;
  try {
    parsedUrl = new URL(mirrorUrl);
  } catch {
    parsedUrl = new URL(`http://${mirrorUrl}`);
  }

  // Append the original path+query
  const targetPath = req.url || '/';
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: parsedUrl.host,
      'X-Mirrored-From': req.headers.host || '',
      'X-Mirror': '1'
    },
    timeout: 5000 // 5s max for mirror requests
  };

  const proto = parsedUrl.protocol === 'https:' ? https : http;
  const mirrorReq = proto.request(options, (res) => {
    // Drain and discard mirror response
    res.resume();
  });
  mirrorReq.on('error', () => {}); // Swallow mirror errors silently
  mirrorReq.end();
} catch (_) {
  // Mirror errors must never affect the real response
}
}

_handleProxyCheck(req, res) {
if (req.url !== '/.well-known/nebula-proxy') {
  return false;
}

const token = config.proxy.checkToken;
res.writeHead(200, {
  'Content-Type': 'text/plain',
  'Cache-Control': 'no-store',
  'X-Nebula-Proxy': token
});
res.end(token);
return true;
}

}
