#!/usr/bin/env bash
# Prueba RÁPIDA (no es la corrida formal): 1 caso positivo (p01) + 1 nulo (n04) × B1,B2 × semilla 101 = 4 corridas en paralelo (~15-20 min).
# Va a su propia carpeta (out/quick-v5-2026-10-09), no mezcla nada con las 90. Uso, desde la raíz del repo:  bash research/bench/investors/run-v5-quick.sh
set -uo pipefail
cd "$(dirname "$0")/../.."            # → research/
CONFIG=bench/investors/config/v5-2026-10-09.json; OUT=bench/investors/out/quick-v5-2026-10-09; mkdir -p "$OUT"
ENVS="--env-file=.env --env-file-if-exists=.env.crawl4ai"
node $ENVS bench/investors/run-experiment.mjs --config "$CONFIG" --cases bench/investors/cases-quick --out "$OUT" --conditions B1,B2 --seeds 101 --concurrency 4 2>&1 | grep -v ExperimentalWarning | tail -3
node bench/investors/analysis/v6_formal_metrics.mjs --out "$OUT" --cases bench/investors/cases-quick 2>&1 | grep -v -E 'ExperimentalWarning|trace-warnings'
