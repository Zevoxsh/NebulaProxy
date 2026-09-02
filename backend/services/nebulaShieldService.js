// @ts-check
// Nebula Shield — native, self-contained bot defense for NebulaProxy.
//
// Pipeline per request on a shielded domain:
//   analyze()  → cheap local + Redis signals (UA class, header quality,
//                request rate, recent failures, GeoIP; DNS-verified good bots)
//   decide()   → allow / deny / challenge, with an ADAPTIVE proof-of-work
//                difficulty driven by a suspicion score
//   challenge  → branded page: a Web Worker brute-forces sha256(challenge+nonce)
//                to `difficulty` leading zero hex digits AND collects a browser
//                fingerprint; both are returned and verified server-side
//   clearance  → signed cookie (bound to IP + host + solved difficulty)
//
// Everything is stateless crypto (HMAC-signed challenges/cookies) plus Redis
// counters. No external service, no sidecar.

import crypto from 'crypto';
import dns from 'dns';
import { config } from '../config/config.js';
import { redisService } from './redis.js';
import { classifyUserAgent, headerSuspicion, scoreFingerprint } from './shield/signatures.js';
import { CELEBRATION_SNIPPET } from './shield/celebration.js';
import { MASCOT_DATA_URI, MASCOT_BUST_DATA_URI } from './shield/mascot.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const BASE_DIFFICULTY = { lenient: 3, balanced: 4, strict: 5 };
const RATE_SOFT = { lenient: 60, balanced: 40, strict: 25 };  // req/10s → +difficulty
const RATE_HARD = { lenient: 400, balanced: 250, strict: 150 }; // req/10s → deny
const DNS_TIMEOUT_MS = 2000;

export const COOKIE_NAME = '__nebula_shield';
export const VERIFY_PATH = '/.well-known/nebula-shield/verify';

const secret = () => config.proxy.antibot.secret;
const hmac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('hex');
const clampDifficulty = (d) => Math.max(1, Math.min(6, d | 0));

function timingSafeEqHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

function normalizeIp(ip) {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

async function redisIncrTtl(key, ttlSec) {
  try {
    if (!redisService.isConnected || !redisService.client) return 0;
    const n = await redisService.client.incr(key);
    if (n === 1) await redisService.client.expire(key, ttlSec);
    return n;
  } catch { return 0; }
}

async function redisGetInt(key) {
  try {
    if (!redisService.isConnected || !redisService.client) return 0;
    const v = await redisService.client.get(key);
    return v ? parseInt(v, 10) || 0 : 0;
  } catch { return 0; }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => { setTimeout(() => rej(new Error('timeout')), ms); }),
  ]);
}

export const nebulaShield = {
  COOKIE_NAME,
  VERIFY_PATH,
  BASE_DIFFICULTY,

  // ── Decision engine ───────────────────────────────────────────────────────

  /** Gather signals for a request. Cheap: a couple of Redis ops; DNS only for
   *  UAs that claim to be a verifiable good bot. */
  async analyze(req, clientIp, _host) {
    const ua = req.headers['user-agent'];
    const uaInfo = classifyUserAgent(ua);
    const headerScore = headerSuspicion(req.headers);
    const rate = await redisIncrTtl(`shield:rate:${clientIp}`, 10);
    const recentFails = await redisGetInt(`shield:fail:${clientIp}`);

    let goodBotVerified = null;
    if (uaInfo.class === 'good-bot') {
      goodBotVerified = await this.verifyGoodBot(clientIp, uaInfo.bot);
    }

    // GeoIP from cache only — never block the request on a lookup.
    let country = null;
    try {
      if (redisService.isConnected && redisService.client) {
        country = await redisService.client.get(`geoip:${clientIp}`);
      }
    } catch { /* ignore */ }

    return { uaClass: uaInfo.class, bot: uaInfo.bot, headerScore, rate, recentFails, goodBotVerified, country };
  },

  /** Pure decision from signals. */
  decide(s, mode = 'balanced') {
    const base = BASE_DIFFICULTY[mode] ?? 4;

    if (s.uaClass === 'good-bot') {
      if (s.goodBotVerified === true) return { action: 'allow', reason: `verified ${s.bot?.name || 'good bot'}` };
      if (s.bot?.verify === 'open') return { action: 'allow', reason: `${s.bot?.name} preview agent` };
      if (s.goodBotVerified === false) {
        return mode === 'lenient'
          ? { action: 'challenge', difficulty: clampDifficulty(base + 2), reason: 'spoofed good-bot UA' }
          : { action: 'deny', reason: 'spoofed good-bot UA (reverse DNS mismatch)' };
      }
      return { action: 'challenge', difficulty: clampDifficulty(base + 1), reason: 'unverified good-bot UA' };
    }

    if (s.rate >= (RATE_HARD[mode] ?? 250)) {
      return { action: 'deny', reason: `request flood (${s.rate}/10s)` };
    }

    if (s.uaClass === 'ai-scraper') {
      return mode === 'lenient'
        ? { action: 'challenge', difficulty: clampDifficulty(base + 2), reason: 'AI scraper UA' }
        : { action: 'deny', reason: 'AI scraper UA' };
    }

    if (s.uaClass === 'automation' || s.uaClass === 'empty') {
      return mode === 'strict'
        ? { action: 'deny', reason: 'automation / non-browser UA' }
        : { action: 'challenge', difficulty: clampDifficulty(base + 2), reason: 'automation / non-browser UA' };
    }

    // Browser → adaptive challenge.
    let d = base;
    d += Math.min(2, s.headerScore);
    const soft = RATE_SOFT[mode] ?? 40;
    if (s.rate >= soft) d += (s.rate >= soft * 2 ? 2 : 1);
    if (s.recentFails >= 3) d += 1;
    return { action: 'challenge', difficulty: clampDifficulty(d), reason: 'browser challenge' };
  },

  /** Reverse+forward DNS good-bot verification, cached in Redis for 1h. */
  async verifyGoodBot(rawIp, bot) {
    if (!bot) return false;
    if (bot.verify === 'open') return true;
    const ip = normalizeIp(rawIp);
    const cacheKey = `shield:goodbot:${ip}`;
    try {
      if (redisService.isConnected && redisService.client) {
        const c = await redisService.client.get(cacheKey);
        if (c === '1') return true;
        if (c === '0') return false;
      }
    } catch { /* ignore */ }

    let verified = false;
    try {
      const names = await withTimeout(dns.promises.reverse(ip), DNS_TIMEOUT_MS);
      const ptr = names.find((n) => bot.suffixes?.some((suf) => n.toLowerCase().endsWith(suf)));
      if (ptr) {
        const addrs = new Set();
        try { (await withTimeout(dns.promises.resolve4(ptr), DNS_TIMEOUT_MS)).forEach((a) => addrs.add(normalizeIp(a))); } catch { /* none */ }
        try { (await withTimeout(dns.promises.resolve6(ptr), DNS_TIMEOUT_MS)).forEach((a) => addrs.add(normalizeIp(a))); } catch { /* none */ }
        verified = addrs.has(ip);
      }
    } catch { verified = false; }

    try {
      if (redisService.isConnected && redisService.client) {
        await redisService.client.setex(cacheKey, 3600, verified ? '1' : '0');
      }
    } catch { /* ignore */ }
    return verified;
  },

  // ── Challenge crypto (stateless, signed) ──────────────────────────────────

  issueChallenge(clientIp, host, difficulty) {
    const challenge = crypto.randomBytes(24).toString('hex');
    const issuedAt = Date.now();
    const diff = clampDifficulty(difficulty || BASE_DIFFICULTY.balanced);
    const sig = hmac(`challenge.${challenge}.${clientIp}.${host}.${issuedAt}.${diff}`);
    return { challenge, issuedAt, difficulty: diff, sig };
  },

  /** Verify a returned solution + fingerprint. Returns { ok, block?, reason? }. */
  verifySolution(clientIp, host, payload, mode = 'balanced') {
    if (!payload) return { ok: false };
    const { challenge, sig, nonce, hash } = payload;
    const issuedAt = Number(payload.issuedAt);
    const difficulty = Number(payload.difficulty);
    if (typeof challenge !== 'string' || typeof sig !== 'string' || nonce === undefined) return { ok: false };
    if (!Number.isFinite(issuedAt) || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 6) return { ok: false };
    const now = Date.now();
    if (now - issuedAt > CHALLENGE_TTL_MS || issuedAt > now + 60_000) return { ok: false };

    const expectSig = hmac(`challenge.${challenge}.${clientIp}.${host}.${issuedAt}.${difficulty}`);
    if (!timingSafeEqHex(sig, expectSig)) return { ok: false };

    const computed = crypto.createHash('sha256').update(`${challenge}${nonce}`).digest('hex');
    if (typeof hash === 'string' && hash && !timingSafeEqHex(hash, computed)) return { ok: false };
    if (!computed.startsWith('0'.repeat(difficulty))) return { ok: false };

    // Proof of work is valid — now judge the environment. A headless bot that
    // can still solve the PoW is caught here by fingerprint anomalies. Lenient
    // mode never blocks on fingerprint (avoids false positives).
    const fp = scoreFingerprint(payload.fp);
    if (fp.hardBot && mode !== 'lenient') return { ok: false, block: true, reason: 'automation fingerprint' };

    return { ok: true, difficulty };
  },

  issueClearance(clientIp, host, difficulty) {
    const issuedAt = Date.now();
    const d = clampDifficulty(difficulty || BASE_DIFFICULTY.balanced);
    const sig = hmac(`clearance.${clientIp}.${host}.${issuedAt}.${d}`);
    return `${issuedAt}.${d}.${sig}`;
  },

  /** Valid clearance whose solved difficulty covers what's now required. */
  verifyClearance(clientIp, host, token, requiredDifficulty) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const issuedAt = Number(parts[0]);
    const d = Number(parts[1]);
    const sig = parts[2];
    if (!Number.isFinite(issuedAt) || !Number.isInteger(d)) return false;
    if (Date.now() - issuedAt > config.proxy.antibot.clearanceTtlSec * 1000) return false;
    if (Number.isInteger(requiredDifficulty) && d < requiredDifficulty) return false;
    return timingSafeEqHex(sig, hmac(`clearance.${clientIp}.${host}.${issuedAt}.${d}`));
  },

  clearanceCookie(clientIp, host, difficulty, { secure }) {
    const token = this.issueClearance(clientIp, host, difficulty);
    const maxAge = config.proxy.antibot.clearanceTtlSec;
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  },

  // ── Metrics (Redis counters, aggregated across cluster workers) ────────────

  metric(domainId, field) {
    try {
      if (redisService.isConnected && redisService.client) {
        redisService.client.hincrby(`shield:stats:${domainId}`, field, 1).catch(() => {});
      }
    } catch { /* ignore */ }
  },

  async recordFailure(clientIp) {
    await redisIncrTtl(`shield:fail:${clientIp}`, 300);
  },

  async getStats(domainId) {
    const empty = { challenge: 0, allow: 0, deny: 0, pass: 0, fail: 0, block: 0 };
    try {
      if (!redisService.isConnected || !redisService.client) return empty;
      const h = await redisService.client.hgetall(`shield:stats:${domainId}`);
      const out = { ...empty };
      for (const k of Object.keys(empty)) out[k] = parseInt(h?.[k] || '0', 10) || 0;
      return out;
    } catch { return empty; }
  },

  // ── Pages ─────────────────────────────────────────────────────────────────

  renderChallengePage(host, challenge, returnUrl) {
    const data = JSON.stringify({
      challenge: challenge.challenge,
      issuedAt: challenge.issuedAt,
      difficulty: challenge.difficulty,
      sig: challenge.sig,
      verifyPath: VERIFY_PATH,
      return: returnUrl || '/',
    }).replace(/</g, '\\u003c');
    const safeHost = String(host || '').replace(/[<>&"]/g, '');
    return CHALLENGE_HTML.replace('__DATA__', data).replace(/__HOST__/g, safeHost).replace('__CELEBRATION__', CELEBRATION_SNIPPET).replace(/__MASCOT__/g, MASCOT_DATA_URI).replace(/__BUST__/g, MASCOT_BUST_DATA_URI);
  },

  /**
   * Combined challenge: the existing interactive human game page (from
   * ddosProtectionService) with the invisible Shield proof-of-work injected so
   * both run on ONE screen. The human plays the game (visible); the PoW solves
   * in the background and posts its own clearance. When the game redirects,
   * both the game bypass cookie and the Shield clearance are already set.
   */
  injectPowInto(host, gamePageHtml, challenge) {
    const data = JSON.stringify({
      challenge: challenge.challenge,
      issuedAt: challenge.issuedAt,
      difficulty: challenge.difficulty,
      sig: challenge.sig,
      verifyPath: VERIFY_PATH,
    }).replace(/</g, '\\u003c');

    const inject = `
<div id="nb-shield-badge" style="position:fixed;bottom:14px;right:14px;z-index:2147483647;display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;border:1px solid rgba(157,78,221,.35);background:rgba(20,15,30,.75);backdrop-filter:blur(6px);font:12px -apple-system,Segoe UI,Roboto,sans-serif;color:#cbb6ea">
  <span id="nb-shield-dot" style="width:8px;height:8px;border-radius:50%;background:#9D4EDD;box-shadow:0 0 8px #9D4EDD;animation:nbp 1.4s infinite"></span>
  <span id="nb-shield-txt">Sécurisation en arrière-plan…</span>
</div>
<style>@keyframes nbp{0%,100%{opacity:1}50%{opacity:.35}}</style>
<script id="nb-shield-data" type="application/json">${data}</script>
<script>
(function(){
  var cfg=JSON.parse(document.getElementById('nb-shield-data').textContent);
  var txt=document.getElementById('nb-shield-txt'),dot=document.getElementById('nb-shield-dot');
  function fp(){var n=navigator,f={};try{f.webdriver=n.webdriver===true}catch(e){}try{f.languages=n.languages?[].slice.call(n.languages):undefined}catch(e){}try{f.hw=n.hardwareConcurrency}catch(e){}try{f.tz=(Intl.DateTimeFormat().resolvedOptions().timeZone)||''}catch(e){}try{f.screen={w:screen.width,h:screen.height}}catch(e){}try{f.automationGlobals=!!(window.__nightmare||window._phantom||window.callPhantom||window.__selenium_unwrapped||window.domAutomation)}catch(e){}return f;}
  var src=function(){function sha256(ascii){function rr(v,a){return (v>>>a)|(v<<(32-a));}var mp=Math.pow,mw=mp(2,32),i,j,result='',words=[],bl=ascii.length*8;var hash=sha256.h=sha256.h||[],k=sha256.k=sha256.k||[],pc=k.length,comp={};for(var c=2;pc<64;c++){if(!comp[c]){for(i=0;i<313;i+=c)comp[i]=c;hash[pc]=(mp(c,.5)*mw)|0;k[pc++]=(mp(c,1/3)*mw)|0;}}ascii+='\\x80';while(ascii.length%64-56)ascii+='\\x00';for(i=0;i<ascii.length;i++){j=ascii.charCodeAt(i);if(j>>8)return;words[i>>2]|=j<<((3-i)%4)*8;}words[words.length]=(bl/mw)|0;words[words.length]=bl;for(j=0;j<words.length;){var w=words.slice(j,j+=16),oh=hash;hash=hash.slice(0,8);for(i=0;i<64;i++){var w15=w[i-15],w2=w[i-2],a=hash[0],e=hash[4];var t1=hash[7]+(rr(e,6)^rr(e,11)^rr(e,25))+((e&hash[5])^((~e)&hash[6]))+k[i]+(w[i]=(i<16)?w[i]:(w[i-16]+(rr(w15,7)^rr(w15,18)^(w15>>>3))+w[i-7]+(rr(w2,17)^rr(w2,19)^(w2>>>10)))|0);var t2=(rr(a,2)^rr(a,13)^rr(a,22))+((a&hash[1])^(a&hash[2])^(hash[1]&hash[2]));hash=[(t1+t2)|0].concat(hash);hash[4]=(hash[4]+t1)|0;}for(i=0;i<8;i++)hash[i]=(hash[i]+oh[i])|0;}for(i=0;i<8;i++)for(j=3;j+1;j--){var b=(hash[i]>>(j*8))&255;result+=((b<16)?0:'')+b.toString(16);}return result;}onmessage=function(e){var ch=e.data.challenge,d=e.data.difficulty,p=Array(d+1).join('0'),n=0;while(true){var h=sha256(ch+n);if(h.slice(0,d)===p){postMessage({nonce:n,hash:h});return;}n++;}};};
  var f=fp();
  var w=new Worker(URL.createObjectURL(new Blob(['('+src.toString()+')()'],{type:'application/javascript'})));
  w.onmessage=function(ev){
    fetch(cfg.verifyPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:cfg.challenge,issuedAt:cfg.issuedAt,difficulty:cfg.difficulty,sig:cfg.sig,nonce:ev.data.nonce,hash:ev.data.hash,fp:f})})
    .then(function(r){return r.json();})
    .then(function(j){if(j&&j.ok){window.__nbShieldCleared=true;if(dot)dot.style.background='#34d399';if(dot)dot.style.boxShadow='0 0 8px #34d399';if(txt)txt.textContent='Sécurisé ✓';}else{if(txt)txt.textContent='Vérification refusée';}})
    .catch(function(){});
  };
  w.postMessage({challenge:cfg.challenge,difficulty:cfg.difficulty});
})();
</script>`;

    if (gamePageHtml.includes('</body>')) return gamePageHtml.replace('</body>', inject + '</body>');
    return gamePageHtml + inject;
  },

  renderBlockPage(host, reason) {
    const safeHost = String(host || '').replace(/[<>&"]/g, '');
    const safeReason = String(reason || 'requête bloquée').replace(/[<>&"]/g, '');
    return BLOCK_HTML.replace(/__HOST__/g, safeHost).replace('__REASON__', safeReason).replace(/__MASCOT__/g, MASCOT_DATA_URI).replace(/__BUST__/g, MASCOT_BUST_DATA_URI);
  },
};

// ── Challenge page ──────────────────────────────────────────────────────────
const CHALLENGE_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<meta name="color-scheme" content="light dark" />
<title>Un instant… | __HOST__</title>
<style>
  :root{--bg:#ffffff;--text:#313131;--muted:#6b6b6b;--line:#d9d9d9;--box:#fafafa;--accent:#6b21a8;--ok:#0f9d58;--err:#d93025}
  @media (prefers-color-scheme:dark){:root{--bg:#1b1b1d;--text:#e8e8e8;--muted:#a3a3a3;--line:#3a3a3d;--box:#232326;--accent:#c084fc;--ok:#34d399;--err:#f87171}}
  *{box-sizing:border-box} html,body{margin:0;min-height:100%}
  body{background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    -webkit-font-smoothing:antialiased;display:flex;flex-direction:column;min-height:100vh}
  main{flex:1;width:100%;max-width:60rem;margin:0 auto;padding:6rem 1.5rem 2rem}
  h1{font-size:2.25rem;line-height:1.2;font-weight:500;margin:0 0 .5rem;word-break:break-word}
  h2{font-size:1.5rem;line-height:1.3;font-weight:400;margin:0 0 2rem}
  .widget{display:flex;align-items:center;gap:14px;width:360px;max-width:100%;height:65px;padding:0 14px 0 16px;border:1px solid var(--line);
    border-radius:4px;background:var(--box)}
  .spinner{width:28px;height:28px;flex:none;border-radius:50%;border:3px solid var(--line);border-top-color:var(--accent);animation:spin .8s linear infinite}
  .check{display:none;width:28px;height:28px;flex:none}
  .check circle{fill:none;stroke:var(--ok);stroke-width:2.5;stroke-dasharray:80;stroke-dashoffset:80;animation:draw .45s ease-out forwards}
  .check path{fill:none;stroke:var(--ok);stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:draw .35s ease-out .3s forwards}
  .widget.ok .spinner{display:none}.widget.ok .check{display:block}
  .widget.err{border-color:var(--err)}.widget.err .spinner{display:none}
  .box{display:none;width:24px;height:24px;flex:none;border:2px solid var(--muted);border-radius:4px;background:var(--bg);position:relative}
  .widget.ask{cursor:pointer}.widget.ask:hover{border-color:var(--accent)}.widget.ask:hover .box{border-color:var(--accent)}
  .widget.ask .spinner{display:none}.widget.ask .box{display:block}
  .widget.ask:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .widget.err.retry{cursor:pointer}
  .mascot{width:40px;height:40px;flex:none;margin-left:auto;border-radius:50%}
  footer .mascot{width:20px;height:20px;margin:0 6px 0 0;vertical-align:-5px}
  .figure{display:none;position:absolute;right:1.5rem;top:4.5rem;height:340px;width:auto;pointer-events:none;user-select:none;
    filter:drop-shadow(0 12px 28px rgba(0,0,0,.18))}
  @media (min-width:900px){main{position:relative;padding-right:22rem}.figure{display:block}}
  .label{font-size:14px;font-weight:500;line-height:1.25}
  .status{margin-top:.75rem;font-size:13px;color:var(--muted);min-height:1.2em}
  .note{margin-top:2rem;font-size:14px;color:var(--muted);max-width:40rem}
  footer{width:100%;max-width:60rem;margin:0 auto;padding:1.5rem;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:.5rem 2rem;
    justify-content:space-between;font-size:12px;color:var(--muted)}
  footer code{font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text)}
  footer b{font-weight:600;color:var(--text)}
  noscript .widget{border-color:var(--err)}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes draw{to{stroke-dashoffset:0}}
  @media (prefers-reduced-motion:reduce){.spinner{animation-duration:2s}.check circle,.check path{animation:none;stroke-dashoffset:0}}
  @media (max-width:600px){main{padding-top:3.5rem}h1{font-size:1.75rem}h2{font-size:1.2rem}}
</style>
</head>
<body>
  <main>
    <img class="figure" src="__BUST__" alt="" aria-hidden="true">
    <h1>__HOST__</h1>
    <h2>Vérification de votre navigateur avant d'accéder au site.</h2>
    <div class="widget" id="widget" tabindex="-1">
      <div class="spinner" aria-hidden="true"></div>
      <div class="box" aria-hidden="true"></div>
      <svg class="check" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13"/><path d="M10 16.5l4 4 8-9"/></svg>
      <span class="label" id="label">Vérification…</span>
      <img class="mascot" src="__MASCOT__" alt="" aria-hidden="true">
    </div>
    <div class="status" id="status" aria-live="polite"></div>
    <noscript><div class="widget" style="margin-top:1rem"><span class="label">JavaScript est requis pour continuer.</span></div></noscript>
    <p class="note">Cette vérification automatique protège <b>__HOST__</b> contre le trafic malveillant. Elle ne prend que quelques secondes et n'exige aucune action de votre part.</p>
  </main>
  <footer>
    <span>Référence : <code id="ref">—</code></span>
    <span><img class="mascot" src="__MASCOT__" alt="" aria-hidden="true">Performance et sécurité par <b>Bouclier Nebula</b></span>
  </footer>
  <script id="nb-data" type="application/json">__DATA__</script>
  <script>
  (function(){
    var cfg = JSON.parse(document.getElementById('nb-data').textContent);
    var statusEl = document.getElementById('status'), widget = document.getElementById('widget'), label = document.getElementById('label');
    try{ document.getElementById('ref').textContent = String(cfg.sig||'').slice(0,16) || String(cfg.challenge||'').slice(0,16); }catch(e){}
    function setState(kind, text, sub){ widget.className='widget'+(kind?' '+kind:''); label.textContent=text; statusEl.textContent=sub||''; }

    function collectFP(){
      var n = navigator, fp = {};
      try{ fp.webdriver = n.webdriver === true; }catch(e){}
      try{ fp.languages = n.languages ? Array.prototype.slice.call(n.languages) : undefined; }catch(e){}
      try{ fp.hw = n.hardwareConcurrency; }catch(e){}
      try{ fp.tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || ''; }catch(e){}
      try{ fp.screen = { w: screen.width, h: screen.height }; }catch(e){}
      try{
        var ua = (n.userAgent||'').toLowerCase(), plat = (n.platform||'').toLowerCase(), mm = false;
        if(ua.indexOf('windows')>-1 && plat && plat.indexOf('win')===-1) mm = true;
        if(ua.indexOf('mac os')>-1 && plat && plat.indexOf('mac')===-1) mm = true;
        if(ua.indexOf('linux')>-1 && ua.indexOf('android')===-1 && plat && plat.indexOf('linux')===-1) mm = true;
        fp.uaPlatformMismatch = mm;
      }catch(e){}
      try{
        fp.automationGlobals = !!(window.__nightmare || window._phantom || window.callPhantom ||
          window.__selenium_unwrapped || window.__webdriver_evaluate || window.domAutomation ||
          document.__$webdriverAsyncExecutor || window.__driver_evaluate);
      }catch(e){}
      try{
        var c = document.createElement('canvas'); c.width = 120; c.height = 30;
        var g = c.getContext('2d');
        if(!g){ fp.canvas = 'blank'; }
        else { g.textBaseline='top'; g.font='14px Arial'; g.fillStyle='#f60'; g.fillRect(0,0,120,30);
          g.fillStyle='#069'; g.fillText('Nebula\\u2728',2,2);
          var url = c.toDataURL(); var h=0,i;
          for(i=0;i<url.length;i++){ h=((h<<5)-h+url.charCodeAt(i))|0; }
          fp.canvas = (url.length < 60) ? 'blank' : ('h'+(h>>>0).toString(16));
        }
      }catch(e){ fp.canvas = 'error'; }
      return fp;
    }

    var sha256src = function(){
      function sha256(ascii){
        function rr(v,a){return (v>>>a)|(v<<(32-a));}
        var mp=Math.pow,mw=mp(2,32),i,j,result='',words=[],bl=ascii.length*8;
        var hash=sha256.h=sha256.h||[],k=sha256.k=sha256.k||[],pc=k.length,comp={};
        for(var c=2;pc<64;c++){if(!comp[c]){for(i=0;i<313;i+=c)comp[i]=c;hash[pc]=(mp(c,.5)*mw)|0;k[pc++]=(mp(c,1/3)*mw)|0;}}
        ascii+='\\x80';while(ascii.length%64-56)ascii+='\\x00';
        for(i=0;i<ascii.length;i++){j=ascii.charCodeAt(i);if(j>>8)return;words[i>>2]|=j<<((3-i)%4)*8;}
        words[words.length]=(bl/mw)|0;words[words.length]=bl;
        for(j=0;j<words.length;){var w=words.slice(j,j+=16),oh=hash;hash=hash.slice(0,8);
          for(i=0;i<64;i++){var w15=w[i-15],w2=w[i-2],a=hash[0],e=hash[4];
            var t1=hash[7]+(rr(e,6)^rr(e,11)^rr(e,25))+((e&hash[5])^((~e)&hash[6]))+k[i]+(w[i]=(i<16)?w[i]:(w[i-16]+(rr(w15,7)^rr(w15,18)^(w15>>>3))+w[i-7]+(rr(w2,17)^rr(w2,19)^(w2>>>10)))|0);
            var t2=(rr(a,2)^rr(a,13)^rr(a,22))+((a&hash[1])^(a&hash[2])^(hash[1]&hash[2]));
            hash=[(t1+t2)|0].concat(hash);hash[4]=(hash[4]+t1)|0;}
          for(i=0;i<8;i++)hash[i]=(hash[i]+oh[i])|0;}
        for(i=0;i<8;i++)for(j=3;j+1;j--){var b=(hash[i]>>(j*8))&255;result+=((b<16)?0:'')+b.toString(16);}
        return result;
      }
      onmessage=function(e){
        var challenge=e.data.challenge,diff=e.data.difficulty,prefix=Array(diff+1).join('0'),n=0;
        while(true){var h=sha256(challenge+n);if(h.slice(0,diff)===prefix){postMessage({done:true,nonce:n,hash:h});return;}
          n++;if(n%4000===0)postMessage({progress:n});}
      };
    };
    var fpData = collectFP();
    var attempts = 0, interactive = false, worker = null, timer = null, busy = false;
    var POW_TIMEOUT_MS = 25000;

    function stopWorker(){ try{ if(worker) worker.terminate(); }catch(e){} worker = null; if(timer){ clearTimeout(timer); timer = null; } }

    // Fallback: the automatic check failed (no worker, timeout, network error,
    // rejected proof). Ask for an explicit click, Turnstile-style, then retry.
    function askClick(reason){
      stopWorker(); busy = false;
      widget.setAttribute('role','button'); widget.setAttribute('tabindex','0');
      setState('ask', 'Confirmez que vous êtes humain', reason || 'La vérification automatique n’a pas abouti. Cliquez pour continuer.');
    }
    function fail(reason){
      stopWorker(); busy = false;
      widget.setAttribute('role','button'); widget.setAttribute('tabindex','0');
      setState('err retry', 'Échec de la vérification', (reason||'Impossible de valider votre navigateur.')+' Cliquez pour recharger la page.');
    }
    widget.addEventListener('click', function(){
      if(busy) return;
      if(widget.classList.contains('retry')){ location.reload(); return; }
      if(widget.classList.contains('ask')){ interactive = true; run(); }
    });
    widget.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); widget.click(); } });

    function submit(nonce, hash){
      statusEl.textContent='Validation auprès du serveur…';
      var body={challenge:cfg.challenge,issuedAt:cfg.issuedAt,difficulty:cfg.difficulty,sig:cfg.sig,nonce:nonce,hash:hash,fp:fpData,'return':cfg['return']};
      if(interactive) body.interaction = true;
      fetch(cfg.verifyPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json();})
      .then(function(j){
        if(j&&j.ok){ busy=false; setState('ok','Réussi','Redirection…');
          var go=function(){location.replace(j['return']||cfg['return']||'/');};
          if(window.nebulaCelebrate){window.nebulaCelebrate(go);}else{setTimeout(go,600);} return; }
        if(j&&j.blocked){ busy=false; setState('err','Accès refusé',''); setTimeout(function(){location.reload();},800); return; }
        if(attempts>=2){ fail('Le défi a expiré.'); return; }
        askClick('La preuve n’a pas été acceptée. Cliquez pour réessayer.');
      })
      .catch(function(){ if(attempts>=2){ fail('Erreur réseau.'); return; } askClick('Erreur réseau. Cliquez pour réessayer.'); });
    }

    function run(){
      if(busy) return; busy = true; attempts++;
      widget.removeAttribute('role'); widget.setAttribute('tabindex','-1');
      setState('', 'Vérification…', interactive ? 'Nouvelle vérification…' : 'Analyse de votre navigateur…');
      if(typeof Worker==='undefined' || typeof Blob==='undefined' || !window.URL || !URL.createObjectURL){ askClick('Votre navigateur ne permet pas la vérification automatique.'); return; }
      try{
        var blob=new Blob(['('+sha256src.toString()+')()'],{type:'application/javascript'});
        worker=new Worker(URL.createObjectURL(blob));
      }catch(e){ askClick('Votre navigateur ne permet pas la vérification automatique.'); return; }
      worker.onerror=function(){ askClick(); };
      worker.onmessage=function(ev){
        var d=ev.data;
        if(d.progress){ statusEl.textContent='Calcul en cours… ('+d.progress.toLocaleString('fr-FR')+' itérations)'; return; }
        if(d.done){ stopWorker(); submit(d.nonce, d.hash); }
      };
      timer=setTimeout(function(){ if(busy && worker){ askClick('La vérification prend trop de temps. Cliquez pour réessayer.'); } }, POW_TIMEOUT_MS);
      worker.postMessage({challenge:cfg.challenge,difficulty:cfg.difficulty});
    }
    run();
  })();
  </script>
__CELEBRATION__
</body>
</html>`;

// ── Block page (403) ────────────────────────────────────────────────────────
const BLOCK_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<meta name="color-scheme" content="light dark" />
<title>Accès refusé | __HOST__</title>
<style>
  :root{--bg:#ffffff;--text:#313131;--muted:#6b6b6b;--line:#d9d9d9;--box:#fafafa;--err:#d93025}
  @media (prefers-color-scheme:dark){:root{--bg:#1b1b1d;--text:#e8e8e8;--muted:#a3a3a3;--line:#3a3a3d;--box:#232326;--err:#f87171}}
  *{box-sizing:border-box} html,body{margin:0;min-height:100%}
  body{background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    -webkit-font-smoothing:antialiased;display:flex;flex-direction:column;min-height:100vh}
  main{flex:1;width:100%;max-width:60rem;margin:0 auto;padding:6rem 1.5rem 2rem}
  h1{font-size:2.25rem;line-height:1.2;font-weight:500;margin:0 0 .5rem;word-break:break-word}
  h2{font-size:1.5rem;line-height:1.3;font-weight:400;margin:0 0 2rem}
  .widget{display:flex;align-items:center;gap:14px;width:300px;max-width:100%;height:65px;padding:0 16px;border:1px solid var(--err);border-radius:4px;background:var(--box)}
  .widget svg{width:28px;height:28px;flex:none;fill:none;stroke:var(--err);stroke-width:2.5;stroke-linecap:round}
  .label{font-size:15px;font-weight:500}
  .reason{margin-top:.75rem;font-size:13px;color:var(--muted)}
  .note{margin-top:2rem;font-size:14px;color:var(--muted);max-width:40rem}
  footer{width:100%;max-width:60rem;margin:0 auto;padding:1.5rem;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:.5rem 2rem;justify-content:space-between;font-size:12px;color:var(--muted)}
  footer b{font-weight:600;color:var(--text)}
  footer .mascot{width:20px;height:20px;margin:0 6px 0 0;vertical-align:-5px;border-radius:50%}
  .figure{display:none;position:absolute;right:1.5rem;top:4.5rem;height:340px;width:auto;pointer-events:none;user-select:none;filter:grayscale(1) opacity(.85) drop-shadow(0 12px 28px rgba(0,0,0,.18))}
  @media (min-width:900px){main{position:relative;padding-right:22rem}.figure{display:block}}
  @media (max-width:600px){main{padding-top:3.5rem}h1{font-size:1.75rem}h2{font-size:1.2rem}}
</style>
</head>
<body>
  <main>
    <img class="figure" src="__BUST__" alt="" aria-hidden="true">
    <h1>__HOST__</h1>
    <h2>Désolé, vous avez été bloqué.</h2>
    <div class="widget"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13"/><path d="M11 11l10 10M21 11L11 21"/></svg><span class="label">Accès refusé</span></div>
    <div class="reason">__REASON__</div>
    <p class="note">Le système de sécurité de <b>__HOST__</b> a identifié cette requête comme du trafic automatisé ou malveillant. Si vous pensez qu'il s'agit d'une erreur, contactez le propriétaire du site.</p>
  </main>
  <footer>
    <span>Code : <b>403</b></span>
    <span><img class="mascot" src="__MASCOT__" alt="" aria-hidden="true">Performance et sécurité par <b>Bouclier Nebula</b></span>
  </footer>
</body>
</html>`;
