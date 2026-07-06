// @ts-check
// Cluster bootstrap — replaces `node server.js` as the container entrypoint.
//
// Previously the backend always ran as a single Node process regardless of
// how many CPUs the container was allocated (docker-compose grants 2). With
// CLUSTER_ENABLED=true this forks CLUSTER_WORKERS worker processes, each
// running the full server.js (proxy manager, admin API, everything) — the
// OS distributes incoming connections across them (cluster.SCHED_NONE),
// which matters here more than for a typical web app because this proxy
// binds many independent listeners (80/443 plus one per TCP/UDP/Minecraft
// domain), not just a single port.
//
// Singleton jobs that must not run once per worker (ACME renewal, the
// auto-update check, active health polling, resource-monitor alerts) are
// gated behind clusterCoordinator's Redis-based leader lock inside their
// respective services — this file only handles process topology.
//
// Clustering is opt-in (config.cluster.enabled, default false): with it
// off, this file is a transparent passthrough to server.js.
import cluster from 'node:cluster';
import { config } from './config/config.js';
import { logger } from './utils/logger.js';

if (!config.cluster.enabled || !cluster.isPrimary) {
  // Disabled, or this IS a worker: run the actual application.
  await import('./server.js');
} else {
  const workerCount = config.cluster.workers;
  logger.info(`[Cluster] Primary ${process.pid} starting ${workerCount} worker(s)`);

  // Let the kernel load-balance connections across workers instead of
  // funnelling every accept() through this primary (default SCHED_RR would
  // make the primary a bottleneck given how many ports this proxy binds).
  cluster.schedulingPolicy = cluster.SCHED_NONE;

  for (let i = 0; i < workerCount; i++) {
    cluster.fork();
  }

  let shuttingDown = false;

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;
    logger.error(`[Cluster] Worker ${worker.process.pid} exited (code=${code} signal=${signal}) — forking a replacement`);
    cluster.fork();
  });

  const shutdown = (signal) => {
    shuttingDown = true;
    logger.info(`[Cluster] Primary received ${signal}, forwarding to workers`);
    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill(signal);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
