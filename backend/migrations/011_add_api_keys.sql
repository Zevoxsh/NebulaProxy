-- Migration 011: Add API Keys system
-- Tables for API key authentication with scopes and rate limiting

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Key storage (hash only, never store plaintext)
    key_prefix VARCHAR(16) NOT NULL, -- First 16 chars for quick lookup
    key_hash TEXT NOT NULL, -- Scrypt hash of full key

    -- Metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Permissions
    scopes TEXT[] NOT NULL DEFAULT '{}', -- Array of scope strings

    -- Rate limiting
    rate_limit_rpm INTEGER DEFAULT 60, -- Requests per minute
    rate_limit_rph INTEGER DEFAULT 3600, -- Requests per hour

    -- Status
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,

    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT valid_rate_limits CHECK (
        rate_limit_rpm > 0 AND
        rate_limit_rpm <= 10000 AND
        rate_limit_rph > 0 AND
        rate_limit_rph <= 100000
    ),
    CONSTRAINT valid_scopes CHECK (array_length(scopes, 1) > 0)
);

-- API Key Usage Logs
CREATE TABLE IF NOT EXISTS api_key_usage (
    id BIGSERIAL PRIMARY KEY,
    api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,

    -- Request details
    method VARCHAR(10) NOT NULL,
    path VARCHAR(500) NOT NULL,
    status_code INTEGER,

    -- Client info
    ip_address INET,
    user_agent TEXT,

    -- Performance
    response_time_ms INTEGER,

    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Partitioning hint: This table will grow large
    -- Consider partitioning by created_at in production
    CHECK (created_at IS NOT NULL)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used ON api_keys(last_used_at);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_api_key_id ON api_key_usage(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_created_at ON api_key_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_compound ON api_key_usage(api_key_id, created_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_api_keys_updated_at();

-- Function to clean up expired API keys (can be called by cron)
CREATE OR REPLACE FUNCTION cleanup_expired_api_keys()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM api_keys
    WHERE expires_at IS NOT NULL
    AND expires_at < CURRENT_TIMESTAMP;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old usage logs (keep last 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_api_key_usage()
RETURNS BIGINT AS $$
DECLARE
    deleted_count BIGINT;
BEGIN
    DELETE FROM api_key_usage
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE api_keys IS 'API keys for programmatic access to NebulaProxy';
COMMENT ON COLUMN api_keys.key_prefix IS 'First 16 characters of the API key for quick lookup';
COMMENT ON COLUMN api_keys.key_hash IS 'Scrypt hash of the full API key';
COMMENT ON COLUMN api_keys.scopes IS 'Array of permission scopes (e.g., domains:*, teams:read)';
COMMENT ON COLUMN api_keys.rate_limit_rpm IS 'Maximum requests per minute';
COMMENT ON COLUMN api_keys.rate_limit_rph IS 'Maximum requests per hour';

COMMENT ON TABLE api_key_usage IS 'Usage logs for API keys (analytics and audit trail)';
COMMENT ON FUNCTION cleanup_expired_api_keys() IS 'Removes expired API keys from the database';
COMMENT ON FUNCTION cleanup_old_api_key_usage() IS 'Removes API key usage logs older than 90 days';
