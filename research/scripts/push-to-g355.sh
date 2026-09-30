#!/usr/bin/env bash
# Desde tu Mac, un solo comando:  bash research/scripts/push-to-g355.sh
# Copia research/ (sin node_modules ni base de datos) a g355, ejecuta g355-engine.sh allí y trae los reportes a research/eval/runs/.
# Variables: G355_HOST (voltage-park) · G355_DIR (outreach-research) · y las de g355-engine.sh (OBJECTIVES, COMPARE_30B, ENGINE_MODEL…)
set -euo pipefail
HOST="${G355_HOST:-voltage-park}"; DEST="${G355_DIR:-outreach-research}"
cd "$(dirname "$0")/.."
echo "→ copiando research/ a $HOST:~/$DEST"
COPYFILE_DISABLE=1 tar czf - --exclude node_modules --exclude 'data/*.sqlite*' --exclude '.backup-*' --exclude 'eval/runs' --exclude '.DS_Store' --exclude '__pycache__' . \
  | ssh "$HOST" "mkdir -p ~/$DEST && tar xzf - -C ~/$DEST 2>/dev/null"
PASS=""; for v in OBJECTIVES BRIEF COMPARE_30B ENGINE_MODEL ENGINE_PORT ENGINE_TP ENGINE_GPUS ENGINE_ROUNDS ENGINE_SEARCH_PROVIDERS; do [[ -n "${!v:-}" ]] && PASS+="$v='${!v}' "; done
ssh -t "$HOST" "cd ~/$DEST && $PASS bash scripts/g355-engine.sh" || echo "⚠ la ejecución remota terminó con error; traigo lo que haya"
mkdir -p eval/runs && ssh "$HOST" "cd ~/$DEST && [ -d eval/runs ] && tar czf - eval/runs" | tar xzf - 2>/dev/null || true
echo "✔ reportes en $(pwd)/eval/runs/"; ls -1dt eval/runs/*/ 2>/dev/null | head -3
