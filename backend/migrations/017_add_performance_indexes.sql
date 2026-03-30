-- Migration 017: Add Performance Indexes
-- Date: 2026-02-04
-- Purpose: Add missing indexes to improve query performance on large tables
-- Impact: Significant performance improvement for logs, analytics, and team queries

-- ============================================================================
-- PROXY LOGS INDEXES (Most critical - this table grows the fastest)
-- ============================================================================

-- Index for fetching logs by domain + time (most common query)
CREATE INDEX IF NOT EXISTS idx_proxy_logs_domain_created
  ON proxy_logs(domain_id, created_at DESC);

-- Index for filtering by log level (error/warn queries)
CREATE INDEX IF NOT EXISTS idx_proxy_logs_level
  ON proxy_logs(level)
  WHERE level IN ('error', 'warn');

-- Composite index for domain + level + time queries
CREATE INDEX IF NOT EXISTS idx_proxy_logs_domain_level_created
  ON proxy_logs(domain_id, level, created_at DESC);

-- Full-text search index for hostname and path
CREATE INDEX IF NOT EXISTS idx_proxy_logs_search
  ON proxy_logs USING gin(
    to_tsvector('english', coalesce(hostname, '') || ' ' || coalesce(path, ''))
  );

-- Index for IP address lookups
CREATE INDEX IF NOT EXISTS idx_proxy_logs_ip_address
  ON proxy_logs(ip_address);

-- ============================================================================
-- AUDIT LOGS INDEXES
-- ============================================================================

-- Index for fetching audit logs by user + time
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs(user_id, created_at DESC);

-- Index for filtering by action type
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(action);

-- Composite index for user + action queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action
  ON audit_logs(user_id, action, created_at DESC);

-- ============================================================================
-- SMTP LOGS INDEXES
-- ============================================================================

-- Index for fetching SMTP logs by timestamp
CREATE INDEX IF NOT EXISTS idx_smtp_logs_timestamp
  ON smtp_logs(timestamp DESC);

-- Index for filtering by client IP
CREATE INDEX IF NOT EXISTS idx_smtp_logs_client_ip
  ON smtp_logs(client_ip);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_smtp_logs_status
  ON smtp_logs(status);

-- Composite index for timestamp + status queries
CREATE INDEX IF NOT EXISTS idx_smtp_logs_timestamp_status
  ON smtp_logs(timestamp DESC, status);

-- ============================================================================
-- HEALTH CHECKS INDEXES
-- ============================================================================

-- Index for fetching health checks by domain + time
CREATE INDEX IF NOT EXISTS idx_health_checks_domain_checked
  ON health_checks(domain_id, checked_at DESC);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_health_checks_status
  ON health_checks(status);

-- Composite index for domain + status + time
CREATE INDEX IF NOT EXISTS idx_health_checks_domain_status_checked
  ON health_checks(domain_id, status, checked_at DESC);

-- ============================================================================
-- REQUEST LOGS INDEXES
-- ============================================================================

-- Index for fetching request logs by domain + timestamp
CREATE INDEX IF NOT EXISTS idx_request_logs_domain_timestamp
  ON request_logs(domain_id, timestamp DESC);

-- Index for filtering by status code
CREATE INDEX IF NOT EXISTS idx_request_logs_status_code
  ON request_logs(status_code);

-- Index for filtering by method
CREATE INDEX IF NOT EXISTS idx_request_logs_method
  ON request_logs(method);

-- ============================================================================
-- TEAM MEMBERS INDEXES (Critical for authorization checks)
-- ============================================================================

-- Composite index for user_id + team_id lookups (used in every auth check)
CREATE INDEX IF NOT EXISTS idx_team_members_user_team
  ON team_members(user_id, team_id);

-- Index for team_id lookups (listing team members)
CREATE INDEX IF NOT EXISTS idx_team_members_team
  ON team_members(team_id);

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_team_members_role
  ON team_members(team_id, role);

-- ============================================================================
-- TEAM INVITATIONS INDEXES
-- ============================================================================
-- NOTE: Basic indexes already exist in 001_initial_schema.sql:
--   - idx_team_invitations_team_id
--   - idx_team_invitations_invited_user_id
--   - idx_team_invitations_status
-- No additional indexes needed for team_invitations

-- ============================================================================
-- DOMAIN GROUPS INDEXES
-- ============================================================================
-- NOTE: Basic indexes already exist in 006_add_domain_groups.sql:
--   - idx_domain_groups_user_id
--   - idx_domain_groups_team_id
--   - idx_domain_groups_created_by
--   - idx_domain_groups_is_active
-- No additional indexes needed for domain_groups

-- ============================================================================
-- DOMAIN GROUP ASSIGNMENTS INDEXES
-- ============================================================================

-- Index for group_id lookups (listing domains in a group)
CREATE INDEX IF NOT EXISTS idx_domain_group_assignments_group
  ON domain_group_assignments(group_id);

-- Index for domain_id lookups (finding which groups a domain belongs to)
CREATE INDEX IF NOT EXISTS idx_domain_group_assignments_domain
  ON domain_group_assignments(domain_id);

-- ============================================================================
-- DOMAIN GROUP MEMBERS INDEXES
-- ============================================================================

-- Composite index for user + group lookups
CREATE INDEX IF NOT EXISTS idx_domain_group_members_user_group
  ON domain_group_members(user_id, group_id);

-- Index for group_id lookups
CREATE INDEX IF NOT EXISTS idx_domain_group_members_group
  ON domain_group_members(group_id);

-- ============================================================================
-- DOMAINS INDEXES (Additional)
-- ============================================================================

-- Index for filtering by SSL enabled status
CREATE INDEX IF NOT EXISTS idx_domains_ssl_enabled
  ON domains(ssl_enabled)
  WHERE ssl_enabled = true;

-- Index for filtering by proxy type
CREATE INDEX IF NOT EXISTS idx_domains_proxy_type
  ON domains(proxy_type);

-- Index for filtering by active status
CREATE INDEX IF NOT EXISTS idx_domains_is_active
  ON domains(is_active)
  WHERE is_active = true;

-- Composite index for team + active status
CREATE INDEX IF NOT EXISTS idx_domains_team_active
  ON domains(team_id, is_active);

-- ============================================================================
-- BACKEND HEALTH STATUS INDEXES
-- ============================================================================

-- Index for backend_id lookups
CREATE INDEX IF NOT EXISTS idx_backend_health_status_backend
  ON backend_health_status(backend_id);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_backend_health_status_status
  ON backend_health_status(current_status);

-- Composite index for backend + time
CREATE INDEX IF NOT EXISTS idx_backend_health_status_backend_time
  ON backend_health_status(backend_id, last_checked_at DESC);

-- ============================================================================
-- NOTIFICATIONS INDEXES
-- ============================================================================
-- NOTE: Notifications table will be created in migration 018
-- Indexes for notifications moved to that migration

-- ============================================================================
-- API KEYS INDEXES
-- ============================================================================

-- Index for key_prefix lookups (used in every API key auth)
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON api_keys(key_prefix);

-- Index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_api_keys_user
  ON api_keys(user_id);

-- Index for active keys only
CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON api_keys(is_active)
  WHERE is_active = true;

-- ============================================================================
-- ANALYZE TABLES (Update statistics for query planner)
-- ============================================================================

ANALYZE proxy_logs;
ANALYZE audit_logs;
ANALYZE smtp_logs;
ANALYZE health_checks;
ANALYZE request_logs;
ANALYZE team_members;
ANALYZE domain_group_assignments;
ANALYZE domain_group_members;
ANALYZE domains;
ANALYZE backend_health_status;
ANALYZE api_keys;

-- ============================================================================
-- NOTES
-- ============================================================================
-- Expected performance improvements:
-- - Proxy logs queries: 10-100x faster
-- - Team authorization checks: 5-10x faster
-- - Analytics queries: 20-50x faster
-- - Search queries: 50-100x faster with GIN index
--
-- Index maintenance:
-- - Indexes are maintained automatically by PostgreSQL
-- - Run VACUUM ANALYZE periodically for optimal performance
-- - Monitor index usage with pg_stat_user_indexes view
