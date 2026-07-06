#!/bin/sh
set -e

echo "================================================"
echo "  NebulaProxy Starting..."
echo "================================================"

# ── Redis password ─────────────────────────────────────────────────────────
REDIS_SECRET_FILE="/run/redis-secret/redis.secret"
if [ -f "$REDIS_SECRET_FILE" ]; then
  export REDIS_PASSWORD=$(cat "$REDIS_SECRET_FILE")
  echo "Redis password auto-loaded from $REDIS_SECRET_FILE"
elif [ -n "$REDIS_PASSWORD" ]; then
  echo "Using Redis password from environment variable"
else
  echo "WARNING: No Redis password found. Running without Redis auth."
fi

# ── PostgreSQL password ────────────────────────────────────────────────────
PG_SECRET_FILE="/run/pg-secret/postgres.secret"
if [ -f "$PG_SECRET_FILE" ]; then
  export DB_PASSWORD=$(cat "$PG_SECRET_FILE")
  echo "PostgreSQL password auto-loaded from $PG_SECRET_FILE"
elif [ -n "$DB_PASSWORD" ]; then
  echo "Using PostgreSQL password from environment variable"
else
  echo "WARNING: No PostgreSQL password found."
fi

# ── Wait for Redis ─────────────────────────────────────────────────────────
echo "Waiting for Redis at ${REDIS_HOST:-redis}:${REDIS_PORT:-6379}..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if redis-cli -h "${REDIS_HOST:-redis}" -p "${REDIS_PORT:-6379}" \
      ${REDIS_PASSWORD:+--no-auth-warning -a "$REDIS_PASSWORD"} ping > /dev/null 2>&1; then
    echo "Redis is ready!"
    break
  fi
  attempt=$((attempt + 1))
  echo "   Attempt $attempt/$max_attempts - Redis not ready yet..."
  sleep 2
done
if [ $attempt -eq $max_attempts ]; then
  echo "ERROR: Redis not available after $max_attempts attempts"
  exit 1
fi

# ── Wait for PostgreSQL ────────────────────────────────────────────────────
echo "Waiting for PostgreSQL at ${DB_HOST:-postgres}:${DB_PORT:-5432}..."
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if PGPASSWORD="$DB_PASSWORD" pg_isready \
      -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" \
      -U "${DB_USER:-nebulaproxy}" -d "${DB_NAME:-nebulaproxy}" > /dev/null 2>&1; then
    echo "PostgreSQL is ready!"
    break
  fi
  attempt=$((attempt + 1))
  echo "   Attempt $attempt/$max_attempts - PostgreSQL not ready yet..."
  sleep 2
done
if [ $attempt -eq $max_attempts ]; then
  echo "ERROR: PostgreSQL not available after $max_attempts attempts"
  exit 1
fi

# ── Check setup state ──────────────────────────────────────────────────────
echo "Checking configuration..."
config_exists=$(redis-cli -h "${REDIS_HOST:-redis}" -p "${REDIS_PORT:-6379}" \
  ${REDIS_PASSWORD:+--no-auth-warning -a "$REDIS_PASSWORD"} exists nebulaproxy:config)

if [ "$config_exists" = "0" ]; then
  echo "WARNING: No configuration found in Redis. Starting setup mode..."
  exec node setup-server.js
fi

echo "Configuration found. Starting proxy server..."
echo "================================================"

# ── Set Node.js memory limits ──────────────────────────────────────────────
# With CLUSTER_ENABLED=true, cluster.fork() inherits this NODE_OPTIONS into
# every worker — a per-process heap sized for a single process (2048M) would
# let N workers try to use N x 2048M old-space against one shared container
# memory limit. Split a fixed total budget across the worker count instead.
TOTAL_HEAP_MB=1536
WORKER_COUNT="${CLUSTER_WORKERS:-2}"
if [ "${CLUSTER_ENABLED:-false}" = "true" ] && [ "$WORKER_COUNT" -gt 1 ] 2>/dev/null; then
  PER_WORKER_MB=$((TOTAL_HEAP_MB / WORKER_COUNT))
  export NODE_OPTIONS="--max-old-space-size=${PER_WORKER_MB}"
  echo "Cluster mode: ${WORKER_COUNT} workers, ${PER_WORKER_MB}MB heap each (${TOTAL_HEAP_MB}MB total budget)"
else
  export NODE_OPTIONS="--max-old-space-size=${TOTAL_HEAP_MB}"
fi

# ── Smoke tests (optional) ─────────────────────────────────────────────────
if [ "${RUN_SMOKE_TESTS:-false}" = "true" ]; then
  npm start &
  SERVER_PID=$!
  echo "Waiting for server to be ready for smoke tests..."
  sleep 10
  echo "Running API smoke tests..."
  node tests/api-smoke-test.js || echo "WARNING: Smoke tests failed, server will continue"
  wait $SERVER_PID
else
  exec npm start
fi
