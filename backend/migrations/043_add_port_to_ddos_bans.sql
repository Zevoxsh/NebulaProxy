-- Store the port and protocol of the banned domain so iptables rules can be
-- removed precisely when a ban expires or is lifted by an admin.
ALTER TABLE ddos_ip_bans ADD COLUMN IF NOT EXISTS listen_port  INTEGER;
ALTER TABLE ddos_ip_bans ADD COLUMN IF NOT EXISTS proxy_type   VARCHAR(16);
