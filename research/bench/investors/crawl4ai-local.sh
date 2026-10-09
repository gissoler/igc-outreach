#!/usr/bin/env bash
# Levanta Crawl4AI en Docker solo en 127.0.0.1 (Mac o Linux) para el benchmark. No toca research/.env:
# escribe CRAWL4AI_URL y CRAWL4AI_TOKEN en research/.env.crawl4ai (ignorado por git, permisos 600).
#   bash research/bench/investors/crawl4ai-local.sh        # encender
#   bash research/bench/investors/crawl4ai-local.sh off    # apagar
set -euo pipefail
cd "$(dirname "$0")/../.."            # → research/
IMAGE="${CRAWL4AI_IMAGE:-unclecode/crawl4ai:latest}"; PORT="${CRAWL4AI_PORT:-11235}"; NAME="crawl4ai-bench"; ENVF=".env.crawl4ai"
if [[ "${1:-on}" == "off" ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f "$ENVF"; echo "Crawl4AI apagado."; exit 0; fi
command -v docker >/dev/null 2>&1 || { echo "No hay Docker. Instala Docker Desktop (https://www.docker.com/products/docker-desktop/) y vuelve a correr."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker está instalado pero no está corriendo: abre Docker Desktop y vuelve a correr."; exit 1; }
TOKEN="$(grep '^CRAWL4AI_TOKEN=' "$ENVF" 2>/dev/null | cut -d= -f2- || true)"; [[ -n "$TOKEN" ]] || TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "==> Descargando y arrancando $IMAGE (la primera vez tarda unos minutos)"
  docker pull "$IMAGE" >/dev/null
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --shm-size=1g -e CRAWL4AI_API_TOKEN="$TOKEN" -p "127.0.0.1:$PORT:11235" "$IMAGE" >/dev/null
fi
healthy() { curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; }
for i in $(seq 1 80); do healthy && break; sleep 3; done
healthy || { echo "Crawl4AI no respondió en /health:"; docker logs --tail 30 "$NAME"; exit 1; }
umask 077; printf 'CRAWL4AI_URL=http://127.0.0.1:%s\nCRAWL4AI_TOKEN=%s\n' "$PORT" "$TOKEN" > "$ENVF"
echo "Crawl4AI listo en 127.0.0.1:$PORT (variables en research/$ENVF)."
