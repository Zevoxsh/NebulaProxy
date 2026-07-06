// @ts-check
/**
 * ClusterCoordinator — leader election for singleton jobs when the backend
 * runs as multiple worker processes (config.cluster.enabled).
 *
 * A handful of scheduled jobs must only ever run once across the whole
 * deployment, not once per worker: ACME certificate renewal (concurrent
 * renewals race on the same cert files and can trip Let's Encrypt rate
 * limits), the auto-update check (concurrent `git fetch` + auto-apply would
 * trigger overlapping rebuild/restart cycles), the active backend health
 * poller (N workers would each hit every backend N times per interval), the
 * resource monitor (duplicate alert notifications), and the SSL-expiry /
 * log-cleanup cron jobs (harmless but wasteful duplicate DB scans).
 *
 * Uses a simple renewable lock in Redis rather than Node's `cluster` module
 * primary/worker relationship, so it works the same way regardless of
 * whether workers were forked via `cluster.fork()` or are entirely separate
 * processes/containers.
 *
 * When clustering is disabled (the default), `isLeader()` always returns
 * true immediately with no Redis round-trip — singleton jobs behave exactly
 * as before.
 */
import { redisService } from './redis.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const LOCK_KEY = 'nebula:cluster:leader';
const LOCK_TTL_SEC = 20;
const RENEW_MS = 8000;

// Atomically renew the lease only if we still own it (avoids stealing our
// own lock's TTL extension from a different process that raced in).
const RENEW_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
  else
    return 0
  end
`;

class ClusterCoordinator {
  constructor() {
    this._id = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this._isLeader = !config.cluster.enabled;
    this._timer = null;
  }

  start() {
    if (!config.cluster.enabled) return; // nothing to coordinate, always leader
    const tick = async () => {
      try {
        if (!redisService.isConnected || !redisService.client) return;
        if (this._isLeader) {
          const renewed = await redisService.client.eval(RENEW_SCRIPT, 1, LOCK_KEY, this._id, LOCK_TTL_SEC);
          if (!renewed) {
            this._isLeader = false;
            logger.warn(`[Cluster] ${this._id} lost the leader lease`);
          }
        } else {
          const acquired = await redisService.client.set(LOCK_KEY, this._id, 'EX', LOCK_TTL_SEC, 'NX');
          if (acquired) {
            this._isLeader = true;
            logger.info(`[Cluster] ${this._id} became leader (runs ACME/update/health-check/resource-monitor crons)`);
          }
        }
      } catch (err) {
        logger.error('[Cluster] Leader election tick failed:', err.message);
      }
    };
    tick();
    this._timer = setInterval(tick, RENEW_MS);
    if (this._timer.unref) this._timer.unref();
  }

  async stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (config.cluster.enabled && this._isLeader && redisService.isConnected && redisService.client) {
      try {
        const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
        await redisService.client.eval(script, 1, LOCK_KEY, this._id);
      } catch { /* best-effort release, lease TTL covers us if this fails */ }
    }
  }

  /** True if this process should run singleton/cluster-wide jobs right now. */
  isLeader() {
    return this._isLeader;
  }
}

export const clusterCoordinator = new ClusterCoordinator();
