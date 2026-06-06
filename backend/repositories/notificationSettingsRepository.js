// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class NotificationSettingsRepository {
// ===== NOTIFICATION SETTINGS METHODS =====

async getNotificationSettings(userId) {
  return this.queryOne('SELECT * FROM notification_settings WHERE user_id = ?', [userId]);
}

async upsertNotificationSettings(userId, settings) {
  const { notificationsEnabled, emailEnabled } = settings;

  const existing = await this.getNotificationSettings(userId);

  if (existing) {
    await this.execute(`
      UPDATE notification_settings
      SET notifications_enabled = ?,
          email_enabled = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [notificationsEnabled ? true : false, emailEnabled ? true : false, userId]);
  } else {
    await this.execute(`
      INSERT INTO notification_settings (user_id, notifications_enabled, email_enabled)
      VALUES (?, ?, ?)
    `, [userId, notificationsEnabled ? true : false, emailEnabled ? true : false]);
  }

  return this.getNotificationSettings(userId);
}

async getTeamNotificationSettings(teamId) {
  return this.queryOne('SELECT * FROM team_notification_settings WHERE team_id = ?', [teamId]);
}

async upsertTeamNotificationSettings(teamId, settings) {
  const { notificationsEnabled, emailEnabled } = settings;
  const existing = await this.getTeamNotificationSettings(teamId);

  if (existing) {
    await this.execute(`
      UPDATE team_notification_settings
      SET notifications_enabled = ?,
          email_enabled = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE team_id = ?
    `, [notificationsEnabled ? true : false, emailEnabled ? true : false, teamId]);
  } else {
    await this.execute(`
      INSERT INTO team_notification_settings (team_id, notifications_enabled, email_enabled)
      VALUES (?, ?, ?)
    `, [teamId, notificationsEnabled ? true : false, emailEnabled ? true : false]);
  }

  return this.getTeamNotificationSettings(teamId);
}
}
