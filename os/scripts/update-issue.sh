#!/bin/sh
# Regenerates /etc/issue (and /etc/motd) with this host's IPs, the same
# trick pfSense/Proxmox use for their console banner: getty prints
# /etc/issue at every login prompt automatically, and PAM prints /etc/motd
# right after a successful login — no custom console daemon needed for
# either, just keep both files up to date. Run once at boot by
# nebulaproxy-issue.service. Writing the same content to both means the
# URL is visible whether you're looking at the console before logging in
# or reading the welcome message after SSHing in.
#
# Just the one URL: nginx's /setup location (frontend/nginx.conf) already
# proxies straight to the backend's setup wizard, and setup-server.js has
# no access-token gate anymore — reaching this box's network is enough,
# same trust boundary as SSH/console access already has.
set -eu

ISSUE_OUT=/etc/issue
MOTD_OUT=/etc/motd
PORT="${NEBULAPROXY_PORT:-3001}"

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

BANNER=$(
  echo ""
  echo "  NebulaProxy"
  echo "  ------------------------------------------------------------"

  if [ -z "$ips" ]; then
    echo "  No network interface configured yet."
  else
    for ip in $ips; do
      echo "  Web UI:  http://$ip:$PORT/"
    done
  fi

  echo ""
  echo "  NebulaProxy (first visit runs the setup wizard)."
  echo ""
)

echo "$BANNER" > "$ISSUE_OUT"
echo "$BANNER" > "$MOTD_OUT"
