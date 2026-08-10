# API Reference (Summary)

Base URL: `/api`

## Authentication
- Web session via HttpOnly JWT cookie
- API key via `X-API-Key` or `Authorization: Bearer <key>`

## Endpoint Groups
### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### User
- `GET /api/user/profile`
- `PUT /api/user/profile`

### Domains
- `GET /api/domains`
- `POST /api/domains`
- `PUT /api/domains/:id`
- `DELETE /api/domains/:id`

### Teams
- `GET /api/teams`
- `POST /api/teams`
- `PUT /api/teams/:id`
- `DELETE /api/teams/:id`

### Redirects
- `GET /api/redirections`
- `POST /api/redirections`
- `PUT /api/redirections/:id`
- `DELETE /api/redirections/:id`

### SSL
- `GET /api/ssl/certificates`
- `POST /api/ssl/issue`
- `POST /api/ssl/renew`

### Monitoring / Logs
- `GET /api/monitoring/stats`
- `GET /api/logs`

### API Keys
- `GET /api/api-keys`
- `POST /api/api-keys`
- `DELETE /api/api-keys/:id`

### Admin
- `GET /api/admin/stats`
- `GET /api/admin/users`
- `GET /api/admin/services/containers`
- `GET /api/admin/updates/status`

## Example
```bash
curl -H "X-API-Key: nbp_live_xxx" https://example.com/api/domains
```

For full endpoint coverage, inspect `backend/routes/`.
