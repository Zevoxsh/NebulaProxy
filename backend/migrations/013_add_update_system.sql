-- Migration 013: Add Auto-Update System
-- Tables for automated git-based updates with rollback support

-- Update checks log (tracks all scheduled checks)
CREATE TABLE IF NOT EXISTS update_checks (
    id SERIAL PRIMARY KEY,
    current_commit VARCHAR(40) NOT NULL,
    remote_commit VARCHAR(40) NOT NULL,
    update_available BOOLEAN NOT NULL DEFAULT false,
    check_status VARCHAR(20) NOT NULL DEFAULT 'success', -- success, failed
    error_message TEXT,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_update_checks_checked_at ON update_checks(checked_at DESC);
CREATE INDEX idx_update_checks_update_available ON update_checks(update_available);

-- Update history (tracks all applied updates)
CREATE TABLE IF NOT EXISTS update_history (
    id SERIAL PRIMARY KEY,
    from_commit VARCHAR(40) NOT NULL,
    to_commit VARCHAR(40) NOT NULL,
    rollback_tag VARCHAR(100) NOT NULL,
    update_status VARCHAR(20) NOT NULL DEFAULT 'in_progress', -- in_progress, success, failed, rolled_back
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    downtime_seconds INTEGER,

    -- What was done during update
    migrations_applied TEXT[], -- Array of migration file names
    frontend_rebuilt BOOLEAN DEFAULT false,
    backend_rebuilt BOOLEAN DEFAULT false,

    -- Health check results
    health_check_passed BOOLEAN,
    health_check_error TEXT,

    -- Rollback information
    rollback_reason TEXT,
    rolled_back_at TIMESTAMP,

    -- Notifications
    notification_sent BOOLEAN DEFAULT false,
    notified_at TIMESTAMP
);

CREATE INDEX idx_update_history_status ON update_history(update_status);
CREATE INDEX idx_update_history_started_at ON update_history(started_at DESC);
CREATE INDEX idx_update_history_to_commit ON update_history(to_commit);

-- Update locks (prevent concurrent updates)
CREATE TABLE IF NOT EXISTS update_locks (
    id SERIAL PRIMARY KEY,
    lock_type VARCHAR(50) NOT NULL UNIQUE, -- 'update_in_progress'
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acquired_by VARCHAR(100), -- Process identifier
    expires_at TIMESTAMP NOT NULL -- TTL: 1 hour
);

CREATE INDEX idx_update_locks_expires_at ON update_locks(expires_at);

-- System configuration (key-value store for update settings)
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration values
INSERT INTO system_config (key, value) VALUES
    ('AUTO_UPDATE_ENABLED', 'false'),
    ('AUTO_UPDATE_INTERVAL_MINUTES', '30'),
    ('AUTO_UPDATE_MIN_INTERVAL_HOURS', '1'),
    ('AUTO_UPDATE_NOTIFY_BEFORE_MINUTES', '5'),
    ('AUTO_UPDATE_HEALTH_CHECK_TIMEOUT_SECONDS', '60')
ON CONFLICT (key) DO NOTHING;

-- Database backups metadata
CREATE TABLE IF NOT EXISTS database_backups (
    id SERIAL PRIMARY KEY,
    backup_path VARCHAR(500) NOT NULL,
    backup_size_bytes BIGINT,
    created_for_update_id INTEGER REFERENCES update_history(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    restored_at TIMESTAMP
);

CREATE INDEX idx_database_backups_update_id ON database_backups(created_for_update_id);
CREATE INDEX idx_database_backups_created_at ON database_backups(created_at DESC);

-- Function to clean expired locks (called on startup)
CREATE OR REPLACE FUNCTION clean_expired_update_locks()
RETURNS void AS $$
BEGIN
    DELETE FROM update_locks WHERE expires_at < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Clean expired locks on migration
SELECT clean_expired_update_locks();

COMMENT ON TABLE update_checks IS 'Log of all scheduled update checks';
COMMENT ON TABLE update_history IS 'History of all applied updates with rollback information';
COMMENT ON TABLE update_locks IS 'Locks to prevent concurrent updates';
COMMENT ON TABLE system_config IS 'System-wide configuration settings';
COMMENT ON TABLE database_backups IS 'Metadata for database backups created before updates';
