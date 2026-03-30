-- Script SQL pour réparer la corruption de la table domains
-- Ce script doit être exécuté dans le conteneur PostgreSQL

-- 1. Créer une table temporaire avec les données récupérables
CREATE TABLE domains_backup AS
SELECT * FROM domains WHERE id NOT IN (
    SELECT id FROM domains WHERE id IS NULL
) LIMIT 0;

-- 2. Copier les données récupérables ligne par ligne
DO $$
DECLARE
    domain_record RECORD;
    recovery_count INTEGER := 0;
    error_count INTEGER := 0;
BEGIN
    FOR domain_record IN 
        SELECT id FROM domains ORDER BY id
    LOOP
        BEGIN
            INSERT INTO domains_backup
            SELECT * FROM domains WHERE id = domain_record.id;
            recovery_count := recovery_count + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Erreur lors de la récupération de la ligne avec id=%: %', domain_record.id, SQLERRM;
            error_count := error_count + 1;
        END;
    END LOOP;
    
    RAISE NOTICE 'Récupération terminée: % lignes récupérées, % erreurs', recovery_count, error_count;
END $$;

-- 3. Vérifier les données récupérées
SELECT COUNT(*) as recovered_rows FROM domains_backup;

-- 4. Si la récupération est satisfaisante, décommenter les lignes suivantes:
-- DROP TABLE domains CASCADE;
-- ALTER TABLE domains_backup RENAME TO domains;
-- REINDEX TABLE domains;
