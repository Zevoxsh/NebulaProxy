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
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
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
    const token = generateChallengeToken(ip);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vérification de sécurité</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0f;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:2.5rem;max-width:420px;width:90%;text-align:center}
    .shield{font-size:3rem;margin-bottom:1rem}
    h1{font-size:1.25rem;font-weight:600;margin-bottom:.5rem}
    p{color:#6b7280;font-size:.9rem;line-height:1.5;margin-bottom:1.5rem}
    .progress{background:#1f2937;border-radius:8px;height:6px;overflow:hidden;margin-bottom:1rem}
    .bar{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:8px;width:0%;transition:width .3s ease}
    .status{font-size:.8rem;color:#4b5563}
    .error{color:#ef4444}
  </style>
</head>
<body>
<div class="card">
  <div class="shield">🛡️</div>
  <h1>Vérification en cours</h1>
  <p>Protection DDoS active. Votre navigateur est en train d'être vérifié.</p>
  <div class="progress"><div class="bar" id="bar"></div></div>
  <div class="status" id="status">Initialisation...</div>
</div>
<script>
(function(){
  const TOKEN=${JSON.stringify(token)};
  const RETURN=${JSON.stringify(returnUrl||'/')};
  const bar=document.getElementById('bar');
  const status=document.getElementById('status');

  async function sha256(msg){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  async function solve(){
    status.textContent='Résolution du challenge...';
    const difficulty='000'; // 3 leading zeros
    for(let n=0;n<5000000;n++){
      if(n%5000===0){
        const pct=Math.min(95,Math.floor(n/50000));
        bar.style.width=pct+'%';
        status.textContent='Vérification... ('+pct+'%)';
        await new Promise(r=>setTimeout(r,0));
      }
      const h=await sha256(TOKEN+':'+n);
      if(h.startsWith(difficulty)){
        bar.style.width='100%';
        status.textContent='Challenge résolu, redirection...';
        const r=await fetch('/__ddos_challenge/verify',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({token:TOKEN,nonce:n,return:RETURN})
        });
        if(r.ok){window.location.href=RETURN;}
        else{status.className='status error';status.textContent='Vérification échouée. Rechargez la page.';}
        return;
      }
    }
    status.className='status error';
    status.textContent='Impossible de résoudre le challenge. Rechargez la page.';
  }

  solve();
})();
</script>
</body>
</html>`;
  }

  verifyChallengeToken(ip, token) {
    return verifyChallengeToken(ip, token);
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
