#!/bin/bash
# ExecStart for nebulaproxy.service. `docker compose up -d`'s own
# dependency wait (frontend: depends_on backend condition: service_healthy)
# gives up if backend isn't healthy yet — and on a genuinely fresh
# appliance boot, it isn't: backend starts in setup mode (no config in
# Redis yet) and only becomes healthy once a human finishes the web setup
# wizard, an inherently unbounded wait. When that happens, `docker compose
# up -d` still exits 0, but leaves dependents (frontend) sitting in
# "Created", never started — and nothing else retries it. First real test
# hit exactly this: backend eventually went healthy after setup, frontend
# never did anything about it.
#
# Fix: after the initial up, keep retrying in the background (cheap
# no-op for anything already running) for a generous window so frontend
# actually starts once backend clears its healthcheck post-setup.
# Detached from this script's own exit so it isn't bound by the service's
# TimeoutStartSec — the service is "started" as soon as this script
# returns (RemainAfterExit=yes), the retry loop just keeps running after.
set -u
cd /opt/nebulaproxy

# Pre-built images (os/build/build-iso.sh) — load once so `docker compose
# up -d` below finds them already tagged and skips building from scratch
# (that build is what used to leave the console/browser showing nothing
# for several minutes on first boot). Must match build-iso.sh's project
# name/service list.
IMAGES_TAR=/opt/nebulaproxy/.docker-images.tar.gz
LOADED_MARKER=/var/lib/nebulaproxy-images-loaded
if [ -f "$IMAGES_TAR" ] && [ ! -f "$LOADED_MARKER" ]; then
  echo "Loading pre-built NebulaProxyV4 images..."
  if gunzip -c "$IMAGES_TAR" | docker load; then
    for svc in backend frontend postgres redis watchdog autoheal; do
      docker tag "nebulaproxyv4img-${svc}:latest" "nebulaproxy-${svc}:latest" 2>/dev/null || true
    done
    touch "$LOADED_MARKER"
    echo "Pre-built images loaded and tagged."
  else
    echo "Failed to load pre-built images — docker compose will build from scratch instead."
  fi
fi

docker compose up -d

(
  for _ in $(seq 1 40); do
    sleep 30
    docker compose up -d >/dev/null 2>&1
  done
) </dev/null >/var/log/nebulaproxy-compose-retry.log 2>&1 &
disown
