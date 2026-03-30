import { pool } from '../config/database.js';

/**
 * Notification Manager
 * Handles throttling, deduplication, and intelligent notification sending
 */
class NotificationManager {
  constructor() {
    this.pendingNotifications = new Map(); // For aggregation
    this.aggregationInterval = null;
  }

  /**
   * Start aggregation timer (sends aggregated notifications every minute)
   */
  startAggregation() {
    if (this.aggregationInterval) return;

    this.aggregationInterval = setInterval(async () => {
      await this.flushAggregatedNotifications();
    }, 60000); // Every minute
  }

  /**
   * Stop aggregation timer
   */
  stopAggregation() {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
  }

  /**
   * Check if a notification should be sent (throttling check)
   */
  async shouldSendNotification(notificationType, entityType, entityId, recipientType, recipientId, throttleMinutes = 15) {
    try {
      const result = await pool.query(
        `SELECT last_sent_at, send_count
         FROM notification_tracking
         WHERE notification_type = $1
           AND entity_type = $2
           AND entity_id = $3
           AND recipient_type = $4
           AND (recipient_id = $5 OR ($5 IS NULL AND recipient_id IS NULL))
         ORDER BY last_sent_at DESC
         LIMIT 1`,
        [notificationType, entityType, entityId, recipientType, recipientId]
      );

      if (result.rows.length === 0) {
        return true; // No previous notification, send it
      }

      const lastSent = new Date(result.rows[0].last_sent_at);
      const minutesSinceLastSent = (Date.now() - lastSent.getTime()) / 1000 / 60;

      return minutesSinceLastSent >= throttleMinutes;
    } catch (error) {
      console.error('[NotificationManager] Error checking throttle:', error);
      return true; // On error, allow sending
    }
  }

  /**
   * Track that a notification was sent
   */
  async trackNotification(notificationType, entityType, entityId, recipientType, recipientId, metadata = null) {
    try {
      await pool.query(
        `INSERT INTO notification_tracking
           (notification_type, entity_type, entity_id, recipient_type, recipient_id, metadata, last_sent_at, send_count)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
         ON CONFLICT ON CONSTRAINT notification_tracking_pkey
         DO UPDATE SET
           last_sent_at = NOW(),
           send_count = notification_tracking.send_count + 1,
           metadata = $6`,
        [notificationType, entityType, entityId, recipientType, recipientId, metadata ? JSON.stringify(metadata) : null]
      );
    } catch (error) {
      console.error('[NotificationManager] Error tracking notification:', error);
    }
  }

  /**
   * Get or set notification state (for state-based notifications like domain down/up)
   */
  async getState(stateKey) {
    try {
      const result = await pool.query(
        'SELECT state_value, metadata FROM notification_states WHERE state_key = $1',
        [stateKey]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error('[NotificationManager] Error getting state:', error);
      return null;
    }
  }

  /**
   * Set notification state
   */
  async setState(stateKey, stateValue, metadata = null) {
    try {
      await pool.query(
        `INSERT INTO notification_states (state_key, state_value, metadata, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (state_key)
         DO UPDATE SET
           state_value = $2,
           metadata = $3,
           updated_at = NOW()`,
        [stateKey, stateValue, metadata ? JSON.stringify(metadata) : null]
      );
    } catch (error) {
      console.error('[NotificationManager] Error setting state:', error);
    }
  }

  /**
   * Update last notification time for a state
   */
  async updateStateNotificationTime(stateKey) {
    try {
      await pool.query(
        'UPDATE notification_states SET last_notification_at = NOW() WHERE state_key = $1',
        [stateKey]
      );
    } catch (error) {
      console.error('[NotificationManager] Error updating state notification time:', error);
    }
  }

  /**
   * Check if state has changed and notification should be sent
   * Used for things like domain down/up to only send when state changes
   */
  async shouldSendStateChangeNotification(stateKey, newState) {
    const currentState = await this.getState(stateKey);

    if (!currentState) {
      // No previous state, send notification
      await this.setState(stateKey, newState);
      await this.updateStateNotificationTime(stateKey);
      return true;
    }

    if (currentState.state_value !== newState) {
      // State changed, send notification
      await this.setState(stateKey, newState);
      await this.updateStateNotificationTime(stateKey);
      return true;
    }

    // State unchanged, check if we should send a reminder
    if (currentState.last_notification_at) {
      const lastNotification = new Date(currentState.last_notification_at);
      const hoursSinceLastNotification = (Date.now() - lastNotification.getTime()) / 1000 / 60 / 60;

      // Send reminder every 24 hours for persistent issues
      if (hoursSinceLastNotification >= 24) {
        await this.updateStateNotificationTime(stateKey);
        return true;
      }
    }

    return false;
  }

  /**
   * Add notification to aggregation queue
   */
  addToAggregation(groupKey, notification) {
    if (!this.pendingNotifications.has(groupKey)) {
      this.pendingNotifications.set(groupKey, []);
    }

    this.pendingNotifications.get(groupKey).push(notification);
  }

  /**
   * Flush aggregated notifications
   */
  async flushAggregatedNotifications() {
    if (this.pendingNotifications.size === 0) return;

    for (const [groupKey, notifications] of this.pendingNotifications.entries()) {
      if (notifications.length === 0) continue;

      // Send aggregated notification
      console.log(`[NotificationManager] Sending ${notifications.length} aggregated notifications for ${groupKey}`);

      // TODO: Implement aggregated notification sending
      // This will be handled by the webhook services
    }

    this.pendingNotifications.clear();
  }

  /**
   * Get admin notification preferences
   */
  async getAdminPreferences(userId) {
    try {
      const result = await pool.query(
        'SELECT * FROM admin_notification_preferences WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        // Return defaults
        return this.getDefaultAdminPreferences();
      }

      return result.rows[0];
    } catch (error) {
      console.error('[NotificationManager] Error getting admin preferences:', error);
      return this.getDefaultAdminPreferences();
    }
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId) {
    try {
      const result = await pool.query(
        'SELECT * FROM user_notification_preferences WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        return null; // User webhooks not configured
      }

      return result.rows[0];
    } catch (error) {
      console.error('[NotificationManager] Error getting user preferences:', error);
      return null;
    }
  }

  /**
   * Get all admin users (for admin notifications)
   */
  async getAdminUsers() {
    try {
      const result = await pool.query(
        'SELECT id, username, display_name, email FROM users WHERE is_admin = TRUE AND is_active = TRUE'
      );

      return result.rows;
    } catch (error) {
      console.error('[NotificationManager] Error getting admin users:', error);
      return [];
    }
  }

  /**
   * Default admin preferences
   */
  getDefaultAdminPreferences() {
    return {
      ssl_expiring_enabled: true,
      ssl_expiring_days: 7,
      ssl_renewed_enabled: true,
      ssl_failed_enabled: true,
      domain_down_enabled: true,
      domain_up_enabled: true,
      backend_down_enabled: true,
      backend_up_enabled: true,
      high_response_time_enabled: true,
      high_response_time_threshold: 2000,
      high_cpu_enabled: true,
      high_cpu_threshold: 80,
      high_memory_enabled: true,
      high_memory_threshold: 85,
      low_disk_enabled: true,
      low_disk_threshold: 10,
      service_stopped_enabled: true,
      service_started_enabled: false,
      failed_login_enabled: true,
      failed_login_threshold: 5,
      new_ip_login_enabled: true,
      unauthorized_access_enabled: true,
      backup_created_enabled: false,
      backup_failed_enabled: true,
      database_issue_enabled: true,
      throttle_minutes: 15,
      aggregate_similar: true
    };
  }

  /**
   * Clean old tracking records (keep last 30 days)
   */
  async cleanOldTracking() {
    try {
      await pool.query(
        "DELETE FROM notification_tracking WHERE last_sent_at < NOW() - INTERVAL '30 days'"
      );
      console.log('[NotificationManager] Cleaned old tracking records');
    } catch (error) {
      console.error('[NotificationManager] Error cleaning old tracking:', error);
    }
  }
}

// Singleton instance
export const notificationManager = new NotificationManager();

// Start aggregation on module load
notificationManager.startAggregation();

// Clean old tracking daily
setInterval(() => {
  notificationManager.cleanOldTracking();
}, 24 * 60 * 60 * 1000);
