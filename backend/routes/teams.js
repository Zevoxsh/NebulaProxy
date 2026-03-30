import { database } from '../services/database.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { emailService } from '../emails/emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function teamRoutes(fastify, options) {

  // Get all teams for the current user
  fastify.get('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;

      // All users (including admins) only see teams they created or are members of
      // To manage all teams, use the admin panel endpoint /api/admin/teams
      // PERFORMANCE: Use optimized single-query method (was N+1 with 4 queries per team)
      const enrichedTeams = await database.getEnrichedTeamsForUser(userId);

      reply.send({
        success: true,
        teams: enrichedTeams,
        count: enrichedTeams.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch teams');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch teams'
      });
    }
  });

  // Get specific team with members
  fastify.get('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;

      const team = await database.getTeamById(teamId);

      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Check if user is a member of the team (admins are NOT exempt)
      if (!await database.isTeamMember(teamId, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this team'
        });
      }

      const members = await database.getTeamMembers(teamId);
      const domainCount = await database.getTeamDomainCount(teamId);
      const quota = await database.getTeamDomainQuota(teamId);

      // Get current user's role and permissions in this team
      const userRole = await database.getTeamMemberRole(teamId, userId);
      const currentMember = members.find(m => String(m.user_id) === String(userId));
      const userPermissions = {
        can_manage_domains: userRole === 'owner' || Boolean(currentMember?.can_manage_domains),
        can_manage_members: userRole === 'owner' || Boolean(currentMember?.can_manage_members),
        can_manage_settings: userRole === 'owner' || Boolean(currentMember?.can_manage_settings)
      };

      reply.send({
        success: true,
        team: {
          ...team,
          members,
          member_count: members.length,
          domain_count: domainCount,
          domain_quota: quota,
          can_add_domain: domainCount < quota,
          user_role: userRole || 'member',
          user_permissions: userPermissions
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch team');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team'
      });
    }
  });

  // Create a new team
  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            pattern: '^[a-zA-Z0-9 _-]+$'
          },
          maxDomains: {
            type: 'integer',
            minimum: 0,
            maximum: 30
          },
          description: {
            type: 'string',
            maxLength: 500
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const { name, maxDomains } = request.body;
      const userId = request.user.id;

      // Validate name
      if (name.trim().length === 0) {
        return reply.code(400).send({
          error: 'Invalid team name',
          message: 'Team name cannot be empty'
        });
      }

      const team = await database.createTeam(name.trim(), userId, maxDomains || null);

      await database.createAuditLog({
        userId,
        action: 'team_created',
        entityType: 'team',
        entityId: team.id,
        details: {
          name: team.name,
          max_domains: maxDomains
        },
        ipAddress: request.ip
      });



      fastify.log.info({ username: request.user.username, teamId: team.id, name: team.name }, 'Team created');

      reply.code(201).send({
        success: true,
        team
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create team');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create team'
      });
    }
  });

  // Update team
  fastify.put('/:id', {
    preHandler: fastify.authenticate,
    schema: {
      params: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            pattern: '^[0-9]+$'
          }
        },
        required: ['id']
      },
      body: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            pattern: '^[a-zA-Z0-9 _-]+$'
          },
          maxDomains: {
            type: 'integer',
            minimum: 0,
            maximum: 30
          },
          description: {
            type: 'string',
            maxLength: 500
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const { name, maxDomains } = request.body;
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);

      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only owner can update team
      const userRole = await database.getTeamMemberRole(teamId, userId);
      if (userRole !== 'owner') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only team owners can update the team'
        });
      }

      const updatedTeam = await database.updateTeam(teamId, {
        name: name?.trim(),
        maxDomains
      });

      await database.createAuditLog({
        userId,
        action: 'team_updated',
        entityType: 'team',
        entityId: teamId,
        details: {
          old_name: team.name,
          new_name: name,
          old_max_domains: team.max_domains,
          new_max_domains: maxDomains
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, teamId, name: updatedTeam.name }, 'Team updated');

      reply.send({
        success: true,
        team: updatedTeam
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update team');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update team'
      });
    }
  });

  // ===== TEAM NOTIFICATION SETTINGS =====
  fastify.get('/:id/notifications', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const userRole = await database.getTeamMemberRole(teamId, userId);
      const hasPermission = await database.hasTeamPermission(teamId, userId, 'can_manage_settings');

      if (userRole !== 'owner' && !hasPermission) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view team notifications'
        });
      }

      const settings = await database.getTeamNotificationSettings(teamId);
      return reply.send({
        success: true,
        settings: settings ? {
          notificationsEnabled: Boolean(settings.notifications_enabled),
          emailEnabled: Boolean(settings.email_enabled)
        } : {
          notificationsEnabled: false,
          emailEnabled: false
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get team notification settings');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get team notification settings'
      });
    }
  });

  fastify.put('/:id/notifications', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          notificationsEnabled: { type: 'boolean' },
          emailEnabled: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const userRole = await database.getTeamMemberRole(teamId, userId);
      const hasPermission = await database.hasTeamPermission(teamId, userId, 'can_manage_settings');

      if (userRole !== 'owner' && !hasPermission) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to update team notifications'
        });
      }

      const { notificationsEnabled, emailEnabled } = request.body;

      const updated = await database.upsertTeamNotificationSettings(teamId, {
        notificationsEnabled: notificationsEnabled || false,
        emailEnabled: emailEnabled || false
      });

      return reply.send({
        success: true,
        settings: {
          notificationsEnabled: Boolean(updated.notifications_enabled),
          emailEnabled: Boolean(updated.email_enabled)
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update team notification settings');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update team notification settings'
      });
    }
  });

  fastify.post('/:id/notifications/test', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const userRole = await database.getTeamMemberRole(teamId, userId);
      const hasPermission = await database.hasTeamPermission(teamId, userId, 'can_manage_settings');

      if (userRole !== 'owner' && !hasPermission) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to test team notifications'
        });
      }

      const team = await database.getTeamById(teamId);
      const members = await database.getTeamMembers(teamId);
      const ownerMember = members.find(m => m.role === 'owner');
      const ownerEmail = ownerMember?.email;

      await emailService.init();
      const sent = await emailService.sendEmail({
        to: ownerEmail,
        subject: 'Team notifications — test email',
        template: 'team-domain-down',
        variables: {
          title: 'Team Email Test',
          teamName: team?.name || 'Your Team',
          teamId,
          domainName: 'test.example.com',
          domainId: 0,
          ownerName: ownerMember?.display_name || ownerMember?.username || 'Team Owner',
          userRole: 'owner',
          downSince: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' }),
          lastError: 'This is a test notification — email is working correctly.',
          dashboardUrl: request.headers.origin ||
            (request.headers.host
              ? `${request.protocol || 'https'}://${request.headers.host}`
              : process.env.DASHBOARD_URL || 'http://localhost:3000')
        },
        notificationType: 'team_alerts',
        isAdminNotification: false
      });

      if (sent) {
        return reply.send({ success: true, message: 'Test email sent successfully to the team owner.' });
      }
      return reply.code(400).send({ error: 'Failed to send test email. Check SMTP configuration in admin panel.' });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to test team email');
      return reply.code(500).send({
        error: 'Failed to send test email.'
      });
    }
  });

  // Delete team
  fastify.delete('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);

      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only owner can delete team
      const userRole = await database.getTeamMemberRole(teamId, userId);
      if (userRole !== 'owner') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only team owners can delete the team'
        });
      }

      await database.deleteTeam(teamId);

      await database.createAuditLog({
        userId,
        action: 'team_deleted',
        entityType: 'team',
        entityId: teamId,
        details: {
          name: team.name
        },
        ipAddress: request.ip
      });



      fastify.log.info({ username: request.user.username, teamId, name: team.name }, 'Team deleted');

      reply.send({
        success: true,
        message: 'Team deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete team');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete team'
      });
    }
  });

  // Add member to team
  fastify.post('/:id/members', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1 },
          permissions: {
            type: 'object',
            properties: {
              canManageDomains: { type: 'boolean' },
              canManageMembers: { type: 'boolean' },
              canManageSettings: { type: 'boolean' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const { username, permissions = {} } = request.body;
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);

      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only owner or users with can_manage_members permission can add members
      const hasPermission = await database.hasTeamPermission(teamId, userId, 'can_manage_members');
      const userRole = await database.getTeamMemberRole(teamId, userId);
      if (userRole !== 'owner' && !hasPermission) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to add members'
        });
      }

      // Find user to add
      const newMember = await database.getUserByUsername(username);
      if (!newMember) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `User ${username} not found`
        });
      }

      const result = await database.addTeamMember(teamId, newMember.id, 'member', permissions);

      if (!result.success) {
        return reply.code(409).send({
          error: 'Conflict',
          message: result.error
        });
      }

      await database.createAuditLog({
        userId,
        action: 'team_member_added',
        entityType: 'team',
        entityId: teamId,
        details: {
          team_name: team.name,
          new_member_username: newMember.username,
          new_member_id: newMember.id,
          permissions
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, teamId, newMemberUsername: newMember.username }, 'Member added to team');

      reply.code(201).send({
        success: true,
        message: `User ${username} added to team successfully`
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to add team member');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to add team member'
      });
    }
  });

  // Update member permissions
  fastify.put('/:id/members/:memberId/permissions', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['permissions'],
        properties: {
          permissions: {
            type: 'object',
            properties: {
              canManageDomains: { type: 'boolean' },
              canManageMembers: { type: 'boolean' },
              canManageSettings: { type: 'boolean' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const memberId = parseInt(request.params.memberId, 10);
      const { permissions } = request.body;
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);

      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only owner can update permissions
      const userRole = await database.getTeamMemberRole(teamId, userId);
      if (userRole !== 'owner') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only team owners can update permissions'
        });
      }

      // Check if member exists
      const memberRole = await database.getTeamMemberRole(teamId, memberId);
      if (!memberRole) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Member not found in team'
        });
      }

      // Cannot update owner permissions
      if (memberRole === 'owner') {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Cannot update owner permissions'
        });
      }

      const updatedMember = await database.updateTeamMemberPermissions(teamId, memberId, permissions);

      await database.createAuditLog({
        userId,
        action: 'team_member_permissions_updated',
        entityType: 'team',
        entityId: teamId,
        details: {
          team_name: team.name,
          member_id: memberId,
          permissions
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, teamId, memberId }, 'Member permissions updated');

      reply.send({
        success: true,
        member: updatedMember
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update member permissions');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update member permissions'
      });
    }
  });

  // Remove member from team
  fastify.delete('/:id/members/:memberId', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const memberId = parseInt(request.params.memberId, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);

      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Check if member exists in team
      const memberRole = await database.getTeamMemberRole(teamId, memberId);
      if (!memberRole) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Member not found in team'
        });
      }

      // Only owner can remove members, and owner cannot remove themselves
      const userRole = await database.getTeamMemberRole(teamId, userId);
      if (userRole !== 'owner') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only team owners can remove members'
        });
      }

      // Cannot remove owner
      if (memberRole === 'owner') {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Cannot remove team owner. Delete the team instead.'
        });
      }

      const memberUser = await database.getUserById(memberId);

      await database.removeTeamMember(teamId, memberId);

      await database.createAuditLog({
        userId,
        action: 'team_member_removed',
        entityType: 'team',
        entityId: teamId,
        details: {
          team_name: team.name,
          removed_member_username: memberUser?.username,
          removed_member_id: memberId
        },
        ipAddress: request.ip
      });

      // Create notification for remaining team members
      const actorName = request.user.display_name || request.user.username;
      const removedMemberName = memberUser?.display_name || memberUser?.username || 'A member';
      await database.createTeamNotificationForMembers({
        teamId,
        actorId: userId,
        actionType: 'member_removed',
        entityType: 'member',
        entityId: memberId,
        entityName: removedMemberName,
        message: `${actorName} removed ${removedMemberName} from the team`
      });

      // Also notify the removed member
      await database.createTeamNotification({
        userId: memberId,
        teamId,
        actorId: userId,
        actionType: 'member_removed',
        entityType: 'member',
        entityId: memberId,
        entityName: removedMemberName,
        message: `You were removed from ${team.name} by ${actorName}`
      });

      fastify.log.info({ username: request.user.username, teamId, removedMemberId: memberId }, 'Member removed from team');

      reply.send({
        success: true,
        message: 'Member removed from team successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to remove team member');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to remove team member'
      });
    }
  });

  // Get team members
  fastify.get('/:id/members', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);

      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Check if user is a member of the team
      if (!await database.isTeamMember(teamId, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view team members'
        });
      }

      const members = await database.getTeamMembers(teamId);

      reply.send({
        success: true,
        members,
        count: members.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch team members');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team members'
      });
    }
  });

  // Get team domains
  fastify.get('/:id/domains', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);

      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Check if user is a member of the team
      if (!await database.isTeamMember(teamId, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view team domains'
        });
      }

      const domains = await database.getDomainsByTeamId(teamId);
      const quota = await database.getTeamDomainQuota(teamId);

      reply.send({
        success: true,
        domains,
        count: domains.length,
        quota,
        can_add_domain: domains.length < quota
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch team domains');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team domains'
      });
    }
  });

  // Assign domain to team
  fastify.post('/:id/domains/:domainId', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const domainId = parseInt(request.params.domainId, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);
      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      const domain = await database.getDomainById(domainId);
      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      // Only domain owner can assign it to a team
      if (domain.user_id !== userId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the domain owner can assign it to a team'
        });
      }

      // User must be a member of the team
      if (!await database.isTeamMember(teamId, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this team'
        });
      }

      // Check if team can add more domains
      if (!await database.canTeamAddDomain(teamId)) {
        const quota = await database.getTeamDomainQuota(teamId);
        return reply.code(400).send({
          error: 'Quota Exceeded',
          message: `Team has reached its domain quota of ${quota}`
        });
      }

      const updatedDomain = await database.assignDomainToTeam(domainId, teamId);

      await database.createAuditLog({
        userId,
        action: 'domain_assigned_to_team',
        entityType: 'domain',
        entityId: domainId,
        details: {
          domain_hostname: domain.hostname,
          team_name: team.name,
          team_id: teamId
        },
        ipAddress: request.ip
      });

      // Create notification for team members
      const actorName = request.user.display_name || request.user.username;
      await database.createTeamNotificationForMembers({
        teamId,
        actorId: userId,
        actionType: 'domain_added',
        entityType: 'domain',
        entityId: domainId,
        entityName: domain.hostname,
        message: `${actorName} added domain ${domain.hostname} to the team`
      });

      fastify.log.info({ username: request.user.username, domainId, teamId }, 'Domain assigned to team');

      reply.send({
        success: true,
        domain: updatedDomain,
        message: 'Domain assigned to team successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to assign domain to team');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to assign domain to team'
      });
    }
  });

  // Remove domain from team
  fastify.delete('/:id/domains/:domainId', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const domainId = parseInt(request.params.domainId, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);
      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      const domain = await database.getDomainById(domainId);
      if (!domain) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Domain not found'
        });
      }

      // Check if domain is actually in this team
      if (domain.team_id !== teamId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Domain is not part of this team'
        });
      }

      // Only domain owner or team owner can remove domain from team
      const userRole = await database.getTeamMemberRole(teamId, userId);
      if (domain.user_id !== userId && userRole !== 'owner') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the domain owner or team owner can remove the domain from the team'
        });
      }

      const updatedDomain = await database.removeDomainFromTeam(domainId);

      await database.createAuditLog({
        userId,
        action: 'domain_removed_from_team',
        entityType: 'domain',
        entityId: domainId,
        details: {
          domain_hostname: domain.hostname,
          team_name: team.name,
          team_id: teamId
        },
        ipAddress: request.ip
      });

      // Create notification for team members
      const actorName = request.user.display_name || request.user.username;
      await database.createTeamNotificationForMembers({
        teamId,
        actorId: userId,
        actionType: 'domain_removed',
        entityType: 'domain',
        entityId: domainId,
        entityName: domain.hostname,
        message: `${actorName} removed domain ${domain.hostname} from the team`
      });

      fastify.log.info({ username: request.user.username, domainId, teamId }, 'Domain removed from team');

      reply.send({
        success: true,
        domain: updatedDomain,
        message: 'Domain removed from team successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to remove domain from team');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to remove domain from team'
      });
    }
  });

  // ===== TEAM INVITATION ROUTES =====

  // Send team invitation
  fastify.post('/:id/invitations', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1 },
          permissions: {
            type: 'object',
            properties: {
              canManageDomains: { type: 'boolean' },
              canManageMembers: { type: 'boolean' },
              canManageSettings: { type: 'boolean' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const { username, permissions = {} } = request.body;
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);
      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only owner or users with can_manage_members permission can send invitations
      const hasPermission = await database.hasTeamPermission(teamId, userId, 'can_manage_members');
      const userRole = await database.getTeamMemberRole(teamId, userId);
      if (userRole !== 'owner' && !hasPermission) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to send invitations'
        });
      }

      // Get the user to invite
      const newMember = await database.getUserByUsername(username);
      if (!newMember) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `User ${username} not found`
        });
      }

      // Check if already a member
      if (await database.isTeamMember(teamId, newMember.id)) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'User is already a member of this team'
        });
      }

      // Create invitation
      const result = await database.createTeamInvitation(teamId, userId, newMember.id, permissions);

      if (!result.success) {
        return reply.code(409).send({
          error: 'Conflict',
          message: result.error
        });
      }

      await database.createAuditLog({
        userId,
        action: 'team_invitation_sent',
        entityType: 'team',
        entityId: teamId,
        details: {
          team_name: team.name,
          invited_username: username,
          permissions
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, teamId, invitedUser: username }, 'Team invitation sent');

      // Send invitation email to the invited user
      if (newMember.email) {
        const members = await database.getTeamMembers(teamId).catch(() => []);
        emailService.sendEmail({
          to: newMember.email,
          subject: `You have been invited to join ${team.name} on NebulaProxy`,
          template: 'team-invitation',
          variables: {
            title: 'Team Invitation',
            inviterName: request.user.display_name || request.user.username,
            inviterEmail: request.user.email || '',
            teamName: team.name,
            teamId,
            role: 'member',
            memberCount: members.length,
            domainCount: team.domain_count || 0,
            invitationId: result.invitationId,
            permissionsList: Object.entries(permissions || {})
              .filter(([, v]) => v)
              .map(([k]) => `<li>${k.replace(/_/g, ' ')}</li>`)
              .join('\n') || '<li>View team domains</li>',
            dashboardUrl: request.headers.origin ||
              (request.headers.host
                ? `${request.protocol || 'https'}://${request.headers.host}`
                : process.env.DASHBOARD_URL || 'http://localhost:3000')
          },
          notificationType: 'team_alerts',
          userId: newMember.id
        }).catch(err => fastify.log.warn({ err }, 'Failed to send team invitation email'));
      }

      reply.send({
        success: true,
        message: `Invitation sent to ${username}`
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to send team invitation');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to send team invitation'
      });
    }
  });

  // Get team invitations (pending)
  fastify.get('/:id/invitations', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);
      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only team members can view team invitations
      if (!await database.isTeamMember(teamId, userId)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view team invitations'
        });
      }

      const invitations = await database.getTeamInvitations(teamId);

      reply.send({
        success: true,
        invitations
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch team invitations');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team invitations'
      });
    }
  });

  // Cancel team invitation
  fastify.delete('/:id/invitations/:invitationId', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const invitationId = parseInt(request.params.invitationId, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const team = await database.getTeamById(teamId);
      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only owner or users with can_manage_members permission can cancel invitations
      const hasPermission = await database.hasTeamPermission(teamId, userId, 'can_manage_members');
      const userRole = await database.getTeamMemberRole(teamId, userId);
      if (userRole !== 'owner' && !hasPermission) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to cancel invitations'
        });
      }

      await database.cancelTeamInvitation(invitationId);

      await database.createAuditLog({
        userId,
        action: 'team_invitation_cancelled',
        entityType: 'team',
        entityId: teamId,
        details: {
          team_name: team.name,
          invitation_id: invitationId
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, teamId, invitationId }, 'Team invitation cancelled');

      reply.send({
        success: true,
        message: 'Invitation cancelled'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to cancel team invitation');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to cancel team invitation'
      });
    }
  });

  // Get user's pending invitations
  fastify.get('/invitations/me', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const invitations = await database.getUserPendingInvitations(userId);

      reply.send({
        success: true,
        invitations
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch user invitations');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch user invitations'
      });
    }
  });

  // Get count of user's pending invitations
  fastify.get('/invitations/me/count', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const count = await database.countUserPendingInvitations(userId);

      reply.send({
        success: true,
        count
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to count user invitations');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to count user invitations'
      });
    }
  });

  // Accept team invitation
  fastify.post('/invitations/:invitationId/accept', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const invitationId = parseInt(request.params.invitationId, 10);
      const userId = request.user.id;

      const result = await database.acceptTeamInvitation(invitationId, userId);

      if (!result.success) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: result.error
        });
      }

      await database.createAuditLog({
        userId,
        action: 'team_invitation_accepted',
        entityType: 'team',
        entityId: result.teamId,
        details: {
          invitation_id: invitationId
        },
        ipAddress: request.ip
      });

      // Create notification for existing team members
      const actorName = request.user.display_name || request.user.username;
      await database.createTeamNotificationForMembers({
        teamId: result.teamId,
        actorId: userId,
        actionType: 'member_joined',
        entityType: 'member',
        entityId: userId,
        entityName: actorName,
        message: `${actorName} joined the team`
      });

      fastify.log.info({ username: request.user.username, invitationId, teamId: result.teamId }, 'Team invitation accepted');

      reply.send({
        success: true,
        message: 'Invitation accepted',
        teamId: result.teamId
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to accept team invitation');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to accept team invitation'
      });
    }
  });

  // Reject team invitation
  fastify.post('/invitations/:invitationId/reject', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const invitationId = parseInt(request.params.invitationId, 10);
      const userId = request.user.id;

      const result = await database.rejectTeamInvitation(invitationId, userId);

      if (!result.success) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: result.error
        });
      }

      await database.createAuditLog({
        userId,
        action: 'team_invitation_rejected',
        entityType: 'team',
        entityId: 0, // No team ID since rejected
        details: {
          invitation_id: invitationId
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, invitationId }, 'Team invitation rejected');

      reply.send({
        success: true,
        message: 'Invitation rejected'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to reject team invitation');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to reject team invitation'
      });
    }
  });

  // Upload team logo
  fastify.post('/:id/logo', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;

      // Check if user is team owner
      const team = await database.getTeamById(teamId);
      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only owner can upload logo
      if (team.owner_id !== userId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only team owner can upload logo'
        });
      }

      // Get file from multipart
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'No file provided'
        });
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(data.mimetype)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed'
        });
      }

      // Validate file size (already limited by multipart config, but double-check)
      const maxSize = 5 * 1024 * 1024; // 5MB
      let fileSize = 0;
      const chunks = [];

      for await (const chunk of data.file) {
        fileSize += chunk.length;
        if (fileSize > maxSize) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'File too large. Maximum size is 5MB'
          });
        }
        chunks.push(chunk);
      }

      // Generate unique filename
      const ext = data.mimetype.split('/')[1];
      const filename = `team-${teamId}-${Date.now()}.${ext}`;
      const uploadDir = join(__dirname, '..', 'uploads', 'team-logos');
      const filepath = join(uploadDir, filename);

      // Ensure directory exists
      const fs = await import('fs/promises');
      await fs.mkdir(uploadDir, { recursive: true });

      // Save file
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(filepath, buffer);

      // Update database
      const logoUrl = `/uploads/team-logos/${filename}`;
      await database.updateTeamLogo(teamId, logoUrl);

      // Create audit log
      await database.createAuditLog({
        userId,
        action: 'team_logo_uploaded',
        entityType: 'team',
        entityId: teamId,
        details: { filename, logoUrl },
        ipAddress: request.ip
      });

      fastify.log.info({ teamId, filename }, 'Team logo uploaded');

      reply.send({
        success: true,
        logoUrl,
        message: 'Logo uploaded successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to upload team logo');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to upload team logo'
      });
    }
  });

  // Delete team logo
  fastify.delete('/:id/logo', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const teamId = parseInt(request.params.id, 10);
      const userId = request.user.id;

      // Check if user is team owner
      const team = await database.getTeamById(teamId);
      if (!team) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Team not found'
        });
      }

      // Only owner can delete logo
      if (team.owner_id !== userId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only team owner can delete logo'
        });
      }

      // Delete file if exists
      if (team.logo_url) {
        const fs = await import('fs/promises');
        const filepath = join(__dirname, '..', team.logo_url);
        try {
          await fs.unlink(filepath);
        } catch (err) {
          fastify.log.warn({ error: err, filepath }, 'Failed to delete logo file');
        }
      }

      // Update database
      await database.updateTeamLogo(teamId, null);

      // Create audit log
      await database.createAuditLog({
        userId,
        action: 'team_logo_deleted',
        entityType: 'team',
        entityId: teamId,
        details: {},
        ipAddress: request.ip
      });

      fastify.log.info({ teamId }, 'Team logo deleted');

      reply.send({
        success: true,
        message: 'Logo deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete team logo');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete team logo'
      });
    }
  });
}
