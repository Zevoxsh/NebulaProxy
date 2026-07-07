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

# RDB snapshotting disabled (--save "") — AOF with everysec fsync already
# gives continuous durability (max ~1s of data loss on a hard crash), and
# `save 60 1` was triggering a BGSAVE fork almost every minute under normal
# traffic. On this host that fork/write was taking 16-36s (seen live: "1
# changes in 60 seconds... DB saved on disk" 16-36s later for a ~1MB
# dataset — a host disk I/O problem, not a Redis data-size one), during
# which Redis command latency spiked enough to blow through the cluster
# leader-lease TTL and cause nginx upstream timeouts on every Redis-backed
# route. Disabling RDB removes that periodic stall entirely.
exec redis-server \
  --appendonly yes \
  --appendfsync everysec \
  --save "" \
  --requirepass "$REDIS_PASSWORD"
