# Project Structure

```text
NebulaProxy/
|-- backend/              # Fastify API, proxy manager, services, migrations
|-- frontend/             # React/Vite UI
|-- watchdog/             # Update/watchdog service
|-- config/               # Sample configuration files
|-- scripts/              # Utility scripts
|-- docs/                 # Full documentation set
|-- docker-compose.yml    # Docker orchestration
`-- README.md             # Main guide
```

## Backend anchors
- `backend/server.js`: main API entrypoint
- `backend/setup-server.js`: setup wizard server
- `backend/config/config.js`: configuration loading
- `backend/routes/`: API endpoints
- `backend/services/`: business logic
- `backend/migrations/`: DB schema migrations

## Frontend anchors
- `frontend/src/pages/`: application pages
- `frontend/src/components/`: UI/business components
- `frontend/src/api/client.js`: API client

## Operations anchors
- `backend/entrypoint.sh`: runtime bootstrap
- `scripts/install.sh`: Linux auto installer
- `scripts/restart-docker.sh`: scheduled restart script
