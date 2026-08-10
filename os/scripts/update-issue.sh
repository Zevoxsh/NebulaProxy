#!/bin/sh
# Regenerates /etc/issue with this host's IPs, the same trick pfSense/Proxmox
# use for their console banner: getty prints /etc/issue at every login
# prompt automatically, so no custom console daemon is needed — just keep
# this file up to date. Run once at boot by nebulaproxy-issue.service.
set -eu

OUT=/etc/issue
PORT="${NEBULAPROXY_PORT:-3001}"
BACKEND_PORT="${NEBULAPROXY_BACKEND_PORT:-3000}"
ENV_FILE=/opt/nebulaproxy/.env.nebula

# install-late.sh pins SETUP_ACCESS_TOKEN into .env.nebula at install time
# specifically so it can be printed here — otherwise backend/setup-server.js
# generates a random one on every boot and only logs it to `docker logs`,
# which meant SSHing in and grepping container output just to find the
# setup URL. Harmless to keep showing after setup is complete: the token
# stops meaning anything once the normal app takes over (no /setup route
# there), it's just a dead link at that point.
SETUP_TOKEN=""
if [ -f "$ENV_FILE" ]; then
  SETUP_TOKEN=$(grep '^SETUP_ACCESS_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)
fi

get_ips() {
  # Exclude Docker's own bridges/veths — noise, not how anyone reaches this
  # box (the app itself runs with network_mode: host, see docker-compose.yml).
  ip -4 -o addr show scope global 2>/dev/null \
    | awk '{print $2, $4}' \
    | grep -Ev '^(docker|br-|veth)' \
    | awk '{print $2}' | cut -d/ -f1
}

# network-online.target is only a soft guarantee on a plain ifupdown setup —
# it can be reached before DHCP has actually handed out a lease. This used
# to check once and print "No network interface configured yet" if it lost
# that race, then never update again (nothing re-triggers a systemd
# oneshot) — leaving the console stuck on that message even seconds later
# once the box actually had an IP. Retry for up to 30s before giving up.
ips=""
i=0
while [ "$i" -lt 15 ]; do
  ips=$(get_ips)
  [ -n "$ips" ] && break
  i=$((i + 1))
  sleep 2
done

{
  echo ""
  echo "  NebulaProxyV4"
  echo "  ------------------------------------------------------------"

  if [ -z "$ips" ]; then
    echo "  No network interface configured yet."
  else
    for ip in $ips; do
      echo "  Web UI:  http://$ip:$PORT/"
      if [ -n "$SETUP_TOKEN" ]; then
        echo "  Setup:   http://$ip:$BACKEND_PORT/setup?token=$SETUP_TOKEN"
      fi
    done
  fi

  echo ""
  echo "  Log in here for a shell, or use the Web UI above to configure"
  echo "  NebulaProxy (first visit runs the setup wizard)."
  echo ""
} > "$OUT"
