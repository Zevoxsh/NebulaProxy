#!/bin/sh
set -e

echo "================================================"
echo "  Triggering NebulaProxy Restart via Watchdog"
echo "================================================"

REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_SECRET_FILE="/run/redis-secret/redis.secret"

# Load Redis password from shared secret volume
if [ -f "$REDIS_SECRET_FILE" ]; then
  REDIS_PASSWORD=$(cat "$REDIS_SECRET_FILE")
fi

REDIS_AUTH=""
if [ -n "$REDIS_PASSWORD" ]; then
  REDIS_AUTH="--no-auth-warning -a $REDIS_PASSWORD"
fi

PAYLOAD="{\"timestamp\":\"$(date -Iseconds)\",\"source\":\"cron\",\"scheduled\":true}"

echo "[INFO] Pushing update request to Redis queue..."
# shellcheck disable=SC2086
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" $REDIS_AUTH \
  LPUSH nebulaproxy:update:queue "$PAYLOAD"

echo "[OK] Update request pushed to nebulaproxy:update:queue"
echo "[WAIT] The watchdog will handle the restart in ~5-10 seconds"
echo ""
echo "Monitor progress:"
echo "   docker logs -f nebulaproxy-watchdog-1"
echo ""
echo "================================================"
echo "  [OK] Restart triggered!"
echo "================================================"
