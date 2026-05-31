// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class NotificationRepository {
// ===== NOTIFICATION METHODS =====

/**
 * Create a team notification for a specific user
 */
async createTeamNotification(data) {
  const { userId, teamId, actorId, actionType, entityType, entityId, entityName, message } = data;

  await this.execute(`
    INSERT INTO notifications (user_id, team_id, actor_id, action_type, entity_type, entity_id, entity_name, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [userId, teamId, actorId, actionType, entityType, entityId, entityName, message]);
}

/**
 * Create notifications for all team members except the actor
 */
async createTeamNotificationForMembers(data) {
  const { teamId, actorId, actionType, entityType, entityId, entityName, message } = data;

  // Get all team members except the actor
  const members = await this.queryAll(`
    SELECT DISTINCT user_id
    FROM team_members
    WHERE team_id = ? AND user_id != ?
  `, [teamId, actorId]);

  // Create notification for each member
  for (const member of members) {
    await this.createTeamNotification({
      userId: member.user_id,
      teamId,
      actorId,
      actionType,
      entityType,
      entityId,
      entityName,
      message
    });
  }
}

/**
 * Get user's notifications
 */
async getUserNotifications(userId, limit = 50, offset = 0) {
  return this.queryAll(`
    SELECT
      n.*,
      u.username as actor_username,
      u.display_name as actor_display_name,
      t.name as team_name
    FROM notifications n
    LEFT JOIN users u ON n.actor_id = u.id
    LEFT JOIN teams t ON n.team_id = t.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `, [userId, limit, offset]);
}

/**
 * Get unread notification count
 */
async getUnreadNotificationCount(userId) {
  const result = await this.queryOne(`
    SELECT COUNT(*) as count
    FROM notifications
    WHERE user_id = ? AND read_at IS NULL
  `, [userId]);
  return parseInt(result?.count || 0, 10);
}

/**
 * Mark notification as read
 */
async markNotificationAsRead(notificationId, userId) {
  await this.execute(`
    UPDATE notifications
    SET read_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND read_at IS NULL
  `, [notificationId, userId]);
}

/**
 * Mark all notifications as read
 */
async markAllNotificationsAsRead(userId) {
  await this.execute(`
    UPDATE notifications
    SET read_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND read_at IS NULL
  `, [userId]);
}

/**
 * Delete old read notifications (cleanup)
 */
async deleteOldNotifications(days = 30) {
  const result = await this.execute(`
    DELETE FROM notifications
    WHERE read_at IS NOT NULL
    AND read_at < (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
  `, [days]);
  return { deleted: result.rowCount || 0 };
}
}
