#!/bin/bash
# Runs inside the target chroot at the end of the Debian install (invoked
# by preseed/preseed.cfg's late_command, via `in-target`). At this point
# the NebulaProxyV4 source tree has already been copied to /opt/nebulaproxy
# by late_command itself — this script only wires up Docker + systemd.
set -euo pipefail

APP_DIR=/opt/nebulaproxy

echo "==> Installing Docker Engine"
curl -fsSL https://get.docker.com | sh
systemctl enable docker

echo "==> Installing NebulaProxyV4 systemd units"
install -m 644 "$APP_DIR"/os/systemd/*.service /etc/systemd/system/
chmod +x "$APP_DIR"/os/scripts/*.sh

echo "==> Enabling NebulaProxyV4 services"
systemctl enable nebulaproxy-issue.service
systemctl enable nebulaproxy.service
