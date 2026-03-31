import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { database } from './database.js';

// ── Blocklist sources ───────────────────────────────────────────────────────

const BLOCKLIST_SOURCES = [
  { key: 'blocklist_de',     url: 'https://lists.blocklist.de/lists/all.txt' },
  { key: 'emerging_threats', url: 'https://rules.emergingthreats.net/blockrules/compromised-ips.txt' },
  { key: 'ci_badguys',       url: 'https://cinsscore.com/list/ci-badguys.txt' }
];

const SYNC_INTERVAL_MS   = 6 * 60 * 60 * 1000; // 6 hours
const CHALLENGE_SECRET   = crypto.randomBytes(32).toString('hex');
const EVENT_LOG_INTERVAL = 500; // ms — debounce event inserts

// ── IP / CIDR utilities ─────────────────────────────────────────────────────

function ipToLong(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const oct = parseInt(p, 10);
    if (isNaN(oct) || oct < 0 || oct > 255) return null;
    n = (n * 256) + oct;
  }
  return n >>> 0;
}

function cidrContains(cidr, ipLong) {
  if (cidr.includes('/')) {
    const [base, bits] = cidr.split('/');
    const baseLong = ipToLong(base);
    if (baseLong === null) return false;
    const prefixLen = parseInt(bits, 10);
    if (prefixLen === 0) return true;
    const mask = (~0 << (32 - prefixLen)) >>> 0;
    return (baseLong & mask) === (ipLong & mask);
  }
  const baseLong = ipToLong(cidr);
  return baseLong !== null && baseLong === ipLong;
}

function isPrivateIp(ip) {
  if (!ip || ip === '::1' || ip === 'localhost') return true;
  const clean = ip.replace(/^::ffff:/, '');
  if (clean === '127.0.0.1') return true;
  const long = ipToLong(clean);
  if (long === null) return false; // IPv6 — not blocking
  return cidrContains('10.0.0.0/8', long) ||
         cidrContains('172.16.0.0/12', long) ||
         cidrContains('192.168.0.0/16', long);
}

function parseIpList(text) {
  const entries = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const entry = trimmed.split(/[\s,;#]/)[0].split(':')[0].trim(); // strip port if any
    if (entry && /^[\d.:/]+$/.test(entry)) entries.add(entry);
  }
  return entries;
}

// ── Challenge utilities ─────────────────────────────────────────────────────

// Generate a math challenge question + token (token encodes the expected answer)
function generateMathChallenge(ip) {
  const ops  = ['+', '-', '×'];
  const op   = ops[Math.floor(Math.random() * ops.length)];
  let a, b, answer;

  if (op === '+') { a = randInt(10, 99); b = randInt(10, 99); answer = a + b; }
  else if (op === '-') { a = randInt(20, 99); b = randInt(1, a - 1); answer = a - b; }
  else { a = randInt(2, 12); b = randInt(2, 12); answer = a * b; }

  const expires = Math.floor(Date.now() / 1000) + 600; // 10 min to solve
  const data    = `${ip}:${answer}:${expires}`;
  const sig     = crypto.createHmac('sha256', CHALLENGE_SECRET).update(data).digest('hex').slice(0, 20);
  const token   = `${answer}.${expires}.${sig}`;

  return { question: `${a} ${op} ${b}`, token };
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Verify the math answer token (created by generateMathChallenge)
function verifyMathToken(ip, token, userAnswer) {
  if (!token || userAnswer === undefined || userAnswer === '') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expectedAnswer, expiresStr, sig] = parts;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  if (parseInt(userAnswer, 10) !== parseInt(expectedAnswer, 10)) return false;
  const expected = crypto.createHmac('sha256', CHALLENGE_SECRET).update(`${ip}:${expectedAnswer}:${expires}`).digest('hex').slice(0, 20);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// Bypass cookie token (set after challenge is solved, valid 1h)
function generateChallengeToken(ip) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const data    = `${ip}:${expires}`;
  const sig     = crypto.createHmac('sha256', CHALLENGE_SECRET).update(data).digest('hex').slice(0, 16);
  return `${expires}.${sig}`;
}

function verifyChallengeToken(ip, token) {
  if (!token) return false;
  const [expiresStr, sig] = token.split('.');
  if (!expiresStr || !sig) return false;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', CHALLENGE_SECRET).update(`${ip}:${expires}`).digest('hex').slice(0, 16);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

// ── Fetch helper ────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ── Service ─────────────────────────────────────────────────────────────────

class DdosProtectionService {
  constructor() {
    this.redis = null;
    this._syncTimer = null;

    // L1 in-process caches (rebuilt on every blocklist sync)
    this._blocklistIpSet  = new Set();   // exact IPs — O(1) lookup
    this._blocklistCidrs  = [];          // CIDR strings for subnet matching
    this._whitelistIpSet  = new Set();
    this._whitelistCidrs  = [];

    // Per-IP concurrent connection tracking (domainId:ip -> count)
    this._connectionCount = new Map();

    // Deferred event queue (batch inserts to avoid DB hammering)
    this._eventQueue = [];
    this._eventFlushTimer = null;

    this._initialized = false;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(redisClient) {
    this.redis = redisClient;
    this._initialized = true;

    await this._loadWhitelist();
    // Refresh whitelist every 5 min
    setInterval(() => this._loadWhitelist().catch(() => {}), 5 * 60 * 1000);

    // Initial blocklist sync (non-blocking)
    this.syncAllBlocklists().catch(err => console.error('[DDoS] Initial sync failed:', err.message));

    // Periodic sync every 6h
    this._syncTimer = setInterval(() => {
      this.syncAllBlocklists().catch(err => console.error('[DDoS] Periodic sync failed:', err.message));
    }, SYNC_INTERVAL_MS);

    // Event flush every 500ms
    this._eventFlushTimer = setInterval(() => this._flushEvents(), EVENT_LOG_INTERVAL);

    console.log('[DDoS] Protection service initialized (enterprise mode)');
  }

  // ── Whitelist ─────────────────────────────────────────────────────────────

  async _loadWhitelist() {
    try {
      const result = await database.execute('SELECT cidr FROM ddos_whitelist');
      const ipSet  = new Set();
      const cidrs  = [];
      for (const { cidr } of (result?.rows || [])) {
        if (cidr.includes('/')) cidrs.push(cidr);
        else ipSet.add(cidr);
      }
      this._whitelistIpSet = ipSet;
      this._whitelistCidrs = cidrs;
    } catch (_) {}
  }

  _isWhitelisted(ip) {
    if (this._whitelistIpSet.has(ip)) return true;
    const long = ipToLong(ip);
    if (long === null) return false;
    return this._whitelistCidrs.some(c => cidrContains(c, long));
  }

  async addWhitelist(cidr, description) {
    await database.execute(
      `INSERT INTO ddos_whitelist (cidr, description) VALUES ($1, $2)
       ON CONFLICT (cidr) DO UPDATE SET description = $2`,
      [cidr, description || '']
    );
    await this._loadWhitelist();
  }

  async removeWhitelist(id) {
    await database.execute(`DELETE FROM ddos_whitelist WHERE id = $1`, [id]);
    await this._loadWhitelist();
  }

  async getWhitelist() {
    const r = await database.execute(`SELECT * FROM ddos_whitelist ORDER BY created_at DESC`);
    return r?.rows || [];
  }

  // ── Blocklist sync ────────────────────────────────────────────────────────

  async syncAllBlocklists() {
    console.log('[DDoS] Syncing threat intelligence blocklists...');
    const combinedIps   = new Set();
    const combinedCidrs = new Set();

    for (const source of BLOCKLIST_SOURCES) {
      try {
        const text    = await fetchUrl(source.url);
        const entries = parseIpList(text);
        let count = 0;

        for (const entry of entries) {
          if (entry.includes('/')) combinedCidrs.add(entry);
          else                      combinedIps.add(entry);
          count++;
        }

        // Store in Redis for persistence across restarts
        if (this.redis && count > 0) {
          const key      = `ddos:blocklist:${source.key}`;
          const arr      = Array.from(entries);
          const pipeline = this.redis.pipeline();
          pipeline.del(key);
          for (let i = 0; i < arr.length; i += 1000) {
            pipeline.sadd(key, ...arr.slice(i, i + 1000));
          }
          pipeline.expire(key, 25 * 3600);
          await pipeline.exec();
        }

        await database.execute(
          `UPDATE ddos_blocklist_meta
             SET last_fetched = NOW(), ip_count = $1, last_error = NULL, updated_at = NOW()
           WHERE source = $2`,
          [count, source.key]
        ).catch(() => {});

        console.log(`[DDoS] ${source.key}: ${count} entries (${combinedCidrs.size} CIDRs so far)`);
      } catch (err) {
        console.error(`[DDoS] Failed to sync ${source.key}:`, err.message);
        await database.execute(
          `UPDATE ddos_blocklist_meta SET last_error = $1, updated_at = NOW() WHERE source = $2`,
          [err.message, source.key]
        ).catch(() => {});
      }
    }

    this._blocklistIpSet = combinedIps;
    this._blocklistCidrs = Array.from(combinedCidrs);

    console.log(`[DDoS] Sync done. ${combinedIps.size} IPs + ${combinedCidrs.size} CIDRs`);
    return { ips: combinedIps.size, cidrs: combinedCidrs.size };
  }

  _isBlacklisted(ip) {
    if (this._blocklistIpSet.has(ip)) return true;
    const long = ipToLong(ip);
    if (long === null) return false;
    return this._blocklistCidrs.some(c => cidrContains(c, long));
  }

  // ── Main check (hot path) ─────────────────────────────────────────────────

  async check(ip, domainId, domain) {
    if (!domain?.ddos_protection_enabled) return { blocked: false };
    if (!ip) return { blocked: false };

    const cleanIp = ip.replace(/^::ffff:/, '');

    if (isPrivateIp(cleanIp)) return { blocked: false };

    // 0. Whitelist (highest priority — always allow)
    if (this._isWhitelisted(cleanIp)) return { blocked: false };

    // 1. L1 blocklist (synchronous, µs — no I/O)
    if (this._isBlacklisted(cleanIp)) {
      this._queueEvent(cleanIp, domainId, 'blocklist', {});
      this._banIpAsync(cleanIp, null, 'blocklist', 'auto', null); // permanent
      return { blocked: true, reason: 'blocklist' };
    }

    // 2. Redis ban check (global + domain)
    try {
      if (this.redis) {
        const [g, d] = await Promise.all([
          this.redis.get(`ddos:ban:global:${cleanIp}`),
          domainId ? this.redis.get(`ddos:ban:domain:${domainId}:${cleanIp}`) : Promise.resolve(null)
        ]);
        if (g) return { blocked: true, reason: `banned: ${g}` };
        if (d) return { blocked: true, reason: `banned: ${d}` };
      }
    } catch (_) {}

    // 3. Concurrent connections per IP
    const maxConns = domain.ddos_max_connections_per_ip || 50;
    const currentConns = this._connectionCount.get(`${domainId}:${cleanIp}`) || 0;
    if (currentConns > maxConns) {
      const reason = `too-many-connections (${currentConns}/${maxConns})`;
      await this.banIp(cleanIp, domainId, reason, 'auto', domain.ddos_ban_duration_sec || 3600);
      this._queueEvent(cleanIp, domainId, 'too-many-connections', { count: currentConns, limit: maxConns });
      return { blocked: true, reason };
    }

    // 4. Connections per minute
    const cpmLimit = domain.ddos_connections_per_minute || 0;
    if (cpmLimit > 0 && this.redis) {
      const r = await this._checkCpm(cleanIp, domainId, cpmLimit, domain.ddos_ban_duration_sec || 3600);
      if (r.blocked) return r;
    }

    // 5. Requests per second (sliding window)
    const rpsResult = await this._checkRps(cleanIp, domainId, domain);
    if (rpsResult.blocked) return rpsResult;

    // 6. Behavioral: 4xx error rate
    if (domain.ddos_ban_on_4xx_rate && this.redis) {
      const b = await this._checkBehavioral4xx(cleanIp, domainId, domain);
      if (b.blocked) return b;
    }

    return { blocked: false };
  }

  // ── Rate limiters ─────────────────────────────────────────────────────────

  async _checkCpm(ip, domainId, limit, banDuration) {
    const slot  = Math.floor(Date.now() / 60000);
    const k1    = `ddos:cpm:${domainId}:${ip}:${slot}`;
    const k2    = `ddos:cpm:${domainId}:${ip}:${slot - 1}`;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(k1);
      pipeline.expire(k1, 120);
      pipeline.get(k2);
      const res   = await pipeline.exec();
      const total = (parseInt(res[0][1]) || 0) + (parseInt(res[2][1]) || 0);
      if (total > limit) {
        const reason = `connections-per-minute (${total}/${limit})`;
        await this.banIp(ip, domainId, reason, 'auto', banDuration);
        this._queueEvent(ip, domainId, 'connections-per-minute', { count: total, limit });
        return { blocked: true, reason };
      }
    } catch (_) {}
    return { blocked: false };
  }

  async _checkRps(ip, domainId, domain) {
    if (!this.redis || !domainId) return { blocked: false };
    const threshold   = domain.ddos_req_per_second   || 100;
    const banDuration = domain.ddos_ban_duration_sec  || 3600;
    const slot        = Math.floor(Date.now() / 1000);
    const k1          = `ddos:rate:${domainId}:${ip}:${slot}`;
    const k2          = `ddos:rate:${domainId}:${ip}:${slot - 1}`;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(k1);
      pipeline.expire(k1, 5);
      pipeline.get(k2);
      const res   = await pipeline.exec();
      const total = (parseInt(res[0][1]) || 0) + (parseInt(res[2][1]) || 0);
      if (total > threshold) {
        const reason = `rate-limit (${total} req/s > ${threshold})`;
        await this.banIp(ip, domainId, reason, 'auto', banDuration);
        this._queueEvent(ip, domainId, 'rate-limit', { rps: total, threshold });
        return { blocked: true, reason };
      }
    } catch (_) {}
    return { blocked: false };
  }

  async _checkBehavioral4xx(ip, domainId, domain) {
    const key = `ddos:4xx:${domainId}:${ip}`;
    try {
      const count = parseInt(await this.redis.get(key) || 0);
      const limit = 50; // 50 errors in 5-minute window
      if (count > limit) {
        const reason = `behavioral-4xx (${count} errors in 5min)`;
        await this.banIp(ip, domainId, reason, 'auto', domain.ddos_ban_duration_sec || 3600);
        this._queueEvent(ip, domainId, 'behavioral-4xx', { count, limit });
        return { blocked: true, reason };
      }
    } catch (_) {}
    return { blocked: false };
  }

  // ── Connection tracking ───────────────────────────────────────────────────

  trackConnectionOpen(ip, domainId) {
    if (!ip || !domainId) return;
    const clean = ip.replace(/^::ffff:/, '');
    const key   = `${domainId}:${clean}`;
    this._connectionCount.set(key, (this._connectionCount.get(key) || 0) + 1);
  }

  trackConnectionClose(ip, domainId) {
    if (!ip || !domainId) return;
    const clean = ip.replace(/^::ffff:/, '');
    const key   = `${domainId}:${clean}`;
    const n     = (this._connectionCount.get(key) || 1) - 1;
    if (n <= 0) this._connectionCount.delete(key);
    else        this._connectionCount.set(key, n);
  }

  // ── 4xx tracking (call from HTTP proxy on 4xx responses) ──────────────────

  async track4xx(ip, domainId) {
    if (!this.redis || !ip || !domainId) return;
    const clean = ip.replace(/^::ffff:/, '');
    const key   = `ddos:4xx:${domainId}:${clean}`;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, 300); // 5-minute window
      await pipeline.exec();
    } catch (_) {}
  }

  // ── Challenge mode (HTTP) ─────────────────────────────────────────────────

  generateChallengePage(ip, returnUrl) {
    const { question, token } = generateMathChallenge(ip);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vérification de sécurité — NebulaProxy</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #fafafa;
      background:
        radial-gradient(1200px 600px at 8% -10%, rgba(255,255,255,0.08), transparent 56%),
        radial-gradient(900px 480px at 92% -15%, rgba(255,255,255,0.04), transparent 52%),
        #09090b;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .wrap {
      width: 100%;
      max-width: 400px;
      animation: fade-in 0.24s ease-out both;
    }

    /* Brand header */
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.625rem;
      margin-bottom: 1.75rem;
    }
    .brand-mark {
      width: 32px; height: 32px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(140deg, rgba(228,228,231,0.2), rgba(161,161,170,0.26));
      border: 1px solid rgba(228,228,231,0.35);
      flex-shrink: 0;
    }
    .brand-mark svg { width: 16px; height: 16px; stroke: #fafafa; }
    .brand-name {
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #71717a;
    }

    /* Card */
    .card {
      background: #111113;
      border: 1px solid #27272a;
      border-radius: 0.75rem;
      padding: 2rem 1.75rem;
    }

    /* Icon */
    .icon-wrap {
      width: 44px; height: 44px;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(140deg, rgba(228,228,231,0.16), rgba(161,161,170,0.2));
      border: 1px solid rgba(228,228,231,0.28);
      margin: 0 auto 1.25rem;
    }
    .icon-wrap svg { width: 20px; height: 20px; stroke: #fafafa; }

    h1 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #fafafa;
      text-align: center;
      margin-bottom: 0.375rem;
      letter-spacing: -0.01em;
    }
    .sub {
      font-size: 0.8rem;
      color: #71717a;
      text-align: center;
      line-height: 1.55;
      margin-bottom: 1.5rem;
    }

    /* Question box */
    .question-box {
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 1.125rem 1rem;
      margin-bottom: 1.25rem;
      text-align: center;
    }
    .question-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #52525b;
      margin-bottom: 0.5rem;
    }
    .question {
      font-size: 1.75rem;
      font-weight: 700;
      color: #fafafa;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .question .eq { color: #a1a1aa; }

    /* Input + button row */
    .input-row { display: flex; gap: 0.625rem; margin-bottom: 0.625rem; }

    input[type=number] {
      flex: 1;
      min-width: 0;
      background: rgba(24,24,27,0.92);
      border: 1px solid #3f3f46;
      border-radius: 8px;
      color: #fafafa;
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 500;
      padding: 0.55rem 0.75rem;
      outline: none;
      -moz-appearance: textfield;
      text-align: center;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }
    input[type=number]::-webkit-outer-spin-button,
    input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
    input[type=number]:focus {
      border-color: rgba(244,244,245,0.5);
      box-shadow: 0 0 0 3px rgba(244,244,245,0.1);
      background: rgba(31,31,35,0.92);
    }
    input[type=number]::placeholder { color: #52525b; }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.55rem 1rem;
      border-radius: 8px;
      border: 1px solid rgba(244,244,245,0.35);
      background: linear-gradient(135deg, #fafafa, #e4e4e7);
      color: #09090b;
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: filter 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
      box-shadow: 0 7px 16px rgba(0,0,0,0.28);
    }
    button:hover { filter: brightness(1.06); transform: translateY(-1px); box-shadow: 0 9px 20px rgba(0,0,0,0.34); }
    button:active { transform: translateY(0); filter: none; }
    button:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }

    /* Status message */
    .msg {
      font-size: 0.75rem;
      min-height: 1.1rem;
      text-align: center;
      color: transparent;
    }
    .msg.ok  { color: #22c55e; }
    .msg.err { color: #ef4444; }

    /* Divider */
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
      margin: 1.25rem 0;
    }

    /* Footer note */
    .note {
      font-size: 0.7rem;
      color: #3f3f46;
      text-align: center;
      line-height: 1.5;
    }
    .note a { color: #52525b; text-decoration: none; }
    .note a:hover { color: #71717a; }

    @keyframes fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes shake {
      0%,100% { transform: translateX(0); }
      20%,60%  { transform: translateX(-5px); }
      40%,80%  { transform: translateX(5px); }
    }
    .shake { animation: shake 0.32s ease; }
  </style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="brand-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    </div>
    <span class="brand-name">NebulaProxy</span>
  </div>

  <div class="card">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    </div>

    <h1>Vérification de sécurité</h1>
    <p class="sub">Résolvez ce calcul pour prouver que vous n'êtes pas un robot.</p>

    <div class="question-box" id="qbox">
      <div class="question-label">Combien font</div>
      <div class="question">${question} <span class="eq">=</span> ?</div>
    </div>

    <form id="form" autocomplete="off">
      <div class="input-row">
        <input type="number" id="ans" placeholder="Votre réponse" autofocus required>
        <button type="submit" id="btn">Valider</button>
      </div>
    </form>
    <div class="msg" id="msg">&nbsp;</div>

    <div class="divider"></div>
    <p class="note">Protégé par NebulaProxy Shield &bull; <a href="/">Retour à l'accueil</a></p>
  </div>
</div>
<script>
(function(){
  var TOKEN=${JSON.stringify(token)};
  var RETURN=${JSON.stringify(returnUrl||'/')};
  var form=document.getElementById('form');
  var btn=document.getElementById('btn');
  var msg=document.getElementById('msg');
  var ansEl=document.getElementById('ans');
  var qbox=document.getElementById('qbox');

  form.addEventListener('submit',function(e){
    e.preventDefault();
    var answer=ansEl.value.trim();
    if(!answer){return;}
    btn.disabled=true;
    btn.textContent='Vérification...';
    msg.className='msg';
    msg.textContent='\u00a0';

    fetch('/__ddos_challenge/verify',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:TOKEN,answer:answer,return:RETURN})
    })
    .then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d};});})
    .then(function(res){
      if(res.ok&&res.data.ok){
        msg.className='msg ok';
        msg.textContent='Réponse correcte, redirection\u2026';
        window.location.href=res.data.return||RETURN;
      } else {
        msg.className='msg err';
        msg.textContent='Réponse incorrecte. Réessayez.';
        ansEl.value='';
        ansEl.focus();
        qbox.classList.remove('shake');
        void qbox.offsetWidth;
        qbox.classList.add('shake');
        btn.disabled=false;
        btn.textContent='Valider';
      }
    })
    .catch(function(){
      msg.className='msg err';
      msg.textContent='Erreur réseau. Réessayez.';
      btn.disabled=false;
      btn.textContent='Valider';
    });
  });
})();
</script>
</body>
</html>`;
  }

  verifyChallengeToken(ip, token) {
    return verifyChallengeToken(ip, token);
  }

  verifyMathToken(ip, token, answer) {
    return verifyMathToken(ip, token, answer);
  }

  generateVerifiedCookie(ip) {
    return generateChallengeToken(ip);
  }

  // ── Ban / Unban ───────────────────────────────────────────────────────────

  async banIp(ip, domainId, reason, bannedBy, durationSec) {
    const clean     = ip.replace(/^::ffff:/, '');
    const expiresAt = durationSec ? new Date(Date.now() + durationSec * 1000) : null;

    try {
      if (this.redis) {
        const key = domainId
          ? `ddos:ban:domain:${domainId}:${clean}`
          : `ddos:ban:global:${clean}`;
        if (durationSec > 0) await this.redis.setex(key, durationSec, reason);
        else                  await this.redis.set(key, reason);
      }
    } catch (_) {}

    try {
      await database.execute(
        `INSERT INTO ddos_ip_bans (ip_address, domain_id, reason, banned_by, expires_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [clean, domainId || null, reason, bannedBy, expiresAt]
      );
    } catch (_) {}
  }

  _banIpAsync(ip, domainId, reason, bannedBy, durationSec) {
    this.banIp(ip, domainId, reason, bannedBy, durationSec).catch(() => {});
  }

  async unbanIp(id) {
    const r   = await database.execute(
      `UPDATE ddos_ip_bans SET expires_at = NOW() WHERE id = $1 RETURNING ip_address, domain_id`,
      [id]
    );
    const ban = r?.rows?.[0];
    if (!ban) return;
    try {
      if (this.redis) {
        const key = ban.domain_id
          ? `ddos:ban:domain:${ban.domain_id}:${ban.ip_address}`
          : `ddos:ban:global:${ban.ip_address}`;
        await this.redis.del(key);
      }
    } catch (_) {}
  }

  async getActiveBans({ ip, domainId, limit = 50, offset = 0 } = {}) {
    let q = `SELECT b.*, d.hostname FROM ddos_ip_bans b
             LEFT JOIN domains d ON b.domain_id = d.id
             WHERE (b.expires_at IS NULL OR b.expires_at > NOW())`;
    const params = [];
    if (ip)       { params.push(`%${ip}%`);   q += ` AND b.ip_address LIKE $${params.length}`; }
    if (domainId) { params.push(domainId);    q += ` AND b.domain_id = $${params.length}`;     }
    params.push(limit, offset);
    q += ` ORDER BY b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const r = await database.execute(q, params);
    return r?.rows || [];
  }

  // ── Events ────────────────────────────────────────────────────────────────

  _queueEvent(ip, domainId, attackType, details) {
    this._eventQueue.push({ ip, domainId, attackType, details });
  }

  async _flushEvents() {
    if (this._eventQueue.length === 0) return;
    const batch = this._eventQueue.splice(0, 100);
    for (const ev of batch) {
      try {
        await database.execute(
          `INSERT INTO ddos_attack_events (ip_address, domain_id, attack_type, details) VALUES ($1, $2, $3, $4)`,
          [ev.ip, ev.domainId || null, ev.attackType, JSON.stringify(ev.details || {})]
        );
      } catch (_) {}
    }
  }

  async getAttackEvents({ limit = 100, domainId, attackType } = {}) {
    let q = `SELECT e.*, d.hostname FROM ddos_attack_events e
             LEFT JOIN domains d ON e.domain_id = d.id WHERE 1=1`;
    const params = [];
    if (domainId)   { params.push(domainId);   q += ` AND e.domain_id = $${params.length}`;   }
    if (attackType) { params.push(attackType); q += ` AND e.attack_type = $${params.length}`; }
    params.push(limit);
    q += ` ORDER BY e.created_at DESC LIMIT $${params.length}`;
    const r = await database.execute(q, params);
    return r?.rows || [];
  }

  async getAttackStats() {
    const r = await database.execute(`
      SELECT attack_type,
             COUNT(*)                    AS count,
             COUNT(DISTINCT ip_address)  AS unique_ips
      FROM ddos_attack_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY attack_type ORDER BY count DESC
    `);
    return r?.rows || [];
  }

  // ── Global stats ──────────────────────────────────────────────────────────

  async getBanStats() {
    const r = await database.execute(`
      SELECT
        COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) AS active_bans,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS blocked_today,
        COUNT(*) AS total_bans
      FROM ddos_ip_bans
    `);
    return {
      ...(r?.rows?.[0] || {}),
      blocklist_ips:    this._blocklistIpSet.size,
      blocklist_cidrs:  this._blocklistCidrs.length,
      whitelist_count:  this._whitelistIpSet.size + this._whitelistCidrs.length,
      active_connections: this._connectionCount.size,
    };
  }

  async getBlocklistMeta() {
    const r = await database.execute(`SELECT * FROM ddos_blocklist_meta ORDER BY source`);
    return r?.rows || [];
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    if (this._syncTimer)       { clearInterval(this._syncTimer); }
    if (this._eventFlushTimer) { clearInterval(this._eventFlushTimer); }
    this._flushEvents().catch(() => {});
  }
}

export const ddosProtectionService = new DdosProtectionService();
