/**
 * E2E Integration Tests — full request/response flows
 *
 * Covers: auth → domain CRUD → API key auth → permission isolation
 * Uses Fastify inject (no real network), mocks external services.
 */

import crypto from 'crypto';
import { test, describe, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/config.js';

// ── Database mock ────────────────────────────────────────────────────────────
vi.mock('../services/database.js', () => {
  const users = [
    { id: 1, username: 'admin', email: 'admin@test.local', role: 'admin', is_active: true, password_hash: null },
    { id: 2, username: 'user1', email: 'user1@test.local', role: 'user', is_active: true, password_hash: null }
  ];
  const domains = new Map();
  let domainIdSeq = 100;

  return {
    database: {
      getUserByUsername: vi.fn(async (username) => users.find(u => u.username === username) ?? null),
      getUserById: vi.fn(async (id) => users.find(u => u.id === id) ?? null),
      // The domain GET route calls getDomainsByUserIdWithTeams
      getDomainsByUserIdWithTeams: vi.fn(async (userId) =>
        [...domains.values()].filter(d => d.user_id === userId)
      ),
      getDomainById: vi.fn(async (id) => domains.get(id) ?? null),
      createDomain: vi.fn(async (data) => {
        const id = ++domainIdSeq;
        const domain = { id, ...data, created_at: new Date().toISOString() };
        domains.set(id, domain);
        return domain;
      }),
      updateDomain: vi.fn(async (id, data) => {
        const existing = domains.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...data };
        domains.set(id, updated);
        return updated;
      }),
      deleteDomain: vi.fn(async (id) => { domains.delete(id); return true; }),
      getUserDomainCount: vi.fn(async () => 0),
      getSystemConfig: vi.fn(async (key) => {
        if (key === 'registration_enabled') return { value: 'true' };
        return null;
      }),
      createAuditLog: vi.fn(async () => {}),
      isTeamMember: vi.fn(async () => false),
      getDomainIdsByUserId: vi.fn(async () => [])
    }
  };
});

// ── Redis mock ───────────────────────────────────────────────────────────────
vi.mock('../services/redis.js', () => ({
  redisService: {
    isConnected: false,
    isTokenBlacklisted: vi.fn(async () => false),
    blacklistToken: vi.fn(async () => {})
  }
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  return app;
}

async function registerPlugins(app) {
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: 'token', signed: false }
  });
  await app.register(rateLimit, { max: 1000, timeWindow: 60000 });
}

function signToken(app, payload) {
  return app.jwt.sign(payload);
}

/** Creates an HS256 JWT whose exp is in the past (for testing expiry). */
function createExpiredJwt(secret, payload) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const p = Buffer.from(JSON.stringify({ ...payload, iat: now - 7200, exp: now - 3600 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

// No-op decorators used when routes need them but the test doesn't exercise them
const noopAuthenticate = async (req, reply) => {
  try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
};
const noopAuthorize  = (_roles) => async () => {};
const noopRequireAdmin = async () => {};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('E2E — Authentication flow', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await registerPlugins(app);
    const { authRoutes } = await import('../routes/auth/index.js');
    app.decorate('authenticate', noopAuthenticate);
    app.decorate('authorize', noopAuthorize);
    app.decorate('requireAdmin', noopRequireAdmin);
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.ready();
  });

  afterAll(() => app.close());

  test('GET /api/auth/mode returns auth type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/mode' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('authType');
  });

  test('POST /api/auth/login rejects missing password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      headers: { 'x-forwarded-for': '1.2.3.4' },
      payload: { username: 'admin' }
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST /api/auth/login rejects missing username', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      headers: { 'x-forwarded-for': '1.2.3.5' },
      payload: { password: 'secret' }
    });
    expect(res.statusCode).toBe(400);
  });

  test('GET on /api/auth/login is blocked (405)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(res.statusCode).toBe(405);
  });
});

describe('E2E — Authenticated domain access', () => {
  let app;
  let adminToken;
  let userToken;

  beforeAll(async () => {
    app = buildApp();
    await registerPlugins(app);

    const { redisService } = await import('../services/redis.js');
    app.decorate('authenticate', async function (req, reply) {
      const authHeader   = req.headers.authorization;
      const cookieHeader = req.headers.cookie;
      let token;
      try {
        if (authHeader?.startsWith('Bearer ')) {
          token = authHeader.slice(7);
          req.user = app.jwt.verify(token);
        } else {
          await req.jwtVerify();
          token = req.cookies.token;
        }
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (token && await redisService.isTokenBlacklisted(token)) {
        return reply.code(401).send({ error: 'Token revoked' });
      }
    });
    app.decorate('authorize', noopAuthorize);
    app.decorate('requireAdmin', noopRequireAdmin);

    const { domainRoutes } = await import('../routes/domains.js');
    await app.register(domainRoutes, { prefix: '/api/domains' });
    await app.ready();

    adminToken = signToken(app, { id: 1, username: 'admin', role: 'admin' });
    userToken  = signToken(app, { id: 2, username: 'user1', role: 'user' });
  });

  afterAll(() => app.close());

  test('GET /api/domains returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/domains' });
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/domains returns 200 with valid JWT cookie', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/domains',
      headers: { cookie: `token=${userToken}` }
    });
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/domains returns 200 with Bearer header', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/domains',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
  });

  test('POST /api/domains rejects SSRF backend URL', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/domains',
      headers: { cookie: `token=${userToken}` },
      payload: { hostname: 'mysite.com', backendUrl: 'http://127.0.0.1:8080', proxyType: 'http' }
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST /api/domains rejects private IP as backend (ALLOW_PRIVATE_BACKENDS=false)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/domains',
      headers: { cookie: `token=${userToken}` },
      payload: { hostname: 'mysite.com', backendUrl: 'http://192.168.1.100:8080', proxyType: 'http' }
    });
    expect([400, 422, 403]).toContain(res.statusCode);
  });
});

describe('E2E — Admin permission isolation', () => {
  let app;
  let regularUserToken;

  beforeAll(async () => {
    app = buildApp();
    await registerPlugins(app);

    // Full authenticate: JWT verify + 401 on failure
    app.decorate('authenticate', async function (req, reply) {
      try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    });

    // requireAdmin: calls authenticate then checks role
    app.decorate('requireAdmin', async function (req, reply) {
      await app.authenticate(req, reply);
      if (reply.sent) return; // authenticate already responded (401)
      if (!req.user || req.user.role !== 'admin') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    });
    app.decorate('authorize', noopAuthorize);

    // Register a simple admin-guarded route instead of the full admin bundle
    app.get('/api/admin/users', { preHandler: [app.requireAdmin] }, async () => ({ users: [] }));
    await app.ready();

    regularUserToken = signToken(app, { id: 2, username: 'user1', role: 'user' });
  });

  afterAll(() => app.close());

  test('GET /api/admin/users returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/admin/users',
      headers: { cookie: `token=${regularUserToken}` }
    });
    expect(res.statusCode).toBe(403);
  });

  test('GET /api/admin/users returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(res.statusCode).toBe(401);
  });
});

describe('E2E — JWT expiry & revocation', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await registerPlugins(app);

    const blacklist = new Set();
    const { redisService } = await import('../services/redis.js');
    redisService.isConnected = true;
    redisService.isTokenBlacklisted.mockImplementation(async (t) => blacklist.has(t));
    redisService.blacklistToken.mockImplementation(async (t) => blacklist.add(t));

    app.decorate('authenticate', async function (req, reply) {
      let token;
      try {
        await req.jwtVerify();
        token = req.cookies.token;
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (token && await redisService.isTokenBlacklisted(token)) {
        return reply.code(401).send({ error: 'Token revoked' });
      }
    });

    app.get('/protected', { preHandler: [app.authenticate] }, async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(() => app.close());

  test('Expired JWT is rejected', async () => {
    // Create a manually expired HS256 token (expiresIn: -1 is not supported by @fastify/jwt)
    const expiredToken = createExpiredJwt(config.jwtSecret, { id: 1, role: 'user' });
    const res = await app.inject({
      method: 'GET', url: '/protected',
      headers: { cookie: `token=${expiredToken}` }
    });
    expect(res.statusCode).toBe(401);
  });

  test('Blacklisted token is rejected', async () => {
    const { redisService } = await import('../services/redis.js');
    const token = app.jwt.sign({ id: 1, role: 'user' });
    await redisService.blacklistToken(token);
    const res = await app.inject({
      method: 'GET', url: '/protected',
      headers: { cookie: `token=${token}` }
    });
    expect(res.statusCode).toBe(401);
  });

  test('Valid token passes', async () => {
    // Use unique nonce so this token is never in the blacklist from previous tests
    const token = app.jwt.sign({ id: 1, role: 'user', nonce: crypto.randomBytes(8).toString('hex') });
    const res = await app.inject({
      method: 'GET', url: '/protected',
      headers: { cookie: `token=${token}` }
    });
    expect(res.statusCode).toBe(200);
  });
});
