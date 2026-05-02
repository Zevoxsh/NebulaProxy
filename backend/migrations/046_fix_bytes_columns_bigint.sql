-- Migration: Fix INTEGER overflow on byte-size columns
-- Columns storing byte counts must be BIGINT (max 9.2 EB) not INTEGER (max 2.1 GB).
-- The value 2,493,755,051 seen in logs exceeds the INTEGER ceiling of 2,147,483,647.

ALTER TABLE request_logs ALTER COLUMN response_size TYPE BIGINT;
ALTER TABLE smtp_logs    ALTER COLUMN message_size  TYPE BIGINT;
