#!/usr/bin/env bash
# V15 · Corre el caso RD-04 (MINT-AD Genomics) con expedientes y deja la corrida en runs-v7 del Pipeline I+D.
# Uso (en el Mac, cualquier carpeta):  bash "/Users/gcaicedo/Documents/Product Brain/Outreach/.worktrees/simpler-grants-chat-ui/research/scripts/run-v15-rd04.sh"
# Gasta búsquedas pagadas con tope Exa USD 0,25 (como runs-v6). Apollo apagado.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.." || exit 1
bash scripts/tunnel-g355.sh status >/dev/null 2>&1 || bash scripts/tunnel-g355.sh bg
sleep 2
PIPELINE_ROOT="/Users/gcaicedo/Documents/Product Brain/Outreach/Fuentes/Pipeline I+D Outreach - 2026-10-19" \
OUT_NAME="${OUT_NAME:-runs-v8}" CONFIRM_SPEND=1 ONLY=RD-04 TODAY=2026-10-19 \
bash scripts/run-rd-cases.sh 2>&1 | tee "/Users/gcaicedo/Documents/Product Brain/Outreach/Fuentes/Pipeline I+D Outreach - 2026-10-19/${OUT_NAME:-runs-v8}.log"
echo "Listo. Puedes volver al chat."
