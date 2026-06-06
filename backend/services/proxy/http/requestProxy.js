// Auto-extracted from httpProxy.js — do not edit directly.
// Mixed into HttpProxy.prototype in httpProxy.js.

import http from 'http';
import https from 'https';
import { lts, getDdos, escapeHtml, getLb } from '../../proxyContext.js';
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
    : this._renderMaintenancePage(domain);
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
        res.end(this._renderBlockedPage(
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
        const { pool } = await import('../config/database.js');
        const { rows } = await pool.query(
          'SELECT bandwidth_quota_bytes FROM users WHERE id = $1', [domain.user_id]
        );
        quotaBytes = Number(rows[0]?.bandwidth_quota_bytes ?? 0);
        await redisService.client.setex(quotaCacheKey, 300, String(quotaBytes));
      }
    }

    if (quotaBytes > 0) {
      const { exceeded } = await bandwidthTracker.checkQuota(domain.user_id, quotaBytes);
      if (exceeded) {
        const wantsHtml = (req.headers.accept || '').includes('text/html');
        if (wantsHtml) {
          res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '3600' });
          res.end(this._renderBandwidthExceededPage(domain));
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
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(rlWin),
          'X-RateLimit-Limit': String(rlMax),
          'X-RateLimit-Remaining': '0'
        });
        res.end(JSON.stringify({ error: 'Too Many Requests', message: 'Rate limit exceeded' }));
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
    await database.createRequestLog({
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
      res.end(this._renderBlockedPage(filterResult.response.message, filterResult.response.code));
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
  const html503 = domain.custom_503_page
    ? this._renderCustomErrorPage(domain.custom_503_page, 503)
    : null;
  if (html503) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html503);
  } else {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service Unavailable', message: 'No available backend' }));
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
const upstreamTimeoutMs = config.proxy.requestTimeoutMs || 4000;
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

  database.createRequestLog({
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
  }).catch((err) => {
    logger.error('[ProxyManager] Failed to write request log:', err);
  });

  database.createProxyLog({
    domainId: domain.id,
    hostname: domain.hostname,
    method: req.method,
    path: req.url,
    status: 502,
    responseTime: responseTime,
    ipAddress: clientIp,
    userAgent: req.headers['user-agent'] || null,
    level: 'error'
  }).catch((err) => {
    logger.error('[ProxyManager] Failed to write proxy log:', err);
  });

  if (!res.headersSent) {
    const accept = String(req.headers.accept || '');
    const wantsHtml = accept.includes('text/html');
    if (wantsHtml) {
      // Use custom 502 page if configured, otherwise fall back to styled default
      const html = domain.custom_502_page
        ? this._renderCustomErrorPage(domain.custom_502_page, 502)
        : this._renderBadGatewayPage(domain.hostname);
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
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Payload Too Large',
        message: `Request body exceeds maximum allowed size (${MAX_BODY_SIZE} bytes)`
      }));
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
 * Render a themed maintenance page for a domain.
 */
_renderMaintenancePage(domain) {
const safeHost = (domain.hostname || '').replace(/[<>"&]/g, '');
const safeMsg  = (domain.maintenance_message || 'Service en maintenance. Veuillez réessayer plus tard.').replace(/[<>"&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]));
let endInfo = '';
if (domain.maintenance_end_time) {
  const end = new Date(domain.maintenance_end_time);
  endInfo = `<p class="eta">Reprise prévue : <strong>${end.toLocaleString()}</strong></p>`;
}
return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Maintenance — ${safeHost}</title>
<style>
:root {
color-scheme: dark;
--background: #09090b;
--surface: #18181b;
--surface-2: #1f1f23;
--border: #27272a;
--border-strong: #3f3f46;
--text: #fafafa;
--muted: #a1a1aa;
--subtle: #71717a;
--accent: #f59e0b;
--accent-strong: #fbbf24;
--info: #22d3ee;
}
* { box-sizing: border-box; }
body {
margin: 0;
min-height: 100vh;
display: grid;
place-items: center;
padding: 32px 16px;
color: var(--text);
font-family: "Segoe UI", Tahoma, sans-serif;
background:
  radial-gradient(1200px 600px at 8% -10%, rgba(255, 255, 255, 0.08), transparent 56%),
  radial-gradient(900px 480px at 92% -15%, rgba(255, 255, 255, 0.04), transparent 52%),
  var(--background);
}
.card {
width: min(760px, 100%);
border-radius: 24px;
border: 1px solid var(--border);
background: linear-gradient(180deg, rgba(24, 24, 27, 0.98) 0%, rgba(17, 17, 19, 0.98) 100%);
box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
padding: 24px;
}
.header {
display: flex;
flex-direction: column;
gap: 10px;
padding-bottom: 18px;
border-bottom: 1px solid var(--border);
}
.badge {
align-self: flex-start;
display: inline-flex;
align-items: center;
gap: 8px;
padding: 6px 12px;
border-radius: 999px;
border: 1px solid rgba(245, 158, 11, 0.35);
background: rgba(245, 158, 11, 0.12);
color: var(--accent-strong);
font-size: 11px;
letter-spacing: 0.18em;
text-transform: uppercase;
font-weight: 700;
}
h1 {
margin: 0;
font-size: clamp(28px, 4vw, 42px);
line-height: 1.05;
letter-spacing: -0.04em;
}
.subtitle {
margin: 0;
color: var(--muted);
font-size: 14px;
line-height: 1.6;
max-width: 62ch;
}
.content {
padding-top: 18px;
display: grid;
gap: 16px;
}
.message {
border-radius: 18px;
border: 1px solid var(--border);
background: rgba(255, 255, 255, 0.03);
padding: 18px;
}
.message p {
margin: 0;
color: var(--text);
font-size: 15px;
line-height: 1.7;
}
.grid {
display: grid;
grid-template-columns: repeat(2, minmax(0, 1fr));
gap: 14px;
}
.tile {
border-radius: 18px;
border: 1px solid var(--border);
background: var(--surface-2);
padding: 16px;
}
.tile span {
display: block;
margin-bottom: 8px;
color: var(--subtle);
font-size: 11px;
letter-spacing: 0.18em;
text-transform: uppercase;
}
.tile strong {
display: block;
color: var(--text);
font-size: 14px;
line-height: 1.5;
word-break: break-word;
}
.actions {
display: flex;
flex-wrap: wrap;
gap: 12px;
}
.button {
appearance: none;
border: 1px solid var(--border-strong);
background: var(--surface-2);
color: var(--text);
padding: 11px 16px;
border-radius: 14px;
font-size: 13px;
cursor: pointer;
transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}
.button:hover {
transform: translateY(-1px);
border-color: #52525b;
background: #27272a;
}
.button.primary {
border-color: rgba(34, 211, 238, 0.35);
background: rgba(34, 211, 238, 0.08);
color: #a5f3fc;
}
.button.primary:hover {
border-color: rgba(34, 211, 238, 0.5);
background: rgba(34, 211, 238, 0.14);
}
footer {
margin-top: 18px;
color: var(--subtle);
font-size: 11px;
line-height: 1.5;
}
@media (max-width: 640px) {
.card { padding: 18px; border-radius: 20px; }
.grid { grid-template-columns: 1fr; }
}
</style></head>
<body><div class="card"><div class="header"><div class="badge">Maintenance</div><h1>Service temporairement indisponible</h1><p class="subtitle">Le domaine est en maintenance ou le service est en cours de redémarrage. L’apparence suit le thème admin pour rester cohérente avec le panneau de gestion.</p></div><div class="content"><div class="message"><p>${safeMsg}</p>${endInfo}</div><div class="grid"><div class="tile"><span>Domaine</span><strong>${safeHost}</strong></div><div class="tile"><span>Plateforme</span><strong>NebulaProxy</strong></div></div><div class="actions"><button class="button primary" onclick="location.reload()">Rafraîchir</button><button class="button" onclick="history.back()">Retour</button></div></div><footer>Si le service reste indisponible, contactez l’administrateur. Timestamp: ${new Date().toISOString()}</footer></div></body></html>`;
}

/**
 * Wrap custom HTML error page content in a standard HTTP response.
 * The `html` is admin-defined content — render it as-is.
 */
_renderCustomErrorPage(html, _code) {
return html;
}

_renderBandwidthExceededPage(domain) {
const host = (domain?.hostname || 'this service').replace(/[<>"&]/g, '');
return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bandwidth Limit Reached — ${host}</title>
<style>
:root { color-scheme: dark; --bg:#09090b; --surface:#18181b; --border:#27272a; --text:#fafafa; --muted:#a1a1aa; --accent:#f59e0b; }
*{box-sizing:border-box;} body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:48px 40px;max-width:480px;width:100%;text-align:center;}
.icon{font-size:48px;margin-bottom:20px;}
h1{font-size:22px;font-weight:600;margin:0 0 12px;color:var(--text);}
p{font-size:14px;color:var(--muted);line-height:1.6;margin:0 0 12px;}
.badge{display:inline-block;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:var(--accent);font-size:12px;font-weight:500;padding:4px 12px;border-radius:20px;margin-bottom:24px;}
.footer{font-size:11px;color:#52525b;margin-top:24px;padding-top:20px;border-top:1px solid var(--border);}
</style></head><body>
<div class="card">
<div class="icon">📊</div>
<div class="badge">429 Bandwidth Limit</div>
<h1>Data Limit Reached</h1>
<p>The monthly bandwidth quota for <strong>${host}</strong> has been reached.</p>
<p>Service will resume automatically when the quota resets. If you are the account owner, contact your administrator to increase your limit.</p>
<div class="footer">Powered by NebulaProxy</div>
</div>
</body></html>`;
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

_renderBadGatewayPage(hostname) {
const copy = config.proxy.badGatewayPage || {};
const safeHost = escapeHtml(hostname || 'unknown-host');
const htmlTitle = escapeHtml(copy.htmlTitle || 'Bad Gateway');
const badge = escapeHtml(copy.badge || 'Bad Gateway');
const title = escapeHtml(copy.title || 'Service amont indisponible');
const subtitle = escapeHtml(copy.subtitle || "Le proxy ne peut pas joindre le backend pour ce domaine. L'ecran suit le meme theme que l'interface admin afin de garder une experience coherente.");
const message = escapeHtml(copy.message || 'The backend server is temporarily unavailable');
const domainLabel = escapeHtml(copy.domainLabel || 'Domaine');
const _proxyLabel = escapeHtml(copy.proxyLabel || 'Proxy');
const _proxyValue = escapeHtml(copy.proxyValue || 'NebulaProxy');
const _causeLabel = escapeHtml(copy.causeLabel || 'Cause');
const _causeValue = escapeHtml(copy.causeValue || 'Backend not reachable');
const _statusLabel = escapeHtml(copy.statusLabel || 'Statut');
const _statusValue = escapeHtml(copy.statusValue || '502 Service Unavailable');
const retryButton = escapeHtml(copy.retryButton || 'Reessayer');
const backButton = escapeHtml(copy.backButton || 'Retour');
const footerText = escapeHtml(copy.footerText || "Contactez l'administrateur si le probleme persiste.");

return `<!doctype html><html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${htmlTitle}</title><style>
  :root {
    color-scheme: dark;
    --bg: #0b0c0f;
    --panel: rgba(22, 23, 34, 0.9);
    --border: rgba(255, 255, 255, 0.08);
    --text: #e6e7ef;
    --muted: rgba(255, 255, 255, 0.55);
    --accent: #c77dff;
    --accent-2: #22d3ee;
    --danger: #ef4444;
    --warning: #f59e0b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", Tahoma, sans-serif;
    background: radial-gradient(1200px 500px at 10% 10%, rgba(157, 78, 221, 0.15), transparent),
                radial-gradient(900px 500px at 90% 20%, rgba(34, 211, 238, 0.12), transparent),
                var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px 16px;
  }
  .card {
    width: min(720px, 100%);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 24px;
    padding: 28px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #fbbf24;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 18px 0 8px;
    font-weight: 300;
    font-size: 28px;
  }
  p {
    margin: 0 0 16px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.6;
  }
  .message-box {
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 16px;
    background: rgba(245, 158, 11, 0.05);
    margin-top: 18px;
  }
  .message-box p {
    margin: 0;
    color: var(--text);
  }
  .actions {
    margin-top: 22px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .button {
    appearance: none;
    border: 1px solid rgba(157, 78, 221, 0.4);
    background: linear-gradient(135deg, rgba(157, 78, 221, 0.2), rgba(123, 44, 191, 0.15));
    color: #c77dff;
    padding: 10px 16px;
    border-radius: 12px;
    font-size: 13px;
    cursor: pointer;
    transition: 0.2s ease;
  }
  .button:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.25);
  }
  footer {
    margin-top: 26px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.35);
  }
</style>
</head>
<body>
<div class="card">
  <div class="badge">${badge}</div>
  <h1>${title}</h1>
  <p>${subtitle}</p>
  <div class="message-box">
    <p>${message}</p>
  </div>
  <div class="actions">
    <button class="button" onclick="location.reload()">${retryButton}</button>
    <button class="button" onclick="history.back()">${backButton}</button>
  </div>
  <footer>${footerText} &mdash; ${domainLabel}: ${safeHost}</footer>
</div>
</body>
</html>`;
}

_renderBlockedPage(message, statusCode = 403) {
const safeMessage = message || 'Access to this resource is forbidden.';
const statusText = statusCode === 403 ? 'Forbidden' : statusCode === 401 ? 'Unauthorized' : 'Access Denied';
return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${statusText}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0c0f;
    --panel: rgba(22, 23, 34, 0.9);
    --border: rgba(255, 255, 255, 0.08);
    --text: #e6e7ef;
    --muted: rgba(255, 255, 255, 0.55);
    --accent: #c77dff;
    --accent-2: #22d3ee;
    --danger: #ef4444;
    --warning: #f59e0b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", Tahoma, sans-serif;
    background: radial-gradient(1200px 500px at 10% 10%, rgba(157, 78, 221, 0.15), transparent),
                radial-gradient(900px 500px at 90% 20%, rgba(34, 211, 238, 0.12), transparent),
                var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px 16px;
  }
  .card {
    width: min(720px, 100%);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 24px;
    padding: 28px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #fbbf24;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 18px 0 8px;
    font-weight: 300;
    font-size: 28px;
  }
  p {
    margin: 0 0 16px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.6;
  }
  .message-box {
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 16px;
    background: rgba(245, 158, 11, 0.05);
    margin-top: 18px;
  }
  .message-box p {
    margin: 0;
    color: var(--text);
  }
  .actions {
    margin-top: 22px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .button {
    appearance: none;
    border: 1px solid rgba(157, 78, 221, 0.4);
    background: linear-gradient(135deg, rgba(157, 78, 221, 0.2), rgba(123, 44, 191, 0.15));
    color: #c77dff;
    padding: 10px 16px;
    border-radius: 12px;
    font-size: 13px;
    cursor: pointer;
    transition: 0.2s ease;
  }
  .button:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.25);
  }
  footer {
    margin-top: 26px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.35);
  }
</style>
</head>
<body>
<div class="card">
  <div class="badge">${statusCode} ${statusText}</div>
  <h1>Access Denied</h1>
  <p>Your request has been blocked by the URL filtering system. Access to this resource is restricted.</p>
  <div class="message-box">
    <p>${safeMessage}</p>
  </div>
  <div class="actions">
    <button class="button" onclick="history.back()">Go back</button>
  </div>
  <footer>Contact your administrator for access. Timestamp: ${new Date().toISOString()}</footer>
</div>
</body>
</html>`;
}

}
