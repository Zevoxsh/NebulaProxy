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

echo "🐳 Lancement Docker Compose"
docker compose up -d --build 2>/dev/null || docker-compose up -d --build

echo "[OK] Tout est prêt [START]"
