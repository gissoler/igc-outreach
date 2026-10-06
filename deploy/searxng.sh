#!/usr/bin/env bash
# Instala SearXNG (metabuscador propio, sin créditos) y lo usa como búsqueda web de grants en lugar de Firecrawl.
#   sudo bash /opt/outreach/deploy/searxng.sh                 # instalar y encender (SEARCH_PROVIDER=searxng)
#   sudo bash /opt/outreach/deploy/searxng.sh test "consulta"  # probar una consulta (muestra los primeros resultados)
#   sudo bash /opt/outreach/deploy/searxng.sh off              # volver a Firecrawl (SEARCH_PROVIDER se borra)
# Idempotente. Solo escucha en 127.0.0.1. Variables: SEARXNG_PORT (8888), SEARXNG_IMAGE (searxng/searxng:latest).
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/outreach}"; APP_USER="${APP_USER:-outreach}"; ENV_R="$APP_DIR/research/.env"
IMAGE="${SEARXNG_IMAGE:-searxng/searxng:latest}"; PORT="${SEARXNG_PORT:-8888}"; NAME="searxng"; CONF=/opt/searxng
[[ $EUID -eq 0 ]] || { echo "Corre esto con sudo."; exit 1; }

set_env() { if grep -q "^$1=" "$ENV_R"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_R"; else echo "$1=$2" >> "$ENV_R"; fi; chown "$APP_USER:$APP_USER" "$ENV_R"; chmod 600 "$ENV_R"; }
unset_env() { sed -i "/^$1=/d" "$ENV_R"; }

case "${1:-on}" in
  off)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    unset_env SEARCH_PROVIDER; unset_env SEARXNG_URL; systemctl restart outreach-research
    echo "SearXNG apagado; la búsqueda vuelve a Firecrawl."; exit 0;;
  test)
    q="${2:-NIH SBIR Phase II clinical trial Alzheimer funding opportunity}"
    curl -fsS --get "http://127.0.0.1:$PORT/search" --data-urlencode "q=$q" -d format=json | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("results",[]); print(len(r),"resultados"); [print("-",x.get("title","")[:90],"|",x.get("url","")) for x in r[:10]]'
    exit 0;;
esac

[[ -f "$ENV_R" ]] || { echo "No existe $ENV_R (corre setup.sh primero)."; exit 1; }
if ! command -v docker >/dev/null 2>&1; then echo "==> Instalando Docker"; apt-get update -qq && apt-get install -y -qq docker.io; systemctl enable --now docker; fi
mkdir -p "$CONF"
if [[ ! -f "$CONF/settings.yml" ]]; then
  cat > "$CONF/settings.yml" <<YML
use_default_settings: true
server:
  secret_key: "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  limiter: false
  image_proxy: false
search:
  safe_search: 0
  formats:
    - html
    - json
YML
fi
echo "==> SearXNG ($IMAGE)"
docker pull "$IMAGE"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped -p "127.0.0.1:$PORT:8080" -v "$CONF:/etc/searxng" "$IMAGE" >/dev/null
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/search?q=test&format=json" >/dev/null 2>&1 && break; sleep 3; done
curl -fsS "http://127.0.0.1:$PORT/search?q=test&format=json" >/dev/null 2>&1 || { echo "SearXNG no respondió con JSON:"; docker logs --tail 30 "$NAME"; exit 1; }
set_env SEARXNG_URL "http://127.0.0.1:$PORT"
set_env SEARCH_PROVIDER searxng
systemctl restart outreach-research; sleep 3
systemctl is-active --quiet outreach-research || { echo "El servicio no arrancó:"; journalctl -u outreach-research -n 40 --no-pager; exit 1; }
echo "Listo: búsqueda web por SearXNG en 127.0.0.1:$PORT (SEARCH_PROVIDER=searxng). Prueba: sudo bash $APP_DIR/deploy/searxng.sh test \"tu consulta\""
