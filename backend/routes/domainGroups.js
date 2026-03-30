import { database } from '../services/database.js';

// Helper: check if user can access group
async function canAccessGroup(group, userId) {
  // Personal group: only owner
  if (group.user_id) {
    return group.user_id === userId;
  }

  // Team group: ANY team member has access automatically
  // No need to be added as a group member - team membership is enough
  if (group.team_id) {
    return await database.isTeamMember(group.team_id, userId);
  }

  return false;
}

// Helper: check if user can modify group
async function canModifyGroup(group, userId) {
  // Personal group: only owner
  if (group.user_id) {
    return group.user_id === userId;
  }

  // Team group: team owner or user with can_manage_group permission
  if (group.team_id) {
    const teamRole = await database.getTeamMemberRole(group.team_id, userId);
    if (teamRole === 'owner') return true;

    return await database.hasGroupPermission(group.id, userId, 'can_manage_group');
  }

  return false;
}

export async function domainGroupRoutes(fastify, options) {

  // Get all groups accessible by user
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const groups = await database.getDomainGroupsByUserId(userId);

      return reply.send({
        success: true,
        groups,
        count: groups.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch domain groups');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch domain groups'
      });
    }
  });

  // Get specific group with domains
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);

      if (!group) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain group not found'
        });
      }

      if (!await canAccessGroup(group, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this group'
        });
      }

      // Get domains in group, filtered by user permissions
      // Personal domains in team groups are only visible to their owner
      const domains = await database.getDomainsInGroup(groupId, userId);

      // For team groups, return ALL team members (not just group members)
      // Team groups are accessible to entire team by default
      let members = [];
      if (group.team_id) {
        const teamMembers = await database.getTeamMembers(group.team_id);
        members = teamMembers.map(tm => ({
          ...tm,
          // All team members have view access by default
          can_manage_group: tm.role === 'owner',
          can_assign_domains: tm.role === 'owner' || tm.can_manage_domains,
          can_view_domains: true
        }));
      }

      return reply.send({
        success: true,
        group: {
          ...group,
          domains,
          members,
          domain_count: domains.length
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch domain group');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch domain group'
      });
    }
  });

  // Create new group (personal or team)
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', maxLength: 1000 },
          color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
          icon: { type: 'string', maxLength: 50 },
          type: { type: 'string', enum: ['personal', 'team'] },
          teamId: { type: 'integer', minimum: 1 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { name, description, color, icon, type, teamId } = request.body;
      const userId = request.user.id;

      // Validate type and teamId consistency
      if (type === 'team' && !teamId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'teamId is required for team groups'
        });
      }

      if (type === 'personal' && teamId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Personal groups cannot have a teamId'
        });
      }

      // For team groups, verify user is team owner or has can_manage_settings
      if (type === 'team') {
        const teamRole = await database.getTeamMemberRole(teamId, userId);
        const hasPermission = await database.hasTeamPermission(teamId, userId, 'can_manage_settings');

        if (teamRole !== 'owner' && !hasPermission) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You do not have permission to create groups for this team'
          });
        }
      }

      const group = await database.createDomainGroup({
        name,
        description,
        color,
        icon,
        userId: type === 'personal' ? userId : null,
        teamId: type === 'team' ? teamId : null,
        createdBy: userId
      });

      await database.createAuditLog({
        userId,
        action: 'domain_group_created',
        entityType: 'domain_group',
        entityId: group.id,
        details: { name, type, teamId },
        ipAddress: request.ip
      });

      return reply.code(201).send({
        success: true,
        group
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create domain group');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create domain group'
      });
    }
  });

  // Update group
  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', maxLength: 1000 },
          color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
          icon: { type: 'string', maxLength: 50 },
          isActive: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);

      if (!group) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain group not found'
        });
      }

      if (!await canModifyGroup(group, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this group'
        });
      }

      const updatedGroup = await database.updateDomainGroup(groupId, request.body);

      await database.createAuditLog({
        userId,
        action: 'domain_group_updated',
        entityType: 'domain_group',
        entityId: groupId,
        details: request.body,
        ipAddress: request.ip
      });

      return reply.send({
        success: true,
        group: updatedGroup
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update domain group');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update domain group'
      });
    }
  });

  // Delete group
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);

      if (!group) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain group not found'
        });
      }

      if (!await canModifyGroup(group, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to delete this group'
        });
      }

      await database.deleteDomainGroup(groupId);

      await database.createAuditLog({
        userId,
        action: 'domain_group_deleted',
        entityType: 'domain_group',
        entityId: groupId,
        details: { name: group.name },
        ipAddress: request.ip
      });

      return reply.send({
        success: true,
        message: 'Domain group deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete domain group');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete domain group'
      });
    }
  });

  // Assign domain to group
  fastify.post('/:id/domains/:domainId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const domainId = parseInt(request.params.domainId, 10);
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);
      const domain = await database.getDomainById(domainId);

      if (!group || !domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: !group ? 'Group not found' : 'Domain not found'
        });
      }

      // Check user can access both group and domain
      if (!await canAccessGroup(group, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this group'
        });
      }

      // Check if domain is already in another group
      const existingAssignment = await database.getDomainGroupAssignment(domainId);
      if (existingAssignment && existingAssignment.group_id !== groupId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Domain is already in another group. Remove it from that group first.'
        });
      }

      // Check domain ownership and access
      // Personal groups: can contain user's personal domains + team domains user has access to
      if (group.user_id) {
        // Check if user owns the domain or has access via team
        const hasAccess = domain.user_id === userId ||
                         (domain.team_id && await database.isTeamMember(domain.team_id, userId));

        if (!hasAccess) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You do not have access to this domain'
          });
        }
      }

      // Team groups: can contain personal domains + domains from the same team
      if (group.team_id) {
        const isPersonalDomain = !domain.team_id && domain.user_id === userId;
        const isSameTeamDomain = domain.team_id === group.team_id;

        if (!isPersonalDomain && !isSameTeamDomain) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'Team groups can only contain your personal domains or domains from the same team'
          });
        }
      }

      // Check permission to assign domains
      if (group.team_id) {
        const canAssign = await database.hasGroupPermission(groupId, userId, 'can_assign_domains');
        const teamRole = await database.getTeamMemberRole(group.team_id, userId);
        const canManageDomains = await database.hasTeamPermission(group.team_id, userId, 'can_manage_domains');

        if (teamRole !== 'owner' && !canAssign && !canManageDomains) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You do not have permission to assign domains to this group'
          });
        }
      }

      const result = await database.assignDomainToGroup(domainId, groupId, userId);

      if (!result.success) {
        return reply.code(409).send({
          error: 'Conflict',
          message: result.error
        });
      }

      await database.createAuditLog({
        userId,
        action: 'domain_assigned_to_group',
        entityType: 'domain_group',
        entityId: groupId,
        details: { domainId, domainHostname: domain.hostname },
        ipAddress: request.ip
      });

      return reply.send({
        success: true,
        message: 'Domain assigned to group successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to assign domain to group');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to assign domain to group'
      });
    }
  });

  // Remove domain from group
  fastify.delete('/:id/domains/:domainId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const domainId = parseInt(request.params.domainId, 10);
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);
      const domain = await database.getDomainById(domainId);

      if (!group || !domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: !group ? 'Group not found' : 'Domain not found'
        });
      }

      // Check permission
      if (group.team_id) {
        const canAssign = await database.hasGroupPermission(groupId, userId, 'can_assign_domains');
        const teamRole = await database.getTeamMemberRole(group.team_id, userId);
        const canManageDomains = await database.hasTeamPermission(group.team_id, userId, 'can_manage_domains');

        if (teamRole !== 'owner' && !canAssign && !canManageDomains) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You do not have permission to remove domains from this group'
          });
        }
      } else if (group.user_id !== userId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this group'
        });
      }

      await database.removeDomainFromGroup(domainId, groupId);

      await database.createAuditLog({
        userId,
        action: 'domain_removed_from_group',
        entityType: 'domain_group',
        entityId: groupId,
        details: { domainId, domainHostname: domain.hostname },
        ipAddress: request.ip
      });

      return reply.send({
        success: true,
        message: 'Domain removed from group successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to remove domain from group');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to remove domain from group'
      });
    }
  });

  // Bulk assign domains to group
  fastify.post('/:id/domains/bulk', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['domainIds'],
        properties: {
          domainIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const { domainIds } = request.body;
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);

      if (!group) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Group not found'
        });
      }

      // Check permission
      if (group.team_id) {
        const canAssign = await database.hasGroupPermission(groupId, userId, 'can_assign_domains');
        const teamRole = await database.getTeamMemberRole(group.team_id, userId);
        const canManageDomains = await database.hasTeamPermission(group.team_id, userId, 'can_manage_domains');

        if (teamRole !== 'owner' && !canAssign && !canManageDomains) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You do not have permission to assign domains to this group'
          });
        }
      } else if (group.user_id !== userId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this group'
        });
      }

      const results = await database.bulkAssignDomainsToGroup(domainIds, groupId, userId);

      await database.createAuditLog({
        userId,
        action: 'domains_bulk_assigned_to_group',
        entityType: 'domain_group',
        entityId: groupId,
        details: {
          domainIds,
          successCount: results.success.length,
          failedCount: results.failed.length
        },
        ipAddress: request.ip
      });

      return reply.send({
        success: true,
        results
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to bulk assign domains');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to bulk assign domains'
      });
    }
  });

  // Get group members (team groups only)
  fastify.get('/:id/members', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);

      if (!group) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Group not found'
        });
      }

      if (!group.team_id) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Personal groups do not have members'
        });
      }

      if (!await canAccessGroup(group, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this group'
        });
      }

      const members = await database.getGroupMembers(groupId);

      return reply.send({
        success: true,
        members,
        count: members.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch group members');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch group members'
      });
    }
  });

  // Add member to team group
  fastify.post('/:id/members', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'integer' },
          permissions: {
            type: 'object',
            properties: {
              canManageGroup: { type: 'boolean' },
              canAssignDomains: { type: 'boolean' },
              canViewDomains: { type: 'boolean' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const { userId: newMemberId, permissions = {} } = request.body;
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);

      if (!group) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Group not found'
        });
      }

      if (!group.team_id) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Cannot add members to personal groups'
        });
      }

      if (!await canModifyGroup(group, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to manage this group'
        });
      }

      // Verify new member is part of the team
      if (!await database.isTeamMember(group.team_id, newMemberId)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'User must be a team member first'
        });
      }

      const result = await database.addGroupMember(groupId, newMemberId, permissions, userId);

      if (!result.success) {
        return reply.code(409).send({
          error: 'Conflict',
          message: result.error
        });
      }

      await database.createAuditLog({
        userId,
        action: 'group_member_added',
        entityType: 'domain_group',
        entityId: groupId,
        details: { newMemberId, permissions },
        ipAddress: request.ip
      });

      return reply.code(201).send({
        success: true,
        message: 'Member added to group successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to add group member');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to add group member'
      });
    }
  });

  // Update group member permissions
  fastify.put('/:id/members/:memberId/permissions', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['permissions'],
        properties: {
          permissions: {
            type: 'object',
            properties: {
              canManageGroup: { type: 'boolean' },
              canAssignDomains: { type: 'boolean' },
              canViewDomains: { type: 'boolean' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const memberId = parseInt(request.params.memberId, 10);
      const { permissions } = request.body;
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);

      if (!group) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Group not found'
        });
      }

      if (!await canModifyGroup(group, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to manage this group'
        });
      }

      const updatedMember = await database.updateGroupMemberPermissions(groupId, memberId, permissions);

      await database.createAuditLog({
        userId,
        action: 'group_member_permissions_updated',
        entityType: 'domain_group',
        entityId: groupId,
        details: { memberId, permissions },
        ipAddress: request.ip
      });

      return reply.send({
        success: true,
        member: updatedMember
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update group member permissions');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update group member permissions'
      });
    }
  });

  // Remove member from group
  fastify.delete('/:id/members/:memberId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const groupId = parseInt(request.params.id, 10);
      const memberId = parseInt(request.params.memberId, 10);
      const userId = request.user.id;

      const group = await database.getDomainGroupById(groupId);

      if (!group) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Group not found'
        });
      }

      if (!await canModifyGroup(group, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to manage this group'
        });
      }

      await database.removeGroupMember(groupId, memberId);

      await database.createAuditLog({
        userId,
        action: 'group_member_removed',
        entityType: 'domain_group',
        entityId: groupId,
        details: { memberId },
        ipAddress: request.ip
      });

      return reply.send({
        success: true,
        message: 'Member removed from group successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to remove group member');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to remove group member'
      });
    }
  });
}
