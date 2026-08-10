#!/bin/bash
# Script de diagnostic complet pour identifier la corruption PostgreSQL

echo "🔍 Diagnostic de la base de données PostgreSQL"
echo "================================================"
echo ""

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Paramètres de connexion à la DB externe
read -p "Hôte PostgreSQL (ex: localhost): " PG_HOST
read -p "Port PostgreSQL (défaut: 5432): " PG_PORT
PG_PORT=${PG_PORT:-5432}
read -p "Nom de la base (défaut: nebulaproxy): " PG_DB
PG_DB=${PG_DB:-nebulaproxy}
read -p "Utilisateur PostgreSQL (défaut: nebulaproxy): " PG_USER
PG_USER=${PG_USER:-nebulaproxy}
read -sp "Mot de passe PostgreSQL: " PG_PASSWORD
echo ""
echo ""

export PGPASSWORD="$PG_PASSWORD"

# Test de connexion
echo "1️⃣  Test de connexion..."
if psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Connexion réussie${NC}"
else
    echo -e "${RED}✗ Échec de connexion${NC}"
    exit 1
fi
echo ""

# Vérifier les tables
echo "2️⃣  Liste des tables..."
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "\dt" 2>&1 | head -20
echo ""

# Tester la table users
echo "3️⃣  Test de la table 'users'..."
if psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "SELECT COUNT(*) FROM users;" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Table 'users' accessible${NC}"
    USER_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -t -c "SELECT COUNT(*) FROM users;")
    echo "  Nombre d'utilisateurs: $USER_COUNT"
else
    echo -e "${RED}✗ Table 'users' CORROMPUE${NC}"
fi
echo ""

# Tester la table domains
echo "4️⃣  Test de la table 'domains'..."
if psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "SELECT COUNT(*) FROM domains;" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Table 'domains' accessible${NC}"
    DOMAIN_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -t -c "SELECT COUNT(*) FROM domains;")
    echo "  Nombre de domaines: $DOMAIN_COUNT"
else
    echo -e "${RED}✗ Table 'domains' CORROMPUE${NC}"
fi
echo ""

# Identifier les lignes corrompues dans users
echo "5️⃣  Recherche de lignes corrompues dans 'users'..."
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" << 'EOF'
DO $$
DECLARE
    user_id INTEGER;
    corrupted_count INTEGER := 0;
BEGIN
    FOR user_id IN SELECT id FROM users ORDER BY id
    LOOP
        BEGIN
            PERFORM * FROM users WHERE id = user_id;
            RAISE NOTICE 'User % - OK', user_id;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'User % - CORRUPTED: %', user_id, SQLERRM;
            corrupted_count := corrupted_count + 1;
        END;
    END LOOP;
    
    IF corrupted_count = 0 THEN
        RAISE NOTICE 'Aucun utilisateur corrompu trouvé';
    ELSE
        RAISE WARNING '% utilisateur(s) corrompu(s) détecté(s)', corrupted_count;
    END IF;
END $$;
EOF
echo ""

# Identifier les lignes corrompues dans domains
echo "6️⃣  Recherche de lignes corrompues dans 'domains'..."
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" << 'EOF'
DO $$
DECLARE
    domain_id INTEGER;
    corrupted_count INTEGER := 0;
BEGIN
    FOR domain_id IN SELECT id FROM domains ORDER BY id
    LOOP
        BEGIN
            PERFORM * FROM domains WHERE id = domain_id;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Domain % - CORRUPTED: %', domain_id, SQLERRM;
            corrupted_count := corrupted_count + 1;
        END;
    END LOOP;
    
    IF corrupted_count = 0 THEN
        RAISE NOTICE 'Aucun domaine corrompu trouvé';
    ELSE
        RAISE WARNING '% domaine(s) corrompu(s) détecté(s)', corrupted_count;
    END IF;
END $$;
EOF
echo ""

# Vérifier l'intégrité du catalogue système
echo "7️⃣  Vérification du catalogue système..."
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -c "SELECT COUNT(*) as tables_count FROM pg_class WHERE relkind = 'r';"
echo ""

# Suggestions de réparation
echo "================================================"
echo "📋 Résumé et actions recommandées"
echo "================================================"
echo ""
echo -e "${YELLOW}Actions de réparation possibles:${NC}"
echo ""
echo "1. Désactiver les lignes corrompues:"
echo "   UPDATE users SET is_active = FALSE WHERE id IN (IDs_corrompus);"
echo "   UPDATE domains SET is_active = FALSE WHERE id IN (IDs_corrompus);"
echo ""
echo "2. Réindexer les tables:"
echo "   REINDEX TABLE users;"
echo "   REINDEX TABLE domains;"
echo "   VACUUM FULL ANALYZE;"
echo ""
echo "3. Export/Import des données saines:"
echo "   pg_dump --data-only --exclude-table=corrupted_table ..."
echo ""
echo "4. En dernier recours: dump SQL puis recréer la base"
echo ""

unset PGPASSWORD
