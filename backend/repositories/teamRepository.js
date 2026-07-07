// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class TeamRepository {
// ===== TEAM METHODS =====

// Create a new team
async createTeam(name, ownerId, maxDomains = null) {
  const result = await this.execute(`
    INSERT INTO teams (name, owner_id, max_domains)
    VALUES (?, ?, ?)
    RETURNING id
  `, [name, ownerId, maxDomains]);
  const teamId = result.rows[0].id;

  // Automatically add the owner as a team member with 'owner' role
  await this.execute(`
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (?, ?, 'owner')
  `, [teamId, ownerId]);

  return this.getTeamById(teamId);
}

// Get team by ID with owner information
getTeamById(teamId) {
  return this.queryOne(`
    SELECT
      t.*,
      u.username as owner_username,
      u.display_name as owner_display_name
    FROM teams t
    JOIN users u ON t.owner_id = u.id
    WHERE t.id = ?
  `, [teamId]);
}

// Get all teams a user is part of (as owner or member)
getTeamsByUserId(userId) {
  return this.queryAll(`
    SELECT
      t.*,
      u.username as owner_username,
      u.display_name as owner_display_name,
      tm.role as user_role
    FROM teams t
    JOIN users u ON t.owner_id = u.id
    JOIN team_members tm ON t.id = tm.team_id
    WHERE tm.user_id = ?
    ORDER BY t.created_at DESC
  `, [userId]);
}

/**
 * PERFORMANCE OPTIMIZATION: Get enriched teams for user with single query
 * Replaces N+1 query pattern where each team triggered 4 separate queries
 * @param {number} userId - User ID
 * @returns {Promise<Array>} - Enriched teams with counts and permissions
 */
async getEnrichedTeamsForUser(userId) {
  const result = await this.queryAll(`
    SELECT
      t.id,
      t.name,
      t.owner_id,
      t.max_domains,
      t.created_at,
      t.updated_at,
      t.logo_url,
      t.logo_updated_at,
      u.username as owner_username,
      u.display_name as owner_display_name,
      tm_user.role as user_role,
      tm_user.can_manage_domains,
      tm_user.can_manage_members,
      tm_user.can_manage_settings,
      COUNT(DISTINCT tm_all.user_id) as member_count,
      COUNT(DISTINCT d.id) as domain_count,
      t.max_domains as domain_quota
    FROM teams t
    INNER JOIN users u ON t.owner_id = u.id
    INNER JOIN team_members tm_user ON t.id = tm_user.team_id AND tm_user.user_id = ?
    LEFT JOIN team_members tm_all ON t.id = tm_all.team_id
    LEFT JOIN domains d ON t.id = d.team_id
    WHERE tm_user.user_id = ?
    GROUP BY
      t.id,
      t.name,
      t.owner_id,
      t.max_domains,
      t.created_at,
      t.updated_at,
      t.logo_url,
      t.logo_updated_at,
      u.username,
      u.display_name,
      tm_user.role,
      tm_user.can_manage_domains,
      tm_user.can_manage_members,
      tm_user.can_manage_settings
    ORDER BY t.created_at DESC
  `, [userId, userId]);

  // Transform to match expected format
  return result.map(row => ({
    id: row.id,
    name: row.name,
    owner_id: row.owner_id,
    max_domains: row.max_domains,
    created_at: row.created_at,
    updated_at: row.updated_at,
    logo_url: row.logo_url,
    logo_updated_at: row.logo_updated_at,
    owner_username: row.owner_username,
    owner_display_name: row.owner_display_name,
    user_role: row.user_role || 'member',
    member_count: parseInt(row.member_count, 10),
    domain_count: parseInt(row.domain_count, 10),
    domain_quota: row.domain_quota,
    can_add_domain: parseInt(row.domain_count, 10) < row.domain_quota,
    can_manage_domains: row.can_manage_domains,
    can_manage_members: row.can_manage_members,
    can_manage_settings: row.can_manage_settings
  }));
}

// Get all teams (admin only)
getAllTeams() {
  return this.queryAll(`
    SELECT
      t.*,
      u.username as owner_username,
      u.display_name as owner_display_name,
      COUNT(DISTINCT tm.user_id) as member_count,
      COUNT(DISTINCT d.id) as domain_count
    FROM teams t
    JOIN users u ON t.owner_id = u.id
    LEFT JOIN team_members tm ON t.id = tm.team_id
    LEFT JOIN domains d ON t.id = d.team_id
    GROUP BY t.id, u.id
    ORDER BY t.created_at DESC
  `, []);
}

// Update team name or max_domains
async updateTeam(teamId, data) {
  const { name, maxDomains } = data;

  await this.execute(`
    UPDATE teams
    SET
      name = COALESCE(?, name),
      max_domains = COALESCE(?, max_domains),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [name ?? null, maxDomains ?? null, teamId]);
  return this.getTeamById(teamId);
}

// Update team logo
async updateTeamLogo(teamId, logoUrl) {
  await this.execute(`
    UPDATE teams
    SET
      logo_url = ?,
      logo_updated_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [logoUrl, teamId]);
  return this.getTeamById(teamId);
}

// Delete team (cascades to team_members and removes team_id from domains)
async deleteTeam(teamId) {
  return this.execute('DELETE FROM teams WHERE id = ?', [teamId]);
}

// Add a user to a team
async addTeamMember(teamId, userId, role = 'member', permissions = {}) {
  const { canManageDomains = 0, canManageMembers = 0, canManageSettings = 0 } = permissions;

  try {
    await this.execute(`
      INSERT INTO team_members (team_id, user_id, role, can_manage_domains, can_manage_members, can_manage_settings)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      teamId,
      userId,
      role,
      canManageDomains ? 1 : 0,
      canManageMembers ? 1 : 0,
      canManageSettings ? 1 : 0
    ]);
    return { success: true };
  } catch (err) {
    if (err.code === '23505') {
      return { success: false, error: 'User is already a member of this team' };
    }
    throw err;
  }
}

// Update team member permissions
async updateTeamMemberPermissions(teamId, userId, permissions) {
  const { canManageDomains, canManageMembers, canManageSettings } = permissions;

  await this.execute(`
    UPDATE team_members
    SET can_manage_domains = ?,
        can_manage_members = ?,
        can_manage_settings = ?
    WHERE team_id = ? AND user_id = ?
  `, [
    canManageDomains ? 1 : 0,
    canManageMembers ? 1 : 0,
    canManageSettings ? 1 : 0,
    teamId,
    userId
  ]);

  const members = await this.getTeamMembers(teamId);
  return members.find(m => m.user_id === userId);
}

// Check if user has specific permission in team
async hasTeamPermission(teamId, userId, permission) {
  const result = await this.queryOne(`
    SELECT role, ${permission} as has_permission FROM team_members
    WHERE team_id = ? AND user_id = ?
  `, [teamId, userId]);

  if (!result) return false;
  if (result.role === 'owner') return true; // Owner has all permissions
  return Boolean(result.has_permission); // INTEGER 0/1 from PostgreSQL → boolean
}

// Remove a user from a team
async removeTeamMember(teamId, userId) {
  return this.execute(`
    DELETE FROM team_members
    WHERE team_id = ? AND user_id = ?
  `, [teamId, userId]);
}

// Get all members of a team with their user information
getTeamMembers(teamId) {
  return this.queryAll(`
    SELECT
      tm.*,
      u.username,
      u.display_name,
      u.avatar_url,
      u.email,
      u.max_domains,
      u.is_active
    FROM team_members tm
    JOIN users u ON tm.user_id = u.id
    WHERE tm.team_id = ?
    ORDER BY
      CASE tm.role
        WHEN 'owner' THEN 1
        WHEN 'member' THEN 2
      END,
      tm.joined_at ASC
  `, [teamId]);
}

// Get a specific team member's role
async getTeamMemberRole(teamId, userId) {
  const result = await this.queryOne(`
    SELECT role FROM team_members
    WHERE team_id = ? AND user_id = ?
  `, [teamId, userId]);
  return result ? result.role : null;
}

// Check if user is a member of a team
async isTeamMember(teamId, userId) {
  const result = await this.queryOne(`
    SELECT COUNT(*) as count FROM team_members
    WHERE team_id = ? AND user_id = ?
  `, [teamId, userId]);
  return Number(result?.count || 0) > 0;
}

// Calculate team's total domain quota (sum of all members' max_domains).
// -1 means unlimited (same convention as users.max_domains) — returned
// as-is (not summed in) so a single unlimited member makes the whole team
// unlimited instead of silently corrupting the SUM with a negative value.
async getTeamDomainQuota(teamId) {
  // If team has a custom max_domains set, use that
  const team = await this.getTeamById(teamId);
  if (team && team.max_domains !== null && team.max_domains !== undefined) {
    return Number(team.max_domains);
  }

  const rows = await this.queryAll(`
    SELECT u.max_domains
    FROM team_members tm
    JOIN users u ON tm.user_id = u.id
    WHERE tm.team_id = ?
  `, [teamId]);
  if (rows.some((r) => Number(r.max_domains) === -1)) return -1;
  return rows.reduce((sum, r) => sum + Number(r.max_domains || 0), 0);
}

// Count domains owned by a team
async getTeamDomainCount(teamId) {
  const result = await this.queryOne(`
    SELECT COUNT(*) as count FROM domains
    WHERE team_id = ?
  `, [teamId]);
  return Number(result?.count || 0);
}

// Check if team can add more domains
async canTeamAddDomain(teamId) {
  const quota = await this.getTeamDomainQuota(teamId);
  if (quota === -1) return true;
  const current = await this.getTeamDomainCount(teamId);
  return current < quota;
}

// Get domains by team ID
getDomainsByTeamId(teamId) {
  return this.queryAll(`
    SELECT
      d.*,
      u.username,
      u.display_name as user_display_name
    FROM domains d
    JOIN users u ON d.user_id = u.id
    WHERE d.team_id = ?
    ORDER BY d.created_at DESC
  `, [teamId]);
}

// Get all domains accessible by a user (personal + team domains)
async getDomainsByUserIdWithTeams(userId) {
  const domains = await this.queryAll(`
    SELECT
      d.*,
      u.username,
      u.display_name as user_display_name,
      t.name as team_name,
      CASE
        WHEN d.team_id IS NULL THEN 'personal'
        ELSE 'team'
      END as ownership_type,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', dg.id,
              'name', dg.name,
              'color', dg.color,
              'icon', dg.icon
            )
          )
          FROM domain_group_assignments dga
          JOIN domain_groups dg ON dga.group_id = dg.id
          WHERE dga.domain_id = d.id
            AND dg.is_active = TRUE
        ),
        '[]'::json
      ) as groups
    FROM domains d
    JOIN users u ON d.user_id = u.id
    LEFT JOIN teams t ON d.team_id = t.id
    WHERE d.user_id = $1
       OR d.team_id IN (
         SELECT team_id FROM team_members WHERE user_id = $2
       )
    ORDER BY d.created_at DESC
  `, [userId, userId]);

  // Convert groups from JSON string to array if needed
  return domains.map(domain => ({
    ...domain,
    groups: typeof domain.groups === 'string' ? JSON.parse(domain.groups) : domain.groups
  }));
}

// Assign domain to team
async assignDomainToTeam(domainId, teamId) {
  await this.execute(`
    UPDATE domains
    SET team_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [teamId, domainId]);
  return this.getDomainById(domainId);
}

// Remove domain from team (make it personal)
async removeDomainFromTeam(domainId) {
  await this.execute(`
    UPDATE domains
    SET team_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [domainId]);
  return this.getDomainById(domainId);
}

// ===== TEAM INVITATION METHODS =====

// Create a team invitation
async createTeamInvitation(teamId, inviterId, invitedUserId, permissions = {}) {
  const { canManageDomains = 0, canManageMembers = 0, canManageSettings = 0 } = permissions;

  // Check if there's already a pending invitation
  const pendingInvitation = await this.queryOne(`
    SELECT id FROM team_invitations
    WHERE team_id = ? AND invited_user_id = ? AND status = 'pending'
  `, [teamId, invitedUserId]);

  if (pendingInvitation) {
    return { success: false, error: 'Invitation already sent to this user' };
  }

  // Delete any old invitations (accepted/rejected) to allow re-invitation
  await this.execute(`
    DELETE FROM team_invitations
    WHERE team_id = ? AND invited_user_id = ? AND status != 'pending'
  `, [teamId, invitedUserId]);

  // Create the new invitation
  await this.execute(`
    INSERT INTO team_invitations (team_id, inviter_id, invited_user_id, can_manage_domains, can_manage_members, can_manage_settings)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    teamId,
    inviterId,
    invitedUserId,
    canManageDomains ? 1 : 0,
    canManageMembers ? 1 : 0,
    canManageSettings ? 1 : 0
  ]);

  return { success: true };
}

// Get all pending invitations for a user
getUserPendingInvitations(userId) {
  return this.queryAll(`
    SELECT
      ti.*,
      t.name as team_name,
      t.owner_id,
      inviter.username as inviter_username,
      inviter.display_name as inviter_display_name
    FROM team_invitations ti
    JOIN teams t ON ti.team_id = t.id
    JOIN users inviter ON ti.inviter_id = inviter.id
    WHERE ti.invited_user_id = ? AND ti.status = 'pending'
    ORDER BY ti.created_at DESC
  `, [userId]);
}

// Get all invitations for a team
getTeamInvitations(teamId) {
  return this.queryAll(`
    SELECT
      ti.*,
      invited.username as invited_username,
      invited.display_name as invited_display_name,
      invited.email as invited_email,
      inviter.username as inviter_username,
      inviter.display_name as inviter_display_name
    FROM team_invitations ti
    JOIN users invited ON ti.invited_user_id = invited.id
    JOIN users inviter ON ti.inviter_id = inviter.id
    WHERE ti.team_id = ?
    ORDER BY ti.created_at DESC
  `, [teamId]);
}

// Accept a team invitation
async acceptTeamInvitation(invitationId, userId) {
  const invitation = await this.queryOne('SELECT * FROM team_invitations WHERE id = ?', [invitationId]);

  if (!invitation) {
    return { success: false, error: 'Invitation not found' };
  }

  if (invitation.invited_user_id !== userId) {
    return { success: false, error: 'Unauthorized' };
  }

  if (invitation.status !== 'pending') {
    return { success: false, error: 'Invitation already responded to' };
  }

  // Update invitation status
  await this.execute(`
    UPDATE team_invitations
    SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [invitationId]);

  // Add user to team with permissions from invitation
  const addResult = await this.addTeamMember(invitation.team_id, userId, 'member', {
    canManageDomains: invitation.can_manage_domains,
    canManageMembers: invitation.can_manage_members,
    canManageSettings: invitation.can_manage_settings
  });

  if (!addResult.success) {
    return addResult;
  }

  return { success: true, teamId: invitation.team_id };
}

// Reject a team invitation
async rejectTeamInvitation(invitationId, userId) {
  const invitation = await this.queryOne('SELECT * FROM team_invitations WHERE id = ?', [invitationId]);

  if (!invitation) {
    return { success: false, error: 'Invitation not found' };
  }

  if (invitation.invited_user_id !== userId) {
    return { success: false, error: 'Unauthorized' };
  }

  if (invitation.status !== 'pending') {
    return { success: false, error: 'Invitation already responded to' };
  }

  await this.execute(`
    UPDATE team_invitations
    SET status = 'rejected', responded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [invitationId]);

  return { success: true };
}

// Cancel a team invitation (by inviter or team owner)
async cancelTeamInvitation(invitationId) {
  await this.execute('DELETE FROM team_invitations WHERE id = ?', [invitationId]);
  return { success: true };
}

// Count pending invitations for a user
async countUserPendingInvitations(userId) {
  const result = await this.queryOne(`
    SELECT COUNT(*) as count FROM team_invitations
    WHERE invited_user_id = ? AND status = 'pending'
  `, [userId]);
  return Number(result?.count || 0);
}
}
