# Operations

NebulaProxy V3 operations runbook.

## Essential Commands
```bash
# Status
docker compose ps

# Start/rebuild
docker compose up -d --build

# Stop
docker compose down

# Global logs
docker compose logs -f

# Backend logs
docker compose logs -f backend

# Last 200 backend lines
docker compose logs --tail=200 backend
```

## Service Health Checks
```bash
# Redis
docker compose exec redis redis-cli ping

# Wizard config key presence
docker compose exec redis redis-cli EXISTS nebulaproxy:config
```

## Reset Admin Password

If you are locked out of the admin account, reset the password directly against the database.

**Outside Docker (local dev):**
```bash
# Interactive prompt
npm run admin:reset-password

# Or pass the password as argument
npm run admin:reset-password -- MonNouveauMotDePasse
```

**Inside Docker (production):**
```bash
# Interactive
docker compose exec backend npm run admin:reset-password

# Non-interactive (recommended for scripts)
docker compose exec -T backend node scripts/reset-admin-password.js MonNouveauMotDePasse
```

The script will:
1. Connect to the database using the current environment variables
2. List all admin accounts if several exist and ask which one to reset
3. Hash the new password with `scrypt` (same algorithm as the application)
4. Update the record and confirm success

---

## Monitoring and Admin API
- Metrics: `/api/admin/monitoring/metrics`
- Logs: `/api/admin/monitoring/logs`
- Processes: `/api/admin/monitoring/processes`

## Backups
- Endpoints: `/api/admin/database/backups`
- Storage volume: `backups`

## Updates
- Endpoints: `/api/admin/updates/*`
- `watchdog` supervises update workflow
- Watchdog logs: `docker compose logs -f watchdog`

## Scheduled Restart
Backend configures internal cron (03:00) via `backend/entrypoint.sh` to run `scripts/restart-docker.sh`.

## Post-change Verification
1. `docker compose ps`
2. `docker compose logs --tail=200 backend`
3. Test UI and `/api/auth/me`
