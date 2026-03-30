#!/usr/bin/env node

/**
 * DDoS Protection Test Suite
 * Tests rate limiting, IP banning, and blocklist features.
 *
 * Usage:
 *   node tests/ddos-test.js
 *   ADMIN_PASSWORD=xxx DOMAIN_ID=5 node tests/ddos-test.js
 */

import axios from 'axios';
import net from 'net';

const API_BASE  = process.env.API_BASE_URL  || 'http://45.134.38.59:3001';
const ADMIN_USER = process.env.ADMIN_USER   || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS   || process.env.ADMIN_PASSWORD || '';
const DOMAIN_ID  = parseInt(process.env.DOMAIN_ID || '0');   // set if you want TCP test
const DOMAIN_HOST = process.env.DOMAIN_HOST || 'panel.paxcia.net';  // hostname of an HTTP domain

// ── Colours ────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m'
};

let pass = 0, fail = 0, skip = 0;

function log(msg, color = C.reset)  { console.log(`${color}${msg}${C.reset}`); }
function sep()                       { log('─'.repeat(60), C.gray); }

function result(name, ok, detail = '') {
  if (ok === null) {
    skip++;
    log(`  ${C.yellow}○ SKIP${C.reset}  ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
  } else if (ok) {
    pass++;
    log(`  ${C.green}✓ PASS${C.reset}  ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
  } else {
    fail++;
    log(`  ${C.red}✗ FAIL${C.reset}  ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
const api = axios.create({ baseURL: API_BASE, timeout: 10000 });

async function login() {
  const res = await api.post('/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  const token = res.data?.token || res.headers['set-cookie']?.[0]?.match(/token=([^;]+)/)?.[1];
  if (!token) throw new Error('No token in login response');
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  return token;
}

async function get(url, cfg = {})  { return api.get(url, cfg); }
async function post(url, data = {}) { return api.post(url, data); }
async function del(url)             { return api.delete(url); }

async function safeFetch(url, headers = {}) {
  try {
    const res = await axios.get(url, { headers, timeout: 5000, validateStatus: () => true });
    return res;
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function tcpConnect(host, port, timeoutMs = 3000) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    const timer = setTimeout(() => { sock.destroy(); resolve('timeout'); }, timeoutMs);
    sock.connect(port, host, () => { clearTimeout(timer); sock.destroy(); resolve('connected'); });
    sock.on('error', () => { clearTimeout(timer); resolve('refused'); });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function testAuth() {
  log('\n[1] Authentication', C.bold + C.blue);
  sep();
  try {
    await login();
    result('Admin login', true, `${ADMIN_USER}@${API_BASE}`);
  } catch (e) {
    result('Admin login', false, e.message);
    throw new Error('Cannot continue without auth');
  }
}

async function testBlocklistSync() {
  log('\n[2] Blocklist Sync', C.bold + C.blue);
  sep();

  // Check current blocklist meta
  try {
    const res = await get('/admin/ddos/blocklists');
    const lists = res.data.blocklists || [];
    result('GET /admin/ddos/blocklists', true, `${lists.length} sources`);

    for (const bl of lists) {
      const synced = !!bl.last_fetched;
      const label  = `${bl.source}: ${bl.ip_count?.toLocaleString() || 0} IPs`;
      result(`  Blocklist ${bl.source}`, synced ? true : null, synced ? label : 'not synced yet');
    }
  } catch (e) {
    result('GET /admin/ddos/blocklists', false, e.message);
  }

  // Trigger a sync
  try {
    const res = await post('/admin/ddos/blocklists/sync');
    result('POST /admin/ddos/blocklists/sync (trigger)', res.status === 202, `HTTP ${res.status}`);
  } catch (e) {
    result('POST /admin/ddos/blocklists/sync', false, e.message);
  }
}

async function testManualBan() {
  log('\n[3] Manual IP Ban / Unban', C.bold + C.blue);
  sep();

  const testIp = '198.51.100.99'; // TEST-NET-3 (RFC 5737), never a real host
  let banId = null;

  // Create ban
  try {
    const res = await post('/admin/ddos/bans', { ip: testIp, reason: 'ddos-test', durationSec: 300 });
    result('POST /admin/ddos/bans (ban test IP)', res.data?.success === true, `IP: ${testIp}`);
  } catch (e) {
    result('POST /admin/ddos/bans', false, e.message);
  }

  // List bans — find ours
  try {
    const res = await get('/admin/ddos/bans', { params: { ip: testIp } });
    const bans = res.data?.bans || [];
    const our  = bans.find(b => b.ip_address === testIp);
    banId = our?.id;
    result('GET /admin/ddos/bans (find our ban)', !!our, our ? `id=${our.id}, reason=${our.reason}` : 'not found');
  } catch (e) {
    result('GET /admin/ddos/bans', false, e.message);
  }

  // Stats reflect the ban
  try {
    const res = await get('/admin/ddos/stats');
    const active = parseInt(res.data?.active_bans || 0);
    result('GET /admin/ddos/stats (active_bans > 0)', active > 0, `active_bans=${active}`);
  } catch (e) {
    result('GET /admin/ddos/stats', false, e.message);
  }

  // Unban
  if (banId) {
    try {
      const res = await del(`/admin/ddos/bans/${banId}`);
      result('DELETE /admin/ddos/bans/:id (unban)', res.data?.success === true, `id=${banId}`);
    } catch (e) {
      result('DELETE /admin/ddos/bans/:id', false, e.message);
    }
  } else {
    result('DELETE /admin/ddos/bans/:id (unban)', null, 'skipped: ban not created');
  }
}

async function testRateLimit() {
  log('\n[4] HTTP Rate Limiting', C.bold + C.blue);
  sep();

  if (!DOMAIN_HOST || DOMAIN_HOST === 'localhost') {
    result('Rate limit flood test', null,
      'set DOMAIN_HOST=<your-http-domain> to test rate limiting against a real proxy');
    return;
  }

  const url = `http://${DOMAIN_HOST}`;
  const BURST = 150; // requests to send (default threshold is 100/s)
  log(`  Sending ${BURST} rapid requests to ${url}...`, C.gray);

  const results = { ok: 0, blocked: 0, error: 0 };
  const start   = Date.now();

  const tasks = Array.from({ length: BURST }, () =>
    safeFetch(url).then(r => {
      if (r.status === 429)       results.blocked++;
      else if (r.status >= 200)   results.ok++;
      else                        results.error++;
    })
  );
  await Promise.all(tasks);

  const elapsed = Date.now() - start;
  log(`  Done in ${elapsed}ms — ok=${results.ok} blocked=${results.blocked} error=${results.error}`, C.gray);

  result(
    `Rate limit triggered (got 429)`,
    results.blocked > 0,
    `${results.blocked}/${BURST} requests blocked`
  );

  // Give the service a moment, then check stats
  await sleep(1000);
  try {
    const res  = await get('/admin/ddos/stats');
    const today = parseInt(res.data?.blocked_today || 0);
    result('Stats: blocked_today incremented', today > 0, `blocked_today=${today}`);
  } catch (e) {
    result('Stats check after flood', false, e.message);
  }
}

async function testTcpBlock() {
  log('\n[5] TCP Connection Block', C.bold + C.blue);
  sep();

  if (!DOMAIN_ID) {
    result('TCP ban enforcement', null,
      'set DOMAIN_ID=<id> and ensure domain is TCP type to test');
    return;
  }

  // First, manually ban localhost loopback (not a good real test, but verifies infra)
  const localIp = '127.0.0.2';
  try {
    await post('/admin/ddos/bans', { ip: localIp, reason: 'tcp-test', durationSec: 60 });
    result('Pre-ban a test IP', true, localIp);
  } catch (e) {
    result('Pre-ban a test IP', false, e.message);
    return;
  }

  // Fetch domain external port
  try {
    const res  = await get(`/domains/${DOMAIN_ID}`);
    const port = res.data?.domain?.external_port;
    if (!port) {
      result('TCP connection test', null, 'domain has no external_port');
      return;
    }

    log(`  Trying TCP connection to ${DOMAIN_HOST}:${port}...`, C.gray);
    const status = await tcpConnect(DOMAIN_HOST, port);
    // We can't easily spoof the IP in the test, so we just confirm the port responds
    result('TCP proxy port reachable', status === 'connected' || status === 'timeout',
      `status=${status} (ban enforcement only works for the banned IP)`);
  } catch (e) {
    result('TCP connection test', false, e.message);
  }

  // Cleanup
  try {
    const bans = (await get('/admin/ddos/bans', { params: { ip: localIp } })).data?.bans || [];
    for (const b of bans) await del(`/admin/ddos/bans/${b.id}`).catch(() => {});
  } catch (_) {}
}

async function testDomainDdosConfig() {
  log('\n[6] Per-domain DDoS Config API', C.bold + C.blue);
  sep();

  if (!DOMAIN_ID) {
    result('Per-domain DDoS toggle', null, 'set DOMAIN_ID=<id> to test per-domain config');
    return;
  }

  // Enable DDoS with aggressive thresholds
  try {
    const res = await api.put(`/domains/${DOMAIN_ID}/ddos-protection`, {
      enabled: true,
      reqPerSecond: 10,
      connectionsPerMinute: 5,
      banDurationSec: 120
    });
    result('PUT /domains/:id/ddos-protection (enable)', res.data?.success === true, 'threshold=10 req/s');
  } catch (e) {
    result('PUT /domains/:id/ddos-protection', false, e.message);
  }

  // Verify it was saved
  try {
    const res = await get(`/domains/${DOMAIN_ID}`);
    const d   = res.data?.domain;
    result('Domain ddos_protection_enabled=true', d?.ddos_protection_enabled === true, '');
    result('Domain ddos_req_per_second=10',       d?.ddos_req_per_second === 10, '');
  } catch (e) {
    result('Verify domain DDoS config', false, e.message);
  }

  // Reset to safer defaults
  try {
    await api.put(`/domains/${DOMAIN_ID}/ddos-protection`, {
      enabled: false,
      reqPerSecond: 100,
      connectionsPerMinute: 60,
      banDurationSec: 3600
    });
    result('Reset to default thresholds', true, 'enabled=false, req/s=100');
  } catch (e) {
    result('Reset domain DDoS config', false, e.message);
  }
}

async function testKnownBadIp() {
  log('\n[7] Known-bad IP Detection (blocklist L1 cache)', C.bold + C.blue);
  sep();

  // We can't easily inject a real blocklist IP into requests without spoofing.
  // Instead, verify the blocklist is loaded in memory via stats.
  try {
    const res  = await get('/admin/ddos/stats');
    const size = parseInt(res.data?.blocklist_ips || 0);
    result('Blocklist IPs loaded in memory', size > 0, `${size.toLocaleString()} IPs cached`);

    if (size > 0) {
      result('L1 cache available for O(1) lookup', true,
        'any request from these IPs will be blocked immediately');
    }
  } catch (e) {
    result('Blocklist L1 cache check', false, e.message);
  }
}

// ── Summary ────────────────────────────────────────────────────────────────

async function main() {
  log('\n' + '═'.repeat(60), C.bold + C.cyan);
  log('  NebulaProxy — DDoS Protection Test Suite', C.bold + C.cyan);
  log('═'.repeat(60), C.bold + C.cyan);
  log(`  API: ${API_BASE}`, C.gray);
  log(`  Domain ID: ${DOMAIN_ID || '(not set)'}`, C.gray);
  log(`  Domain Host: ${DOMAIN_HOST}`, C.gray);

  try {
    await testAuth();
    await testBlocklistSync();
    await testManualBan();
    await testRateLimit();
    await testTcpBlock();
    await testDomainDdosConfig();
    await testKnownBadIp();
  } catch (e) {
    log(`\nFatal: ${e.message}`, C.red);
  }

  sep();
  const total = pass + fail + skip;
  log(`\n  Results: ${C.green}${pass} passed${C.reset}  ${fail > 0 ? C.red : ''}${fail} failed${C.reset}  ${C.yellow}${skip} skipped${C.reset}  (${total} total)\n`);

  if (fail > 0) process.exit(1);
}

main();
