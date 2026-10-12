#!/usr/bin/env bash
# Corrida formal v7 (PROMPT-v9): B2 v7 en p01–p06 (variante A) × 3 réplicas (etiquetas s101/s202/s303) = 18 corridas,
# más la prueba de alcanzabilidad del oro (C4, 18 consultas, una sola vez). Carpeta nueva out/investors-internal-2026-10-12-v7.
# TOPE DE GASTO: CAP_USD (por defecto 9) sobre TODO el gasto v7 (corridas + C4), medido con exa_spend.mjs a 0.0089 USD por
# llamada pagada. Entre lotes (un lote por caso) se para al llegar a CAP_USD - RESERVE_USD; el vigilante mide cada 20 s y al
# llegar a CAP_USD crea el archivo de parada (run-experiment.v7 --stop-file no empieza más corridas). Si el gasto no se puede
# medir, se trata como tope alcanzado. Errores de saldo de Exa (401/402/403/429…) o 3 errores seguidos: run-experiment.v7 crea el
# archivo de parada y corta la corrida en curso (queda failure.json, se descarta).
# Uso, desde la raíz del repo:   CAP_USD=9 bash research/bench/investors/run-v7.sh      (DRY_RUN=1: plan y costo esperado, no gasta)
set -uo pipefail
if [[ -z "${CAFFEINATED:-}" ]] && command -v caffeinate >/dev/null 2>&1 && [[ -z "${DRY_RUN:-}" ]]; then exec env CAFFEINATED=1 caffeinate -is bash "$0" "$@"; fi
cd "$(dirname "$0")/../.."            # → research/
CAP_USD="${CAP_USD:-9}"; RESERVE_USD="${RESERVE_USD:-1}"; CONC="${CONCURRENCY:-3}"; RATE=0.0089; PAID_MEAN="${PAID_MEAN:-17}"; PAID_MAX="${PAID_MAX:-34}"
INV=bench/investors; CFG=$INV/config/v7-2026-10-12.json; OUT=$INV/out/investors-internal-2026-10-12-v7; REACH=$INV/out/reachability-v7-2026-10-12
DOCS=../docs/benchmark/investors; ENVS="--env-file=.env --env-file-if-exists=.env.crawl4ai"
mkdir -p "$OUT"; LOG=$INV/out/v7-$(date +%Y%m%d-%H%M).log; STOP=$INV/out/.v7-stop
say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
spend() { node $INV/analysis/exa_spend.mjs --dirs "$OUT,$REACH" --usd-per-call $RATE 2>/dev/null; }
over() { local s; s=$(spend); [[ "$s" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { say "NO SE PUDO MEDIR EL GASTO ('$s'): se trata como tope alcanzado"; return 0; }
  say "gasto Exa v7: US\$ $s (tope $CAP_USD, reserva $RESERVE_USD)"; [[ -e "$STOP" ]] && return 0; awk -v s="$s" -v c="$CAP_USD" -v r="$RESERVE_USD" 'BEGIN{exit !(s>=c-r)}'; }
CASES=(p01 p02 p03 p04 p05 p06); SEEDS=101,202,303

if [[ -n "${DRY_RUN:-}" ]]; then
  node $INV/run-experiment.v7.mjs --config "$CFG" --cases $INV/cases --out "$OUT" --only-cases "$(IFS=,; echo "${CASES[*]}")" --seeds $SEEDS --dry-run 2>/dev/null > /tmp/v7-dry.json || { echo "DRY_RUN falló"; exit 1; }
  python3 - "$PAID_MEAN" "$PAID_MAX" "$RATE" "$CAP_USD" "$([[ -f $REACH/result.json ]] && echo 1 || echo 0)" <<'PY'
import json, sys
d = json.load(open('/tmp/v7-dry.json')); mean, mx, rate, cap, reach_done = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5] == '1'
n = d['to_run']; c4 = 0 if reach_done else 18 * rate
print(f"plan: {d['scheduled']} corridas programadas, {d['already_done']} ya hechas, {n} por correr; lote inicial de: {sorted(set(r['fixed_initial_from'].split('__')[1] for r in d['runs']))}")
print(f"C4 alcanzabilidad: {'ya ejecutada' if reach_done else '18 llamadas'} -> US$ {c4:.2f}")
print(f"costo esperado = {n} corridas x {mean:g} llamadas pagadas medias x {rate} = US$ {n*mean*rate:.2f} (+ C4 = US$ {n*mean*rate+c4:.2f}); cota alta sin aciertos de caché: {n} x {mx:g} x {rate} = US$ {n*mx*rate+c4:.2f}; tope US$ {cap:g}")
PY
  echo "gasto v7 ya medido: US\$ $(spend)"; exit 0
fi

rm -f "$STOP"
( while sleep 20; do s=$(spend); if ! [[ "$s" =~ ^[0-9]+(\.[0-9]+)?$ ]] || awk -v s="$s" -v c="$CAP_USD" 'BEGIN{exit !(s>=c)}'; then [[ -e "$STOP" ]] || { echo "tope de gasto: US\$ ${s:-?}" > "$STOP"; say "VIGILANTE: gasto US\$ ${s:-?} >= tope $CAP_USD: no se empiezan más corridas"; }; fi; done ) &
WATCH=$!; trap 'kill $WATCH 2>/dev/null' EXIT

grep -q '"status": "frozen"' "$CFG" || { say "La config v7 no está frozen."; exit 1; }
node $INV/freeze.mjs --config "$CFG" --check >>"$LOG" 2>&1 || { say "El fingerprint v7 no coincide con los archivos: no se lanza."; exit 1; }
node $INV/freeze.mjs --config $INV/config/v5-2026-10-09.json --check >>"$LOG" 2>&1 || { say "El fingerprint v5 cambió: no se lanza."; exit 1; }
node $ENVS $INV/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1 || bash $INV/crawl4ai-local.sh >>"$LOG" 2>&1 || true
node $ENVS $INV/preflight-reader.mjs --out "$OUT/preflight-reader.json" > "$OUT/preflight-reader.txt" 2>&1 || { say "READER_UNAVAILABLE: no se lanza."; exit 1; }

# C4 — prueba de alcanzabilidad del oro (una sola vez; si ya existe result.json no vuelve a llamar a Exa).
if over; then say "TOPE alcanzado antes de C4: no se hace nada más"; exit 1; fi
say "== C4 alcanzabilidad del oro (18 consultas)"
node --env-file=.env $INV/analysis/v7/reachability.mjs >>"$LOG" 2>&1 && node $INV/analysis/v7/reachability_report.mjs 2>&1 | tee -a "$LOG" \
  || say "C4 no se completó (ver $LOG); se sigue con la corrida"
[[ -e "$STOP" ]] && { say "parada activa tras C4 ($(cat "$STOP")): no se lanzan corridas"; exit 1; }

GUARD=0
for p in "${CASES[@]}"; do
  if over; then say "TOPE alcanzado: se omite $p y lo que sigue"; break; fi
  say "== lote $p (B2 v7 × $SEEDS)"
  cmd=(node $ENVS $INV/run-experiment.v7.mjs --config "$CFG" --cases $INV/cases --out "$OUT" --only-cases "$p" --seeds $SEEDS --concurrency "$CONC" --stop-file "$STOP")
  "${cmd[@]}" 2>&1 | grep -v ExperimentalWarning | tail -1 | tee -a "$LOG"; rc=${PIPESTATUS[0]}
  if [[ $rc == 3 ]]; then GUARD=1; say "GUARDIA DE EXA: $(cat "$STOP" 2>/dev/null). Se para y se descarta lo que quedó a medias."; break; fi
  [[ -e "$STOP" ]] && { say "parada activa: $(cat "$STOP")"; break; }
  # Reintento SOLO de las que fallaron por infraestructura (las válidas se reutilizan, no se repiten).
  if grep -q '"failed":[1-9]' <(tail -1 "$LOG"); then "${cmd[@]}" 2>&1 | grep -v ExperimentalWarning | tail -1 | tee -a "$LOG"; [[ ${PIPESTATUS[0]} == 3 ]] && { GUARD=1; say "GUARDIA DE EXA en el reintento"; break; }; fi
done

say "FIN. Gasto Exa v7 medido: US\$ $(spend) (tope $CAP_USD)."
node $INV/analysis/exa_spend.mjs --dirs "$OUT,$REACH" --usd-per-call $RATE --json >> "$LOG" 2>&1
# Informes: verificación de citas (debe ser 100%), métricas sin etiquetas y comparación con v5 según el pre-registro.
node $INV/analysis/v5_check.mjs --out "$OUT" --cases $INV/cases --json "$OUT/v5_check.json" > "$OUT/v5_check.txt" 2>&1
node $INV/analysis/v6_formal_metrics.mjs --out "$OUT" --cases $INV/cases --check "$OUT/v5_check.json" --json "$OUT/v6_formal_metrics.json" --md "$OUT/v6_formal_metrics.md" > "$OUT/v6_formal_metrics.txt" 2>&1
node $INV/analysis/v7/v7_results.mjs --v7 "$OUT" --check "$OUT/v5_check.json" --json "$OUT/v7_results.json" --md "$DOCS/V7-RESULTADOS.md" 2>&1 | grep -v ExperimentalWarning | tee -a "$LOG"
say "Informes: docs/benchmark/investors/V7-RESULTADOS.md, ALCANZABILIDAD-ORO.md y research/$OUT/{v5_check,v6_formal_metrics,v7_results}.json"
[[ $GUARD == 1 ]] && exit 3 || exit 0
