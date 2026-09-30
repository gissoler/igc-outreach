#!/usr/bin/env bash
# Túnel SSH de tu Mac al modelo Qwen3-30B que YA corre en g355. No arranca ni toca nada en g355.
#   bash research/scripts/tunnel-g355.sh          # abre el túnel y se queda en primer plano (Ctrl-C lo cierra)
#   bash research/scripts/tunnel-g355.sh bg       # lo abre en segundo plano y te devuelve la terminal
#   bash research/scripts/tunnel-g355.sh status   # ¿está abierto y responde el modelo?
#   bash research/scripts/tunnel-g355.sh stop     # cierra el túnel abierto con "bg"
#
# Qué hace exactamente:
#   ssh -N -L 127.0.0.1:18000:127.0.0.1:8000 voltage-park
#   - Abre UNA conexión SSH a g355 (el alias "voltage-park" de tu ~/.ssh/config).
#   - -N: no ejecuta ningún comando en g355, solo mantiene la conexión.
#   - -L: reenvía el puerto 18000 de TU Mac (solo local, 127.0.0.1) al puerto 8000 de g355, donde ya escucha
#     el servidor del modelo. Así http://127.0.0.1:18000/v1 en tu Mac equivale al modelo de g355.
#   - Nada se instala ni se escribe en g355; al cerrar el túnel, el puerto 18000 deja de existir en tu Mac.
# El backend (npm start) solo necesita que 127.0.0.1:18000 responda; lo apunta el bloque del .env de app-engine.sh.
set -uo pipefail
HOST="${G355_HOST:-voltage-park}"; PORT="${TUNNEL_PORT:-18000}"
SOCK="${TMPDIR:-/tmp}/outreach-tunel-g355.sock"
up() { curl -s -m 6 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; }
case "${1:-fg}" in
  fg)
    up && { echo "Ya hay un túnel respondiendo en el puerto $PORT."; exit 0; }
    echo "Túnel: $PORT → g355:8000 (Qwen3-30B). Ctrl-C para cerrar."
    exec ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L "127.0.0.1:$PORT:127.0.0.1:8000" "$HOST" ;;
  bg)
    up && { echo "Ya hay un túnel respondiendo en el puerto $PORT."; exit 0; }
    ssh -f -N -M -S "$SOCK" -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
      -L "127.0.0.1:$PORT:127.0.0.1:8000" "$HOST" || { echo "No pude abrir el túnel (¿VPN/SSH? ¿algo usa el puerto $PORT?)."; exit 1; }
    up && echo "Túnel abierto en segundo plano. Modelo: responde. Ciérralo con:  bash $0 stop" || echo "Túnel abierto pero el modelo no responde (¿sigue cargado en g355:8000?)." ;;
  status)
    if up; then echo "Túnel en $PORT: ABIERTO y el modelo responde."; else echo "Túnel en $PORT: cerrado o el modelo no responde."; exit 1; fi ;;
  stop)
    ssh -S "$SOCK" -O exit "$HOST" 2>/dev/null && echo "Túnel cerrado." || echo "No hay túnel abierto con 'bg' (si lo abriste en primer plano, Ctrl-C en su terminal)." ;;
  *) echo "uso: fg | bg | status | stop"; exit 2 ;;
esac
