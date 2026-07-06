// @ts-check
// Cluster-aware Docker healthcheck.
//
// A plain `GET /health` isn't enough once CLUSTER_ENABLED=true: with
// cluster.SCHED_NONE both workers share the same listening port and the
// kernel picks which one accepts a given connection, so the check has good
// odds of landing on a healthy worker even when the other one is stuck —
// meaning a single stuck worker could sit there indefinitely without ever
// accumulating enough consecutive failures to be marked unhealthy.
//
// This checks two things: the HTTP endpoint responds (basic liveness), and
// — only when clustering is on — that every expected worker has written a
// fresh heartbeat to Redis in the last HEARTBEAT_TTL_SEC seconds (see
// clusterCoordinator.js). Exits 0 only if both pass.
import http from 'node:http';
import fs from 'node:fs';
import Redis from 'ioredis';

const HTTP_TIMEOUT_MS = 4000;
const HEARTBEAT_PREFIX = 'nebula:cluster:heartbeat:';

function checkHttp() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: 3000, path: '/health', timeout: HTTP_TIMEOUT_MS },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function readRedisPassword() {
  // entrypoint.sh's `export REDIS_PASSWORD=...` only lives in PID 1's shell
  // session — a separate HEALTHCHECK CMD invocation doesn't inherit it, so
  // read the same secret file directly instead.
  const secretFile = '/run/redis-secret/redis.secret';
  try {
    if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  } catch { /* fall through to env var */ }
  return process.env.REDIS_PASSWORD || undefined;
}

async function checkClusterWorkers() {
  if ((process.env.CLUSTER_ENABLED || 'false') !== 'true') return { ok: true, detail: 'cluster disabled' };

  const expectedWorkers = parseInt(process.env.CLUSTER_WORKERS || '2', 10);
  const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: readRedisPassword(),
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    const keys = await redis.keys(`${HEARTBEAT_PREFIX}*`);
    return { ok: keys.length >= expectedWorkers, detail: `${keys.length}/${expectedWorkers} worker heartbeats: ${keys.join(', ') || 'none'}` };
  } catch (err) {
    // Redis itself has its own healthcheck/dependency chain — don't fail
    // this container's healthcheck over infra it doesn't own.
    return { ok: true, detail: `redis unreachable, skipped: ${err.message}` };
  } finally {
    redis.disconnect();
  }
}

// Docker's `docker inspect` keeps the last few HEALTHCHECK CMD stdout
// outputs — printing a reason here is the only way to see, after the fact,
// which of the two checks actually failed (previously exited silently,
// so a false-positive restart left zero trace of why).
const [httpOk, workers] = await Promise.all([checkHttp(), checkClusterWorkers()]);
const ok = httpOk && workers.ok;
console.log(`${ok ? 'OK' : 'FAIL'} http=${httpOk} workers=${workers.ok} (${workers.detail})`);
process.exit(ok ? 0 : 1);
