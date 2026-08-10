-- NebulaProxy - Migration 002: Stockage des certificats SSL en BDD
-- Ajoute les colonnes pour stocker les certificats directement en base

-- Ajouter les colonnes pour stocker les certificats SSL
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_fullchain TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_private_key TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_issuer VARCHAR(255);
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_issued_at TIMESTAMP;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_auto_renew BOOLEAN DEFAULT TRUE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS ssl_cert_type VARCHAR(20) DEFAULT 'acme';

-- Commentaires pour documentation
COMMENT ON COLUMN domains.ssl_fullchain IS 'Certificat SSL complet (fullchain) au format PEM';
COMMENT ON COLUMN domains.ssl_private_key IS 'Clé privée SSL au format PEM';
COMMENT ON COLUMN domains.ssl_issuer IS 'Émetteur du certificat (ex: Let''s Encrypt)';
COMMENT ON COLUMN domains.ssl_issued_at IS 'Date d''émission du certificat';
COMMENT ON COLUMN domains.ssl_expires_at IS 'Date d''expiration du certificat';
COMMENT ON COLUMN domains.ssl_auto_renew IS 'Renouvellement automatique activé';
COMMENT ON COLUMN domains.ssl_cert_type IS 'Type de certificat: acme (Let''s Encrypt) ou manual (uploadé)';

-- Créer des index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_domains_ssl_expires_at ON domains(ssl_expires_at) WHERE ssl_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_domains_ssl_auto_renew ON domains(ssl_auto_renew) WHERE ssl_enabled = TRUE;

-- Créer une vue pour les certificats expirant bientôt
CREATE OR REPLACE VIEW expiring_certificates AS
SELECT
  id,
  hostname,
  ssl_expires_at,
  ssl_auto_renew,
  ssl_cert_type,
  ssl_issuer,
  EXTRACT(DAY FROM (ssl_expires_at - CURRENT_TIMESTAMP)) as days_until_expiry
FROM domains
WHERE ssl_enabled = TRUE
  AND ssl_expires_at IS NOT NULL
  AND ssl_expires_at < CURRENT_TIMESTAMP + INTERVAL '30 days'
ORDER BY ssl_expires_at ASC;

COMMENT ON VIEW expiring_certificates IS 'Certificats SSL expirant dans les 30 prochains jours';
