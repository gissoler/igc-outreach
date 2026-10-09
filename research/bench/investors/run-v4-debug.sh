#!/usr/bin/env bash
# Fase 1.5 (c') + Fase 3 (smoke D1–D3) del plan v4. Se corre en el Mac (necesita la flota y los buscadores).
# Uso, desde la raíz del repo:   bash research/bench/investors/run-v4-debug.sh
# Todo queda en research/bench/investors/out/debug-v4-2026-10-09/ (ignorado por git). No imprime claves.
set -uo pipefail
cd "$(dirname "$0")/../.."            # → research/
OUT=bench/investors/out/debug-v4-2026-10-09
V3="/Users/gcaicedo/Documents/Product Brain/Outreach/Fuentes/Benchmark investors - execution 2026-10-08/workspace/AGENT-snapshot/research/bench/investors/out/investors-internal-2026-10-08-v3"
mkdir -p "$OUT"
step() { printf '\n=== %s ===\n' "$1"; }

ENVS="--env-file=.env --env-file-if-exists=.env.crawl4ai"
if [[ "${SKIP_P15:-0}" == "1" || -f "$OUT/p15/llm_vs_design.json" ]]; then echo "(1/5 ya hecho; se salta)"; else
step "1/5 Prueba LLM vs diseño (c'): gpt-oss-120b con schema v2 + prompt v3 en las 20 páginas"
node $ENVS bench/investors/analysis/llm_vs_design.mjs --v3 "$V3" --labels bench/investors/gold/v3/labels/adjudicator.jsonl --out "$OUT/p15" --variant-v2 > "$OUT/p15.txt" 2>&1
grep -A30 '"gpt_oss_120b_v4_design"' "$OUT/p15.txt" | head -40
fi

step "2/5 Preflight del lector"
if ! node $ENVS bench/investors/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1; then
  echo "Sin lector (Jina sin saldo o sin Crawl4AI). Intento levantar Crawl4AI local con Docker…"
  bash bench/investors/crawl4ai-local.sh || true
fi
if ! node $ENVS bench/investors/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1; then
  echo "READER_UNAVAILABLE — ver $OUT/preflight-reader.json. No se corre el smoke sin lector."; tail -5 "$OUT/preflight-reader.txt"; exit 1
fi
grep -E '"(status|crawl4ai_ok|jina_ok)"' "$OUT/preflight-reader.json"

step "3/5 Smoke: B1 y B2 × D1–D3 × semilla 101 (6 corridas)"
node $ENVS bench/investors/run-experiment.mjs --config bench/investors/config/v4-2026-10-09.json --cases bench/investors/cases-debug --out "$OUT/smoke" --conditions B1,B2 --seeds 101 --concurrency 3 --mode debug 2>&1 | grep -v ExperimentalWarning | tail -3

step "4/5 Verificación (criterios, citas literales, gain, nulos, lector)"
node bench/investors/analysis/v4_check.mjs --out "$OUT/smoke" --cases bench/investors/cases-debug --json "$OUT/v4_check.json" 2>/dev/null | head -60

step "5/5 Informes por corrida (report.md)"
node bench/investors/analysis/render_reports.mjs --out "$OUT/smoke" --cases bench/investors/cases-debug 2>/dev/null
echo; echo "Listo. Resultados en research/$OUT"
