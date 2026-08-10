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

echo "==> Rebranding the installed system's own identity"
# Everything in os/branding/ + build-iso.sh only skins the INSTALLER media
# — the machine you actually boot afterward is a separate GRUB config,
# generated fresh by grub-mkconfig from THIS system's own /etc/os-release
# and /etc/default/grub (grub-installer already ran this once during
# install, using stock Debian values, before late_command ever got a
# chance to run). Fix the source fields, then regenerate.
sed -i 's/^PRETTY_NAME=.*/PRETTY_NAME="NebulaProxyV4"/' /etc/os-release
sed -i 's/^NAME=.*/NAME="NebulaProxyV4"/' /etc/os-release
if grep -q '^GRUB_DISTRIBUTOR=' /etc/default/grub; then
  sed -i 's/^GRUB_DISTRIBUTOR=.*/GRUB_DISTRIBUTOR="NebulaProxyV4"/' /etc/default/grub
else
  echo 'GRUB_DISTRIBUTOR="NebulaProxyV4"' >> /etc/default/grub
fi
update-grub 2>&1 || grub-mkconfig -o /boot/grub/grub.cfg 2>&1
cat > /etc/motd <<'EOF'

  NebulaProxyV4
  ------------------------------------------------------------
  Manage this appliance from a browser — the URL is on the console
  login screen.

EOF
echo "==> Rebranding done"

echo "==> Generating a stable setup-wizard access token"
# Without this, backend/setup-server.js auto-generates a random token
# EVERY container start and only ever prints it to `docker logs` — which
# meant finding it required SSHing in and grepping container logs, not
# exactly "look at the screen and go". Pinning it here (env_file'd into
# the backend the same way DB/Redis creds already are) means
# update-issue.sh can print the full setup URL — token included — right
# on the console banner instead. Same 40-char alnum idiom
# postgres/entrypoint.sh and redis/entrypoint.sh already use for their
# own auto-generated secrets.
ENV_FILE="$APP_DIR/.env.nebula"
if ! grep -q '^SETUP_ACCESS_TOKEN=' "$ENV_FILE" 2>/dev/null; then
  SETUP_TOKEN=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 48)
  echo "SETUP_ACCESS_TOKEN=$SETUP_TOKEN" >> "$ENV_FILE"
  echo "==> Setup token written to $ENV_FILE"
else
  echo "==> Setup token already present in $ENV_FILE, leaving as-is"
fi

echo "==> Installing NebulaProxyV4 systemd units"
if install -m 644 "$APP_DIR"/os/systemd/*.service /etc/systemd/system/ \
   && chmod +x "$APP_DIR"/os/scripts/*.sh \
   && systemctl enable nebulaproxy-issue.service \
   && systemctl enable nebulaproxy.service; then
  echo "==> systemd units installed and enabled OK"
else
  echo "!! FAILED installing/enabling systemd units — see errors above"
fi

echo "==> Removing stale cdrom: apt source (install media, gone by now — a"
echo "    dead cdrom: entry fails apt-get update entirely, not just itself)"
sed -i '/^deb cdrom:/d' /etc/apt/sources.list

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
