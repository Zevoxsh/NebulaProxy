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
    return CHALLENGE_HTML.replace('__DATA__', data).replace(/__HOST__/g, safeHost);
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
    return BLOCK_HTML.replace(/__HOST__/g, safeHost).replace('__REASON__', safeReason);
  },
};

// ── Challenge page ──────────────────────────────────────────────────────────
const CHALLENGE_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Vérification — Bouclier Nebula</title>
<style>
  :root { --bg:#0a0a0b; --line:rgba(255,255,255,.09); --text:#f4f4f5; --muted:#a1a1aa; --accent:#9D4EDD; --accent2:#22d3ee; }
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--text);
    background:radial-gradient(circle at 25% 12%,rgba(157,78,221,.18),transparent 45%),radial-gradient(circle at 82% 12%,rgba(34,211,238,.10),transparent 40%),linear-gradient(160deg,#0a0a0b,#0d0d15 60%,#08080c);
    display:flex;align-items:center;justify-content:center;padding:24px}
  .card{width:100%;max-width:420px;border:1px solid var(--line);border-radius:18px;padding:30px 28px;
    background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));text-align:center}
  .mark{width:54px;height:54px;margin:0 auto 18px;border-radius:15px;border:1px solid rgba(157,78,221,.4);
    display:flex;align-items:center;justify-content:center;background:rgba(157,78,221,.12)}
  .mark .dot{width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 30% 30%,var(--accent2),var(--accent));
    box-shadow:0 0 18px rgba(157,78,221,.75);animation:pulse 1.8s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  h1{font-size:19px;margin:0 0 6px;letter-spacing:-.01em}
  p{margin:0;color:var(--muted);font-size:13px}
  .bar{height:6px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:22px 0 10px}
  .fill{height:100%;width:8%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .2s}
  .status{font-size:12px;color:var(--muted);min-height:16px}
  .brand{margin-top:22px;font-size:11px;color:var(--muted);letter-spacing:.14em;text-transform:uppercase}
  .brand b{color:#cbb6ea;font-weight:700}
  noscript{display:block;margin-top:14px;color:#fca5a5;font-size:12px}
</style>
</head>
<body>
  <div class="card">
    <div class="mark"><span class="dot"></span></div>
    <h1>Vérification en cours…</h1>
    <p>On s'assure que vous n'êtes pas un robot avant d'accéder à <b>__HOST__</b>.</p>
    <div class="bar"><div class="fill" id="fill"></div></div>
    <div class="status" id="status">Initialisation…</div>
    <div class="brand">Protégé par le <b>Bouclier Nebula</b></div>
    <noscript>JavaScript est requis pour passer la vérification.</noscript>
  </div>
  <script id="nb-data" type="application/json">__DATA__</script>
  <script>
  (function(){
    var cfg = JSON.parse(document.getElementById('nb-data').textContent);
    var statusEl = document.getElementById('status'), fill = document.getElementById('fill');

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
    var blob=new Blob(['('+sha256src.toString()+')()'],{type:'application/javascript'});
    var worker=new Worker(URL.createObjectURL(blob));
    worker.onmessage=function(ev){
      var d=ev.data;
      if(d.progress){var pct=Math.min(90,8+(d.progress/700));fill.style.width=pct+'%';statusEl.textContent='Preuve de travail… ('+d.progress+' essais)';return;}
      if(d.done){
        fill.style.width='96%';statusEl.textContent='Vérification…';
        fetch(cfg.verifyPath,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({challenge:cfg.challenge,issuedAt:cfg.issuedAt,difficulty:cfg.difficulty,sig:cfg.sig,nonce:d.nonce,hash:d.hash,fp:fpData,'return':cfg['return']})})
        .then(function(r){return r.json();})
        .then(function(j){if(j&&j.ok){fill.style.width='100%';statusEl.textContent='Accès autorisé.';location.replace(j['return']||cfg['return']||'/');}
          else if(j&&j.blocked){statusEl.textContent='Accès refusé.';location.reload();}
          else{statusEl.textContent='Échec de la vérification. Nouvelle tentative…';setTimeout(function(){location.reload();},1200);}})
        .catch(function(){statusEl.textContent='Erreur réseau. Rechargez la page.';});
      }
    };
    statusEl.textContent='Résolution du défi…';
    worker.postMessage({challenge:cfg.challenge,difficulty:cfg.difficulty});
  })();
  </script>
</body>
</html>`;

// ── Block page (403) ────────────────────────────────────────────────────────
const BLOCK_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Accès refusé — Bouclier Nebula</title>
<style>
  html,body{margin:0;height:100%}
  body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#f4f4f5;
    background:radial-gradient(circle at 25% 12%,rgba(239,68,68,.16),transparent 45%),linear-gradient(160deg,#0a0a0b,#12090c 60%,#08080c);
    display:flex;align-items:center;justify-content:center;padding:24px}
  .card{width:100%;max-width:420px;border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:30px 28px;
    background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));text-align:center}
  .mark{width:54px;height:54px;margin:0 auto 18px;border-radius:15px;border:1px solid rgba(239,68,68,.4);
    display:flex;align-items:center;justify-content:center;background:rgba(239,68,68,.12);font-size:26px}
  h1{font-size:19px;margin:0 0 6px}
  p{margin:0;color:#a1a1aa;font-size:13px}
  .reason{margin-top:14px;font-size:12px;color:#f0a1a1;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:8px 12px;display:inline-block}
  .brand{margin-top:22px;font-size:11px;color:#a1a1aa;letter-spacing:.14em;text-transform:uppercase}
  .brand b{color:#cbb6ea;font-weight:700}
</style>
</head>
<body>
  <div class="card">
    <div class="mark">⛔</div>
    <h1>Accès refusé</h1>
    <p>Le trafic automatisé vers <b>__HOST__</b> est bloqué.</p>
    <div class="reason">__REASON__</div>
    <div class="brand">Protégé par le <b>Bouclier Nebula</b></div>
  </div>
</body>
</html>`;
