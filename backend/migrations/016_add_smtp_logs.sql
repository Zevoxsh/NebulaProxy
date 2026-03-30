-- Migration: Add SMTP proxy logging table
-- Description: Stores SMTP relay events with client IP preservation
-- Date: 2026-02-04

-- Create smtp_logs table for SMTP proxy activity
CREATE TABLE IF NOT EXISTS smtp_logs (
  id SERIAL PRIMARY KEY,
  client_ip VARCHAR(45) NOT NULL,
  event_type VARCHAR(20) NOT NULL,  -- 'connection', 'message', 'error'
  remote_address VARCHAR(45),        -- Original socket address
  mail_from VARCHAR(255),            -- MAIL FROM address
  rcpt_to TEXT,                      -- RCPT TO addresses (comma-separated)
  message_size INTEGER,              -- Message size in bytes
  status VARCHAR(50),                -- 'success', 'failed', 'rejected'
  error_message TEXT,                -- Error details if failed
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_smtp_logs_client_ip ON smtp_logs(client_ip);
CREATE INDEX IF NOT EXISTS idx_smtp_logs_timestamp ON smtp_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_smtp_logs_event_type ON smtp_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_smtp_logs_status ON smtp_logs(status);

-- Add comments to table
COMMENT ON TABLE smtp_logs IS 'SMTP proxy relay logs with original client IP addresses';
COMMENT ON COLUMN smtp_logs.client_ip IS 'Real client IP address extracted from connection';
COMMENT ON COLUMN smtp_logs.event_type IS 'Type of SMTP event: connection, message, or error';
COMMENT ON COLUMN smtp_logs.remote_address IS 'Direct socket connection address (may be proxy)';
COMMENT ON COLUMN smtp_logs.mail_from IS 'Sender email address from MAIL FROM command';
COMMENT ON COLUMN smtp_logs.rcpt_to IS 'Recipient addresses from RCPT TO commands';
COMMENT ON COLUMN smtp_logs.message_size IS 'Size of message body in bytes';
COMMENT ON COLUMN smtp_logs.status IS 'Result status: success, failed, or rejected';
