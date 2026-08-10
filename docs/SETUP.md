# Setup Wizard

NebulaProxy stores active runtime configuration in Redis under key `nebulaproxy:config`.

## Startup behavior
- If key does not exist: backend starts `setup-server.js`
- If key exists: backend starts `server.js`

Verification:
```bash
docker compose exec redis redis-cli EXISTS nebulaproxy:config
```

## Wizard access
- `http://<SERVER_IP>:3001/setup`
- Fallback: `http://<SERVER_IP>:3000/setup`

## Wizard steps
1. Docker environment detection
2. PostgreSQL configuration
3. Security configuration (JWT/token)
4. Authentication configuration (LDAP or local)
5. Validation and save to Redis

## Import / export
Wizard accepts:
- `.env`
- `.json`

Reference files:
- `config/config-import.env`
- `config/config-template.json`
- `config/config-correct.json`

## Configuration CLI
From root:
```bash
npm run config:show
npm run config:edit
npm run config:set
npm run config:export
npm run config:import
npm run config:reset
```

## Notes
- `backend/.env` remains a minimal fallback (mostly Redis).
- Redis remains the primary runtime source.
