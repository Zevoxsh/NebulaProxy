#!/bin/bash
# Runs inside the target chroot at the end of the Debian install (invoked
# by preseed/preseed.cfg's late_command, via `in-target`). At this point
# the NebulaProxyV4 source tree has already been copied to /opt/nebulaproxy
# by late_command itself.
#
# Deliberately NOT `set -e`: the old version installed Docker first and
# died there under `set -e` on any hiccup (network/DNS not fully up yet
# inside the installer chroot, upstream outage, ...) — which skipped
# EVERYTHING after it, including the systemd units and the console IP
# banner. That turned one flaky curl into a machine with no Docker AND no
# way to tell it apart from a plain Debian box. Cheap, essential steps go
# first; Docker (the one genuinely network-dependent, failure-prone step)
# goes last with a fallback, and every step logs pass/fail instead of
# letting a `set -e` abort hide what happened.
set -u

APP_DIR=/opt/nebulaproxy
LOG=/var/log/nebulaproxy-install.log
exec > >(tee -a "$LOG") 2>&1

echo "=== NebulaProxyV4 install-late.sh started $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="

echo "==> Installing NebulaProxyV4 systemd units"
if install -m 644 "$APP_DIR"/os/systemd/*.service /etc/systemd/system/ \
   && chmod +x "$APP_DIR"/os/scripts/*.sh \
   && systemctl enable nebulaproxy-issue.service \
   && systemctl enable nebulaproxy.service; then
  echo "==> systemd units installed and enabled OK"
else
  echo "!! FAILED installing/enabling systemd units — see errors above"
fi

echo "==> Installing Docker Engine"
if curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh; then
  systemctl enable docker
  echo "==> Docker installed via get.docker.com"
elif apt-get update && apt-get install -y docker.io docker-compose-v2; then
  systemctl enable docker
  echo "==> Docker installed via apt fallback (docker.io + docker-compose-v2)"
else
  echo "!! Docker install FAILED (get.docker.com and apt fallback both failed)."
  echo "!! Fix manually once logged in: apt-get install docker.io docker-compose-v2"
  echo "!! then: systemctl enable --now docker && systemctl start nebulaproxy.service"
fi

echo "=== install-late.sh finished $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
echo "=== Full log kept at $LOG ==="
