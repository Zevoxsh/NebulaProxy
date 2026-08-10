-- 052: Allow NULL fullchain/private_key on wildcard_ssl_certs for ACME pending records
-- A wildcard_ssl_certs row is created as placeholder when ACME is initiated;
-- cert data is filled in after DNS validation succeeds.

ALTER TABLE wildcard_ssl_certs
  ALTER COLUMN fullchain    DROP NOT NULL,
  ALTER COLUMN private_key  DROP NOT NULL;
