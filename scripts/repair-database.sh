#!/bin/bash
# Script de réparation de la base de données PostgreSQL

echo "🔧 Démarrage de la réparation de la base de données..."

# Obtenir le nom du conteneur PostgreSQL
PG_CONTAINER=$(docker-compose ps -q postgres)

if [ -z "$PG_CONTAINER" ]; then
    echo "❌ Conteneur PostgreSQL introuvable"
    exit 1
fi

echo "📦 Conteneur PostgreSQL trouvé: $PG_CONTAINER"

# Méthode 1: REINDEX la table domains
echo ""
echo "🔨 Étape 1: Réindexation de la table domains..."
docker exec -it $PG_CONTAINER psql -U postgres -d nebulaproxy -c "REINDEX TABLE domains;" || echo "⚠️  REINDEX a échoué"

# Méthode 2: VACUUM FULL pour nettoyer
echo ""
echo "🧹 Étape 2: Nettoyage complet de la base de données..."
docker exec -it $PG_CONTAINER psql -U postgres -d nebulaproxy -c "VACUUM FULL VERBOSE domains;" || echo "⚠️  VACUUM a échoué"

# Méthode 3: Vérifier l'intégrité
echo ""
echo "🔍 Étape 3: Vérification de l'intégrité..."
docker exec -it $PG_CONTAINER psql -U postgres -d nebulaproxy -c "SELECT COUNT(*) as total_domains FROM domains;" || echo "⚠️  Toujours corrompu"

echo ""
echo "✅ Réparation terminée. Redémarrez les conteneurs avec: docker-compose restart"
