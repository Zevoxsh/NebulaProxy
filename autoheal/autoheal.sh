#!/bin/sh
# Autoheal — restarts any container Docker has marked "unhealthy".
#
# Every service in this stack has a HEALTHCHECK, but plain `restart:
# unless-stopped` only reacts to a container actually exiting/crashing — it
# does NOT react to a healthcheck failing while the process stays alive
# (e.g. an event-loop stall or a stuck connection pool). Without this, a
# degraded-but-not-crashed backend can sit "unhealthy" indefinitely, with
# every proxied domain affected, until someone restarts it by hand.
#
# Talks to the Docker API over the existing read-write socket-proxy (the
# same one the watchdog already uses) instead of mounting the raw
# docker.sock into yet another container.

DOCKER_API_HOST="${DOCKER_API_HOST:-socket-proxy-rw:2375}"
INTERVAL="${AUTOHEAL_INTERVAL:-15}"
API="http://${DOCKER_API_HOST}"

echo "[autoheal] watching for unhealthy containers via ${API}, interval=${INTERVAL}s"

while true; do
  filters='{"health":["unhealthy"]}'
  response=$(curl -sf -G "${API}/containers/json" --data-urlencode "filters=${filters}" 2>/dev/null)

  if [ -n "$response" ]; then
    echo "$response" | jq -r '.[] | .Id + " " + (.Names[0] // .Id)' | while read -r id name; do
      [ -z "$id" ] && continue
      echo "[autoheal] $(date) — $name ($id) is unhealthy, restarting"
      if curl -sf -X POST "${API}/containers/${id}/restart?t=10" >/dev/null 2>&1; then
        echo "[autoheal] $(date) — restarted $name"
      else
        echo "[autoheal] $(date) — FAILED to restart $name"
      fi
    done
  fi

  sleep "$INTERVAL"
done
