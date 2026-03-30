/**
 * Unified Permission Checker
 * Provides consistent authorization logic across the application
 *
 * SECURITY: This module centralizes all permission checks to prevent
 * authorization bypass vulnerabilities caused by inconsistent logic
 */

import { database } from '../services/database.js';

export class PermissionChecker {
  /**
   * Check if user can VIEW a domain
   * @param {Object} domain - Domain object from database
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canAccessDomain(domain, userId, isAdmin) {
    // Admins can access everything
    if (isAdmin) return true;

    // Owner can access
    if (domain.user_id === userId) return true;

    // Team member can access if domain belongs to their team
    if (domain.team_id) {
      const member = await database.getTeamMember(domain.team_id, userId);
      return member !== null; // Any team member can view
    }

    return false;
  }

  /**
   * Check if user can MODIFY a domain (update, delete, manage SSL, etc.)
   * @param {Object} domain - Domain object from database
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canModifyDomain(domain, userId, isAdmin) {
    // Admins can modify everything
    if (isAdmin) return true;

    // Owner can modify
    if (domain.user_id === userId) return true;

    // Team member can modify if they have permission
    if (domain.team_id) {
      const member = await database.getTeamMember(domain.team_id, userId);
      return member && member.can_manage_domains === true;
    }

    return false;
  }

  /**
   * Check if user can VIEW a redirection
   * @param {Object} redirection - Redirection object from database
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canAccessRedirection(redirection, userId, isAdmin) {
    // Admins can access everything
    if (isAdmin) return true;

    // Owner can access
    if (redirection.user_id === userId) return true;

    // Team member can access if redirection belongs to their team
    if (redirection.team_id) {
      const member = await database.getTeamMember(redirection.team_id, userId);
      return member !== null; // Any team member can view
    }

    return false;
  }

  /**
   * Check if user can MODIFY a redirection (update, delete)
   * @param {Object} redirection - Redirection object from database
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canModifyRedirection(redirection, userId, isAdmin) {
    // Admins can modify everything
    if (isAdmin) return true;

    // Owner can modify
    if (redirection.user_id === userId) return true;

    // Team member can modify if they have permission
    if (redirection.team_id) {
      const member = await database.getTeamMember(redirection.team_id, userId);
      return member && member.can_manage_redirections === true;
    }

    return false;
  }

  /**
   * Check if user can access a team
   * @param {number} teamId - Team ID
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canAccessTeam(teamId, userId, isAdmin) {
    if (isAdmin) return true;

    const member = await database.getTeamMember(teamId, userId);
    return member !== null;
  }

  /**
   * Check if user can manage a team (update settings, delete team)
   * @param {Object} team - Team object from database
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canManageTeam(team, userId, isAdmin) {
    if (isAdmin) return true;

    // Only team owner can manage team
    if (team.owner_id === userId) return true;

    return false;
  }

  /**
   * Check if user can invite members to a team
   * @param {number} teamId - Team ID
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canInviteToTeam(teamId, userId, isAdmin) {
    if (isAdmin) return true;

    const member = await database.getTeamMember(teamId, userId);
    return member && member.can_invite_members === true;
  }

  /**
   * Check if user can manage team members (change roles, remove members)
   * @param {number} teamId - Team ID
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canManageTeamMembers(teamId, userId, isAdmin) {
    if (isAdmin) return true;

    // Get team to check if user is owner
    const team = await database.getTeamById(teamId);
    if (!team) return false;

    return team.owner_id === userId;
  }

  /**
   * Check if user can access domain group
   * @param {Object} group - Domain group object from database
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canAccessDomainGroup(group, userId, isAdmin) {
    if (isAdmin) return true;

    // Personal group
    if (group.type === 'personal' && group.user_id === userId) {
      return true;
    }

    // Team group
    if (group.type === 'team' && group.team_id) {
      const member = await database.getTeamMember(group.team_id, userId);
      return member !== null;
    }

    return false;
  }

  /**
   * Check if user can modify domain group
   * @param {Object} group - Domain group object from database
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<boolean>}
   */
  static async canModifyDomainGroup(group, userId, isAdmin) {
    if (isAdmin) return true;

    // Personal group - only owner can modify
    if (group.type === 'personal' && group.user_id === userId) {
      return true;
    }

    // Team group - only members with can_manage_domains can modify
    if (group.type === 'team' && group.team_id) {
      const member = await database.getTeamMember(group.team_id, userId);
      return member && member.can_manage_domains === true;
    }

    return false;
  }

  /**
   * Helper: Get user permissions for logging/debugging
   * @param {number} userId - User ID
   * @param {boolean} isAdmin - Whether user is admin
   * @returns {Promise<Object>} - Summary of user permissions
   */
  static async getUserPermissionsSummary(userId, isAdmin) {
    if (isAdmin) {
      return {
        role: 'admin',
        canAccessAll: true,
        canModifyAll: true
      };
    }

    // Get all teams user belongs to
    const teams = await database.getTeamsByUserId(userId);

    return {
      role: 'user',
      userId,
      teamsCount: teams.length,
      teams: teams.map(t => ({
        id: t.id,
        name: t.name,
        role: t.role,
        permissions: {
          canManageDomains: t.can_manage_domains,
          canManageRedirections: t.can_manage_redirections,
          canInviteMembers: t.can_invite_members
        }
      }))
    };
  }
}

/**
 * Middleware-style helper for route handlers
 * @param {Function} permissionCheck - Permission check function
 * @returns {Function} - Fastify preHandler
 */
export function requirePermission(permissionCheck) {
  return async (request, reply) => {
    const hasPermission = await permissionCheck(request);

    if (!hasPermission) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'You do not have permission to perform this action'
      });
    }
  };
}
