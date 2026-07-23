-- Allow TCP/UDP domains to open a range of external ports (e.g. 50100-50200),
-- each forwarded 1:1 by port number to the same port on the backend.

ALTER TABLE domains ADD COLUMN IF NOT EXISTS external_port_end INTEGER;

ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_port_range_valid;
ALTER TABLE domains ADD CONSTRAINT domains_port_range_valid
  CHECK (external_port_end IS NULL OR external_port_end >= external_port);
