#!/bin/sh
# Regenerates /etc/issue with this host's IPs, the same trick pfSense/Proxmox
# use for their console banner: getty prints /etc/issue at every login
# prompt automatically, so no custom console daemon is needed — just keep
# this file up to date. Run once at boot by nebulaproxy-issue.service.
set -eu

OUT=/etc/issue
PORT="${NEBULAPROXY_PORT:-3001}"

{
  echo ""
  echo "  NebulaProxyV4"
  echo "  ------------------------------------------------------------"

  # Exclude Docker's own bridges/veths — noise, not how anyone reaches this
  # box (the app itself runs with network_mode: host, see docker-compose.yml).
  ips=$(ip -4 -o addr show scope global 2>/dev/null \
    | awk '{print $2, $4}' \
    | grep -Ev '^(docker|br-|veth)' \
    | awk '{print $2}' | cut -d/ -f1)

  if [ -z "$ips" ]; then
    echo "  No network interface configured yet."
  else
    for ip in $ips; do
      echo "  Web UI:  http://$ip:$PORT/"
    done
  fi

  echo ""
  echo "  Log in here for a shell, or use the Web UI above to configure"
  echo "  NebulaProxy (first visit runs the setup wizard)."
  echo ""
} > "$OUT"
