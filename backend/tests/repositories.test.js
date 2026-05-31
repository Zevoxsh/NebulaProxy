/**
 * Repository integration tests.
 *
 * Strategy: instantiate repository methods on a plain object with spied
 * queryOne / queryAll / execute base methods. Verifies:
 *   - correct base method (queryOne vs queryAll vs execute)
 *   - SQL contains the expected table/clause
 *   - correct parameters are forwarded
 *   - return value is passed through unchanged
 *
 * No real DB required — fast, deterministic, runnable in CI.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { UserRepository }   from '../repositories/userRepository.js';
import { DomainRepository } from '../repositories/domainRepository.js';
import { SslRepository }    from '../repositories/sslRepository.js';
import { TeamRepository }   from '../repositories/teamRepository.js';
import { ApiKeyRepository } from '../repositories/apiKeyRepository.js';
import { AuditLogRepository } from '../repositories/auditLogRepository.js';

// ── Helper ─────────────────────────────────────────────────────────────────
function createRepo(...RepoClasses) {
  const instance = {
    queryOne: vi.fn(),
    queryAll: vi.fn(),
    execute:  vi.fn(),
    pgPool:   { query: vi.fn() },
  };
  for (const Repo of RepoClasses) {
    Object.getOwnPropertyNames(Repo.prototype)
      .filter(n => n !== 'constructor')
      .forEach(n => { instance[n] = Repo.prototype[n].bind(instance); });
  }
  return instance;
}

// ── UserRepository ─────────────────────────────────────────────────────────
describe('UserRepository', () => {
  let db;
  beforeEach(() => {
    db = createRepo(UserRepository);
    vi.clearAllMocks();
  });

  test('getUserByUsername — calls queryOne with correct SQL', async () => {
    db.queryOne.mockResolvedValue({ id: 1, username: 'alice' });
    const result = await db.getUserByUsername('alice');
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    const [sql, params] = db.queryOne.mock.calls[0];
    expect(sql.toLowerCase()).toContain('users');
    expect(sql.toLowerCase()).toContain('username');
    expect(params[0]).toBe('alice');
    expect(result).toEqual({ id: 1, username: 'alice' });
  });

  test('getUserById — calls queryOne with id param', async () => {
    db.queryOne.mockResolvedValue({ id: 42, username: 'bob' });
    const result = await db.getUserById(42);
    const [sql, params] = db.queryOne.mock.calls[0];
    expect(sql.toLowerCase()).toContain('users');
    expect(params[0]).toBe(42);
    expect(result.id).toBe(42);
  });

  test('getAllUsers — calls queryAll', async () => {
    db.queryAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const result = await db.getAllUsers();
    expect(db.queryAll).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  test('createUser — calls execute with user data', async () => {
    db.execute.mockResolvedValue({ rows: [{ id: 99 }] });
    db.queryOne.mockResolvedValue({ id: 99, username: 'carol' });
    await db.createUser({ username: 'carol', email: 'carol@test.local', passwordHash: 'hash', role: 'user' });
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('insert');
    expect(sql.toLowerCase()).toContain('users');
    expect(params).toContain('carol');
  });

  test('toggleUserActive — calls execute with userId', async () => {
    db.execute.mockResolvedValue({ rows: [{ id: 1, is_active: false }] });
    db.queryOne.mockResolvedValue({ id: 1, is_active: false });
    await db.toggleUserActive(1);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('users');
    expect(params).toContain(1);
  });

  test('updateUserLoginTime — calls execute with userId', async () => {
    db.execute.mockResolvedValue({});
    await db.updateUserLoginTime(5);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][1]).toContain(5);
  });

  test('deleteUser — calls execute with userId', async () => {
    db.execute.mockResolvedValue({});
    await db.deleteUser(7);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('users');
    expect(params[0]).toBe(7);
  });
});

// ── DomainRepository ────────────────────────────────────────────────────────
describe('DomainRepository', () => {
  let db;
  beforeEach(() => {
    db = createRepo(DomainRepository);
    vi.clearAllMocks();
  });

  test('getDomainIdsByUserId — calls queryAll', async () => {
    db.queryAll.mockResolvedValue([{ id: 10 }, { id: 20 }]);
    const result = await db.getDomainIdsByUserId(1);
    expect(db.queryAll).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });

  test('countDomainsByUserId — calls queryOne and returns integer', async () => {
    db.queryOne.mockResolvedValue({ count: '3' });
    const count = await db.countDomainsByUserId(1);
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(typeof count).toBe('number');
    expect(count).toBe(3);
  });

  test('countActiveDomains — calls queryOne', async () => {
    db.queryOne.mockResolvedValue({ count: '5' });
    const count = await db.countActiveDomains();
    expect(typeof count).toBe('number');
  });

  test('toggleDomainActive — calls execute with domainId', async () => {
    db.execute.mockResolvedValue({ rows: [{ id: 3, is_active: true }] });
    db.queryOne.mockResolvedValue({ id: 3, is_active: true });
    await db.toggleDomainActive(3);
    expect(db.execute).toHaveBeenCalled();
    expect(db.execute.mock.calls[0][1]).toContain(3);
  });

  test('deleteDomain — calls execute with domainId', async () => {
    db.execute.mockResolvedValue({});
    await db.deleteDomain(99);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('domains');
    expect(params[0]).toBe(99);
  });

  test('updateDomainSSLStatus — calls execute with ssl fields', async () => {
    db.execute.mockResolvedValue({});
    await db.updateDomainSSLStatus(1, 'active', '/cert.pem', '/key.pem', '2026-01-01');
    const [sql] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('ssl');
  });
});

// ── SslRepository ────────────────────────────────────────────────────────────
// Several SSL methods call this.getDomainById — include DomainRepository in the mix.
describe('SslRepository', () => {
  let db;
  beforeEach(() => {
    db = createRepo(DomainRepository, SslRepository);
    vi.clearAllMocks();
  });

  test('getCertificateFromDB — calls queryOne with domainId', async () => {
    // getCertificateFromDB maps the raw row into an object with camelCase keys
    db.queryOne.mockResolvedValue({
      ssl_fullchain: 'cert', ssl_private_key: 'key', ssl_issuer: 'LE',
      ssl_issued_at: null, ssl_expires_at: null, ssl_cert_type: 'acme'
    });
    const result = await db.getCertificateFromDB(5);
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(db.queryOne.mock.calls[0][1][0]).toBe(5);
    expect(result.fullchain).toBe('cert');
  });

  test('getCertificateByHostname — calls queryOne with hostname', async () => {
    db.queryOne.mockResolvedValue({ hostname: 'example.com' });
    await db.getCertificateByHostname('example.com');
    expect(db.queryOne.mock.calls[0][1][0]).toBe('example.com');
  });

  test('storeCertificateInDB — calls execute (INSERT/UPDATE)', async () => {
    // First queryOne call checks existing cert, then execute upserts, then getDomainById returns domain
    db.queryOne
      .mockResolvedValueOnce(null)  // no existing cert
      .mockResolvedValueOnce({ id: 1, hostname: 'example.com' }); // getDomainById
    db.execute.mockResolvedValue({});
    await db.storeCertificateInDB(1, 'chain', 'key', 'letsencrypt', new Date(), new Date(), 'acme');
    expect(db.execute).toHaveBeenCalled();
    const [sql] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toMatch(/insert|update/);
  });

  test('deleteCertificateFromDB — calls execute + getDomainById', async () => {
    db.execute.mockResolvedValue({});
    db.queryOne.mockResolvedValue({ id: 10, hostname: 'test.com' }); // getDomainById
    await db.deleteCertificateFromDB(10);
    expect(db.execute).toHaveBeenCalled();
    expect(db.execute.mock.calls[0][1]).toContain(10);
  });

  test('setSSLAutoRenew — calls execute then getDomainById', async () => {
    db.execute.mockResolvedValue({});
    db.queryOne.mockResolvedValue({ id: 3, hostname: 'site.com' }); // getDomainById
    await db.setSSLAutoRenew(3, true);
    expect(db.execute).toHaveBeenCalled();
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('domains');
    expect(params).toContain(3);
  });

  test('getExpiringCertificates — calls queryAll with days param', async () => {
    db.queryAll.mockResolvedValue([{ hostname: 'x.com', days_until_expiry: 5 }]);
    const result = await db.getExpiringCertificates(14);
    expect(db.queryAll).toHaveBeenCalledTimes(1);
    expect(db.queryAll.mock.calls[0][1][0]).toBe(14);
    expect(result[0].hostname).toBe('x.com');
  });
});

// ── TeamRepository ──────────────────────────────────────────────────────────
describe('TeamRepository', () => {
  let db;
  beforeEach(() => {
    db = createRepo(TeamRepository);
    vi.clearAllMocks();
  });

  test('createTeam — calls execute INSERT + addTeamMember + getTeamById', async () => {
    db.execute.mockResolvedValue({ rows: [{ id: 7 }] });
    db.queryOne.mockResolvedValue({ id: 7, name: 'devs', owner_id: 1 });
    await db.createTeam('devs', 1);
    expect(db.execute).toHaveBeenCalledTimes(2); // INSERT team + INSERT member
    const [sql] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('teams');
  });

  test('deleteTeam — calls execute with teamId', async () => {
    db.execute.mockResolvedValue({});
    await db.deleteTeam(5);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('teams');
    expect(params[0]).toBe(5);
  });

  test('isTeamMember — calls queryOne with COUNT and returns boolean', async () => {
    // isTeamMember uses SELECT COUNT(*) — mock must return { count: '1' }
    db.queryOne.mockResolvedValue({ count: '1' });
    const result = await db.isTeamMember(1, 2);
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  test('isTeamMember — returns false when count is 0', async () => {
    db.queryOne.mockResolvedValue({ count: '0' });
    const result = await db.isTeamMember(1, 99);
    expect(result).toBe(false);
  });

  test('hasTeamPermission — returns true for owner', async () => {
    // hasTeamPermission returns true when role === 'owner' regardless of permission column
    db.queryOne.mockResolvedValue({ role: 'owner', has_permission: null });
    const result = await db.hasTeamPermission(1, 2, 'can_manage_domains');
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  test('hasTeamPermission — returns Boolean of permission column for non-owner', async () => {
    db.queryOne.mockResolvedValue({ role: 'member', has_permission: 1 });
    const result = await db.hasTeamPermission(1, 2, 'can_manage_domains');
    expect(result).toBe(true);
  });

  test('removeTeamMember — calls execute with teamId and userId', async () => {
    db.execute.mockResolvedValue({});
    await db.removeTeamMember(3, 7);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('team_members');
    expect(params).toContain(3);
    expect(params).toContain(7);
  });

  test('canTeamAddDomain — returns boolean', async () => {
    db.queryOne.mockResolvedValueOnce({ max_domains: 10 });  // getTeamDomainQuota
    db.queryOne.mockResolvedValueOnce({ count: '3' });       // getTeamDomainCount
    const result = await db.canTeamAddDomain(1);
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });
});

// ── ApiKeyRepository ────────────────────────────────────────────────────────
describe('ApiKeyRepository', () => {
  let db;
  beforeEach(() => {
    db = createRepo(ApiKeyRepository);
    vi.clearAllMocks();
  });

  test('getApiKeysByUserId — calls queryAll', async () => {
    db.queryAll.mockResolvedValue([{ id: 1, name: 'key1' }]);
    const result = await db.getApiKeysByUserId(5);
    expect(db.queryAll).toHaveBeenCalledTimes(1);
    expect(db.queryAll.mock.calls[0][1][0]).toBe(5);
    expect(result).toHaveLength(1);
  });

  test('deleteApiKey — calls execute with keyId', async () => {
    db.execute.mockResolvedValue({});
    await db.deleteApiKey(10);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('api_keys');
    expect(params).toContain(10);
  });
});

// ── AuditLogRepository ──────────────────────────────────────────────────────
describe('AuditLogRepository', () => {
  let db;
  beforeEach(() => {
    db = createRepo(AuditLogRepository);
    vi.clearAllMocks();
  });

  test('createAuditLog — calls execute', async () => {
    db.execute.mockResolvedValue({});
    await db.createAuditLog({ userId: 1, action: 'domain.create', targetId: 5, details: {} });
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql] = db.execute.mock.calls[0];
    expect(sql.toLowerCase()).toContain('audit_logs');
  });

  test('getAuditLogs — calls queryAll', async () => {
    db.queryAll.mockResolvedValue([{ id: 1, action: 'login' }]);
    const result = await db.getAuditLogs({ limit: 20, offset: 0 });
    expect(db.queryAll).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });
});
