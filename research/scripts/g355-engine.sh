#!/usr/bin/env bash
# TODO EN UNO, dentro de g355:  bash ~/outreach-research/scripts/g355-engine.sh
#  1. Node 22 (lo instala en ~/.local si falta)          4. corre el motor v2 con el modelo nuevo
#  2. comprueba las 5 APIs de búsqueda                   5. corre lo mismo con Qwen3-30B (misma caché de búsquedas)
#  3. levanta el modelo grande en GPUs libres            6. deja los reportes en eval/runs/
# Variables: OBJECTIVES (grant,investment) · BRIEF (eval/briefs/mentiva.json) · COMPARE_30B (1) · ENGINE_MODEL (openai/gpt-oss-120b; "none" = no levantar)
set -uo pipefail
cd "$(dirname "$0")/.."
say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
OBJECTIVES="${OBJECTIVES:-grant,investment}"; BRIEF="${BRIEF:-eval/briefs/mentiva.json}"; COMPARE_30B="${COMPARE_30B:-1}"

say "1/5 Node"
export PATH="$HOME/.local/node/bin:$PATH"
if ! node -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)' 2>/dev/null; then
  ARCH=$(uname -m); [[ "$ARCH" == x86_64 ]] && ARCH=x64; [[ "$ARCH" == aarch64 ]] && ARCH=arm64
  F=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk -v a="linux-$ARCH.tar.xz" '$2 ~ a"$" {print $2}')
  [[ -z "$F" ]] && { echo "✖ no pude descargar Node (¿sin salida a nodejs.org?)"; exit 1; }
  mkdir -p "$HOME/.local" && curl -fsSL "https://nodejs.org/dist/latest-v22.x/$F" | tar -xJ -C "$HOME/.local" && rm -rf "$HOME/.local/node" && mv "$HOME/.local/${F%.tar.xz}" "$HOME/.local/node"
fi
node -v || exit 1

say "2/5 APIs de búsqueda"
node --env-file-if-exists=.env scripts/search-apis-check.mjs || { echo "✖ ninguna API respondió desde g355 (¿salida a internet bloqueada?). Revisa el mensaje de arriba."; exit 1; }

say "3/5 Flota actual (Qwen3-30B, puerto 8000)"
export VLLM_CHAT_URL="${VLLM_CHAT_URL:-http://127.0.0.1:8000/v1}"
export VLLM_CHAT_MODEL="${VLLM_CHAT_MODEL:-$(curl -s -m 5 "$VLLM_CHAT_URL/models" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null)}"
echo "chat: ${VLLM_CHAT_MODEL:-(no responde)} @ $VLLM_CHAT_URL"

say "4/5 Modelo grande (rol engine)"
if [[ "${ENGINE_MODEL:-}" != none ]]; then
  bash scripts/g355-serve-engine-model.sh && set -a && . "$HOME/.outreach-engine.env" && set +a
fi
if [[ -n "${ENGINE_LLM_MODEL:-}" ]]; then
  node --env-file-if-exists=.env scripts/engine-run.mjs --brief "$BRIEF" --objectives "$OBJECTIVES" --label "$(basename "$ENGINE_LLM_MODEL")"
else echo "⚠ sin modelo grande; sigo solo con el 30B"; fi

say "5/5 Mismo brief con Qwen3-30B (comparación)"
if [[ "$COMPARE_30B" == 1 && -n "$VLLM_CHAT_MODEL" ]]; then
  env -u ENGINE_LLM_URL -u ENGINE_LLM_MODEL -u ENGINE_LLM_JSON_MODE -u ENGINE_LLM_REASONING_EFFORT \
    node --env-file-if-exists=.env scripts/engine-run.mjs --brief "$BRIEF" --objectives "$OBJECTIVES" --label qwen3-30b
fi

say "Reportes"
ls -1dt eval/runs/*/ 2>/dev/null | head -2 | while read -r d; do echo "── $d"; sed -n '1,25p' "$d/report.md" | grep -E '^(#|-|\| grant|\| investment|## Recall)' ; done
echo; echo "Completos en: $(pwd)/eval/runs/  (push-to-g355.sh los copia a tu Mac)"
