#!/usr/bin/env bash
# Corrida formal v5: 15 casos × B1,B2 × semillas 101,202,303 = 90 corridas. Se corre EN EL MAC (necesita red, claves y Docker).
# Reanudable: run-experiment.mjs reutiliza los resultados ya escritos (status "reused"); repetir el comando completa lo que falta.
# Uso, desde la raíz del repo:   bash research/bench/investors/run-v5-formal.sh
set -uo pipefail
cd "$(dirname "$0")/../.."            # → research/
CONFIG=bench/investors/config/v5-2026-10-09.json
OUT=bench/investors/out/investors-internal-2026-10-09-v5
ENVS="--env-file=.env --env-file-if-exists=.env.crawl4ai"
grep -q '"status": "frozen"' "$CONFIG" || { echo "La config v5 no está frozen."; exit 1; }
[[ -f "$OUT/fingerprint.json" ]] || { echo "Falta $OUT/fingerprint.json (node bench/investors/freeze.mjs --config $CONFIG)."; exit 1; }
node $ENVS bench/investors/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1 || { bash bench/investors/crawl4ai-local.sh || true; }
node $ENVS bench/investors/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1 || { echo "READER_UNAVAILABLE — no se lanza."; exit 1; }
node $ENVS bench/investors/run-experiment.mjs --config "$CONFIG" --cases bench/investors/cases --out "$OUT" --conditions B1,B2 --seeds 101,202,303 --concurrency 3 2>&1 | grep -v ExperimentalWarning | tee -a "$OUT/run.log" | tail -20
echo "Corridas con resultado: $(find "$OUT" -name 'result*.json' 2>/dev/null | wc -l) (esperadas: 90)"
