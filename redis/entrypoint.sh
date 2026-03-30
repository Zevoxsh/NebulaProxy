#!/bin/sh
set -e

SECRET_FILE=/data/redis.secret
SHARED_DIR=/run/redis-secret
SHARED_FILE="$SHARED_DIR/redis.secret"

if [ ! -f "$SECRET_FILE" ]; then
  # Generate a cryptographically random 40-character password on first boot
  REDIS_PASSWORD=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 40)
  printf '%s' "$REDIS_PASSWORD" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "[Redis] Generated new password → saved to $SECRET_FILE"
else
  REDIS_PASSWORD=$(cat "$SECRET_FILE")
  echo "[Redis] Loaded existing password from $SECRET_FILE"
fi

# Sync to shared secret volume so sibling containers can read it read-only
mkdir -p "$SHARED_DIR"
cp "$SECRET_FILE" "$SHARED_FILE"
chmod 600 "$SHARED_FILE"

exec redis-server \
  --appendonly yes \
  --appendfsync everysec \
  --save 60 1 \
  --requirepass "$REDIS_PASSWORD"
