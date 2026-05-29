/**
 * HTML error page renderers — extracted from ProxyManager.
 *
 * All functions are pure (no class state, no `this`).
 * They accept only the data they need and return an HTML string.
 * This makes them independently testable and keeps proxyManager.js leaner.
 */

import { config } from '../../config/config.js';

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;')
    .replace(/\//g, '&#x2F;');

// ── Shared dark-mode CSS snippet reused by all pages ─────────────────────────
const BASE_CSS = `
  :root { color-scheme: dark; --bg:#0b0c0f; --panel:rgba(22,23,34,0.9); --border:rgba(255,255,255,0.08); --text:#e6e7ef; --muted:rgba(255,255,255,0.55); --accent:#c77dff; --warning:#f59e0b; }
  *{box-sizing:border-box;}
  body{margin:0;font-family:"Segoe UI",Tahoma,sans-serif;background:radial-gradient(1200px 500px at 10% 10%,rgba(157,78,221,0.15),transparent),radial-gradient(900px 500px at 90% 20%,rgba(34,211,238,0.12),transparent),var(--bg);color:var(--text);min-height:100vh;display:grid;place-items:center;padding:32px 16px;}
  .card{width:min(720px,100%);background:var(--panel);border:1px solid var(--border);border-radius:24px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.45);}
  .badge{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);color:#fbbf24;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;}
  h1{margin:18px 0 8px;font-weight:300;font-size:28px;}
  p{margin:0 0 16px;color:var(--muted);font-size:14px;line-height:1.6;}
  .box{border:1px solid var(--border);border-radius:16px;padding:16px;background:rgba(245,158,11,0.05);margin-top:18px;}
  .box p{margin:0;color:var(--text);}
  .actions{margin-top:22px;display:flex;flex-wrap:wrap;gap:12px;}
  .btn{appearance:none;border:1px solid rgba(157,78,221,0.4);background:linear-gradient(135deg,rgba(157,78,221,0.2),rgba(123,44,191,0.15));color:#c77dff;padding:10px 16px;border-radius:12px;font-size:13px;cursor:pointer;transition:0.2s ease;}
  .btn:hover{transform:translateY(-1px);box-shadow:0 10px 20px rgba(0,0,0,0.25);}
  footer{margin-top:26px;font-size:11px;color:rgba(255,255,255,0.35);}
`;

// ── Maintenance page ──────────────────────────────────────────────────────────
export function renderMaintenancePage(domain) {
  const safeHost = escapeHtml(domain.hostname || '');
  const safeMsg  = escapeHtml(domain.maintenance_message || 'Service temporarily unavailable.');
  const eta      = domain.maintenance_end_time
    ? `<p style="color:#fbbf24">Expected back: <strong>${new Date(domain.maintenance_end_time).toLocaleString()}</strong></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Maintenance — ${safeHost}</title><style>${BASE_CSS}
  .badge{background:rgba(245,158,11,0.12);border-color:rgba(245,158,11,0.35);color:#fbbf24;}
</style></head><body><div class="card">
  <div class="badge">Maintenance</div>
  <h1>Service Temporarily Unavailable</h1>
  <p>The proxy for <strong>${safeHost}</strong> is undergoing maintenance or is restarting.</p>
  <div class="box"><p>${safeMsg}</p>${eta}</div>
  <div class="actions">
    <button class="btn" onclick="location.reload()">Retry</button>
    <button class="btn" onclick="history.back()">Go back</button>
  </div>
  <footer>If the service remains unavailable, contact your administrator. ${new Date().toISOString()}</footer>
</div></body></html>`;
}

// ── Bad Gateway (502) ─────────────────────────────────────────────────────────
export function renderBadGatewayPage(hostname) {
  const copy      = config.proxy?.badGatewayPage || {};
  const safeHost  = escapeHtml(hostname || 'unknown');
  const badge     = escapeHtml(copy.badge    || 'Bad Gateway');
  const title     = escapeHtml(copy.title    || 'Backend unavailable');
  const subtitle  = escapeHtml(copy.subtitle || 'The proxy cannot reach the backend for this domain.');
  const message   = escapeHtml(copy.message  || 'The backend server is temporarily unreachable. Please try again shortly.');
  const footer    = escapeHtml(copy.footerText || 'Contact your administrator if the problem persists.');
  const retry     = escapeHtml(copy.retryButton || 'Retry');
  const back      = escapeHtml(copy.backButton  || 'Go back');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>502 Bad Gateway — ${safeHost}</title><style>${BASE_CSS}</style></head><body><div class="card">
  <div class="badge">${badge}</div>
  <h1>${title}</h1>
  <p>${subtitle}</p>
  <div class="box"><p>${message}</p></div>
  <div class="actions">
    <button class="btn" onclick="location.reload()">${retry}</button>
    <button class="btn" onclick="history.back()">${back}</button>
  </div>
  <footer>${footer} — Domain: ${safeHost}</footer>
</div></body></html>`;
}

// ── Access Blocked (403 / 401) ────────────────────────────────────────────────
export function renderBlockedPage(message, statusCode = 403) {
  const safeMsg    = escapeHtml(message || 'Access to this resource is forbidden.');
  const statusText = statusCode === 401 ? 'Unauthorized' : statusCode === 403 ? 'Forbidden' : 'Access Denied';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${statusCode} ${statusText}</title><style>${BASE_CSS}</style></head><body><div class="card">
  <div class="badge">${statusCode} ${statusText}</div>
  <h1>Access Denied</h1>
  <p>Your request has been blocked. Access to this resource is restricted.</p>
  <div class="box"><p>${safeMsg}</p></div>
  <div class="actions"><button class="btn" onclick="history.back()">Go back</button></div>
  <footer>Contact your administrator for access. ${new Date().toISOString()}</footer>
</div></body></html>`;
}

// ── Bandwidth Quota Exceeded (429) ────────────────────────────────────────────
export function renderBandwidthExceededPage(domain) {
  const host = escapeHtml(domain?.hostname || 'this service');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bandwidth Limit Reached — ${host}</title>
<style>
  :root{color-scheme:dark;--bg:#09090b;--surface:#18181b;--border:#27272a;--text:#fafafa;--muted:#a1a1aa;--accent:#f59e0b;}
  *{box-sizing:border-box;}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:48px 40px;max-width:480px;width:100%;text-align:center;}
  .icon{font-size:48px;margin-bottom:20px;}
  h1{font-size:22px;font-weight:600;margin:0 0 12px;}
  p{font-size:14px;color:var(--muted);line-height:1.6;margin:0 0 12px;}
  .badge{display:inline-block;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:var(--accent);font-size:12px;font-weight:500;padding:4px 12px;border-radius:20px;margin-bottom:24px;}
  .footer{font-size:11px;color:#52525b;margin-top:24px;padding-top:20px;border-top:1px solid var(--border);}
</style></head><body>
<div class="card">
  <div class="icon">📊</div>
  <div class="badge">429 Bandwidth Limit</div>
  <h1>Data Limit Reached</h1>
  <p>The bandwidth quota for <strong>${host}</strong> has been reached.</p>
  <p>Service will resume automatically when the quota resets. If you are the account owner, contact your administrator to increase your limit.</p>
  <div class="footer">Powered by NebulaProxy</div>
</div></body></html>`;
}
