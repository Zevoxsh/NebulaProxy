#!/bin/bash
# NebulaProxy — Host firewall setup for network_mode: host backend
#
# The backend container runs with network_mode: host, meaning it shares the
# host's network stack. This script restricts which services on the host can
# be reached from connections coming through the proxy.
#
# Apply once after first install:  sudo bash scripts/setup-firewall.sh
# Reload on boot via:              systemd service or /etc/rc.local
#
# Requires: iptables (Linux), run as root.

set -euo pipefail

PROXY_USER="nobody"        # or the actual user the backend runs as inside the container
INTERNAL_IFACE="lo"        # loopback — redis/postgres are on 127.0.0.1

log() { echo "[firewall] $*"; }

# ── Validate environment ────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Must be run as root (sudo bash $0)" >&2
  exit 1
fi

if ! command -v iptables &>/dev/null; then
  echo "ERROR: iptables not found. Install with: apt-get install iptables" >&2
  exit 1
fi

log "Configuring OUTPUT rules for NebulaProxy backend (network_mode: host)"

# ── Allow established/related connections ───────────────────────────────────
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true

# ── Allow DNS (required for backend hostname resolution) ────────────────────
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# ── Allow outbound HTTPS/HTTP (ACME challenges, external APIs) ──────────────
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 80 -j ACCEPT

# ── Allow SMTP (if SMTP proxy enabled) ──────────────────────────────────────
iptables -A OUTPUT -p tcp --dport 25 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 587 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 465 -j ACCEPT

# ── Allow loopback (Redis :6379, PostgreSQL :5432, backend API :3000) ────────
iptables -A OUTPUT -o "$INTERNAL_IFACE" -j ACCEPT

# ── Allow Docker socket proxy ───────────────────────────────────────────────
iptables -A OUTPUT -d 172.20.0.0/16 -p tcp --dport 2375 -j ACCEPT

# ── Block access to cloud metadata endpoints (AWS, GCP, Azure) ──────────────
# Prevents SSRF from reaching instance metadata services.
iptables -A OUTPUT -d 169.254.169.254/32 -j DROP
iptables -A OUTPUT -d 169.254.170.2/32 -j DROP

log "Rules applied. To persist across reboots, install iptables-persistent:"
log "  apt-get install iptables-persistent && netfilter-persistent save"
log ""
log "Current OUTPUT rules:"
iptables -L OUTPUT -n --line-numbers
