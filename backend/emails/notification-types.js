/**
 * Notification Types Configuration
 * Defines who receives what type of notification
 */

export const NOTIFICATION_TYPES = {
  // ============================================================================
  // USER NOTIFICATIONS (sent to individual users)
  // ============================================================================

  // Security & Account
  security: {
    label: 'Security Alerts',
    description: 'New logins, password changes, suspicious activity',
    recipients: 'user',
    userPreference: true,
    examples: ['new-ip-login', 'password-changed', 'api-key-created']
  },

  new_ip_login: {
    label: 'New IP Login',
    description: 'Alert when logging in from unknown IP address',
    recipients: 'user',
    userPreference: true,
    template: 'new-ip-login'
  },

  password_changes: {
    label: 'Password Changes',
    description: 'Confirmation when password is changed',
    recipients: 'user',
    userPreference: true,
    template: 'password-changed'
  },

  // Domain Alerts
  domain_alerts: {
    label: 'Domain Alerts',
    description: 'Domain up/down notifications',
    recipients: 'domain_owner',
    userPreference: true,
    examples: ['domain-down', 'domain-restored']
  },

  // SSL Certificates
  ssl_alerts: {
    label: 'SSL Alerts',
    description: 'SSL certificate expiration warnings',
    recipients: 'domain_owner',
    userPreference: true,
    template: 'ssl-expiring'
  },

  // Team Notifications
  team_alerts: {
    label: 'Team Alerts',
    description: 'Team domain issues, invitations, member changes',
    recipients: 'team_members',
    userPreference: true,
    examples: ['team-domain-down', 'team-invitation']
  },

  // Quota & Limits
  quota_warnings: {
    label: 'Quota Warnings',
    description: 'Alerts when approaching domain quota limits',
    recipients: 'user',
    userPreference: true,
    template: 'quota-warning'
  },

  // ============================================================================
  // ADMIN-ONLY NOTIFICATIONS (sent only to admins)
  // ============================================================================

  system_alerts: {
    label: 'System Alerts',
    description: 'Critical system issues, errors, failures',
    recipients: 'admins_only',
    userPreference: false,
    adminOnly: true,
    examples: ['critical errors', 'service failures']
  },

  backup_alerts: {
    label: 'Backup Alerts',
    description: 'Backup success/failure notifications',
    recipients: 'admins_only',
    userPreference: false,
    adminOnly: true,
    template: 'backup-failed'
  },

  high_resources: {
    label: 'High Resource Usage',
    description: 'CPU, RAM, Disk usage alerts',
    recipients: 'admins_only',
    userPreference: false,
    adminOnly: true,
    template: 'high-resources'
  },

  update_available: {
    label: 'Updates Available',
    description: 'System update notifications',
    recipients: 'admins_only',
    userPreference: false,
    adminOnly: true
  },

  database_issues: {
    label: 'Database Issues',
    description: 'Database connection, performance, backup issues',
    recipients: 'admins_only',
    userPreference: false,
    adminOnly: true
  },

  critical_errors: {
    label: 'Critical Errors',
    description: 'Unhandled exceptions, service crashes',
    recipients: 'admins_only',
    userPreference: false,
    adminOnly: true
  }
};

/**
 * Get all admin-only notification types
 */
export function getAdminOnlyTypes() {
  return Object.entries(NOTIFICATION_TYPES)
    .filter(([_, config]) => config.adminOnly === true)
    .map(([type]) => type);
}

/**
 * Get all user-configurable notification types
 */
export function getUserConfigurableTypes() {
  return Object.entries(NOTIFICATION_TYPES)
    .filter(([_, config]) => config.userPreference === true)
    .map(([type]) => type);
}

/**
 * Check if notification type is admin-only
 */
export function isAdminOnly(notificationType) {
  return NOTIFICATION_TYPES[notificationType]?.adminOnly === true;
}

/**
 * Get default user preferences
 */
export function getDefaultUserPreferences() {
  const defaults = {};

  Object.entries(NOTIFICATION_TYPES).forEach(([type, config]) => {
    if (config.userPreference === true) {
      // Default to true for security and domain alerts
      // Default to false for less critical notifications
      defaults[type] = ['security', 'domain_alerts', 'ssl_alerts', 'new_ip_login'].includes(type);
    }
  });

  return defaults;
}

export default NOTIFICATION_TYPES;
