-- Migration 018: Complete Notification System
-- Date: 2026-02-04
-- Purpose: Add comprehensive notification system with user preferences, IP tracking, and email logs

-- ============================================================================
-- USER NOTIFICATION PREFERENCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_notification_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Preference categories (JSON for flexibility)
    preferences JSONB NOT NULL DEFAULT '{
        "security": true,
        "domain_alerts": true,
        "ssl_alerts": true,
        "team_alerts": true,
        "system_alerts": false,
        "backup_alerts": false,
        "quota_warnings": true,
        "password_changes": true,
        "new_ip_login": true
    }'::jsonb,

    -- Team notification preferences
    team_notifications_enabled BOOLEAN DEFAULT TRUE,

    -- Notification methods (for future extension)
    email_enabled BOOLEAN DEFAULT TRUE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Ensure one preference record per user
    UNIQUE(user_id)
);

-- Index for fast user lookups
CREATE INDEX idx_user_notification_prefs_user ON user_notification_preferences(user_id);

-- ============================================================================
-- USER LOGIN IP TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_login_ips (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address INET NOT NULL,

    -- Location data (optional, can be enriched with GeoIP)
    country VARCHAR(100),
    city VARCHAR(100),
    region VARCHAR(100),

    -- Device info
    user_agent TEXT,
    device_type VARCHAR(50), -- desktop, mobile, tablet, bot
    browser VARCHAR(100),
    os VARCHAR(100),

    -- Login tracking
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    login_count INTEGER DEFAULT 1,

    -- Trust status
    is_trusted BOOLEAN DEFAULT FALSE,
    alerted BOOLEAN DEFAULT FALSE, -- Whether alert was sent for first login

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX idx_user_login_ips_user ON user_login_ips(user_id);
CREATE INDEX idx_user_login_ips_ip ON user_login_ips(ip_address);
CREATE INDEX idx_user_login_ips_user_ip ON user_login_ips(user_id, ip_address);
CREATE INDEX idx_user_login_ips_last_seen ON user_login_ips(last_seen_at DESC);

-- ============================================================================
-- EMAIL LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    template VARCHAR(100) NOT NULL,
    notification_type VARCHAR(50),

    -- Email tracking
    message_id VARCHAR(255),
    status VARCHAR(20) NOT NULL, -- sent, failed, bounced, etc.
    error_message TEXT,

    -- Timestamps
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for querying logs
CREATE INDEX idx_email_logs_user ON email_logs(user_id);
CREATE INDEX idx_email_logs_recipient ON email_logs(recipient);
CREATE INDEX idx_email_logs_status ON email_logs(status);
CREATE INDEX idx_email_logs_sent_at ON email_logs(sent_at DESC);
CREATE INDEX idx_email_logs_notification_type ON email_logs(notification_type);

-- ============================================================================
-- DOMAIN HEALTH TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS domain_health_tracking (
    id SERIAL PRIMARY KEY,
    domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,

    -- Health status
    status VARCHAR(20) NOT NULL, -- up, down, degraded
    previous_status VARCHAR(20),

    -- Down tracking (for 10-minute rule)
    first_failed_at TIMESTAMP WITH TIME ZONE,
    consecutive_failures INTEGER DEFAULT 0,
    down_alert_sent BOOLEAN DEFAULT FALSE,
    restored_alert_sent BOOLEAN DEFAULT FALSE,

    -- Error details
    last_error TEXT,
    last_error_code VARCHAR(50),

    -- Response metrics
    response_time_ms INTEGER,
    last_successful_check TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Ensure one tracking record per domain
    UNIQUE(domain_id)
);

-- Indexes for health checks
CREATE INDEX idx_domain_health_tracking_domain ON domain_health_tracking(domain_id);
CREATE INDEX idx_domain_health_tracking_status ON domain_health_tracking(status);
CREATE INDEX idx_domain_health_tracking_first_failed ON domain_health_tracking(first_failed_at);
CREATE INDEX idx_domain_health_tracking_down_alert ON domain_health_tracking(down_alert_sent) WHERE down_alert_sent = false;

-- ============================================================================
-- SSL CERTIFICATE TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS ssl_certificate_tracking (
    id SERIAL PRIMARY KEY,
    domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,

    -- Certificate info
    issued_to VARCHAR(255),
    issuer VARCHAR(255),
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_until TIMESTAMP WITH TIME ZONE,

    -- Alert tracking
    days_before_expiry INTEGER,
    alert_7_days_sent BOOLEAN DEFAULT FALSE,
    alert_3_days_sent BOOLEAN DEFAULT FALSE,
    alert_1_day_sent BOOLEAN DEFAULT FALSE,
    expired_alert_sent BOOLEAN DEFAULT FALSE,

    -- Certificate details
    fingerprint VARCHAR(255),
    serial_number VARCHAR(255),

    -- Timestamps
    last_checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Ensure one tracking record per domain
    UNIQUE(domain_id)
);

-- Indexes for SSL tracking
CREATE INDEX idx_ssl_cert_tracking_domain ON ssl_certificate_tracking(domain_id);
CREATE INDEX idx_ssl_cert_tracking_expiry ON ssl_certificate_tracking(valid_until);
CREATE INDEX idx_ssl_cert_tracking_days_before ON ssl_certificate_tracking(days_before_expiry);

-- ============================================================================
-- NOTIFICATION QUEUE (for batch processing)
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_queue (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    priority INTEGER DEFAULT 5, -- 1 (highest) to 10 (lowest)

    -- Notification data (flexible JSON)
    data JSONB NOT NULL,

    -- Processing status
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, sent, failed
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,

    -- Scheduling
    scheduled_for TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for queue processing
CREATE INDEX idx_notification_queue_status ON notification_queue(status);
CREATE INDEX idx_notification_queue_scheduled ON notification_queue(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_notification_queue_priority ON notification_queue(priority, scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_notification_queue_user ON notification_queue(user_id);

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_notification_preferences_updated_at
    BEFORE UPDATE ON user_notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_login_ips_updated_at
    BEFORE UPDATE ON user_login_ips
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_domain_health_tracking_updated_at
    BEFORE UPDATE ON domain_health_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ssl_certificate_tracking_updated_at
    BEFORE UPDATE ON ssl_certificate_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_queue_updated_at
    BEFORE UPDATE ON notification_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ANALYZE TABLES
-- ============================================================================

ANALYZE user_notification_preferences;
ANALYZE user_login_ips;
ANALYZE email_logs;
ANALYZE domain_health_tracking;
ANALYZE ssl_certificate_tracking;
ANALYZE notification_queue;

-- ============================================================================
-- NOTES
-- ============================================================================
-- This migration creates a complete notification system:
-- 1. User preferences for fine-grained control
-- 2. IP tracking for security alerts
-- 3. Email logs for auditability
-- 4. Health tracking with 10-minute delay for domain down alerts
-- 5. SSL certificate monitoring
-- 6. Notification queue for reliable delivery
