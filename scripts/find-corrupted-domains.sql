-- Script pour identifier les domaines corrompus dans la base de données
-- À exécuter manuellement sur la DB externe via psql

-- 1. Trouver tous les IDs de domaines actifs
SELECT id FROM domains WHERE is_active = TRUE ORDER BY id;

-- 2. Tester chaque domaine un par un (remplacer X par l'ID)
-- SELECT * FROM domains WHERE id = X;

-- 3. Script pour identifier automatiquement le domaine corrompu
DO $$
DECLARE
    domain_id INTEGER;
    test_data TEXT;
BEGIN
    FOR domain_id IN 
        SELECT id FROM domains WHERE is_active = TRUE ORDER BY id
    LOOP
        BEGIN
            -- Essayer de lire tous les champs
            SELECT description INTO test_data FROM domains WHERE id = domain_id;
            RAISE NOTICE 'Domain % - OK', domain_id;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Domain % - CORRUPTED: %', domain_id, SQLERRM;
        END;
    END LOOP;
END $$;

-- 4. Une fois le domaine corrompu identifié, vous pouvez:
--    a) Le désactiver (recommandé):
--       UPDATE domains SET is_active = FALSE WHERE id = X;
--
--    b) Supprimer les champs TEXT corrompus:
--       UPDATE domains SET description = NULL, dns_validation_token = NULL WHERE id = X;
--
--    c) Supprimer complètement le domaine (si acceptable):
--       DELETE FROM domains WHERE id = X;

-- 5. Après correction, réindexer:
-- REINDEX TABLE domains;
-- VACUUM ANALYZE domains;
