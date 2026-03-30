# Getting Started

Quick start guide for NebulaProxy V3.

## Prerequisites
- Docker Engine
- Docker Compose plugin (`docker compose`)
- Git
- Node.js 18+ and npm
- PostgreSQL 14+ (reachable by backend)

## Production Installation (Linux)
### Option A - Automatic script
```bash
curl -fsSL https://raw.githubusercontent.com/Zevoxsh/NebulaProxyV3/main/scripts/install.sh | sh
```

This script must run as root.

### Option B - Manual installation
```bash
cd /etc
git clone https://github.com/Zevoxsh/NebulaProxyV3.git
cd /etc/NebulaProxyV3
npm run install:all
docker compose up -d --build
```

## Verify status
```bash
docker compose ps
docker compose logs -f backend
```

## Access
- Wizard: `http://<SERVER_IP>:3001/setup`
- Wizard backend fallback: `http://<SERVER_IP>:3000/setup`
- Dashboard: `http://<SERVER_IP>:3001`

## Local development startup
```bash
npm run install:all
npm run dev
```

Local URLs:
- Backend: `http://localhost:3000`
- Frontend: `http://localhost:5173`

## Next Step
Continue with `docs/SETUP.md`.
