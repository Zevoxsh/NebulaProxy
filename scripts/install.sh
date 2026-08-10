#!/bin/sh
# NebulaProxy — script d'installation automatique
# https://docs.nebula-app.dev
set -e

DOCS_URL="https://docs.nebula-app.dev"
REPO_URL="https://github.com/Zevoxsh/NebulaProxy.git"
INSTALL_DIR="/etc/NebulaProxy"

# ── Couleurs (si terminal le supporte) ────────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
  BLUE='\033[0;34m' CYAN='\033[0;36m' BOLD='\033[1m' NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' CYAN='' BOLD='' NC=''
fi

step() { printf "\n${BOLD}${BLUE}━━ %s${NC}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$1"; }
info() { printf "  ${CYAN}→${NC} %s\n" "$1"; }
fail() {
  printf "\n${RED}${BOLD}✗ ERREUR: %s${NC}\n" "$1"
  printf "  Documentation : %s\n" "$DOCS_URL"
  printf "  Dépannage     : %s/troubleshooting\n\n" "$DOCS_URL"
  exit 1
}

# ── Root check ────────────────────────────────────────────────────────────────
[ "$(id -u)" = "0" ] || fail "Ce script doit être exécuté en root (sudo su -)"

printf "\n${BOLD}${GREEN}"
printf "  ███╗   ██╗███████╗██████╗ ██╗   ██╗██╗      █████╗ \n"
printf "  ████╗  ██║██╔════╝██╔══██╗██║   ██║██║     ██╔══██╗\n"
printf "  ██╔██╗ ██║█████╗  ██████╔╝██║   ██║██║     ███████║\n"
printf "  ██║╚██╗██║██╔══╝  ██╔══██╗██║   ██║██║     ██╔══██║\n"
printf "  ██║ ╚████║███████╗██████╔╝╚██████╔╝███████╗██║  ██║\n"
printf "  ╚═╝  ╚═══╝╚══════╝╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝\n"
printf "${NC}\n"
printf "  ${BOLD}NebulaProxy — Installateur automatique${NC}\n"
printf "  %s\n\n" "$DOCS_URL"

# ── Détection du système ──────────────────────────────────────────────────────
step "Détection du système"

OS_ID=""
OS_VERSION=""
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
  OS_VERSION="${VERSION_ID:-}"
fi

if command -v apt-get >/dev/null 2>&1;  then PM="apt"
elif command -v dnf >/dev/null 2>&1;    then PM="dnf"
elif command -v yum >/dev/null 2>&1;    then PM="yum"
elif command -v apk >/dev/null 2>&1;    then PM="apk"
elif command -v pacman >/dev/null 2>&1; then PM="pacman"
else fail "Gestionnaire de paquets non supporté. Voir: $DOCS_URL/installation"; fi

ok "OS: ${OS_ID:-inconnu} ${OS_VERSION}"
ok "Package manager: $PM"
ok "Arch: $(uname -m)"

# ── Installation des dépendances ──────────────────────────────────────────────
step "Installation des dépendances système"

install_packages() {
  case "$PM" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq curl git ca-certificates gnupg lsb-release nodejs npm

      if ! command -v docker >/dev/null 2>&1; then
        info "Installation de Docker via dépôt officiel..."
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
          | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
        chmod a+r /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} $(lsb_release -cs) stable" \
          > /etc/apt/sources.list.d/docker.list
        apt-get update -qq
        apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
          docker-buildx-plugin docker-compose-plugin
      fi
      ;;
    dnf|yum)
      $PM install -y -q curl git nodejs npm
      if ! command -v docker >/dev/null 2>&1; then
        $PM install -y -q docker docker-compose-plugin 2>/dev/null || \
          curl -fsSL https://get.docker.com | sh
      fi
      ;;
    apk)
      apk update -q
      apk add --no-cache -q curl git nodejs npm docker docker-cli docker-compose
      ;;
    pacman)
      pacman -Sy --noconfirm --quiet curl git nodejs npm docker docker-compose
      ;;
  esac
}

install_packages
ok "Dépendances installées"

# ── Démarrage de Docker ───────────────────────────────────────────────────────
step "Démarrage de Docker"

start_docker() {
  command -v docker >/dev/null 2>&1 || \
    fail "Docker introuvable après installation. Voir: $DOCS_URL/installation"

  if docker info >/dev/null 2>&1; then
    ok "Docker est déjà actif"
    return 0
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable docker --now 2>/dev/null || true
  elif command -v rc-service >/dev/null 2>&1; then
    rc-update add docker default 2>/dev/null || true
    rc-service docker start
  fi

  sleep 3
  docker info >/dev/null 2>&1 || \
    fail "Docker n'a pas démarré. Voir: $DOCS_URL/troubleshooting#docker"
  ok "Docker démarré"
}

start_docker

# ── Diagnostic réseau ─────────────────────────────────────────────────────────
step "Diagnostic réseau automatique"

# Détecter le MTU de l'interface principale
PRIMARY_IF=$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')
HOST_MTU=1500
if [ -n "$PRIMARY_IF" ]; then
  MTU_RAW=$(ip link show "$PRIMARY_IF" 2>/dev/null | awk '/mtu/ {print $5; exit}')
  [ -n "$MTU_RAW" ] && HOST_MTU="$MTU_RAW"
fi
# MTU Docker = MTU hôte - 50 (overhead tunnel/VLAN), plafonné à 1450
DOCKER_MTU=$((HOST_MTU - 50))
[ "$DOCKER_MTU" -gt 1450 ] && DOCKER_MTU=1450
[ "$DOCKER_MTU" -lt 1280 ] && DOCKER_MTU=1280
info "Interface principale : ${PRIMARY_IF:-inconnue} (MTU hôte: ${HOST_MTU} → MTU Docker: ${DOCKER_MTU})"

# Tester la connectivité IPv4 vers Docker Hub
IPV4_OK=0
IPV6_OK=0
info "Test connectivité Docker Hub..."
CODE4=$(curl -4 -s --max-time 8 -o /dev/null -w "%{http_code}" \
  https://registry-1.docker.io/v2/ 2>/dev/null || echo "000")
{ [ "$CODE4" = "200" ] || [ "$CODE4" = "401" ]; } && IPV4_OK=1

CODE6=$(curl -6 -s --max-time 8 -o /dev/null -w "%{http_code}" \
  https://registry-1.docker.io/v2/ 2>/dev/null || echo "000")
{ [ "$CODE6" = "200" ] || [ "$CODE6" = "401" ]; } && IPV6_OK=1

[ "$IPV4_OK" = "1" ] && ok "Docker Hub joignable en IPv4" || \
  warn "Docker Hub non joignable en IPv4 (code HTTP: $CODE4)"
[ "$IPV6_OK" = "1" ] && ok "Docker Hub joignable en IPv6" || \
  info "Docker Hub non joignable en IPv6 (fréquent, non bloquant)"

[ "$IPV4_OK" = "0" ] && [ "$IPV6_OK" = "0" ] && \
  fail "Aucune connectivité vers Docker Hub. Vérifiez le réseau. Voir: $DOCS_URL/troubleshooting#network"

# Fix automatique : préférer IPv4 si IPv6 ne fonctionne pas vers Docker Hub
if [ "$IPV4_OK" = "1" ] && [ "$IPV6_OK" = "0" ]; then
  if ! grep -q "precedence ::ffff:0:0/96" /etc/gai.conf 2>/dev/null; then
    echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf
    ok "Fix appliqué : priorité IPv4 pour connexions sortantes (gai.conf)"
  else
    ok "Priorité IPv4 déjà configurée (gai.conf)"
  fi
fi

# ── Détection IP publique ─────────────────────────────────────────────────────
step "Détection des IPs publiques"

PUBLIC_IP=""
PUBLIC_IPV6=""

# IPv4 publique — essayer plusieurs services
for svc in "https://api.ipify.org" "https://icanhazip.com" "https://ifconfig.me/ip"; do
  CANDIDATE=$(curl -4 -s --max-time 5 "$svc" 2>/dev/null | tr -d '[:space:]')
  if echo "$CANDIDATE" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    PUBLIC_IP="$CANDIDATE"
    break
  fi
done

# IPv6 publique — essayer plusieurs services
for svc in "https://api6.ipify.org" "https://v6.ident.me" "https://ipv6.icanhazip.com"; do
  CANDIDATE6=$(curl -6 -s --max-time 5 "$svc" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$CANDIDATE6" ] && echo "$CANDIDATE6" | grep -q ":"; then
    PUBLIC_IPV6="$CANDIDATE6"
    break
  fi
done

[ -n "$PUBLIC_IP" ]   && ok "IPv4 publique : $PUBLIC_IP"   || warn "IPv4 publique non détectée"
[ -n "$PUBLIC_IPV6" ] && ok "IPv6 publique : $PUBLIC_IPV6" || info "IPv6 publique non détectée (optionnel)"

# ── Configuration du daemon Docker ────────────────────────────────────────────
step "Configuration du daemon Docker"

configure_docker() {
  cat > /etc/docker/daemon.json << DAEMON_EOF
{
  "dns": ["1.1.1.1", "8.8.8.8"],
  "mtu": ${DOCKER_MTU},
  "ipv6": true,
  "fixed-cidr-v6": "fd00:docker::/64"
}
DAEMON_EOF

  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart docker 2>/dev/null || true
  elif command -v rc-service >/dev/null 2>&1; then
    rc-service docker restart 2>/dev/null || true
  fi

  sleep 3
  docker info >/dev/null 2>&1 || \
    fail "Docker n'a pas redémarré après configuration. Voir: $DOCS_URL/troubleshooting#docker"
  ok "Daemon Docker configuré (MTU: ${DOCKER_MTU}, DNS: 1.1.1.1 / 8.8.8.8)"
}

configure_docker

# ── Clonage / mise à jour du dépôt ───────────────────────────────────────────
step "Déploiement de NebulaProxy"

if [ ! -d "$INSTALL_DIR" ]; then
  info "Clonage du dépôt..."
  git clone "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || \
    fail "Impossible de cloner le dépôt Git. Voir: $DOCS_URL/installation"
  ok "Dépôt cloné dans $INSTALL_DIR"
else
  info "Mise à jour du dépôt existant..."
  cd "$INSTALL_DIR"
  git pull 2>/dev/null && ok "Dépôt mis à jour" || warn "git pull échoué — installation locale conservée"
fi

cd "$INSTALL_DIR"

# Écrire les IPs publiques dans .env.nebula (chargé par docker-compose)
{
  echo "# Généré par install.sh le $(date -u '+%Y-%m-%d %H:%M UTC')"
  [ -n "$PUBLIC_IP" ]   && echo "PUBLIC_IP=$PUBLIC_IP"
  [ -n "$PUBLIC_IPV6" ] && echo "PUBLIC_IPV6=$PUBLIC_IPV6"
} > .env.nebula
ok "IPs publiques sauvegardées (.env.nebula)"

# ── Installation Node.js ──────────────────────────────────────────────────────
step "Installation des dépendances Node.js"
npm run install:all 2>/dev/null || \
  fail "npm install a échoué. Voir: $DOCS_URL/troubleshooting#npm"
ok "Dépendances Node.js installées"

# ── Téléchargement des images Docker ─────────────────────────────────────────
step "Téléchargement des images Docker"
info "Pré-téléchargement pour éviter les timeouts BuildKit..."

IMAGES="node:20.18-alpine node:20-alpine postgres:16-alpine redis:7.4-alpine nginx:alpine alpine:3.21 tecnativa/docker-socket-proxy:0.3.0"

pull_with_retry() {
  local img="$1"
  local attempt=1
  while [ $attempt -le 3 ]; do
    printf "  ${CYAN}→${NC} %-45s" "$img (tentative $attempt/3)..."
    if docker pull "$img" > /tmp/nebula_pull.log 2>&1; then
      printf "${GREEN}✓${NC}\n"
      return 0
    fi
    printf "${YELLOW}⚠${NC}\n"
    attempt=$((attempt + 1))
    [ $attempt -le 3 ] && sleep 5
  done
  warn "Impossible de pré-télécharger $img — le build réessaiera automatiquement"
  return 0
}

for img in $IMAGES; do
  pull_with_retry "$img"
done

# ── Build et démarrage ────────────────────────────────────────────────────────
step "Build et démarrage des services"

# Exporter les IPs pour docker compose
export PUBLIC_IP PUBLIC_IPV6

build_and_start() {
  info "Build avec BuildKit (tentative 1/2)..."
  if docker compose up -d --build > /tmp/nebula_build.log 2>&1; then
    ok "Services démarrés avec BuildKit"
    return 0
  fi

  warn "BuildKit a échoué — nouvelle tentative sans BuildKit..."
  if DOCKER_BUILDKIT=0 docker compose up -d --build > /tmp/nebula_build.log 2>&1; then
    ok "Services démarrés sans BuildKit"
    return 0
  fi

  # Afficher le log en cas d'échec total
  printf "\n${RED}Logs du build :${NC}\n"
  tail -30 /tmp/nebula_build.log 2>/dev/null || true
  fail "Build Docker échoué. Voir le log ci-dessus ou: $DOCS_URL/troubleshooting#build"
}

build_and_start

# ── Résumé final ──────────────────────────────────────────────────────────────
printf "\n${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${GREEN}║     ✓  NebulaProxy installé avec succès !        ║${NC}\n"
printf "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}\n\n"

printf "  ${BOLD}Accès à l'interface :${NC}\n"
if [ -n "$PUBLIC_IP" ]; then
  printf "    http://${BOLD}%s${NC}:3001\n" "$PUBLIC_IP"
  [ -n "$PUBLIC_IPV6" ] && printf "    http://${BOLD}[%s]${NC}:3001\n" "$PUBLIC_IPV6"
else
  printf "    http://${BOLD}<votre-ip-publique>${NC}:3001\n"
fi
printf "\n  ${BOLD}Complétez l'assistant de configuration pour démarrer.${NC}\n"
printf "\n  Documentation    : ${CYAN}%s${NC}\n"         "$DOCS_URL"
printf "  Dépannage        : ${CYAN}%s/troubleshooting${NC}\n\n" "$DOCS_URL"
