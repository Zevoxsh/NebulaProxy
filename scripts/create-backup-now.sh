#!/bin/bash
# Créer une backup complète de la base de données

export PGPASSWORD="QZuqdqpuQZOYDuQd"
PG_HOST="10.10.0.4"
PG_PORT="5437"
PG_USER="root"
PG_DB="nebula_db"
BACKUP_DIR="/tmp"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/nebula_backup_$TIMESTAMP.json"

echo "📦 Création de la backup de la base de données..."
echo "Fichier: $BACKUP_FILE"
echo ""

# Exporter toutes les tables en JSON
{
  echo "{"
  
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -t -c "
    SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename
  " | while read table; do
    if [ ! -z "$table" ]; then
      echo "  \"$table\": ["
      psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -t -c "
        SELECT row_to_json(t) FROM \"$table\" t
      " | sed 's/^/    /' | paste -sd "," - | sed 's/,$//'
      echo "  ],"
    fi
  done | sed '$ s/,$//'
  
  echo "}"
} > "$BACKUP_FILE"

if [ -s "$BACKUP_FILE" ]; then
  echo ""
  echo "✅ Backup créée avec succès!"
  echo "📁 Localisation: $BACKUP_FILE"
  echo "📊 Taille: $(du -h "$BACKUP_FILE" | cut -f1)"
  echo ""
  echo "Pour télécharger via SCP:"
  echo "  scp root@YOUR_IP:$BACKUP_FILE ~/nebula_backup_$TIMESTAMP.json"
else
  echo "❌ Erreur: Le fichier de backup est vide"
  exit 1
fi

unset PGPASSWORD
