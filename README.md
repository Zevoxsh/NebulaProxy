# NebulaProxy V3

Multi-protocol reverse proxy control panel (HTTP/HTTPS, TCP/UDP, Minecraft) with an admin UI, ACME SSL, monitoring, audit logs, and team management.

## Table of Contents
- [Overview](#overview)
- [Architecture and Services](#architecture-and-services)
- [Prerequisites](#prerequisites)
- [Production Installation (Docker)](#production-installation-docker)
- [Initial Configuration (Setup Wizard)](#initial-configuration-setup-wizard)
- [Tokens and Secrets](#tokens-and-secrets)
- [Docker Operations Commands](#docker-operations-commands)
- [Logs and Diagnostics](#logs-and-diagnostics)
- [Local Development Mode](#local-development-mode)
- [Project Structure](#project-structure)
- [Detailed Documentation](#detailed-documentation)
- [Quick Troubleshooting](#quick-troubleshooting)

## Overview
Main features:
- Multi-protocol reverse proxy: HTTP/HTTPS, TCP, UDP, Minecraft
- Domains, domain groups, redirects, quotas, and teams
- LDAP or local authentication, scoped API keys
- SSL automation (ACME / Let's Encrypt)
- Monitoring, activity logs, and admin audit trail
- Admin console: configuration, services, updates, backups, notifications

## Architecture and Services
`docker-compose.yml` runs 4 services:
- `backend`: Fastify API + proxy logic (`network_mode: host`)
- `frontend`: React/Nginx UI exposed on `3001`
- `redis`: runtime configuration store (`nebulaproxy:config`)
- `watchdog`: repo update/watchdog service + watchdog logs

Used volumes:
- `redis-data`: Redis persistence
- `backups`: database backups
- `uploads`: uploaded files (logos, etc.)
- `watchdog-logs`: watchdog logs
- `update-flags`: update coordination flags

Important note:
Compose mounts `/etc/NebulaProxy` into `backend` and `watchdog` for Git/update operations. In production, use this path to avoid mount mismatches.

## Prerequisites
- Docker Engine
- Docker Compose plugin (`docker compose`)
- Git
- Node.js 18+ and npm (useful for utility scripts)
- PostgreSQL 14+ reachable by backend (external to current compose)

## Production Installation (Docker)
### Option A - Linux automatic install script (recommended)
The script:
- installs system dependencies
- installs/enables Docker
- clones repository into `/etc/NebulaProxy`
- runs `npm run install:all`
- runs `docker compose up -d --build`

Command:
```bash
curl -fsSL https://raw.githubusercontent.com/Zevoxsh/NebulaProxy/main/scripts/install.sh | sh
```

The script must run as root.

### Option B - Linux manual install
```bash
cd /etc
git clone https://github.com/Zevoxsh/NebulaProxy.git
cd /etc/NebulaProxy
npm run install:all
docker compose up -d --build
```

### Post-install verification
```bash
docker compose ps
docker compose logs -f backend
```

Access:
- Wizard: `http://<SERVER_IP>:3001/setup`
- Wizard backend fallback: `http://<SERVER_IP>:3000/setup`
- Dashboard: `http://<SERVER_IP>:3001`

## Initial Configuration (Setup Wizard)
Backend starts in setup mode when Redis key `nebulaproxy:config` does not exist.

Expected flow:
1. Docker environment detection
2. PostgreSQL configuration
3. Security configuration (secrets/tokens)
4. Authentication configuration (LDAP or local)
5. Validation + save to Redis

Wizard import supports:
- `.env`
- `.json`

Useful references:
- `config/config-import.env`
- `config/config-template.json`
- `config/config-correct.json`

## Tokens and Secrets
Critical variables to define (wizard or import):
- `JWT_SECRET`: strong JWT secret (minimum 32 chars, recommended 64+)
- `PROXY_CHECK_TOKEN`: proxy route protection token
- `DB_PASSWORD`: database password
- `LDAP_BIND_PASSWORD` (if `AUTH_MODE=ldap`)

Best practices:
- Do not commit secrets to Git
- Rotate weak/default secrets
- Restrict `ALLOWED_ORIGINS` in production
- Keep `ALLOW_PRIVATE_BACKENDS=false` and `ALLOW_INSECURE_BACKENDS=false` in production unless explicitly required

## Docker Operations Commands
From repository root:

```bash
# Start / rebuild
docker compose up -d --build

# Container state
docker compose ps

# Stop
docker compose down

# Restart one service
docker compose restart backend

# Follow all logs
docker compose logs -f

# Service-specific logs
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f redis
docker compose logs -f watchdog
```

Available npm wrappers:
```bash
npm run docker:up
npm run docker:down
npm run docker:logs
npm run docker:restart
```

## Logs and Diagnostics
Most useful commands:

```bash
# Backend logs (setup/auth/db/proxy)
docker compose logs -f backend

# Last 200 backend log lines
docker compose logs --tail=200 backend

# Redis health check
docker compose exec redis redis-cli ping

# Check wizard config key in Redis
docker compose exec redis redis-cli EXISTS nebulaproxy:config
```

Quick interpretation:
- `EXISTS ... = 0`: setup not completed, wizard expected
- `EXISTS ... = 1`: config exists, backend should start `server.js`

## Local Development Mode
### Standard dev mode
```bash
npm run install:all
npm run dev
```

Local URLs:
- Frontend: `http://localhost:5173` (Vite)
- Backend: `http://localhost:3000`

### Local Docker mode
```bash
npm run install:all
docker compose up -d --build
```

## Project Structure
- `backend/`: API, proxy services, auth, migrations
- `frontend/`: React interface
- `watchdog/`: update/watchdog container
- `config/`: sample/import config files
- `scripts/`: utility scripts
- `docs/`: detailed documentation

## Detailed Documentation
- Docs index: `docs/README.md`
- Getting Started: `docs/GETTING_STARTED.md`
- Setup Wizard: `docs/SETUP.md`
- Configuration: `docs/CONFIGURATION.md`
- Architecture: `docs/ARCHITECTURE.md`
- Admin Panel: `docs/ADMIN_PANEL.md`
- API: `docs/API.md`
- Security: `docs/SECURITY.md`
- Operations: `docs/OPERATIONS.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Project Structure: `docs/PROJECT_STRUCTURE.md`
- Contributing: `docs/CONTRIBUTING.md`
- Tests: `docs/TEST_REPORT.md`
- License: `docs/LICENSE.md`

## Quick Troubleshooting
- Wizard unreachable on `3001`: try `http://localhost:3000/setup` and check backend logs.
- DB error: verify `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- LDAP login fails: verify `LDAP_*`, then temporarily test with `AUTH_MODE=local` to isolate.
- Proxy errors toward private IPs: check `ALLOW_PRIVATE_BACKENDS`.
- ACME/SSL issues: check `ACME_EMAIL`, challenge webroot, and domain DNS.
- CORS issues: verify `ALLOWED_ORIGINS`.

## License
MIT - see `LICENSE`.
