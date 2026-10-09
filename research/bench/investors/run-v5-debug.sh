#!/usr/bin/env bash
# Smoke v5 (B1 y B2 × D1–D3 × semilla 101) con config v5. Copia de run-v4-debug.sh (que no se edita). Se corre en el Mac.
# Uso, desde la raíz del repo:   ITER=v5dbg1 bash research/bench/investors/run-v5-debug.sh
# Todo queda en research/bench/investors/out/debug-v5-2026-10-09/ (ignorado por git). No imprime claves.
set -uo pipefail
cd "$(dirname "$0")/../.."            # → research/
OUT=bench/investors/out/debug-v5-2026-10-09
CONFIG=bench/investors/config/v5-2026-10-09.json
mkdir -p "$OUT"
step() { printf '\n=== %s ===\n' "$1"; }
ENVS="--env-file=.env --env-file-if-exists=.env.crawl4ai"
# SKIP_P15 se acepta por compatibilidad con el script v4; la prueba LLM vs diseño (1/5) no forma parte de v5.

step "1/4 Preflight del lector"
if ! node $ENVS bench/investors/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1; then
  echo "Sin lector (Jina sin saldo o sin Crawl4AI). Intento levantar Crawl4AI local con Docker…"
  bash bench/investors/crawl4ai-local.sh || true
fi
if ! node $ENVS bench/investors/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1; then
  echo "READER_UNAVAILABLE — ver $OUT/preflight-reader.json. No se corre el smoke sin lector."; tail -5 "$OUT/preflight-reader.txt"; exit 1
fi
grep -E '"(status|crawl4ai_ok|jina_ok)"' "$OUT/preflight-reader.json"

SMOKE="$OUT/smoke${ITER:+-$ITER}"
# Cada iteración va en su carpeta; se reutiliza la caché de la iteración v5 anterior (mismo namespace → mismas respuestas).
# No se copia la caché de v4: su namespace es otro (no se reutilizaría) y la verificación de citas leería textos ajenos a v5.
if [[ ! -f "$SMOKE/cache.sqlite" ]]; then
  mkdir -p "$SMOKE"; PREV=$(ls -td "$OUT"/smoke*/ 2>/dev/null | grep -v "$SMOKE/" | head -1)
  if [[ -n "$PREV" && -f "$PREV/cache.sqlite" ]]; then cp "$PREV/cache.sqlite" "$SMOKE/cache.sqlite" && echo "(caché copiada de $PREV)"; fi
fi
step "2/4 Smoke: B1 y B2 × D1–D3 × semilla 101 (6 corridas) → $SMOKE"
node $ENVS bench/investors/run-experiment.mjs --config "$CONFIG" --cases bench/investors/cases-debug --out "$SMOKE" --conditions B1,B2 --seeds 101 --concurrency 3 --mode debug 2>&1 | grep -v ExperimentalWarning | tail -3

step "3/4 Verificación (criterios, citas literales, gain, nulos, lector, profundización, triage)"
node bench/investors/analysis/v5_check.mjs --out "$SMOKE" --cases bench/investors/cases-debug --json "$SMOKE/v5_check.json" 2>&1 | grep -v -E 'ExperimentalWarning|trace-warnings' | head -80

step "4/4 Informes por corrida (report.md)"
node bench/investors/analysis/render_reports.mjs --out "$SMOKE" --cases bench/investors/cases-debug 2>&1 | grep -v -E 'ExperimentalWarning|trace-warnings'
echo; echo "Listo. Resultados en research/$SMOKE"
