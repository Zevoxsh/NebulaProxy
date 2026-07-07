-- Wildcard SSL certs and wildcard domain matching have been removed.
-- SSL certificates and domain routing now use exact hostname matching only.
DROP TABLE IF EXISTS wildcard_ssl_certs;

ALTER TABLE domains DROP COLUMN IF EXISTS is_wildcard;
