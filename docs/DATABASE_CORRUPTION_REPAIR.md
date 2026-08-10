# Guide de réparation de la base de données corrompue

## Situation
Votre base de données PostgreSQL externe présente des erreurs de corruption:
- **XX001**: TOAST corruption (données volumineuses corrompues)  
- **XX000**: Erreur interne (impossibilité d'ouvrir des relations/tables)

## Étapes de diagnostic

### 1. Exécuter le script de diagnostic
```bash
cd /home/zevox/Documents/NebulaProxy
chmod +x scripts/diagnose-database.sh
./scripts/diagnose-database.sh
```

Cela identifiera exactement quelles tables et lignes sont corrompues.

### 2. Solutions par ordre de préférence

#### Option A: Désactiver les lignes corrompues (RECOMMANDÉ)
Si seules quelques lignes sont corrompues:

```sql
-- Connectez-vous à votre base PostgreSQL externe
psql -h VOTRE_HOST -U nebulaproxy -d nebulaproxy

-- Désactiver les utilisateurs corrompus
UPDATE users SET is_active = FALSE WHERE id IN (liste_des_ids_corrompus);

-- Désactiver les domaines corrompus
UPDATE domains SET is_active = FALSE WHERE id IN (liste_des_ids_corrompus);

-- Réindexer
REINDEX TABLE users;
REINDEX TABLE domains;
VACUUM FULL ANALYZE;
```

#### Option B: Supprimer les lignes corrompues
Si les données ne sont pas critiques:

```sql
-- ATTENTION: Cela supprime définitivement les données
DELETE FROM domains WHERE id IN (liste_des_ids_corrompus);
DELETE FROM users WHERE id IN (liste_des_ids_corrompus);

REINDEX DATABASE nebulaproxy;
VACUUM FULL ANALYZE;
```

#### Option C: Export/Import des données saines
Si la corruption est étendue:

```bash
# 1. Exporter seulement les données saines (schéma + données non corrompues)
pg_dump -h VOTRE_HOST -U nebulaproxy --data-only \
  --disable-triggers \
  -t users -t domains -t teams -t audit_logs \
  nebulaproxy > backup_clean.sql

# 2. Créer une nouvelle base propre
createdb -h VOTRE_HOST -U postgres nebulaproxy_new

# 3. Restaurer le schéma depuis les migrations NebulaProxy
psql -h VOTRE_HOST -U nebulaproxy -d nebulaproxy_new \
  -f backend/migrations/001_initial_schema.sql

# 4. Importer les données saines
psql -h VOTRE_HOST -U nebulaproxy -d nebulaproxy_new < backup_clean.sql

# 5. Renommer les bases
psql -h VOTRE_HOST -U postgres << EOF
ALTER DATABASE nebulaproxy RENAME TO nebulaproxy_corrupted;
ALTER DATABASE nebulaproxy_new RENAME TO nebulaproxy;
EOF
```

#### Option D: Réparation PostgreSQL au niveau système
Si la corruption est au niveau des fichiers:

```bash
# Sur le serveur PostgreSQL, en tant que postgres
sudo -u postgres /usr/lib/postgresql/XX/bin/pg_resetwal -f /var/lib/postgresql/XX/main

# ⚠️ ATTENTION: Cela peut causer une perte de données!
# À n'utiliser qu'en dernier recours
```

## Modifications du code NebulaProxy

J'ai déjà modifié le code pour gérer gracieusement les corruptions TOAST:
- `getAllActiveDomains()` récupère maintenant les domaines un par un
- Les domaines corrompus sont ignorés pour permettre au serveur de démarrer
- Des logs détaillés sont ajoutés pour identifier les problèmes

## Prévention

Pour éviter ce problème à l'avenir:

1. **Backups réguliers**:
   ```bash
   # Créer un cron pour backup quotidien
   0 3 * * * pg_dump -h HOST -U nebulaproxy nebulaproxy | gzip > /backups/nebulaproxy_$(date +\%Y\%m\%d).sql.gz
   ```

2. **Monitoring de la santé**:
   ```sql
   -- Vérifier régulièrement
   SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
   FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
   ```

3. **Arrêts propres**: Toujours arrêter PostgreSQL proprement avec `pg_ctl stop -m fast`

4. **Espace disque**: Maintenir au moins 20% d'espace libre

## Support

Si vous avez besoin d'aide pour identifier les lignes corrompues:
1. Exécutez `scripts/diagnose-database.sh`
2. Exécutez `scripts/find-corrupted-domains.sql` dans psql
3. Partagez les logs d'erreur
