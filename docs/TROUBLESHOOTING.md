# Troubleshooting

## Wizard unreachable
Symptoms:
- `http://localhost:3001/setup` does not respond

Checks:
1. `docker compose ps`
2. `docker compose logs -f backend`
3. Try `http://localhost:3000/setup`
4. Verify Redis: `docker compose exec redis redis-cli ping`

## Backend stuck in setup mode
Checks:
1. `docker compose exec redis redis-cli EXISTS nebulaproxy:config`
2. If `0`, complete wizard or import valid config

## Database errors
Verify:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- PostgreSQL network reachability
- Migrations applied

## LDAP login failures
Verify:
- `LDAP_URL`, `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`
- LDAP reachability from backend
- Temporarily test with `AUTH_MODE=local` to isolate

## Private backend targets blocked
Possible cause:
- `ALLOW_PRIVATE_BACKENDS=false`

Action:
- Set to `true` temporarily only for local testing

## SSL / ACME issues
Verify:
- `ACME_EMAIL`
- Challenge webroot reachability
- Domain DNS

## CORS issues
Verify:
- `ALLOWED_ORIGINS` contains exact frontend origins

## Useful logs
```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f redis
docker compose logs -f watchdog
```
