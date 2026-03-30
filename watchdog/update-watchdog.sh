#!/bin/sh
# Watchdog — listens on Redis queue for update requests from the backend

REPO_DIR="/repo"
LOG_FILE="/var/log/nebulaproxy-watchdog.log"

REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_SECRET_FILE="/run/redis-secret/redis.secret"

# Load Redis password from shared secret volume
if [ -f "$REDIS_SECRET_FILE" ]; then
  REDIS_PASSWORD=$(cat "$REDIS_SECRET_FILE")
fi

# Build redis-cli auth flags
redis_auth() {
  if [ -n "$REDIS_PASSWORD" ]; then
    printf '%s' "--no-auth-warning -a $REDIS_PASSWORD"
  fi
}

redis_cmd() {
  # shellcheck disable=SC2046
  redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" $(redis_auth) "$@"
}

echo "[$(date)] ========================================" | tee -a "$LOG_FILE"
echo "[$(date)] NebulaProxy Update Watchdog Starting" | tee -a "$LOG_FILE"
echo "[$(date)] ========================================" | tee -a "$LOG_FILE"
echo "[$(date)] Redis queue: nebulaproxy:update:queue @ $REDIS_HOST:$REDIS_PORT" | tee -a "$LOG_FILE"
echo "[$(date)] Repository: $REPO_DIR" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

while true; do
  # Blocking pop — waits up to 10 s then returns empty; retry on empty
  result=$(redis_cmd BLPOP nebulaproxy:update:queue 10 2>/dev/null)
  [ -z "$result" ] && continue

  echo "[$(date)] ========================================" | tee -a "$LOG_FILE"
  echo "[$(date)] Update requested: $result" | tee -a "$LOG_FILE"

  cd "$REPO_DIR" || exit 1

  # Pull latest changes
  echo "[$(date)] Pulling latest changes..." | tee -a "$LOG_FILE"
  git config pull.rebase false 2>&1 | tee -a "$LOG_FILE"
  git pull origin main 2>&1 | tee -a "$LOG_FILE" || {
    echo "[$(date)] [WARNING] Pull failed, resetting to origin/main..." | tee -a "$LOG_FILE"
    git fetch origin main 2>&1 | tee -a "$LOG_FILE"
    git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"
  }

  echo "[$(date)] [WAIT] Waiting 10 seconds before rebuild..." | tee -a "$LOG_FILE"
  sleep 10

  echo "[$(date)] [BUILD] Rebuilding backend and frontend..." | tee -a "$LOG_FILE"
  docker compose -p nebulaproxy build backend frontend 2>&1 | tee -a "$LOG_FILE"

  echo "[$(date)] [RESTART] Restarting services..." | tee -a "$LOG_FILE"
  docker compose -p nebulaproxy up -d --no-deps backend frontend 2>&1 | tee -a "$LOG_FILE"

  NEW_COMMIT=$(git rev-parse HEAD 2>/dev/null)

  echo "[$(date)] [WAIT] Waiting 30 s for backend to start..." | tee -a "$LOG_FILE"
  sleep 30

  # Signal success to backend via Redis instead of a flag file
  if [ -n "$NEW_COMMIT" ]; then
    redis_cmd SET nebulaproxy:update:success "$NEW_COMMIT" 2>/dev/null
    echo "[$(date)] [OK] Success flag set in Redis for commit: $NEW_COMMIT" | tee -a "$LOG_FILE"
  fi

  echo "[$(date)] [OK] Update complete!" | tee -a "$LOG_FILE"
  echo "[$(date)] ========================================" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
done
