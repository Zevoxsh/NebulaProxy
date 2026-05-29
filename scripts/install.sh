#!/bin/sh

set -e

# Root check
if [ "$(id -u)" != "0" ]; then
  echo "[ERROR] Ce script doit être exécuté en root"
  exit 1
fi

echo "🧠 Détection du système"

# Détection package manager
if command -v apk >/dev/null 2>&1; then
  PM="apk"
elif command -v apt >/dev/null 2>&1; then
  PM="apt"
elif command -v dnf >/dev/null 2>&1; then
  PM="dnf"
elif command -v yum >/dev/null 2>&1; then
  PM="yum"
elif command -v pacman >/dev/null 2>&1; then
  PM="pacman"
else
  echo "[ERROR] Gestionnaire de paquets non supporté"
  exit 1
fi

echo "[PKG] Package manager détecté : $PM"

install_packages() {
  case "$PM" in
    apk)
      apk update
      apk add --no-cache curl git nodejs npm docker docker-cli docker-compose certbot
      ;;
    apt)
      apt-get update
      apt-get install -y curl git ca-certificates gnupg lsb-release certbot nodejs npm

      # Install Docker via official apt repository (avoids curl|sh pattern)
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
$(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
      apt-get update
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    dnf|yum)
      $PM install -y curl git certbot nodejs npm
      $PM install -y docker docker-compose-plugin || true
      ;;
    pacman)
      pacman -Sy --noconfirm \
        curl \
        git \
        nodejs \
        npm \
        docker \
        docker-compose \
        certbot
      ;;
  esac
}

install_packages

start_docker() {
  echo "🐳 Vérification Docker"

  if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] Docker non installé"
    exit 1
  fi

  if docker info >/dev/null 2>&1; then
    echo "[OK] Docker est déjà lancé"
    return
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable docker --now
  elif command -v rc-service >/dev/null 2>&1; then
    rc-update add docker default || true
    rc-service docker start
  else
    echo "[ERROR] Impossible de démarrer Docker (init inconnu)"
    exit 1
  fi

  docker info >/dev/null 2>&1 || {
    echo "[ERROR] Docker n'a pas pu démarrer"
    exit 1
  }

  echo "[OK] Docker lancé"
}

start_docker

# ── Configure Docker daemon (DNS + MTU + IPv6) ────────────────────────────────
configure_docker() {
  echo "[CFG] Configuration du daemon Docker"

  cat > /etc/docker/daemon.json << 'DAEMON_EOF'
{
  "dns": ["1.1.1.1", "8.8.8.8"],
  "mtu": 1450,
  "ipv6": true,
  "fixed-cidr-v6": "fd00:docker::/64"
}
DAEMON_EOF

  # Préférer IPv4 pour les connexions sortantes (évite les timeouts IPv6 vers Docker Hub)
  if ! grep -q "precedence ::ffff:0:0/96 100" /etc/gai.conf 2>/dev/null; then
    echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf
  fi

  # Redémarre Docker pour prendre en compte la config
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart docker
  elif command -v rc-service >/dev/null 2>&1; then
    rc-service docker restart
  fi

  sleep 3
  docker info >/dev/null 2>&1 || { echo "[ERROR] Docker n'a pas redémarré"; exit 1; }
  echo "[OK] Docker configuré"
}

configure_docker

echo "[PKG] Déploiement NebulaProxy"

cd /etc

if [ ! -d NebulaProxy ]; then
  git clone https://github.com/Zevoxsh/NebulaProxy.git
else
  echo "[INFO] Repo déjà présent"
fi

cd NebulaProxy

echo "[PKG] Installation Node"
npm run install:all

# ── Pre-pull Docker images (contourne les timeouts BuildKit) ──────────────────
echo "🐳 Téléchargement des images Docker"
IMAGES="
  node:20.18-alpine
  node:20-alpine
  postgres:16-alpine
  redis:7.4-alpine
  nginx:alpine
  alpine:3.21
  tecnativa/docker-socket-proxy:0.3.0
"
for img in $IMAGES; do
  echo "[PULL] $img"
  docker pull "$img" || { echo "[WARN] Échec pull $img, le build va réessayer"; }
done

echo "🐳 Lancement Docker Compose"
DOCKER_BUILDKIT=0 docker compose up -d --build 2>/dev/null || \
  DOCKER_BUILDKIT=0 docker-compose up -d --build

echo "[OK] Tout est prêt [START]"
