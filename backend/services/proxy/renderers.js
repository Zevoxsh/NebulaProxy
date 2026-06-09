/**
 * HTML error page renderers — Cloudflare-style layout, NebulaProxy branding.
 * Pure functions: accept data, return HTML string.
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

const genRef = () =>
  [...Array(16)].map(() => '0123456789abcdef'[Math.random() * 16 | 0]).join('');

const fmtTime = () =>
  new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/Paris',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

// ── Path node icons (40 px square, uses currentColor) ────────────────────────

const ICON_BROWSER = `<svg width="40" height="36" viewBox="0 0 40 36" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="38" height="34" rx="5" fill="currentColor" fill-opacity=".1" stroke="currentColor" stroke-width="1.5"/>
  <path d="M1 6C1 3.24 3.24 1 6 1H34C36.76 1 39 3.24 39 6V13H1Z" fill="currentColor" fill-opacity=".32"/>
  <rect x="4"  y="3"  width="14" height="5"  rx="2.5" fill="currentColor" fill-opacity=".5"/>
  <circle cx="8"    cy="5.5" r="1.8" fill="currentColor" fill-opacity=".75"/>
  <circle cx="13"   cy="5.5" r="1.8" fill="currentColor" fill-opacity=".75"/>
  <rect x="20" y="3"  width="17" height="5"  rx="2.5" fill="currentColor" fill-opacity=".28"/>
  <circle cx="23.5" cy="5.5" r="1.5" fill="currentColor" fill-opacity=".5"/>
  <rect x="5"  y="17" width="30" height="4"  rx="2"   fill="currentColor" fill-opacity=".48"/>
  <rect x="5"  y="23" width="22" height="3"  rx="1.5" fill="currentColor" fill-opacity=".28"/>
  <rect x="5"  y="28" width="27" height="3"  rx="1.5" fill="currentColor" fill-opacity=".2"/>
</svg>`;

const ICON_PROXY = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 2L36 11V29L20 38L4 29V11Z" fill="currentColor" fill-opacity=".13" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M20 9.5L30 15V25L20 30.5L10 25V15Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  <circle cx="20" cy="20" r="5.5" fill="currentColor"/>
  <circle cx="20" cy="20" r="2.5" fill="currentColor" fill-opacity=".35"/>
</svg>`;

const ICON_SERVER = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="5"  width="34" height="12" rx="3" fill="currentColor" fill-opacity=".13" stroke="currentColor" stroke-width="1.5"/>
  <rect x="3" y="22" width="34" height="12" rx="3" fill="currentColor" fill-opacity=".13" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="31.5" cy="11" r="3.5" fill="currentColor" opacity=".9"/>
  <circle cx="31.5" cy="28" r="3.5" fill="currentColor" opacity=".9"/>
  <rect x="7"  y="9.5"  width="19" height="3"  rx="1.5" fill="currentColor" opacity=".42"/>
  <rect x="7"  y="26.5" width="13" height="3"  rx="1.5" fill="currentColor" opacity=".42"/>
</svg>`;

// ── Per-page animations ───────────────────────────────────────────────────────

const ANIM_NOT_FOUND = `<style>
.nf-w{position:relative;width:70px;height:70px}
.nf-r{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(139,92,246,.5);animation:nfx 2.2s ease-out infinite}
.nf-r:nth-child(2){animation-delay:.55s}.nf-r:nth-child(3){animation-delay:1.1s}
@keyframes nfx{0%{transform:scale(0);opacity:.9}100%{transform:scale(2.1);opacity:0}}
.nf-c{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.nf-dot{width:10px;height:10px;border-radius:50%;background:#a78bfa;box-shadow:0 0 14px rgba(139,92,246,.9)}
.nf-lbl{font-size:11px;color:rgba(255,255,255,.3);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.07em;margin-top:14px}
</style>
<div class="nf-w"><div class="nf-r"></div><div class="nf-r"></div><div class="nf-r"></div><div class="nf-c"><div class="nf-dot"></div></div></div>
<div class="nf-lbl">Searching for domain…</div>`;

const ANIM_BAD_GATEWAY = `<style>
.bgs{display:flex;align-items:center;gap:10px}
.bgn{width:14px;height:14px;border-radius:50%;flex-shrink:0}
.bgok{background:#22c55e;box-shadow:0 0 10px rgba(34,197,94,.55)}
.bger{background:#ef4444;animation:bgfl 1.8s ease-in-out infinite}
@keyframes bgfl{0%,100%{background:rgba(239,68,68,.3);box-shadow:none}45%,55%{background:#ef4444;box-shadow:0 0 14px rgba(239,68,68,.9)}}
.bgwire{display:flex;align-items:center;gap:4px}
.bgd{width:10px;height:2px;background:rgba(255,255,255,.2);border-radius:1px}
.bgx{animation:bgx 1.8s ease-in-out infinite}
@keyframes bgx{0%,100%{opacity:.2;transform:scale(.8)}45%,55%{opacity:1;transform:scale(1.2)}}
.bglbl{font-size:11px;color:rgba(255,255,255,.3);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.07em;margin-top:12px}
</style>
<div class="bgs">
  <div class="bgn bgok"></div>
  <div class="bgwire">
    <div class="bgd"></div><div class="bgd"></div>
    <svg class="bgx" width="18" height="18" viewBox="0 0 18 18" fill="none"><line x1="3" y1="3" x2="15" y2="15" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/><line x1="15" y1="3" x2="3" y2="15" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/></svg>
    <div class="bgd"></div><div class="bgd"></div>
  </div>
  <div class="bgn bger"></div>
</div>
<div class="bglbl">Connection failed</div>`;

const ANIM_UNAVAILABLE = `<style>
.svb{display:flex;align-items:flex-end;gap:5px;height:44px}
.svbar{border-radius:3px 3px 0 0;width:11px;background:rgba(239,68,68,.75);animation:svf 2.4s ease-in-out infinite}
.svbar:nth-child(1){height:16px;animation-delay:.8s}
.svbar:nth-child(2){height:28px;animation-delay:.4s}
.svbar:nth-child(3){height:44px;animation-delay:0s}
@keyframes svf{0%{opacity:.8}35%{opacity:.8}60%{opacity:.1}85%{opacity:.1}100%{opacity:.8}}
.svlbl{font-size:11px;color:rgba(255,255,255,.3);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.07em;margin-top:12px}
</style>
<div class="svb"><div class="svbar"></div><div class="svbar"></div><div class="svbar"></div></div>
<div class="svlbl">All backends offline</div>`;

const ANIM_MAINTENANCE = `<style>
.mtg{animation:mtspin 5s linear infinite;display:block;filter:drop-shadow(0 0 8px rgba(245,158,11,.4))}
@keyframes mtspin{to{transform:rotate(360deg)}}
.mtlbl{font-size:11px;color:rgba(255,255,255,.3);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.07em;margin-top:10px}
</style>
<svg class="mtg" width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="26" cy="26" r="11" fill="rgba(245,158,11,0.2)" stroke="rgba(245,158,11,0.65)" stroke-width="2"/>
  <circle cx="26" cy="26" r="4.5" fill="rgba(245,158,11,0.7)"/>
  <rect x="23.5" y="4"  width="5" height="9" rx="2.5" fill="rgba(245,158,11,0.5)"/>
  <rect x="23.5" y="4"  width="5" height="9" rx="2.5" fill="rgba(245,158,11,0.5)" transform="rotate(45 26 26)"/>
  <rect x="23.5" y="4"  width="5" height="9" rx="2.5" fill="rgba(245,158,11,0.5)" transform="rotate(90 26 26)"/>
  <rect x="23.5" y="4"  width="5" height="9" rx="2.5" fill="rgba(245,158,11,0.5)" transform="rotate(135 26 26)"/>
  <rect x="23.5" y="4"  width="5" height="9" rx="2.5" fill="rgba(245,158,11,0.5)" transform="rotate(180 26 26)"/>
  <rect x="23.5" y="4"  width="5" height="9" rx="2.5" fill="rgba(245,158,11,0.5)" transform="rotate(225 26 26)"/>
  <rect x="23.5" y="4"  width="5" height="9" rx="2.5" fill="rgba(245,158,11,0.5)" transform="rotate(270 26 26)"/>
  <rect x="23.5" y="4"  width="5" height="9" rx="2.5" fill="rgba(245,158,11,0.5)" transform="rotate(315 26 26)"/>
</svg>
<div class="mtlbl">Work in progress</div>`;

const ANIM_BLOCKED = `<style>
.bll{animation:blp 2s ease-in-out infinite;display:block}
@keyframes blp{0%,100%{filter:drop-shadow(0 0 4px rgba(239,68,68,.2));transform:scale(1)}50%{filter:drop-shadow(0 0 20px rgba(239,68,68,.9));transform:scale(1.08)}}
.bllbl{font-size:11px;color:rgba(255,255,255,.3);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.07em;margin-top:10px}
</style>
<svg class="bll" width="42" height="52" viewBox="0 0 42 52" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11 22V16C11 9.37 15.48 4 21 4C26.52 4 31 9.37 31 16V22" stroke="rgba(239,68,68,0.75)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  <rect x="3" y="20" width="36" height="28" rx="7" fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.65)" stroke-width="2"/>
  <circle cx="21" cy="33" r="5" fill="rgba(239,68,68,0.85)"/>
  <rect x="19" y="33" width="4" height="8" rx="2" fill="rgba(239,68,68,0.85)"/>
</svg>
<div class="bllbl">Access denied</div>`;

const ANIM_BANDWIDTH = `<style>
.bww{width:190px}
.bwhdr{display:flex;justify-content:space-between;margin-bottom:7px;font-size:12px;font-family:Inter,sans-serif;font-weight:600}
.bwused{animation:bwcol 2.8s ease-in-out infinite}
@keyframes bwcol{0%{color:#86efac}65%,100%{color:#fca5a5}}
.bwlim{color:rgba(255,255,255,.3)}
.bwtrack{height:10px;background:rgba(255,255,255,.08);border-radius:5px;overflow:hidden}
.bwfill{height:100%;border-radius:5px;background:linear-gradient(90deg,#22c55e 0%,#f59e0b 55%,#ef4444 100%);animation:bwfill 2.8s ease-in-out infinite}
@keyframes bwfill{0%,5%{width:18%}72%{width:100%;filter:none}80%,85%{width:100%;filter:brightness(1.9)}90%,100%{width:18%;filter:none}}
.bwlbl{font-size:11px;color:rgba(255,255,255,.3);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.07em;margin-top:7px}
</style>
<div class="bww">
  <div class="bwhdr"><span class="bwused">USED</span><span class="bwlim">LIMIT</span></div>
  <div class="bwtrack"><div class="bwfill"></div></div>
  <div class="bwlbl">Monthly transfer quota</div>
</div>`;

const ANIM_RATE_LIMIT = `<style>
.rls{display:flex;align-items:center;gap:14px}
.rlrs{display:flex;flex-direction:column;gap:7px}
.rlr{height:5px;width:52px;border-radius:2.5px;background:rgba(255,255,255,.55);animation:rlr 2s ease-in-out infinite}
.rlr:nth-child(1){animation-delay:0s}.rlr:nth-child(2){animation-delay:.2s}
.rlr:nth-child(3){animation-delay:.4s}.rlr:nth-child(4){animation-delay:.6s}.rlr:nth-child(5){animation-delay:.8s}
@keyframes rlr{0%,100%{transform:translateX(0);opacity:.4}55%{transform:translateX(30px);opacity:1}68%{transform:translateX(22px);opacity:.2}}
.rlwall{width:6px;height:57px;border-radius:3px;background:rgba(239,68,68,.65);animation:rlg 2s ease-in-out infinite}
@keyframes rlg{0%,52%{box-shadow:none}60%,70%{box-shadow:0 0 20px rgba(239,68,68,1)}82%,100%{box-shadow:none}}
.rllbl{font-size:11px;color:rgba(255,255,255,.3);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.07em;margin-top:12px}
</style>
<div class="rls">
  <div class="rlrs"><div class="rlr"></div><div class="rlr"></div><div class="rlr"></div><div class="rlr"></div><div class="rlr"></div></div>
  <div class="rlwall"></div>
</div>
<div class="rllbl">Rate limit reached</div>`;

const ANIM_PAYLOAD = `<style>
.pls{width:176px;position:relative}
.plmax{width:110px;border-top:2px dashed rgba(255,255,255,.22);position:relative;margin-bottom:7px}
.plmax::after{content:'MAX';position:absolute;right:-34px;top:-9px;font-size:10px;color:rgba(255,255,255,.38);font-family:Inter,sans-serif;font-weight:600;letter-spacing:.06em}
.plbar{height:11px;border-radius:5.5px;animation:plg 2.6s ease-in-out infinite}
@keyframes plg{0%,5%{width:44px;background:rgba(34,197,94,.65);filter:none}62%{width:154px;background:rgba(239,68,68,.7);filter:none}72%{width:154px;background:rgba(239,68,68,.9);filter:brightness(1.9)}78%,100%{width:44px;background:rgba(34,197,94,.65);filter:none}}
.pllbl{font-size:11px;color:rgba(255,255,255,.3);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.07em;margin-top:8px}
</style>
<div class="pls"><div class="plmax"></div><div class="plbar"></div></div>
<div class="pllbl">Payload exceeds limit</div>`;

// ── Shared CSS ────────────────────────────────────────────────────────────────
// ── Per-page watermark SVGs ───────────────────────────────────────────────────

const WMRK_NOT_FOUND = `<svg width="260" height="260" viewBox="0 0 260 260" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="110" cy="110" r="82" stroke="rgba(139,92,246,1)" stroke-width="9"/>
  <line x1="168" y1="168" x2="236" y2="236" stroke="rgba(139,92,246,1)" stroke-width="14" stroke-linecap="round"/>
  <text x="110" y="142" text-anchor="middle" fill="rgba(139,92,246,1)" font-size="96" font-family="Inter,sans-serif" font-weight="700">?</text>
</svg>`;

const WMRK_BAD_GATEWAY = `<svg width="280" height="130" viewBox="0 0 280 130" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="30" width="72" height="54" rx="10" stroke="rgba(239,68,68,1)" stroke-width="7" fill="rgba(239,68,68,0.08)"/>
  <rect x="16" y="42" width="24" height="10" rx="3" fill="rgba(239,68,68,0.55)"/>
  <rect x="16" y="57" width="40" height="6" rx="3" fill="rgba(239,68,68,0.3)"/>
  <line x1="80" y1="57" x2="112" y2="57" stroke="rgba(239,68,68,1)" stroke-width="6"/>
  <line x1="113" y1="37" x2="143" y2="77" stroke="rgba(239,68,68,1)" stroke-width="8" stroke-linecap="round"/>
  <line x1="143" y1="37" x2="113" y2="77" stroke="rgba(239,68,68,1)" stroke-width="8" stroke-linecap="round"/>
  <line x1="143" y1="57" x2="170" y2="57" stroke="rgba(239,68,68,1)" stroke-width="6"/>
  <rect x="170" y="30" width="72" height="54" rx="10" stroke="rgba(239,68,68,1)" stroke-width="7" fill="rgba(239,68,68,0.08)"/>
  <rect x="178" y="42" width="24" height="10" rx="3" fill="rgba(239,68,68,0.3)"/>
  <rect x="178" y="57" width="40" height="6" rx="3" fill="rgba(239,68,68,0.2)"/>
</svg>`;

const WMRK_UNAVAILABLE = `<svg width="190" height="260" viewBox="0 0 190 260" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="15" y="15"  width="160" height="44" rx="7" stroke="rgba(239,68,68,1)" stroke-width="6" fill="rgba(239,68,68,0.06)"/>
  <circle cx="158" cy="37" r="10" fill="rgba(239,68,68,0.7)"/>
  <rect x="25"  y="27"  width="100" height="8" rx="4" fill="rgba(239,68,68,0.3)"/>
  <rect x="15" y="72"  width="160" height="44" rx="7" stroke="rgba(239,68,68,1)" stroke-width="6" fill="rgba(239,68,68,0.06)"/>
  <circle cx="158" cy="94" r="10" fill="rgba(239,68,68,0.7)"/>
  <rect x="25"  y="84"  width="80"  height="8" rx="4" fill="rgba(239,68,68,0.3)"/>
  <rect x="15" y="129" width="160" height="44" rx="7" stroke="rgba(239,68,68,1)" stroke-width="6" fill="rgba(239,68,68,0.06)"/>
  <circle cx="158" cy="151" r="10" fill="rgba(239,68,68,0.7)"/>
  <rect x="25"  y="141" width="110" height="8" rx="4" fill="rgba(239,68,68,0.3)"/>
  <line x1="22"  y1="18"  x2="168" y2="228" stroke="rgba(239,68,68,0.9)" stroke-width="18" stroke-linecap="round"/>
  <line x1="168" y1="18"  x2="22"  y2="228" stroke="rgba(239,68,68,0.9)" stroke-width="18" stroke-linecap="round"/>
</svg>`;

const WMRK_MAINTENANCE = `<svg width="260" height="260" viewBox="0 0 260 260" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="130" cy="130" r="52" stroke="rgba(245,158,11,1)" stroke-width="9"/>
  <circle cx="130" cy="130" r="22" fill="rgba(245,158,11,0.25)" stroke="rgba(245,158,11,1)" stroke-width="9"/>
  <rect x="117" y="12"  width="26" height="42" rx="8" fill="rgba(245,158,11,0.8)"/>
  <rect x="117" y="12"  width="26" height="42" rx="8" fill="rgba(245,158,11,0.8)" transform="rotate(45 130 130)"/>
  <rect x="117" y="12"  width="26" height="42" rx="8" fill="rgba(245,158,11,0.8)" transform="rotate(90 130 130)"/>
  <rect x="117" y="12"  width="26" height="42" rx="8" fill="rgba(245,158,11,0.8)" transform="rotate(135 130 130)"/>
  <rect x="117" y="12"  width="26" height="42" rx="8" fill="rgba(245,158,11,0.8)" transform="rotate(180 130 130)"/>
  <rect x="117" y="12"  width="26" height="42" rx="8" fill="rgba(245,158,11,0.8)" transform="rotate(225 130 130)"/>
  <rect x="117" y="12"  width="26" height="42" rx="8" fill="rgba(245,158,11,0.8)" transform="rotate(270 130 130)"/>
  <rect x="117" y="12"  width="26" height="42" rx="8" fill="rgba(245,158,11,0.8)" transform="rotate(315 130 130)"/>
</svg>`;

const WMRK_BLOCKED = `<svg width="200" height="260" viewBox="0 0 200 260" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M55 118V72C55 41.1 74.6 16 100 16C125.4 16 145 41.1 145 72V118" stroke="rgba(239,68,68,1)" stroke-width="13" stroke-linecap="round" fill="none"/>
  <rect x="14" y="112" width="172" height="134" rx="20" stroke="rgba(239,68,68,1)" stroke-width="9" fill="rgba(239,68,68,0.07)"/>
  <circle cx="100" cy="165" r="22" fill="rgba(239,68,68,0.85)"/>
  <rect x="91"  cy="165" width="18" height="30" rx="9" fill="rgba(239,68,68,0.85)" x="91" y="165"/>
</svg>`;

const WMRK_BANDWIDTH = `<svg width="260" height="170" viewBox="0 0 260 170" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 150 A110 110 0 0 1 240 150" stroke="rgba(255,255,255,0.12)" stroke-width="14" stroke-linecap="round" fill="none"/>
  <path d="M20 150 A110 110 0 0 1 83 38"  stroke="rgba(34,197,94,0.75)"   stroke-width="14" stroke-linecap="round" fill="none"/>
  <path d="M83 38  A110 110 0 0 1 177 38" stroke="rgba(245,158,11,0.75)"  stroke-width="14" stroke-linecap="round" fill="none"/>
  <path d="M177 38 A110 110 0 0 1 240 150" stroke="rgba(239,68,68,0.85)"  stroke-width="14" stroke-linecap="round" fill="none"/>
  <line x1="130" y1="150" x2="218" y2="60" stroke="rgba(245,158,11,1)" stroke-width="7" stroke-linecap="round"/>
  <circle cx="130" cy="150" r="12" fill="rgba(245,158,11,0.9)"/>
  <line x1="22"  y1="150" x2="30"  y2="138" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
  <line x1="130" y1="42"  x2="130" y2="54"  stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
  <line x1="238" y1="150" x2="230" y2="138" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
</svg>`;

const WMRK_RATE_LIMIT = `<svg width="260" height="210" viewBox="0 0 260 210" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="210" y="18" width="24" height="175" rx="6" fill="rgba(239,68,68,0.8)"/>
  <line x1="18" y1="50"  x2="192" y2="50"  stroke="rgba(245,158,11,0.9)" stroke-width="6" stroke-linecap="round"/>
  <polygon points="192,38 214,50 192,62" fill="rgba(245,158,11,0.9)"/>
  <line x1="18" y1="88"  x2="178" y2="88"  stroke="rgba(245,158,11,0.8)" stroke-width="6" stroke-linecap="round"/>
  <polygon points="178,76 200,88 178,100" fill="rgba(245,158,11,0.8)"/>
  <line x1="18" y1="120" x2="186" y2="120" stroke="rgba(245,158,11,0.75)" stroke-width="6" stroke-linecap="round"/>
  <polygon points="186,108 208,120 186,132" fill="rgba(245,158,11,0.75)"/>
  <line x1="18" y1="155" x2="172" y2="155" stroke="rgba(245,158,11,0.65)" stroke-width="6" stroke-linecap="round"/>
  <polygon points="172,143 194,155 172,167" fill="rgba(245,158,11,0.65)"/>
</svg>`;

const WMRK_PAYLOAD = `<svg width="210" height="260" viewBox="0 0 210 260" fill="none" xmlns="http://www.w3.org/2000/svg">
  <line x1="105" y1="10"  x2="105" y2="70"  stroke="rgba(239,68,68,1)" stroke-width="9" stroke-linecap="round"/>
  <polygon points="72,60 105,98 138,60" fill="rgba(239,68,68,1)"/>
  <rect x="18" y="90"  width="174" height="130" rx="10" stroke="rgba(239,68,68,1)" stroke-width="8" fill="rgba(239,68,68,0.07)"/>
  <line x1="105" y1="90"  x2="105" y2="220" stroke="rgba(239,68,68,0.45)" stroke-width="5"/>
  <line x1="18"  y1="148" x2="192" y2="148" stroke="rgba(239,68,68,0.45)" stroke-width="5"/>
  <rect x="18" y="234" width="174" height="18" rx="5" fill="rgba(239,68,68,0.35)"/>
</svg>`;

const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  color: #fafafa;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 20px;
  background:
    radial-gradient(1100px 560px at 10% -8%,  rgba(255,255,255,0.07), transparent 55%),
    radial-gradient(800px  420px at 90% -12%,  rgba(255,255,255,0.03), transparent 50%),
    #09090b;
  overflow-x: hidden;
}

/* ════════════════════════════════════════
   AMBIENT BACKGROUND ORBS
   ════════════════════════════════════════ */
.orb {
  position: fixed;
  pointer-events: none;
  border-radius: 50%;
  filter: blur(110px);
  z-index: 0;
}
.orb-1 {
  width: 600px; height: 600px;
  top: -260px; left: -220px;
  animation: orb-a 18s ease-in-out infinite alternate;
}
.orb-2 {
  width: 500px; height: 500px;
  bottom: -200px; right: -200px;
  animation: orb-b 22s ease-in-out infinite alternate;
}
@keyframes orb-a { 0%{transform:translate(0,0)} 100%{transform:translate(80px,60px)} }
@keyframes orb-b { 0%{transform:translate(0,0)} 100%{transform:translate(-70px,-50px)} }

/* error */
.page-error .orb-1 { background:radial-gradient(circle,rgba(239,68,68,.18),transparent 70%); }
.page-error .orb-2 { background:radial-gradient(circle,rgba(220,38,38,.12),transparent 70%); }
/* warning */
.page-warning .orb-1 { background:radial-gradient(circle,rgba(245,158,11,.14),transparent 70%); }
.page-warning .orb-2 { background:radial-gradient(circle,rgba(234,179,8,.09),transparent 70%); }
/* info */
.page-info .orb-1 { background:radial-gradient(circle,rgba(139,92,246,.14),transparent 70%); }
.page-info .orb-2 { background:radial-gradient(circle,rgba(109,40,217,.09),transparent 70%); }

/* ════════════════════════════════════════
   WRAP
   ════════════════════════════════════════ */
.wrap {
  width: 100%;
  max-width: 620px;
  position: relative;
  z-index: 1;
  animation: fadeUp .3s cubic-bezier(.16,1,.3,1) both;
}
@keyframes fadeUp {
  from { opacity:0; transform:translateY(20px) scale(.97); filter:blur(3px); }
  to   { opacity:1; transform:translateY(0)    scale(1);   filter:blur(0); }
}

/* ════════════════════════════════════════
   PATH DIAGRAM
   ════════════════════════════════════════ */
.path {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 0;
  margin-bottom: 52px;
}
.path-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 100px;
}

/* 80 × 80 circles */
.path-circle {
  width: 80px; height: 80px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  position: relative;
  background: rgba(255,255,255,0.04);
  border: 2px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.28);
  transition: transform .2s ease;
}
.path-circle.is-ok {
  background:rgba(34,197,94,0.11); border-color:rgba(34,197,94,0.5); color:#86efac;
  animation: ok-breathe 3s ease-in-out infinite;
}
@keyframes ok-breathe {
  0%,100%{ box-shadow:0 0 0 0 rgba(34,197,94,0); }
  50%    { box-shadow:0 0 18px 2px rgba(34,197,94,.18); }
}
.path-circle.is-error {
  background:rgba(239,68,68,0.12); border-color:rgba(239,68,68,0.55); color:#fca5a5;
}
.path-circle.is-warn {
  background:rgba(245,158,11,0.1); border-color:rgba(245,158,11,0.5); color:#fde68a;
}
.path-circle.is-neutral {
  background:rgba(255,255,255,0.03); border-color:rgba(255,255,255,0.07); color:rgba(255,255,255,0.2);
}

/* expanding ripple ring on error/warn nodes */
.path-circle.is-error::after,
.path-circle.is-warn::after {
  content: '';
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  pointer-events: none;
}
.path-circle.is-error::after {
  border: 2px solid rgba(239,68,68,.55);
  animation: ring-err 2s ease-out infinite;
}
.path-circle.is-warn::after {
  border: 2px solid rgba(245,158,11,.5);
  animation: ring-warn 2.4s ease-out infinite;
}
@keyframes ring-err  { 0%{opacity:.85;transform:scale(.82)} 100%{opacity:0;transform:scale(1.4)} }
@keyframes ring-warn { 0%{opacity:.75;transform:scale(.84)} 100%{opacity:0;transform:scale(1.3)} }

.path-lbl {
  font-size: 12px; font-weight: 600;
  letter-spacing: 0.09em; text-transform: uppercase;
  color: rgba(255,255,255,0.42);
}

/* connection line with a moving data-packet */
.path-line {
  flex: 1;
  height: 2px;
  min-width: 16px;
  margin-top: 39px;
  background: rgba(255,255,255,0.1);
  position: relative;
}
.path-line::before,
.path-line::after {
  content: '';
  position: absolute;
  top: 50%; transform: translateY(-50%);
  left: -7px;
  width: 7px; height: 7px; border-radius: 50%;
  pointer-events: none;
  opacity: 0;
}
.path-line-ok {
  background: rgba(34,197,94,0.6);
  box-shadow: 0 0 6px rgba(34,197,94,0.25);
}
.path-line-ok::before,
.path-line-ok::after {
  background: #86efac;
  box-shadow: 0 0 8px rgba(34,197,94,.9);
  animation: pkt 3s linear infinite;
}
.path-line-ok::after { animation-delay: 1.5s; }
.path-line-error {
  background: rgba(239,68,68,0.5);
  box-shadow: 0 0 6px rgba(239,68,68,0.2);
}
.path-line-error::before,
.path-line-error::after { display: none; }
.path-line-warn {
  background: rgba(245,158,11,0.5);
  box-shadow: 0 0 6px rgba(245,158,11,0.2);
}
.path-line-warn::before,
.path-line-warn::after {
  background: #fde68a;
  box-shadow: 0 0 8px rgba(245,158,11,.9);
  animation: pkt 3.5s linear infinite;
}
.path-line-warn::after { animation-delay: 1.75s; }
.path-line-neutral {
  background: rgba(255,255,255,0.07);
}
.path-line-neutral::before,
.path-line-neutral::after { display: none; }

@keyframes pkt {
  0%   { left: -7px; opacity: 0; }
  8%   { opacity: 1; }
  92%  { opacity: 1; }
  100% { left: calc(100% + 7px); opacity: 0; }
}


/* ════════════════════════════════════════
   PAGE ANIMATION BLOCK
   ════════════════════════════════════════ */
.page-anim {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 38px;
}

/* ════════════════════════════════════════
   BADGE
   ════════════════════════════════════════ */
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 14px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  margin-bottom: 18px;
}
.badge-error {
  color:#ffb2b2;
  background:rgba(239,106,106,0.12);
  border:1px solid rgba(239,106,106,0.35);
  animation: badge-err 3s ease-in-out infinite;
}
.badge-warning {
  color:#ffdca4;
  background:rgba(247,185,85,0.1);
  border:1px solid rgba(247,185,85,0.35);
  animation: badge-warn 3s ease-in-out infinite;
}
.badge-info {
  color:#c4b5fd;
  background:rgba(139,92,246,0.1);
  border:1px solid rgba(139,92,246,0.3);
  animation: badge-info 3s ease-in-out infinite;
}
@keyframes badge-err  { 0%,100%{box-shadow:0 0 0 rgba(239,68,68,0)}  50%{box-shadow:0 0 12px rgba(239,68,68,.35)} }
@keyframes badge-warn { 0%,100%{box-shadow:0 0 0 rgba(245,158,11,0)} 50%{box-shadow:0 0 12px rgba(245,158,11,.3)} }
@keyframes badge-info { 0%,100%{box-shadow:0 0 0 rgba(139,92,246,0)} 50%{box-shadow:0 0 12px rgba(139,92,246,.3)} }

/* ════════════════════════════════════════
   HEADING
   ════════════════════════════════════════ */
h1 {
  font-size: clamp(28px, 5.5vw, 40px);
  font-weight: 700; letter-spacing: -0.03em;
  line-height: 1.1; margin-bottom: 14px;
  background: linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,.72) 40%, #ffffff 55%, rgba(255,255,255,.88) 100%);
  background-size: 300% 300%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: h1shine 6s ease-in-out infinite;
}
@keyframes h1shine {
  0%,100%{ background-position:0% 50% }
  50%    { background-position:100% 50% }
}

.desc {
  font-size: 16px; color: rgba(255,255,255,0.52);
  line-height: 1.72; margin-bottom: 36px;
  max-width: 50ch; margin-left: auto; margin-right: auto;
}
.desc strong { color: rgba(255,255,255,0.85); font-weight: 500; }

/* ════════════════════════════════════════
   BUTTONS
   ════════════════════════════════════════ */
.actions { display:flex; justify-content:center; flex-wrap:wrap; gap:12px; margin-bottom:36px; }
.btn {
  display:inline-flex; align-items:center; justify-content:center;
  font-family:'Inter',sans-serif; font-size:15px; font-weight:600; line-height:1;
  padding:.75rem 1.65rem; border-radius:10px; cursor:pointer;
  transition:transform .18s ease, filter .18s ease, box-shadow .18s ease;
}
.btn:hover  { transform:translateY(-2px); }
.btn:active { transform:translateY(0); }
.btn-primary {
  position: relative; overflow: hidden;
  background:linear-gradient(135deg,#fafafa,#e4e4e7);
  color:#09090b; border:1px solid rgba(244,244,245,0.35);
  box-shadow:0 7px 16px rgba(0,0,0,0.3);
}
.btn-primary:hover { filter:brightness(1.06); box-shadow:0 12px 24px rgba(0,0,0,0.38); }
/* shimmer sweep on the primary button */
.btn-primary::after {
  content:'';
  position:absolute; top:0; left:-120%;
  width:60%; height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent);
  animation:btnshine 4s ease-in-out infinite;
}
@keyframes btnshine { 0%{left:-120%} 30%,100%{left:200%} }
.btn-ghost { background:transparent; color:rgba(255,255,255,0.58); border:1px solid transparent; }
.btn-ghost:hover { background:rgba(255,255,255,0.06); color:#fafafa; }

/* ════════════════════════════════════════
   FOOTER
   ════════════════════════════════════════ */
.footer {
  font-size:11px; color:rgba(255,255,255,0.18);
  letter-spacing:0.05em; line-height: 1.8;
}
.footer span { margin:0 5px; opacity:.4; }
.footer-ref { display:block; font-size:10px; color:rgba(255,255,255,.12); letter-spacing:.06em; margin-top:4px; }

/* ════════════════════════════════════════
   WATERMARK — large faded icon per page
   ════════════════════════════════════════ */
/* centred wrapper — fills viewport, centres the icon */
.bg-wmrk-wrap {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 0;
}
.bg-wmrk {
  opacity: 0.055;
  transform-origin: center center;
  flex-shrink: 0;
}
/* per-page animations */
.p-404         .bg-wmrk { animation: wm-float  8s  ease-in-out infinite; }
.p-502         .bg-wmrk { animation: wm-shake  5s  ease-in-out infinite; }
.p-503         .bg-wmrk { animation: wm-pulse  4s  ease-in-out infinite; }
.p-maintenance .bg-wmrk { animation: wm-spin  30s  linear      infinite; }
.p-blocked     .bg-wmrk { animation: wm-sway   6s  ease-in-out infinite; }
.p-bandwidth   .bg-wmrk { animation: wm-pulse  3s  ease-in-out infinite; }
.p-ratelimit   .bg-wmrk { animation: wm-rush   2.5s ease-in-out infinite; }
.p-payload     .bg-wmrk { animation: wm-sink   3.5s ease-in-out infinite; }
@keyframes wm-float { 0%,100%{transform:translateY(0)}       50%{transform:translateY(-22px)} }
@keyframes wm-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-10px)} 40%{transform:translateX(10px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
@keyframes wm-pulse { 0%,100%{opacity:.04} 50%{opacity:.09} }
@keyframes wm-spin  { to{transform:rotate(360deg)} }
@keyframes wm-sway  { 0%,100%{transform:rotate(0deg)} 30%{transform:rotate(-4deg)} 70%{transform:rotate(4deg)} }
@keyframes wm-rush  { 0%,100%{transform:translateX(0)} 45%{transform:translateX(14px)} 65%{transform:translateX(-4px)} }
@keyframes wm-sink  { 0%,100%{transform:translateY(0)} 55%{transform:translateY(16px)} }
`;

// ── Path diagram builder ──────────────────────────────────────────────────────
function path(client, link1, proxy, link2, backend) {
  const node = (state, icon, lbl) =>
    `<div class="path-node"><div class="path-circle is-${state}">${icon}</div><div class="path-lbl">${lbl}</div></div>`;
  const line = (s) => `<div class="path-line path-line-${s}"></div>`;
  return `<div class="path">
  ${node(client,  ICON_BROWSER, 'You')}
  ${line(link1)}
  ${node(proxy,   ICON_PROXY,   'Proxy')}
  ${line(link2)}
  ${node(backend, ICON_SERVER,  'Backend')}
</div>`;
}

// ── Page builder ──────────────────────────────────────────────────────────────
function page({ code, badgeClass, badgeText, title, desc, pathArgs, anim, actions, pageId, watermark }) {
  const ts  = fmtTime();
  const ref = genRef();
  const pageClass = badgeClass === 'badge-error'   ? 'page-error'
    : badgeClass  === 'badge-warning'              ? 'page-warning'
    : 'page-info';
  const bodyClass = [pageClass, pageId ? `p-${pageId}` : ''].filter(Boolean).join(' ');

  const btnHtml = actions.map(({ label, onclick, primary }) =>
    `<button class="btn btn-${primary ? 'primary' : 'ghost'}" onclick="${escapeHtml(onclick)}">${escapeHtml(label)}</button>`
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(String(code))} — NebulaProxy</title>
  <style>${BASE_CSS}</style>
</head>
<body class="${bodyClass}">
<div class="orb orb-1"></div>
<div class="orb orb-2"></div>
${watermark ? `<div class="bg-wmrk-wrap"><div class="bg-wmrk">${watermark}</div></div>` : ''}
<div class="wrap">
  ${pathArgs ? path(...pathArgs) : ''}
  ${anim ? `<div class="page-anim">${anim}</div>` : ''}
  <div class="badge ${badgeClass}">${escapeHtml(badgeText)}</div>
  <h1>${escapeHtml(title)}</h1>
  <p class="desc">${desc}</p>
  <div class="actions">${btnHtml}</div>
  <div class="footer">
    ${escapeHtml(ts)}<span>·</span>HTTP ${escapeHtml(String(code))}
    <span class="footer-ref">NebulaProxy · Ref: ${ref}</span>
  </div>
</div>
</body>
</html>`;
}

// ── Public renderers ──────────────────────────────────────────────────────────

export function renderNotFoundPage(hostname) {
  return page({
    code: 404, badgeClass: 'badge-info', badgeText: '404 Not Found',
    title: 'Domain Not Found',
    desc: `No proxy is configured for <strong>${escapeHtml(hostname || 'this domain')}</strong>. NebulaProxy doesn't know where to route this request.`,
    pathArgs: ['ok', 'ok', 'error', 'neutral', 'neutral'],
    anim: ANIM_NOT_FOUND,
    pageId: '404', watermark: WMRK_NOT_FOUND,
    actions: [{ label: 'Go back', onclick: 'history.back()', primary: true }],
  });
}

export function renderBadGatewayPage(hostname, opts = {}) {
  const copy  = config.proxy?.badGatewayPage || {};
  const cause = opts.errorCode === 'ETIMEDOUT'    ? 'Connection timed out'
    : opts.errorCode === 'ECONNREFUSED'            ? 'Connection refused'
    : opts.errorCode === 'ENOTFOUND'               ? 'Hostname not resolved'
    : opts.errorCode                               ? opts.errorCode
    : 'No response';

  return page({
    code: 502, badgeClass: 'badge-error', badgeText: '502 Bad Gateway',
    title: copy.title || 'Backend Unreachable',
    desc: `NebulaProxy can't reach the server behind <strong>${escapeHtml(hostname || 'this domain')}</strong>. ${escapeHtml(cause)}.`,
    pathArgs: ['ok', 'ok', 'ok', 'error', 'error'],
    anim: ANIM_BAD_GATEWAY,
    pageId: '502', watermark: WMRK_BAD_GATEWAY,
    actions: [
      { label: copy.retryButton || 'Try again', onclick: 'location.reload()', primary: true },
      { label: copy.backButton  || 'Go back',   onclick: 'history.back()' },
    ],
  });
}

export function renderServiceUnavailablePage(hostname) {
  return page({
    code: 503, badgeClass: 'badge-error', badgeText: '503 Unavailable',
    title: 'No Backend Available',
    desc: `All servers behind <strong>${escapeHtml(hostname || 'this domain')}</strong> are currently down or unreachable.`,
    pathArgs: ['ok', 'ok', 'ok', 'error', 'error'],
    anim: ANIM_UNAVAILABLE,
    pageId: '503', watermark: WMRK_UNAVAILABLE,
    actions: [
      { label: 'Try again', onclick: 'location.reload()', primary: true },
      { label: 'Go back',   onclick: 'history.back()' },
    ],
  });
}

export function renderMaintenancePage(domain) {
  const host = domain.hostname || 'this service';
  const msg  = domain.maintenance_message || 'Back shortly.';
  const eta  = domain.maintenance_end_time
    ? `Back at ${new Date(domain.maintenance_end_time).toLocaleString('en-GB', { timeZone: 'Europe/Paris' })}.`
    : '';

  return page({
    code: 503, badgeClass: 'badge-warning', badgeText: 'Maintenance',
    title: 'Under Maintenance',
    desc: `<strong>${escapeHtml(host)}</strong> is temporarily offline. ${escapeHtml(msg)}${eta ? ' ' + escapeHtml(eta) : ''}`,
    pathArgs: ['ok', 'ok', 'ok', 'warn', 'warn'],
    anim: ANIM_MAINTENANCE,
    pageId: 'maintenance', watermark: WMRK_MAINTENANCE,
    actions: [
      { label: 'Refresh', onclick: 'location.reload()', primary: true },
      { label: 'Go back', onclick: 'history.back()' },
    ],
  });
}

export function renderBlockedPage(message, statusCode = 403) {
  const text = statusCode === 401 ? 'Unauthorized' : 'Forbidden';
  return page({
    code: statusCode, badgeClass: 'badge-error', badgeText: `${statusCode} ${text}`,
    title: 'Access Denied',
    desc: escapeHtml(message || 'You do not have permission to access this resource.'),
    pathArgs: ['ok', 'error', 'ok', 'neutral', 'neutral'],
    anim: ANIM_BLOCKED,
    pageId: 'blocked', watermark: WMRK_BLOCKED,
    actions: [{ label: 'Go back', onclick: 'history.back()', primary: true }],
  });
}

export function renderBandwidthExceededPage(domain) {
  const host = domain?.hostname || 'this service';
  return page({
    code: 429, badgeClass: 'badge-warning', badgeText: '429 Quota Exceeded',
    title: 'Bandwidth Limit Reached',
    desc: `The monthly transfer quota for <strong>${escapeHtml(host)}</strong> has been used up. Service resumes when the quota resets.`,
    pathArgs: ['ok', 'ok', 'warn', 'neutral', 'neutral'],
    anim: ANIM_BANDWIDTH,
    pageId: 'bandwidth', watermark: WMRK_BANDWIDTH,
    actions: [{ label: 'Go back', onclick: 'history.back()', primary: true }],
  });
}

export function renderRateLimitPage(hostname) {
  return page({
    code: 429, badgeClass: 'badge-warning', badgeText: '429 Rate Limited',
    title: 'Too Many Requests',
    desc: `You've sent too many requests to <strong>${escapeHtml(hostname || 'this domain')}</strong> in a short time. Wait a moment, then try again.`,
    pathArgs: ['error', 'error', 'ok', 'neutral', 'neutral'],
    anim: ANIM_RATE_LIMIT,
    pageId: 'ratelimit', watermark: WMRK_RATE_LIMIT,
    actions: [
      { label: 'Try again', onclick: 'location.reload()', primary: true },
      { label: 'Go back',   onclick: 'history.back()' },
    ],
  });
}

export function renderPayloadTooLargePage(hostname, maxSize) {
  const limit = maxSize ? `${Math.round(maxSize / (1024 * 1024))} MB` : 'the allowed limit';
  return page({
    code: 413, badgeClass: 'badge-error', badgeText: '413 Too Large',
    title: 'Payload Too Large',
    desc: `The data you sent exceeds the maximum upload size of <strong>${escapeHtml(limit)}</strong> allowed on <strong>${escapeHtml(hostname || 'this domain')}</strong>.`,
    pathArgs: ['error', 'error', 'ok', 'neutral', 'neutral'],
    anim: ANIM_PAYLOAD,
    pageId: 'payload', watermark: WMRK_PAYLOAD,
    actions: [{ label: 'Go back', onclick: 'history.back()', primary: true }],
  });
}
