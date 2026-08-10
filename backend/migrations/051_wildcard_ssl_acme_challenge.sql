-- 051: Add DNS challenge tracking to wildcard_ssl_certs
-- Allows requesting Let's Encrypt wildcard certs via DNS-01 challenge

ALTER TABLE wildcard_ssl_certs
  ADD COLUMN IF NOT EXISTS dns_challenge_token       TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dns_challenge_domain      VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dns_challenge_status      VARCHAR(20)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dns_challenge_expires_at  TIMESTAMPTZ   DEFAULT NULL;
