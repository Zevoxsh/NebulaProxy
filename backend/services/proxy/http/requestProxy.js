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
import { proxyMetrics } from '../../proxyMetrics.js';

// Shared keep-alive agents reused across every proxied request. Previously
// each request used `agent: false`, opening a brand new TCP (+ TLS handshake
// for HTTPS backends) connection per request — this reuses sockets per
// backend host:port instead.
// Exported so /metrics can report pool utilization (active/free/pending).
export const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: config.proxy.maxSocketsPerBackend,
  maxFreeSockets: 64,
});
export const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: config.proxy.maxSocketsPerBackend,
  maxFreeSockets: 64,
});

// Connect-level errors safe to retry against a different backend: the
// connection never opened, so no bytes could have been sent upstream.
const RETRYABLE_CONNECT_ERROR_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']);

// Headers that must never be persisted verbatim into request_logs (an
// admin-browsable table) — kept present so it's visible the header was
// sent, without leaking session tokens/credentials into logs.
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);
function sanitizeHeadersForLogging(headers) {
  if (!headers) return {};
  const out = {};
  for (const [key, val] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : val;
  }
  return out;
}

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
  const html = domain.custom_maintenance_page || renderMaintenancePage(domain);
  res.writeHead(503, {
    'Content-Type': 'text/html; charset=utf-8',
    'Retry-After': '3600'
  });
  res.end(html);
  return;
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
        this._logBlockedRequest(domain, req, clientIp, 429, 'Bandwidth quota exceeded', startTime);
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
      // NX: only set the TTL if the key doesn't already have one. Using
      // `count === 1` as the guard instead has a race — if the process
      // crashes/times out between INCR and EXPIRE, the key is left without
      // a TTL and permanently rate-limits that domain/IP. EXPIRE ... NX is
      // idempotent so it's safe to call unconditionally on every request.
      await redisService.client.expire(rlKey, rlWin, 'NX');
      if (count > rlMax) {
        this._logBlockedRequest(domain, req, clientIp, 429, `Rate limit exceeded (${rlMax}/${rlWin}s)`, startTime);
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
              this._logBlockedRequest(domain, req, clientIp, 200, 'Challenge de sécurité réussi', startTime);
            } else {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Challenge failed' }));
              this._logBlockedRequest(domain, req, clientIp, 403, 'Challenge de sécurité échoué', startTime);
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
        const html = ddosProtectionService.generateChallengePage(clientIp, reqUrl, domain.ddos_challenge_types);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Blocked-By': 'DDoS-Challenge' });
        res.end(html);
        // Previously unlogged entirely — a visitor served the challenge (the
        // common case for a first-time visit) left zero trace anywhere: not
        // in this domain's Logs tab, not in the live traffic map, nothing.
        this._logBlockedRequest(domain, req, clientIp, 200, 'Challenge de sécurité affiché', startTime);
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
  // Read the sticky-session cookie when that load-balancing algorithm is
  // selected — independent of any per-domain "sticky sessions" toggle
  // (removed; this is plumbing for the 'sticky-session' LB strategy only).
  let stickyValue = null;
  if (domain.load_balancing_algorithm === 'sticky-session') {
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
  this._logBlockedRequest(domain, req, clientIp, 503, `No backend available: ${err.message}`, startTime);
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/html')) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderServiceUnavailablePage(domain.hostname));
  } else {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service Unavailable', message: 'No available backend' }));
  }
  return;
}

// ── 6. CIRCUIT BREAKER CHECK ─────────────────────────────────────────────
const cbKey = `${domain.id}:${backendHost}:${backendPort}`;
if (!circuitBreaker.isAvailable(cbKey)) {
  // Breaker is OPEN: fail fast instead of letting every request hang until
  // the (5min, now 30s by default) upstream timeout. isAvailable() already
  // returns true for the single allowed HALF_OPEN probe, so reaching here
  // means the backend is confirmed down — no free pass-through.
  logger.warn(`[HTTP Proxy ${domain.id}] Circuit breaker OPEN for ${cbKey} — failing fast (503)`);
  this._logBlockedRequest(domain, req, clientIp, 503, `Circuit breaker open for ${backendHost}:${backendPort} — backend repeatedly failing`, startTime);
  proxyMetrics.recordCircuitBreakerReject();
  if (backendId) { const lb = getLb(); if (lb) lb.decrementConnections(backendId); }
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/html')) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '10' });
    res.end(renderServiceUnavailablePage(domain.hostname));
  } else {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '10' });
    res.end(JSON.stringify({ error: 'Service Unavailable', message: 'Backend temporarily unavailable (circuit breaker open)' }));
  }
  return;
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

const acceptsHtml = String(req.headers.accept || '').includes('text/html');
if (acceptsHtml && config.proxy.injectConsoleScript) {
  headers['accept-encoding'] = 'identity';
}

const consolePayload = {
  host: String(domain.hostname || req.headers.host || 'unknown-host'),
  path: String(req.url || '/'),
  timestamp: new Date().toISOString()
};
const consoleMessage = `var np=${JSON.stringify(consolePayload)};console.groupCollapsed('%cNebulaProxy %c// live route','color:#C77DFF;font-size:16px;font-weight:800;letter-spacing:0.02em;','color:#8b5cf6;font-size:11px;font-weight:700;letter-spacing:0.08em;');console.log('%cDomain:%c '+np.host,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cPath:%c '+np.path,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cTimestamp:%c '+np.timestamp,'color:#a1a1aa;font-weight:700;','color:#fafafa;font-weight:500;');console.log('%cPowered by NebulaProxy','color:#22d3ee;font-size:12px;font-weight:700;');console.groupEnd();`;
const consoleScript = `<script>(function(){try{${consoleMessage}}catch(e){}})();</script>`;

// SECURITY: Enforce request body size limit (DOS prevention)
const MAX_BODY_SIZE = config.proxy?.maxRequestBodySize || (100 * 1024 * 1024); // 100MB default
let bytesReceived = 0;
let bodySizeLimitExceeded = false;

// A retry against a different backend is only safe when there is another
// backend to go to (load balancing enabled) and no request body could have
// been partially consumed by the failed attempt (GET/HEAD only).
const canRetryBackend = !!domain.load_balancing_enabled && (req.method === 'GET' || req.method === 'HEAD');

let activeProxyReq = null;

const dispatch = (target, attempt) => {
  const dBackendHost = target.hostname;
  const dBackendPort = target.port;
  const dBackendProtocol = target.protocol || 'http:';
  const dBackendId = target.backendId || null;
  const dCbKey = `${domain.id}:${dBackendHost}:${dBackendPort}`;

  const options = {
    hostname: dBackendHost,
    port: dBackendPort,
    path: req.url,
    method: req.method,
    agent: dBackendProtocol === 'https:' ? httpsKeepAliveAgent : httpKeepAliveAgent,
    headers
  };

  if (dBackendProtocol === 'https:') {
    if (!this._isIpAddress(req.headers.host?.split(':')[0])) {
      options.servername = req.headers.host?.split(':')[0] || dBackendHost;
    } else {
      options.servername = dBackendHost;
    }
    options.rejectUnauthorized = !config.proxy.allowInsecureBackends;
  }

  const protocol = dBackendProtocol === 'https:' ? https : http;
  const upstreamTimeoutMs = config.proxy.requestTimeoutMs > 0 ? config.proxy.requestTimeoutMs : 30000;
  const debugEnabled = logger.isLevelEnabled('debug');

  if (debugEnabled && (req.url.includes('/System/') || req.url.includes('/Branding/') || req.url.includes('/MediaBar/') || req.url.includes('/QuickConnect/'))) {
    logger.debug(`[DEBUG:HTTP] Sending to ${dBackendProtocol}//${dBackendHost}:${dBackendPort}${req.url}`);
    logger.debug(`  Method: ${req.method}`);
    logger.debug(`  Headers: ${JSON.stringify({
      host: options.headers.host,
      'x-forwarded-for': options.headers['x-forwarded-for'],
      'x-forwarded-proto': options.headers['x-forwarded-proto'],
      'x-real-ip': options.headers['x-real-ip']
    })}`);
  }

  if (debugEnabled) {
    logger.debug(`[HTTP Proxy ${domain.id}] upstream request ${req.method || 'GET'} ${req.url || '/'} -> ${dBackendProtocol}//${dBackendHost}:${dBackendPort} host=${req.headers.host || '-'} client=${clientIp} attempt=${attempt}`);
  }

  const handleFinalError = (error, responseTime) => {
    proxyMetrics.recordUpstreamError();
    logger.error(`[ProxyManager] Backend error for ${domain.hostname} (${req.method} ${req.url}):`);
    logger.error(`  Target: ${dBackendProtocol}//${dBackendHost}:${dBackendPort}`);
    logger.error(`  Error: ${error.code} - ${error.message}`);
    logger.error(`  Client IP: ${clientIp}`);
    logger.error(`  Host header: ${req.headers.host}`);

    // Fire-and-forget: queued asynchronously so resolving the country never
    // delays the 502 response written right after this call returns.
    geoIpService.getCountryCode(clientIp).catch(() => null).then((country) => {
      logBatchQueue.queueRequestLog({
        domainId: domain.id,
        hostname: domain.hostname,
        method: req.method,
        path: req.url.split('?')[0],
        queryString: req.url.includes('?') ? req.url.split('?')[1] : null,
        statusCode: 502,
        responseTime: responseTime,
        ipAddress: clientIp,
        country,
        userAgent: req.headers['user-agent'] || null,
        referer: req.headers['referer'] || req.headers['referrer'] || null,
        errorMessage: error.message,
        requestHeaders: sanitizeHeadersForLogging(req.headers)
      });
    });

    if (config.proxy.legacyProxyLogEnabled) {
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
    }

    if (!res.headersSent) {
      const accept = String(req.headers.accept || '');
      const wantsHtml = accept.includes('text/html');
      if (wantsHtml) {
        const html = renderBadGatewayPage(domain.hostname, { errorCode: error.code, errorMessage: error.message });
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
  };

  const proxyReq = protocol.request(options, (proxyRes) => {
    const responseTime = Date.now() - startTime;
    const statusCode = proxyRes.statusCode;
    let responseSize = 0;
    const contentType = String(proxyRes.headers['content-type'] || '').toLowerCase();
    const isHtmlResponse = contentType.includes('text/html');

    proxyMetrics.recordStatus(statusCode);

    if (debugEnabled) {
      logger.debug(`[HTTP Proxy ${domain.id}] upstream response ${statusCode} ${req.method || 'GET'} ${req.url || '/'} -> ${dBackendHost}:${dBackendPort} in ${responseTime}ms contentType=${contentType || '-'} client=${clientIp}`);
    }

    // Circuit breaker: success
    circuitBreaker.onSuccess(dCbKey);

    // STABILITY: without an 'error' listener, a mid-stream upstream error
    // (backend resets the connection after sending headers) is an unhandled
    // stream 'error' event — Node rethrows it, and with no process-level
    // handler that crashes the whole server for every domain at once.
    proxyRes.on('error', (err) => {
      logger.warn(`[HTTP Proxy ${domain.id}] upstream response stream error: ${err.message}`);
      if (!res.writableEnded) res.destroy(err);
    });

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
      if (dBackendId) { const lb = getLb(); if (lb) lb.decrementConnections(dBackendId); }
    });

    // Bandwidth tracking (fire-and-forget — never blocks response)
    proxyRes.on('end', () => {
      if (domain.user_id) {
        bandwidthTracker.record(domain.user_id, bytesReceived, responseSize).catch(() => {});
      }
    });

    // Log the request (batched for performance). Response has already been
    // sent to the client by the time 'end' fires, so resolving the client's
    // country here can delay persistence if the GeoIP service is slow or
    // unreachable. The country column is nullable, so persist immediately and
    // let geo enrichment happen elsewhere.
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
        country: null,
        userAgent: req.headers['user-agent'] || null,
        referer: req.headers['referer'] || req.headers['referrer'] || null,
        requestHeaders: sanitizeHeadersForLogging(req.headers),
        responseHeaders: sanitizeHeadersForLogging(proxyRes.headers)
      });
    });

    // Legacy proxy log (batched) — feeds the real-time "live logs" WebSocket
    // view only. Disable via PROXY_LEGACY_LOG_ENABLED=false to halve DB
    // write volume on the proxy hot path if that view isn't used.
    if (config.proxy.legacyProxyLogEnabled) {
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
    }

    // Build response headers (copy from backend)
    const responseHeaders = { ...proxyRes.headers };

    const requestedHost = String(req.headers.host || '').trim();
    const upstreamLocation = responseHeaders.location || responseHeaders.Location;
    if (upstreamLocation && requestedHost) {
      try {
        const parsedLocation = new URL(upstreamLocation, `${dBackendProtocol}//${dBackendHost}:${dBackendPort}`);
        const upstreamHost = parsedLocation.hostname.toLowerCase();
        const requestedHostname = requestedHost.split(':')[0].toLowerCase();

        const publicPort = req.socket.encrypted ? 443 : 80;
        const locPort = parsedLocation.port ? parseInt(parsedLocation.port, 10) : (parsedLocation.protocol === "https:" ? 443 : 80);
        const hostnameNeedsRewrite = parsedLocation.origin && upstreamHost === String(dBackendHost).toLowerCase() && requestedHostname && requestedHostname !== upstreamHost;
        const portNeedsRewrite = parsedLocation.origin && upstreamHost === requestedHostname && locPort === parseInt(String(dBackendPort), 10) && locPort !== publicPort;

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

    // Sticky session: set cookie when the 'sticky-session' LB algorithm is
    // selected and we know the backend id (fixed TTL — no per-domain config).
    if (domain.load_balancing_algorithm === 'sticky-session' && dBackendId) {
      const existing = responseHeaders['set-cookie'] || [];
      const cookieArr = Array.isArray(existing) ? existing : [existing];
      cookieArr.push(`__nebula_srv=${dBackendId}; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax`);
      responseHeaders['set-cookie'] = cookieArr;
    }

    res.writeHead(proxyRes.statusCode, responseHeaders);

    if (isHtmlResponse && config.proxy.injectConsoleScript) {
      // STREAMING injection: previously buffered the *entire* response body
      // in memory before writing anything to the client (latency + memory
      // spike proportional to page size). Now only a small sliding window
      // (marker length) is held, to catch a "</body>" split across chunk
      // boundaries — everything else is forwarded as it arrives.
      const marker = Buffer.from('</body>');
      const scriptBuf = Buffer.from(consoleScript);
      let held = Buffer.alloc(0);
      let injected = false;

      proxyRes.on('data', (chunk) => {
        let outBuf;
        if (injected) {
          outBuf = chunk;
        } else {
          const combined = held.length ? Buffer.concat([held, chunk]) : chunk;
          const idx = combined.indexOf(marker);
          if (idx !== -1) {
            outBuf = Buffer.concat([combined.subarray(0, idx), scriptBuf, combined.subarray(idx)]);
            injected = true;
            held = Buffer.alloc(0);
          } else {
            const keep = Math.min(marker.length - 1, combined.length);
            const flushEnd = combined.length - keep;
            outBuf = combined.subarray(0, flushEnd);
            held = Buffer.from(combined.subarray(flushEnd));
          }
        }
        if (outBuf.length > 0 && res.write(outBuf) === false) {
          proxyRes.pause();
        }
      });
      res.on('drain', () => { if (proxyRes.isPaused()) proxyRes.resume(); });
      proxyRes.on('end', () => {
        if (!injected) {
          if (held.length) res.write(held);
          res.write(scriptBuf);
        }
        res.end();
      });
    } else {
      proxyRes.pipe(res);
    }
  });

  activeProxyReq = proxyReq;

  proxyReq.setTimeout(upstreamTimeoutMs, () => {
    const timeoutError = new Error(`Upstream request timeout after ${upstreamTimeoutMs}ms`);
    timeoutError.code = 'ETIMEDOUT';
    proxyReq.destroy(timeoutError);
  });

  proxyReq.on('error', (error) => {
    const responseTime = Date.now() - startTime;

    // Least-connections: decrement on error so the backend isn't penalised indefinitely
    if (dBackendId) { const lb = getLb(); if (lb) lb.decrementConnections(dBackendId); }

    // Circuit breaker: failure (but not for ECONNRESET which might be normal close)
    if (error.code !== 'ECONNRESET') {
      circuitBreaker.onFailure(dCbKey, error);
    }

    // Suppress ECONNRESET errors if response was already started (client received data)
    if (error.code === 'ECONNRESET' && res.headersSent) {
      logger.debug(`[DEBUG:HTTP] Backend closed connection after sending response (normal): ${domain.hostname} ${req.method} ${req.url}`);
      return;
    }

    // Single retry against a different backend for connect-level failures,
    // only for bodyless requests (GET/HEAD) so nothing was already sent
    // upstream, and only when load balancing offers another candidate.
    if (attempt === 1 && canRetryBackend && bytesReceived === 0 && !res.headersSent && RETRYABLE_CONNECT_ERROR_CODES.has(error.code)) {
      this._selectBackendForDomain(domain, clientIp, 'http', { excludeBackendId: dBackendId })
        .then((nextTarget) => {
          if (nextTarget && (nextTarget.hostname !== dBackendHost || nextTarget.port !== dBackendPort)) {
            logger.warn(`[HTTP Proxy ${domain.id}] backend ${dBackendHost}:${dBackendPort} ${error.code} — retrying once on ${nextTarget.hostname}:${nextTarget.port}`);
            proxyMetrics.recordRetry();
            if (nextTarget.backendId) { const lb = getLb(); if (lb) lb.incrementConnections(nextTarget.backendId); }
            req.unpipe(proxyReq);
            dispatch(nextTarget, 2);
          } else {
            handleFinalError(error, responseTime);
          }
        })
        .catch(() => handleFinalError(error, responseTime));
      return;
    }

    handleFinalError(error, responseTime);
  });

  // GET/HEAD have no body — end() directly on retry rather than re-piping
  // `req`, which may have already emitted 'end' on the first attempt (pipe()
  // does not forward an already-past 'end' event to a newly piped destination).
  if (attempt === 1) {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
};

req.on('data', (chunk) => {
  bytesReceived += chunk.length;

  if (bytesReceived > MAX_BODY_SIZE && !bodySizeLimitExceeded) {
    bodySizeLimitExceeded = true;
    logger.warn(`[HTTP Proxy ${domain.id}] Request body size limit exceeded: ${bytesReceived} bytes from ${clientIp}`);

    // Destroy both connections
    req.destroy();
    if (activeProxyReq) activeProxyReq.destroy();

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

// STABILITY: previously neither `req` nor `res` had an 'error' listener.
// A client aborting mid-upload or disconnecting mid-response-write emits
// an unhandled stream 'error' — with no process-level safety net either,
// this took down the entire process (every proxied domain at once) instead
// of just failing the one affected request.
req.on('error', (err) => {
  logger.debug(`[HTTP Proxy ${domain.id}] client request stream error: ${err.message}`);
  if (activeProxyReq) activeProxyReq.destroy(err);
});
res.on('error', (err) => {
  logger.debug(`[HTTP Proxy ${domain.id}] client response stream error: ${err.message}`);
  if (activeProxyReq) activeProxyReq.destroy(err);
});

dispatch({ hostname: backendHost, port: backendPort, protocol: backendProtocol, backendId }, 1);
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

// Logs requests rejected before ever reaching a backend (rate limit,
// bandwidth quota, circuit breaker open, no backend available) — these used
// to be silent (console-only), leaving the domain owner with zero visibility
// into why their domain was inaccessible. Fire-and-forget, same as the
// normal request-completion logging path.
_logBlockedRequest(domain, req, clientIp, statusCode, errorMessage, startTime) {
  const urlPath = (req.url || '/').split('?')[0];
  const queryString = req.url && req.url.includes('?') ? req.url.split('?')[1] : null;
  logBatchQueue.queueRequestLog({
    domainId: domain.id,
    hostname: domain.hostname,
    method: req.method,
    path: urlPath,
    queryString,
    statusCode,
    responseTime: Date.now() - startTime,
    ipAddress: clientIp,
    country: null,
    userAgent: req.headers['user-agent'] || null,
    referer: req.headers['referer'] || req.headers['referrer'] || null,
    errorMessage
  });
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
