#!/usr/bin/env bash
# TODO EN UNO: abre el túnel a g355, enciende el motor v2 en el .env y arranca el servidor de research.
# Al parar (Ctrl-C) apaga el servidor, cierra el túnel y deja el .env como estaba (motor apagado).
#   bash research/scripts/app-motor.sh            # con Qwen3-30B
#   KEEP_ENV=1 bash research/scripts/app-motor.sh # no apagar el motor del .env al salir (no recomendado)
# Solo usa modelos que ya corren en g355 (Qwen3-30B, puerto 8000); no arranca ni toca nada allí.
# El frontend se levanta aparte, como siempre.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; HERE="$ROOT/scripts"; ENVF="${ENV_FILE:-$ROOT/.env}"
HOST="${G355_HOST:-voltage-park}"; MODEL=30b
SOCK="$(mktemp -d)/tunel.sock"; SRV_PID=""; TUNNEL_MINE=0; ENV_MINE=0
export ENV_FILE="$ENVF"

up() { curl -s -m 6 "http://127.0.0.1:$1/v1/models" >/dev/null 2>&1; }
cleanup() {
  trap - EXIT INT TERM; echo; echo "Apagando…"
  [[ -n "$SRV_PID" ]] && kill "$SRV_PID" 2>/dev/null && wait "$SRV_PID" 2>/dev/null
  if [[ $ENV_MINE = 1 && "${KEEP_ENV:-0}" != 1 ]]; then bash "$HERE/app-engine.sh" off >/dev/null && echo "  .env: motor v2 apagado"; fi
  if [[ $TUNNEL_MINE = 1 ]]; then ssh -S "$SOCK" -O exit "$HOST" >/dev/null 2>&1; echo "  túnel cerrado"; fi
  rm -rf "$(dirname "$SOCK")"; exit "${1:-0}"
}
trap 'cleanup 130' INT TERM; trap 'cleanup $?' EXIT

# 1) túnel (si ya hay uno tuyo abierto y responde, se reutiliza y no se cierra al salir)
if up 18000; then echo "Túnel: ya hay uno abierto, lo reutilizo."
else
  echo "Abriendo túnel a ${HOST}…"
  ssh -f -N -M -S "$SOCK" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ConnectTimeout=15 \
    -L 127.0.0.1:18000:127.0.0.1:8000 "$HOST" || { echo "No pude abrir el túnel (¿VPN/SSH? ¿algo usa el puerto 18000?)."; exit 1; }
  TUNNEL_MINE=1
fi
up 18000 || { echo "El modelo $MODEL no responde por el túnel (g355:8000). ¿Sigue cargado?"; exit 1; }
echo "Modelo $MODEL: responde."

# 2) motor v2 en el .env (se revierte al salir)
bash "$HERE/app-engine.sh" on "$MODEL" >/dev/null || { bash "$HERE/app-engine.sh" on "$MODEL"; exit 1; }; ENV_MINE=1; echo ".env: motor v2 encendido (se apaga solo al salir)."

# 3) servidor de research
RPORT="$(grep -E '^RESEARCH_PORT=' "$ENVF" | tail -1 | cut -d= -f2 | tr -d ' \r')"; RPORT="${RPORT:-8788}"
if curl -s -m 3 "http://127.0.0.1:$RPORT/" >/dev/null 2>&1; then echo "Ya hay algo escuchando en el puerto $RPORT (¿el servidor de research anterior?). Páralo y repite."; exit 1; fi
echo "Arrancando research en http://127.0.0.1:$RPORT con el motor v2 ($MODEL). Ctrl-C para apagar todo."
cd "$ROOT" && npm start & SRV_PID=$!
wait "$SRV_PID"; SRV_PID=""; exit $?
