#!/usr/bin/env bash
# Túnel SSH de tu Mac al modelo Qwen3-30B que YA corre en g355. No arranca ni toca nada en g355.
#   bash research/scripts/tunnel-g355.sh          # abre el túnel y se queda en primer plano (Ctrl-C lo cierra)
#   bash research/scripts/tunnel-g355.sh bg       # lo abre en segundo plano y te devuelve la terminal
#   bash research/scripts/tunnel-g355.sh status   # ¿está abierto y responde el modelo?
#   bash research/scripts/tunnel-g355.sh stop     # cierra el túnel abierto con "bg"
#   bash research/scripts/tunnel-g355.sh dual     # 8016→8016 y 8017→8017, primer plano
#   bash research/scripts/tunnel-g355.sh dual-bg  # los dos túneles en segundo plano
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
DUAL_SOCK="${TMPDIR:-/tmp}/outreach-tunel-g355-v13.sock"
up() { curl -s -m 6 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
model_up() { curl -s -m 6 "http://127.0.0.1:$1/v1/models" >/dev/null 2>&1; }
dual_up() { model_up 8016 && model_up 8017; }
dual_forwards() {
  DUAL_FWD=()
  local p
  for p in 8016 8017; do
    if port_busy "$p"; then
      model_up "$p" || { echo "El puerto local $p está ocupado por otro servicio."; return 1; }
    else
      DUAL_FWD+=(-L "127.0.0.1:$p:127.0.0.1:$p")
    fi
  done
}
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
  dual)
    dual_up && { echo "Los dos modelos ya responden en 8016 y 8017."; exit 0; }
    dual_forwards || exit 1
    echo "Túneles faltantes hacia g355: 8016 y 8017. Ctrl-C para cerrar."
    exec ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes "${DUAL_FWD[@]}" "$HOST" ;;
  dual-bg)
    dual_up && { echo "Los dos modelos ya responden en 8016 y 8017."; exit 0; }
    dual_forwards || exit 1
    ssh -f -N -M -S "$DUAL_SOCK" -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
      "${DUAL_FWD[@]}" "$HOST" || exit 1
    dual_up && echo "Túneles abiertos: 8016 → juez; 8017 → compilador." || { echo "Los túneles abrieron pero uno de los modelos no responde."; exit 1; } ;;
  dual-status)
    if dual_up; then echo "Juez 8016: responde. Compilador 8017: responde."; else echo "Uno o ambos modelos no responden."; exit 1; fi ;;
  dual-stop)
    ssh -S "$DUAL_SOCK" -O exit "$HOST" 2>/dev/null && echo "Túneles 8016 y 8017 cerrados." || echo "No hay túnel abierto con 'dual-bg'." ;;
  *) echo "uso: fg | bg | status | stop | dual | dual-bg | dual-status | dual-stop"; exit 2 ;;
esac
