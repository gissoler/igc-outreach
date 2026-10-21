#!/usr/bin/env bash
# V15 · Corre los cinco casos de inversión del Pipeline I+D (RD-01, RD-02, RD-03, RD-09, RD-10) con la etapa de inversionistas
# por organización (ENGINE_INVESTOR_DOSSIER=1, por defecto) y Apollo ENCENDIDO como fuente inicial y para contactos de lo retenido.
# Uso (en el Mac, cualquier carpeta):  bash "/Users/gcaicedo/Documents/Product Brain/Outreach/.worktrees/simpler-grants-chat-ui/research/scripts/run-v15-investors.sh"
# Gasta búsquedas pagadas (tope Exa USD 0,25 por caso) y hasta 5 créditos de Apollo por caso. APOLLO_ENABLED=0 lo apaga.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.." || exit 1
bash scripts/tunnel-g355.sh status >/dev/null 2>&1 || bash scripts/tunnel-g355.sh bg
sleep 2
ROOT="/Users/gcaicedo/Documents/Product Brain/Outreach/Fuentes/Pipeline I+D Outreach - 2026-10-19"
OUT_NAME="${OUT_NAME:-runs-v10-investors}"
PIPELINE_ROOT="$ROOT" OUT_NAME="$OUT_NAME" CONFIRM_SPEND=1 ONLY=RD-01,RD-02,RD-03,RD-09,RD-10 TODAY=2026-10-19 \
APOLLO_ENABLED="${APOLLO_ENABLED:-0}" ENGINE_AGENT_APOLLO_STAGE="${ENGINE_AGENT_APOLLO_STAGE:-post_judge}" ENGINE_AGENT_APOLLO_CREDITS="${ENGINE_AGENT_APOLLO_CREDITS:-5}" \
bash scripts/run-rd-cases.sh 2>&1 | tee "$ROOT/$OUT_NAME.log"
node scripts/investor-control.mjs --runs "$ROOT/$OUT_NAME" | tee "$ROOT/$OUT_NAME.control.txt"
echo "Listo. Puedes volver al chat."
