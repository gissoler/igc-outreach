#!/usr/bin/env bash
# Corrida formal v9: B2 v9 (= v8 sin fase de listas + candidatos del modelo) en p01–p06 × 3 réplicas = 18 corridas.
# Carpeta out/investors-internal-2026-10-13-v9. Por caso: primero la réplica s101 sola (paga búsquedas y extracciones), luego s202 y
# s303 en paralelo (salen de la caché). TOPE: CAP_USD (5) sobre TODO el gasto Exa v9 (diagnóstico + corridas), medido con exa_spend.mjs
# a 0.0089 por llamada; vigilante cada 20 s y archivo de parada. Proveedor de candidatos: CANDIDATES_PROVIDER (lo fija go-v9.sh).
# Uso, desde la raíz del repo:   CANDIDATES_PROVIDER=anthropic bash research/bench/investors/run-v9.sh   (DRY_RUN=1: plan, no gasta)
set -uo pipefail
if [[ -z "${CAFFEINATED:-}" ]] && command -v caffeinate >/dev/null 2>&1 && [[ -z "${DRY_RUN:-}" ]]; then exec env CAFFEINATED=1 caffeinate -is bash "$0" "$@"; fi
cd "$(dirname "$0")/../.."            # → research/
CAP_USD="${CAP_USD:-5}"; RESERVE_USD="${RESERVE_USD:-0.5}"; RATE=0.0089
INV=bench/investors; CFG=$INV/config/v9-2026-10-13.json; OUT=$INV/out/investors-internal-2026-10-13-v9; DIAG=$INV/out/v9-diagnostico-2026-10-12
DOCS=../docs/benchmark/investors; ENVS="--env-file=.env --env-file-if-exists=.env.crawl4ai"
mkdir -p "$OUT"; LOG=$INV/out/v9-$(date +%Y%m%d-%H%M).log; STOP=$INV/out/.v9-stop
export CANDIDATES_PROVIDER="${CANDIDATES_PROVIDER:-fleet}"
say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
spend() { node $INV/analysis/exa_spend.mjs --dirs "$OUT,$DIAG" --usd-per-call $RATE 2>/dev/null; }
over() { local s; s=$(spend); [[ "$s" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { say "NO SE PUDO MEDIR EL GASTO ('$s'): se trata como tope alcanzado"; return 0; }
  say "gasto Exa v9: US\$ $s (tope $CAP_USD, reserva $RESERVE_USD)"; [[ -e "$STOP" ]] && return 0; awk -v s="$s" -v c="$CAP_USD" -v r="$RESERVE_USD" 'BEGIN{exit !(s>=c-r)}'; }
CASES=(p01 p02 p03 p04 p05 p06)
if [[ -n "${DRY_RUN:-}" ]]; then
  node $INV/run-experiment.v9.mjs --config "$CFG" --cases $INV/cases --out "$OUT" --only-cases "$(IFS=,; echo "${CASES[*]}")" --seeds 101,202,303 --dry-run 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"plan: {d[\"scheduled\"]} corridas, {d[\"already_done\"]} ya hechas, {d[\"to_run\"]} por correr")'
  echo "costo esperado: planner como v7 (18 x 8.44 = 152 llamadas) + candidatos del modelo (hasta 40 búsquedas por caso, solo cuando el dominio propuesto no sirve; 6 x 40 = 240) = hasta 392 llamadas x $RATE = US\$ 3.49; tope US\$ $CAP_USD sobre todo v9 (diagnóstico ya gastó US\$ $(spend))"
  echo "proveedor de candidatos: $CANDIDATES_PROVIDER ${CANDIDATES_MODEL:+(modelo $CANDIDATES_MODEL)}"; exit 0
fi
rm -f "$STOP"
( while sleep 20; do s=$(spend); if ! [[ "$s" =~ ^[0-9]+(\.[0-9]+)?$ ]] || awk -v s="$s" -v c="$CAP_USD" 'BEGIN{exit !(s>=c)}'; then [[ -e "$STOP" ]] || { echo "tope de gasto: US\$ ${s:-?}" > "$STOP"; say "VIGILANTE: gasto US\$ ${s:-?} >= tope $CAP_USD: no se empiezan más corridas"; }; fi; done ) &
WATCH=$!; trap 'kill $WATCH 2>/dev/null' EXIT
node $INV/freeze.mjs --config "$CFG" --check >>"$LOG" 2>&1 || { say "La huella v9 no coincide con los archivos: no se lanza."; exit 1; }
node $ENVS $INV/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1 || bash $INV/crawl4ai-local.sh >>"$LOG" 2>&1 || true
node $ENVS $INV/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1 || { say "READER_UNAVAILABLE: no se lanza."; exit 1; }
say "proveedor de candidatos: $CANDIDATES_PROVIDER ${CANDIDATES_MODEL:+(modelo $CANDIDATES_MODEL)}"
GUARD=0
run() { local p=$1 seeds=$2 conc=$3; local cmd=(node $ENVS $INV/run-experiment.v9.mjs --config "$CFG" --cases $INV/cases --out "$OUT" --only-cases "$p" --seeds "$seeds" --concurrency "$conc" --stop-file "$STOP")
  "${cmd[@]}" 2>&1 | grep -v ExperimentalWarning | tail -1 | tee -a "$LOG"; local rc=${PIPESTATUS[0]}
  [[ $rc == 3 ]] && return 3
  if grep -q '"failed":[1-9]' <(tail -1 "$LOG"); then "${cmd[@]}" 2>&1 | grep -v ExperimentalWarning | tail -1 | tee -a "$LOG"; [[ ${PIPESTATUS[0]} == 3 ]] && return 3; fi; return 0; }
for p in "${CASES[@]}"; do
  if over; then say "TOPE alcanzado: se omite $p y lo que sigue"; break; fi
  say "== $p: réplica s101"; run "$p" 101 1 || { GUARD=1; say "GUARDIA DE EXA: $(cat "$STOP" 2>/dev/null)"; break; }
  [[ -e "$STOP" ]] && { say "parada activa: $(cat "$STOP")"; break; }
  say "== $p: réplicas s202 y s303"; run "$p" 202,303 2 || { GUARD=1; say "GUARDIA DE EXA: $(cat "$STOP" 2>/dev/null)"; break; }
  [[ -e "$STOP" ]] && { say "parada activa: $(cat "$STOP")"; break; }
done
say "FIN. Gasto Exa v9 medido: US\$ $(spend) (tope $CAP_USD)."
node $INV/analysis/exa_spend.mjs --dirs "$OUT,$DIAG" --usd-per-call $RATE --json >> "$LOG" 2>&1
node $INV/analysis/v5_check.mjs --out "$OUT" --cases $INV/cases --json "$OUT/v5_check.json" > "$OUT/v5_check.txt" 2>&1
node $INV/analysis/v6_formal_metrics.mjs --out "$OUT" --cases $INV/cases --check "$OUT/v5_check.json" --json "$OUT/v6_formal_metrics.json" --md "$OUT/v6_formal_metrics.md" > "$OUT/v6_formal_metrics.txt" 2>&1
node --no-warnings $INV/analysis/v9/v9_results.mjs --v9 "$OUT" --check "$OUT/v5_check.json" --json "$OUT/v9_results.json" --md "$DOCS/V9-RESULTADOS.md" 2>&1 | tee -a "$LOG"
git -C .. add docs/benchmark/investors/V9-RESULTADOS.md docs/benchmark/investors/V9-NOMBRES.md 2>/dev/null; git -C .. commit -q -m "V9: resultados de la corrida formal (candidatos del modelo)" && say "commit de resultados hecho"
say "Informe: docs/benchmark/investors/V9-RESULTADOS.md"
[[ $GUARD == 1 ]] && exit 3 || exit 0
