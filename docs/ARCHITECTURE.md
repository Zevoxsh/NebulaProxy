# Architecture

## Components
- `frontend` (React + Vite + Nginx): user interface
- `backend` (Fastify): API, auth, proxy, business logic
- `redis`: runtime configuration, cache, state
- `postgresql` (external to current compose): application data
- `watchdog`: update supervision and Docker state checks

## Backend core services
- `services/proxyManager.js`: proxy orchestration
- `services/acmeManager.js`: SSL certificate handling
- `services/monitoringService.js`: metrics collection
- `services/databaseBackupService.js`: database backups
- `services/logBroadcastService.js`: real-time log broadcast

## Main flow
1. User authentication (LDAP or local)
2. Frontend calls `/api/*`
3. Backend validates permissions and persists state in DB
4. Proxy configuration and SSL workflows are applied

## Setup flow
1. `entrypoint.sh` waits for Redis
2. Checks `nebulaproxy:config`
3. Without config: starts `setup-server.js`
4. With config: starts `server.js`

## Docker
Main compose file: `docker-compose.yml`
- `backend`: host network
- `frontend`: `3001:80`
- `redis`: `127.0.0.1:6379:6379`
- `watchdog`: host network + Docker socket
