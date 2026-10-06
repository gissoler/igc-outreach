#!/usr/bin/env bash
# Instala Crawl4AI (lector de páginas con navegador, en tu propia instancia) y apaga Firecrawl.
#   sudo bash /opt/outreach/deploy/crawl4ai.sh          # instalar, encender y apagar Firecrawl
#   sudo bash /opt/outreach/deploy/crawl4ai.sh off      # apagar Crawl4AI (no toca Firecrawl)
# Idempotente. El servidor solo escucha en 127.0.0.1 (nada de internet lo alcanza). Sin créditos por página.
# Variables opcionales: CRAWL4AI_IMAGE (por defecto unclecode/crawl4ai:latest), CRAWL4AI_PORT (11235), FIRECRAWL_OFF=0 para NO apagar Firecrawl.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/outreach}"; APP_USER="${APP_USER:-outreach}"; ENV_R="$APP_DIR/research/.env"
IMAGE="${CRAWL4AI_IMAGE:-unclecode/crawl4ai:latest}"; PORT="${CRAWL4AI_PORT:-11235}"; NAME="crawl4ai"
[[ $EUID -eq 0 ]] || { echo "Corre esto con sudo."; exit 1; }
[[ -f "$ENV_R" ]] || { echo "No existe $ENV_R (corre setup.sh primero)."; exit 1; }

set_env() {   # set_env CLAVE valor  (sin imprimir el resto del .env)
  if grep -q "^$1=" "$ENV_R"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_R"; else echo "$1=$2" >> "$ENV_R"; fi
  chown "$APP_USER:$APP_USER" "$ENV_R"; chmod 600 "$ENV_R"
}
unset_env() { sed -i "/^$1=/d" "$ENV_R"; }

if [[ "${1:-on}" == "off" ]]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  unset_env CRAWL4AI_URL; unset_env CRAWL4AI_TOKEN; systemctl restart outreach-research
  echo "Crawl4AI apagado (Firecrawl no se tocó)."; exit 0
fi

main() {
  # 1) Memoria: el navegador del contenedor necesita ~2 GB. En instancias chicas se añade swap (una sola vez).
  local mem_mb; mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if (( mem_mb < 3072 )) && ! swapon --show | grep -q '/swapfile'; then
    echo "==> RAM ${mem_mb} MB: creando 2 GB de swap"
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile; mkswap /swapfile >/dev/null; swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  (( mem_mb >= 2000 )) || echo "AVISO: ${mem_mb} MB de RAM es poco para Crawl4AI; si se cae, sube la instancia."
  # 2) Docker
  if ! command -v docker >/dev/null 2>&1; then
    echo "==> Instalando Docker"; apt-get update -qq && apt-get install -y -qq docker.io
    systemctl enable --now docker
  fi
  # 3) Contenedor: solo localhost, reinicio automático, memoria compartida para Chromium.
  echo "==> Crawl4AI ($IMAGE)"
  docker pull "$IMAGE"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # Token propio y fijo (si no, el servidor genera uno temporal en cada arranque y la app no lo conoce).
  TOKEN="$(grep '^CRAWL4AI_TOKEN=' "$ENV_R" | cut -d= -f2- || true)"; [[ -n "$TOKEN" ]] || TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  docker run -d --name "$NAME" --restart unless-stopped --shm-size=1g -e CRAWL4AI_API_TOKEN="$TOKEN" -p "127.0.0.1:$PORT:11235" "$IMAGE" >/dev/null
  # 4) Esperar a que responda (el primer arranque tarda).
  healthy() { curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; }
  for i in $(seq 1 60); do healthy && break; sleep 3; done
  healthy || { echo "Crawl4AI no respondió en /health:"; docker logs --tail 30 "$NAME"; exit 1; }
  # 5) Encender en la app; Firecrawl se apaga con una variable (la clave se queda en el .env, sin usarse).
  set_env CRAWL4AI_URL "http://127.0.0.1:$PORT"; set_env CRAWL4AI_TOKEN "$TOKEN"
  [[ "${FIRECRAWL_OFF:-1}" == "0" ]] || set_env FIRECRAWL_DISABLED 1
  systemctl restart outreach-research
  sleep 3
  systemctl is-active --quiet outreach-research || { echo "El servicio no arrancó:"; journalctl -u outreach-research -n 40 --no-pager; exit 1; }
  echo "Listo: Crawl4AI en 127.0.0.1:$PORT${FIRECRAWL_OFF:+ y Firecrawl desactivado (FIRECRAWL_DISABLED=1)}."
}
main "$@"
