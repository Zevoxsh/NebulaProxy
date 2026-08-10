# Security

## Authentication
- `AUTH_MODE=ldap` or `AUTH_MODE=local`
- JWT stored in HttpOnly cookie
- Scoped API keys for integrations

## Secrets and tokens
- `JWT_SECRET`: required, strong, unique
- `PROXY_CHECK_TOKEN`: protects proxy checks/routes
- Never commit plaintext secrets

## Network protections
- `ALLOWED_ORIGINS` for CORS
- `ALLOWED_DOMAINS` to restrict managed domains
- `ALLOW_PRIVATE_BACKENDS=false` in production
- `ALLOW_INSECURE_BACKENDS=false` in production

## CSRF and hardening
- CSRF enabled by default (`CSRF_ENABLED=true`)
- Trusted proxies via `TRUSTED_PROXIES`
- DNS rebinding protection option available

## Recommendations
- Rotate secrets regularly
- Keep admin footprint minimal
- Enforce HTTPS in production
- Review logs and audit trail periodically
