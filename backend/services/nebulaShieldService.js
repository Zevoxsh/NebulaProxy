// @ts-check
// Nebula Shield — native proof-of-work anti-bot for NebulaProxy.
//
// Replaces the external Anubis sidecar with an in-process module: a visitor
// on a shielded domain is served a branded challenge page whose JS must find
// a nonce N such that sha256(challenge + N) starts with `difficulty` zero hex
// digits. Cheap for one browser, expensive for a scraper hitting the site at
// scale. On success the visitor gets a signed clearance cookie and passes
// straight through until it expires.
//
// Everything is stateless: the challenge itself is HMAC-signed (tied to the
// client IP + host + issue time), so there is no server-side challenge store
// to keep — a returned solution carries the signed challenge it solved, and
// we re-verify the signature before checking the proof of work.

import crypto from 'crypto';
import { config } from '../config/config.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // a challenge must be solved within 5 min

const secret = () => config.proxy.antibot.secret;

function hmac(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('hex');
}

function timingSafeEqHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export const COOKIE_NAME = '__nebula_shield';
export const VERIFY_PATH = '/.well-known/nebula-shield/verify';

export const nebulaShield = {
  COOKIE_NAME,
  VERIFY_PATH,

  /** Issue a fresh signed challenge for this client/host. */
  issueChallenge(clientIp, host) {
    const challenge = crypto.randomBytes(24).toString('hex');
    const issuedAt = Date.now();
    const difficulty = config.proxy.antibot.difficulty;
    const sig = hmac(`challenge.${challenge}.${clientIp}.${host}.${issuedAt}.${difficulty}`);
    return { challenge, issuedAt, difficulty, sig };
  },

  /** Verify a returned solution: signature genuine, not expired, PoW valid. */
  verifySolution(clientIp, host, payload) {
    if (!payload) return false;
    const { challenge, sig, nonce, hash } = payload;
    const issuedAt = Number(payload.issuedAt);
    const difficulty = Number(payload.difficulty);
    if (typeof challenge !== 'string' || typeof sig !== 'string' || nonce === undefined) return false;
    if (!Number.isFinite(issuedAt) || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 8) return false;
    const now = Date.now();
    if (now - issuedAt > CHALLENGE_TTL_MS || issuedAt > now + 60_000) return false;

    const expectSig = hmac(`challenge.${challenge}.${clientIp}.${host}.${issuedAt}.${difficulty}`);
    if (!timingSafeEqHex(sig, expectSig)) return false;

    const computed = crypto.createHash('sha256').update(`${challenge}${nonce}`).digest('hex');
    if (typeof hash === 'string' && hash && !timingSafeEqHex(hash, computed)) return false;
    return computed.startsWith('0'.repeat(difficulty));
  },

  /** Mint a clearance token bound to client IP + host. */
  issueClearance(clientIp, host) {
    const issuedAt = Date.now();
    const sig = hmac(`clearance.${clientIp}.${host}.${issuedAt}`);
    return `${issuedAt}.${sig}`;
  },

  /** Validate a clearance cookie value. */
  verifyClearance(clientIp, host, token) {
    if (!token || typeof token !== 'string') return false;
    const dot = token.indexOf('.');
    if (dot < 1) return false;
    const issuedAt = Number(token.slice(0, dot));
    const sig = token.slice(dot + 1);
    if (!Number.isFinite(issuedAt)) return false;
    if (Date.now() - issuedAt > config.proxy.antibot.clearanceTtlSec * 1000) return false;
    return timingSafeEqHex(sig, hmac(`clearance.${clientIp}.${host}.${issuedAt}`));
  },

  /** Build the Set-Cookie header value for a fresh clearance. */
  clearanceCookie(clientIp, host, { secure }) {
    const token = this.issueClearance(clientIp, host);
    const maxAge = config.proxy.antibot.clearanceTtlSec;
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  },

  /** The branded interstitial served to unverified visitors. */
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
    return CHALLENGE_HTML.replace('__DATA__', data).replace('__HOST__', safeHost);
  },
};

// ── Challenge page ──────────────────────────────────────────────────────────
// Self-contained: inline CSS, a Web Worker built from a Blob that runs a
// compact synchronous SHA-256 over challenge+nonce until the difficulty is
// met, then POSTs the solution back and reloads to the original URL.
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
    // Compact synchronous SHA-256 (ASCII input), run inside a Worker so the
    // page stays responsive while it brute-forces the nonce.
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
    var blob=new Blob(['('+sha256src.toString()+')()'],{type:'application/javascript'});
    var worker=new Worker(URL.createObjectURL(blob));
    var t0=Date.now();
    worker.onmessage=function(ev){
      var d=ev.data;
      if(d.progress){var pct=Math.min(90,8+(d.progress/700));fill.style.width=pct+'%';statusEl.textContent='Calcul de la preuve de travail… ('+d.progress+' essais)';return;}
      if(d.done){
        fill.style.width='96%';statusEl.textContent='Vérification…';
        fetch(cfg.verifyPath,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({challenge:cfg.challenge,issuedAt:cfg.issuedAt,difficulty:cfg.difficulty,sig:cfg.sig,nonce:d.nonce,hash:d.hash,return:cfg['return']})})
        .then(function(r){return r.json();})
        .then(function(j){if(j&&j.ok){fill.style.width='100%';statusEl.textContent='Accès autorisé.';location.replace(j['return']||cfg['return']||'/');}else{statusEl.textContent='Échec de la vérification. Rechargez la page.';}})
        .catch(function(){statusEl.textContent='Erreur réseau. Rechargez la page.';});
      }
    };
    statusEl.textContent='Résolution du défi…';
    worker.postMessage({challenge:cfg.challenge,difficulty:cfg.difficulty});
  })();
  </script>
</body>
</html>`;
