#!/bin/sh
set -e

SECRET_DIR=/run/pg-secret
SECRET_FILE="$SECRET_DIR/postgres.secret"

# Ensure the shared secret directory exists and is private
mkdir -p "$SECRET_DIR"
chmod 700 "$SECRET_DIR"

if [ ! -f "$SECRET_FILE" ]; then
  # First boot: generate a cryptographically random 40-character password
  POSTGRES_PASSWORD=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 40)
  printf '%s' "$POSTGRES_PASSWORD" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "[Postgres] Generated new password → $SECRET_FILE"
else
  echo "[Postgres] Loaded existing password from $SECRET_FILE"
fi

# Tell the official postgres entrypoint where the password file is
export POSTGRES_PASSWORD_FILE="$SECRET_FILE"

# Hand off to the official postgres docker-entrypoint.sh
exec docker-entrypoint.sh "$@"
