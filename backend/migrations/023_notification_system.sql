-- Notification System Tables
-- Tracks sent notifications to prevent spam and enable throttling

-- Notification tracking (prevent duplicates and spam)
CREATE TABLE IF NOT EXISTS notification_tracking (
  id SERIAL PRIMARY KEY,
  notification_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  recipient_type VARCHAR(20) NOT NULL, -- 'admin' or 'user'
  recipient_id INTEGER,
  last_sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  send_count INTEGER DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_tracking_lookup
  ON notification_tracking(notification_type, entity_type, entity_id, recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_tracking_last_sent
  ON notification_tracking(last_sent_at);

-- Notification preferences (admin)
CREATE TABLE IF NOT EXISTS admin_notification_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- SSL Notifications
  ssl_expiring_enabled BOOLEAN DEFAULT TRUE,
  ssl_expiring_days INTEGER DEFAULT 7,
  ssl_renewed_enabled BOOLEAN DEFAULT TRUE,
  ssl_failed_enabled BOOLEAN DEFAULT TRUE,

  -- Health Monitoring
  domain_down_enabled BOOLEAN DEFAULT TRUE,
  domain_up_enabled BOOLEAN DEFAULT TRUE,
  backend_down_enabled BOOLEAN DEFAULT TRUE,
  backend_up_enabled BOOLEAN DEFAULT TRUE,
  high_response_time_enabled BOOLEAN DEFAULT TRUE,
  high_response_time_threshold INTEGER DEFAULT 2000, -- ms

  -- System Resources
  high_cpu_enabled BOOLEAN DEFAULT TRUE,
  high_cpu_threshold INTEGER DEFAULT 80, -- %
  high_memory_enabled BOOLEAN DEFAULT TRUE,
  high_memory_threshold INTEGER DEFAULT 85, -- %
  low_disk_enabled BOOLEAN DEFAULT TRUE,
  low_disk_threshold INTEGER DEFAULT 10, -- %

  -- Services
  service_stopped_enabled BOOLEAN DEFAULT TRUE,
  service_started_enabled BOOLEAN DEFAULT FALSE,

  -- Security
  failed_login_enabled BOOLEAN DEFAULT TRUE,
  failed_login_threshold INTEGER DEFAULT 5,
  new_ip_login_enabled BOOLEAN DEFAULT TRUE,
  unauthorized_access_enabled BOOLEAN DEFAULT TRUE,

  -- Database
  backup_created_enabled BOOLEAN DEFAULT FALSE,
  backup_failed_enabled BOOLEAN DEFAULT TRUE,
  database_issue_enabled BOOLEAN DEFAULT TRUE,

  -- Throttling settings
  throttle_minutes INTEGER DEFAULT 15, -- Don't send same notification within X minutes
  aggregate_similar BOOLEAN DEFAULT TRUE, -- Aggregate similar notifications

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id)
);

-- Notification preferences (user)
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Webhook configuration
  webhook_enabled BOOLEAN DEFAULT FALSE,
  webhook_url TEXT,
  webhook_secret VARCHAR(255),

  -- Domain Notifications
  domain_added_enabled BOOLEAN DEFAULT TRUE,
  domain_deleted_enabled BOOLEAN DEFAULT TRUE,
  domain_updated_enabled BOOLEAN DEFAULT FALSE,
  domain_down_enabled BOOLEAN DEFAULT TRUE,
  domain_up_enabled BOOLEAN DEFAULT TRUE,
  backend_down_enabled BOOLEAN DEFAULT TRUE,
  backend_up_enabled BOOLEAN DEFAULT TRUE,
  high_response_time_enabled BOOLEAN DEFAULT TRUE,
  high_response_time_threshold INTEGER DEFAULT 2000,

  -- SSL Notifications
  ssl_expiring_enabled BOOLEAN DEFAULT TRUE,
  ssl_expiring_days INTEGER DEFAULT 7,
  ssl_renewed_enabled BOOLEAN DEFAULT TRUE,
  ssl_failed_enabled BOOLEAN DEFAULT TRUE,

  -- Quota Notifications
  quota_warning_enabled BOOLEAN DEFAULT TRUE,
  quota_warning_threshold INTEGER DEFAULT 80, -- % of quota
  quota_reached_enabled BOOLEAN DEFAULT TRUE,

  -- Redirections
  redirection_created_enabled BOOLEAN DEFAULT FALSE,
  redirection_deleted_enabled BOOLEAN DEFAULT FALSE,

  -- API Keys
  api_key_created_enabled BOOLEAN DEFAULT TRUE,
  api_key_deleted_enabled BOOLEAN DEFAULT TRUE,
  api_key_expiring_enabled BOOLEAN DEFAULT TRUE,

  -- Account
  new_ip_login_enabled BOOLEAN DEFAULT TRUE,
  account_disabled_enabled BOOLEAN DEFAULT TRUE,

  -- Throttling settings
  throttle_minutes INTEGER DEFAULT 15,
  aggregate_similar BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id)
);

-- System notification state (for persistent monitoring)
CREATE TABLE IF NOT EXISTS notification_states (
  id SERIAL PRIMARY KEY,
  state_key VARCHAR(255) NOT NULL UNIQUE, -- e.g., 'domain_down_123', 'high_cpu'
  state_value VARCHAR(50) NOT NULL, -- e.g., 'down', 'up', 'alert', 'ok'
  last_notification_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_states_key ON notification_states(state_key);
