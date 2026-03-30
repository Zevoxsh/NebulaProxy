# Configuration

Configuration priority order:
1. Redis (`nebulaproxy:config`) - primary source
2. `backend/.env` - fallback
3. Internal defaults (`backend/config/config.js`)

## Critical Variables
### Server
- `HOST`, `PORT`, `FRONTEND_PORT`

### Auth
- `AUTH_MODE` (`ldap` or `local`)
- `JWT_SECRET` (strong, unique, minimum 32 characters)

### Database
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

### LDAP (if enabled)
- `LDAP_URL`, `LDAP_BASE_DN`
- `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`
- `LDAP_ADMIN_GROUP`, `LDAP_USER_GROUP`, `LDAP_REQUIRE_GROUP`

### Proxy and security
- `PROXY_ENABLED`
- `PROXY_CHECK_TOKEN`
- `ALLOWED_DOMAINS`
- `ALLOWED_ORIGINS`
- `ALLOW_PRIVATE_BACKENDS`
- `ALLOW_INSECURE_BACKENDS`
- `MAX_REQUEST_BODY_SIZE`

### Redis
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`

### SSL / ACME
- `ACME_EMAIL`, `ACME_WEBROOT`

### SMTP
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`

## Best Practices
- Keep `JWT_SECRET` and `PROXY_CHECK_TOKEN` out of Git.
- Restrict `ALLOWED_ORIGINS` and `ALLOWED_DOMAINS`.
- In production, keep `ALLOW_PRIVATE_BACKENDS=false` and `ALLOW_INSECURE_BACKENDS=false` unless explicitly needed.
- Prefer wizard or `config-manager` for controlled config changes.

## Tools
```bash
npm run config:show
npm run config:export
npm run config:import
```
