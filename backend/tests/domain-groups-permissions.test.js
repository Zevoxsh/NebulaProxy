import { test, describe, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { config } from '../config/config.js';

const databaseMock = {
  getDomainGroupById: vi.fn(),
  getDomainById: vi.fn(),
  isTeamMember: vi.fn(),
  getTeamMemberRole: vi.fn(),
  hasGroupPermission: vi.fn(),
  hasTeamPermission: vi.fn(),
  getDomainGroupAssignment: vi.fn(),
  assignDomainToGroup: vi.fn(),
  bulkAssignDomainsToGroup: vi.fn(),
  removeDomainFromGroup: vi.fn(),
  createAuditLog: vi.fn()
};

vi.mock('../services/database.js', () => ({
  database: databaseMock
}));

describe('Domain Group Routes - Team Domain Permissions', () => {
  let app;
  let validToken;
  let domainGroupRoutes;

  beforeAll(async () => {
    ({ domainGroupRoutes } = await import('../routes/domainGroups.js'));

    app = Fastify({
      logger: false
    });
    await app.register(cookie);
    await app.register(jwt, {
      secret: config.jwtSecret,
      cookie: {
        cookieName: 'token',
        signed: false
      }
    });

    app.decorate('authenticate', async function(request, reply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });

    await app.register(domainGroupRoutes, { prefix: '/domain-groups' });
    await app.ready();

    validToken = app.jwt.sign({
      id: 42,
      username: 'member',
      role: 'user'
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMock.isTeamMember.mockResolvedValue(true);
    databaseMock.getTeamMemberRole.mockResolvedValue('member');
    databaseMock.hasGroupPermission.mockResolvedValue(false);
    databaseMock.hasTeamPermission.mockResolvedValue(true);
    databaseMock.getDomainGroupAssignment.mockResolvedValue(null);
    databaseMock.createAuditLog.mockResolvedValue(true);
  });

  test('allows team member with can_manage_domains to assign a domain to a team group', async () => {
    databaseMock.getDomainGroupById.mockResolvedValue({
      id: 10,
      team_id: 7,
      user_id: null,
      name: 'Team Group'
    });
    databaseMock.getDomainById.mockResolvedValue({
      id: 20,
      team_id: 7,
      user_id: 99,
      hostname: 'example.com'
    });
    databaseMock.assignDomainToGroup.mockResolvedValue({ success: true });

    const response = await app.inject({
      method: 'POST',
      url: '/domain-groups/10/domains/20',
      headers: {
        cookie: `token=${validToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(databaseMock.hasTeamPermission).toHaveBeenCalledWith(7, 42, 'can_manage_domains');
  });

  test('allows team member with can_manage_domains to bulk assign domains', async () => {
    databaseMock.getDomainGroupById.mockResolvedValue({
      id: 11,
      team_id: 7,
      user_id: null,
      name: 'Team Group'
    });
    databaseMock.bulkAssignDomainsToGroup.mockResolvedValue({
      success: [21, 22],
      failed: []
    });

    const response = await app.inject({
      method: 'POST',
      url: '/domain-groups/11/domains/bulk',
      headers: {
        cookie: `token=${validToken}`
      },
      payload: {
        domainIds: [21, 22]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(databaseMock.hasTeamPermission).toHaveBeenCalledWith(7, 42, 'can_manage_domains');
  });

  test('allows team member with can_manage_domains to remove a domain from a team group', async () => {
    databaseMock.getDomainGroupById.mockResolvedValue({
      id: 12,
      team_id: 7,
      user_id: null,
      name: 'Team Group'
    });
    databaseMock.getDomainById.mockResolvedValue({
      id: 23,
      team_id: 7,
      user_id: 99,
      hostname: 'example.com'
    });
    databaseMock.removeDomainFromGroup.mockResolvedValue(true);

    const response = await app.inject({
      method: 'DELETE',
      url: '/domain-groups/12/domains/23',
      headers: {
        cookie: `token=${validToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(databaseMock.hasTeamPermission).toHaveBeenCalledWith(7, 42, 'can_manage_domains');
  });
});
