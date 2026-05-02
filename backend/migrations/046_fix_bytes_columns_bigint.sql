-- Migration: Fix INTEGER overflow on byte-size columns
-- Truncate log tables first so the ALTER TABLE rewrites are instant.
-- Columns storing byte counts must be BIGINT (max 9.2 EB) not INTEGER (max 2.1 GB).

TRUNCATE TABLE request_logs;
TRUNCATE TABLE smtp_logs;

ALTER TABLE request_logs ALTER COLUMN response_size TYPE BIGINT;
ALTER TABLE smtp_logs    ALTER COLUMN message_size  TYPE BIGINT;
