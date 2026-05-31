// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class DomainGroupRepository {
// ===== DOMAIN GROUPS METHODS =====

/**
 * Create a new domain group (personal or team)
 */
async createDomainGroup(groupData) {
  const { name, description, color, icon, userId, teamId, createdBy } = groupData;

  // Validate: must be either personal OR team
  if ((userId && teamId) || (!userId && !teamId)) {
    throw new Error('Group must be either personal or team-owned');
  }

  const result = await this.execute(`
    INSERT INTO domain_groups (name, description, color, icon, user_id, team_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `, [name, description || null, color || '#9D4EDD', icon || null, userId || null, teamId || null, createdBy]);

  return this.getDomainGroupById(result.rows[0].id);
}

/**
 * Get domain group by ID with ownership info
 */
getDomainGroupById(groupId) {
  return this.queryOne(`
    SELECT
      dg.*,
      u.username as owner_username,
      u.display_name as owner_display_name,
      t.name as team_name,
      creator.username as created_by_username,
      creator.display_name as created_by_display_name,
      CASE
        WHEN dg.user_id IS NOT NULL THEN 'personal'
        ELSE 'team'
      END as ownership_type
    FROM domain_groups dg
    LEFT JOIN users u ON dg.user_id = u.id
    LEFT JOIN teams t ON dg.team_id = t.id
    LEFT JOIN users creator ON dg.created_by = creator.id
    WHERE dg.id = ?
  `, [groupId]);
}

/**
 * Get all groups accessible by a user (personal + team groups)
 */
getDomainGroupsByUserId(userId) {
  return this.queryAll(`
    SELECT
      dg.*,
      u.username as owner_username,
      u.display_name as owner_display_name,
      t.name as team_name,
      creator.username as created_by_username,
      CASE
        WHEN dg.user_id IS NOT NULL THEN 'personal'
        ELSE 'team'
      END as ownership_type,
      COUNT(DISTINCT CASE
        WHEN d.team_id IS NOT NULL OR d.user_id = ? THEN dga.domain_id
        ELSE NULL
      END) as domain_count,
      CASE
        WHEN dg.user_id = ? THEN TRUE
        WHEN dg.team_id IS NOT NULL THEN
          EXISTS(SELECT 1 FROM team_members tm WHERE tm.team_id = dg.team_id AND tm.user_id = ? AND tm.role = 'owner')
        ELSE FALSE
      END as is_owner
    FROM domain_groups dg
    LEFT JOIN users u ON dg.user_id = u.id
    LEFT JOIN teams t ON dg.team_id = t.id
    LEFT JOIN users creator ON dg.created_by = creator.id
    LEFT JOIN domain_group_assignments dga ON dg.id = dga.group_id
    LEFT JOIN domains d ON dga.domain_id = d.id
    WHERE (
      dg.user_id = ?  -- Personal groups
      OR dg.team_id IN (  -- Team groups where user is member
        SELECT team_id FROM team_members WHERE user_id = ?
      )
    ) AND dg.is_active = TRUE
    GROUP BY dg.id, u.id, t.id, creator.id
    ORDER BY dg.created_at DESC
  `, [userId, userId, userId, userId, userId]);
}

/**
 * Get groups by team ID
 */
getDomainGroupsByTeamId(teamId) {
  return this.queryAll(`
    SELECT
      dg.*,
      t.name as team_name,
      creator.username as created_by_username,
      COUNT(DISTINCT dga.domain_id) as domain_count
    FROM domain_groups dg
    LEFT JOIN teams t ON dg.team_id = t.id
    LEFT JOIN users creator ON dg.created_by = creator.id
    LEFT JOIN domain_group_assignments dga ON dg.id = dga.group_id
    WHERE dg.team_id = ? AND dg.is_active = TRUE
    GROUP BY dg.id, t.id, creator.id
    ORDER BY dg.created_at DESC
  `, [teamId]);
}

/**
 * Update domain group
 */
async updateDomainGroup(groupId, updates) {
  const { name, description, color, icon, isActive } = updates;

  await this.execute(`
    UPDATE domain_groups
    SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      color = COALESCE(?, color),
      icon = COALESCE(?, icon),
      is_active = COALESCE(?, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    name ?? null,
    description ?? null,
    color ?? null,
    icon ?? null,
    isActive !== undefined ? isActive : null,
    groupId
  ]);

  return this.getDomainGroupById(groupId);
}

/**
 * Delete domain group
 */
async deleteDomainGroup(groupId) {
  return this.execute('DELETE FROM domain_groups WHERE id = ?', [groupId]);
}

/**
 * Get domain's current group assignment (if any)
 */
getDomainGroupAssignment(domainId) {
  return this.queryOne(`
    SELECT dga.*, dg.name as group_name
    FROM domain_group_assignments dga
    JOIN domain_groups dg ON dga.group_id = dg.id
    WHERE dga.domain_id = ?
  `, [domainId]);
}

/**
 * Assign domain to group
 */
async assignDomainToGroup(domainId, groupId, assignedBy) {
  try {
    await this.execute(`
      INSERT INTO domain_group_assignments (domain_id, group_id, assigned_by)
      VALUES (?, ?, ?)
    `, [domainId, groupId, assignedBy]);
    return { success: true };
  } catch (err) {
    if (err.code === '23505') { // Unique constraint violation
      return { success: false, error: 'Domain already in this group' };
    }
    throw err;
  }
}

/**
 * Remove domain from group
 */
async removeDomainFromGroup(domainId, groupId) {
  return this.execute(`
    DELETE FROM domain_group_assignments
    WHERE domain_id = ? AND group_id = ?
  `, [domainId, groupId]);
}

/**
 * Get all domains in a group
 */
getDomainsInGroup(groupId, userId = null) {
  // If userId is provided, filter personal domains (only show if owned by user)
  // Team domains are visible to all team members
  const userFilter = userId ? `
    AND (
      d.team_id IS NOT NULL  -- Team domains visible to all
      OR d.user_id = ?       -- Personal domains only visible to owner
    )
  ` : '';

  const params = userId ? [groupId, userId] : [groupId];

  return this.queryAll(`
    SELECT
      d.*,
      u.username,
      u.display_name as user_display_name,
      t.name as team_name,
      dga.assigned_at,
      assigner.username as assigned_by_username,
      CASE
        WHEN d.team_id IS NULL THEN 'personal'
        ELSE 'team'
      END as ownership_type
    FROM domains d
    JOIN domain_group_assignments dga ON d.id = dga.domain_id
    JOIN users u ON d.user_id = u.id
    LEFT JOIN teams t ON d.team_id = t.id
    LEFT JOIN users assigner ON dga.assigned_by = assigner.id
    WHERE dga.group_id = ?
    ${userFilter}
    ORDER BY dga.assigned_at DESC
  `, params);
}

/**
 * Get all groups a domain belongs to
 */
getGroupsForDomain(domainId) {
  return this.queryAll(`
    SELECT
      dg.*,
      u.username as owner_username,
      t.name as team_name,
      dga.assigned_at,
      CASE
        WHEN dg.user_id IS NOT NULL THEN 'personal'
        ELSE 'team'
      END as ownership_type
    FROM domain_groups dg
    JOIN domain_group_assignments dga ON dg.id = dga.group_id
    LEFT JOIN users u ON dg.user_id = u.id
    LEFT JOIN teams t ON dg.team_id = t.id
    WHERE dga.domain_id = ? AND dg.is_active = TRUE
    ORDER BY dga.assigned_at DESC
  `, [domainId]);
}

/**
 * Check if user has permission to manage a group
 */
async hasGroupPermission(groupId, userId, permission) {
  const group = await this.getDomainGroupById(groupId);
  if (!group) return false;

  // Personal group: only owner can manage
  if (group.user_id) {
    return group.user_id === userId;
  }

  // Team group: check team permissions
  if (group.team_id) {
    // Team owner has all permissions
    const teamRole = await this.getTeamMemberRole(group.team_id, userId);
    if (teamRole === 'owner') return true;

    // Check specific group member permissions
    const member = await this.queryOne(`
      SELECT ${permission} as has_permission
      FROM domain_group_members
      WHERE group_id = ? AND user_id = ?
    `, [groupId, userId]);

    return member ? member.has_permission === true : false;
  }

  return false;
}

/**
 * Add member to team group with permissions
 */
async addGroupMember(groupId, userId, permissions, addedBy) {
  const { canManageGroup = false, canAssignDomains = false, canViewDomains = true } = permissions;

  try {
    await this.execute(`
      INSERT INTO domain_group_members (group_id, user_id, can_manage_group, can_assign_domains, can_view_domains, added_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [groupId, userId, canManageGroup, canAssignDomains, canViewDomains, addedBy]);
    return { success: true };
  } catch (err) {
    if (err.code === '23505') {
      return { success: false, error: 'User already has access to this group' };
    }
    throw err;
  }
}

/**
 * Update group member permissions
 */
async updateGroupMemberPermissions(groupId, userId, permissions) {
  const { canManageGroup, canAssignDomains, canViewDomains } = permissions;

  await this.execute(`
    UPDATE domain_group_members
    SET can_manage_group = ?,
        can_assign_domains = ?,
        can_view_domains = ?
    WHERE group_id = ? AND user_id = ?
  `, [canManageGroup, canAssignDomains, canViewDomains, groupId, userId]);

  return this.getGroupMembers(groupId).then(members =>
    members.find(m => m.user_id === userId)
  );
}

/**
 * Remove member from group
 */
async removeGroupMember(groupId, userId) {
  return this.execute(`
    DELETE FROM domain_group_members
    WHERE group_id = ? AND user_id = ?
  `, [groupId, userId]);
}

/**
 * Get all members of a group
 */
getGroupMembers(groupId) {
  return this.queryAll(`
    SELECT
      dgm.*,
      u.username,
      u.display_name,
      u.avatar_url,
      u.email
    FROM domain_group_members dgm
    JOIN users u ON dgm.user_id = u.id
    WHERE dgm.group_id = ?
    ORDER BY dgm.added_at ASC
  `, [groupId]);
}

/**
 * Bulk assign multiple domains to a group
 */
async bulkAssignDomainsToGroup(domainIds, groupId, assignedBy) {
  const results = {
    success: [],
    failed: []
  };

  for (const domainId of domainIds) {
    try {
      const result = await this.assignDomainToGroup(domainId, groupId, assignedBy);
      if (result.success) {
        results.success.push(domainId);
      } else {
        results.failed.push({ domainId, error: result.error });
      }
    } catch (err) {
      results.failed.push({ domainId, error: err.message });
    }
  }

  return results;
}

/**
 * Get domains with their groups (enriched query for domain list)
 */
getDomainsWithGroups(userId) {
  return this.queryAll(`
    SELECT
      d.*,
      u.username,
      u.display_name as user_display_name,
      t.name as team_name,
      CASE
        WHEN d.team_id IS NULL THEN 'personal'
        ELSE 'team'
      END as ownership_type,
      json_agg(
        DISTINCT jsonb_build_object(
          'id', dg.id,
          'name', dg.name,
          'color', dg.color,
          'icon', dg.icon
        )
      ) FILTER (WHERE dg.id IS NOT NULL) as groups
    FROM domains d
    JOIN users u ON d.user_id = u.id
    LEFT JOIN teams t ON d.team_id = t.id
    LEFT JOIN domain_group_assignments dga ON d.id = dga.domain_id
    LEFT JOIN domain_groups dg ON dga.group_id = dg.id AND dg.is_active = TRUE
    WHERE d.user_id = ?
       OR d.team_id IN (
         SELECT team_id FROM team_members WHERE user_id = ?
       )
    GROUP BY d.id, u.id, t.id
    ORDER BY d.created_at DESC
  `, [userId, userId]);
}
}
