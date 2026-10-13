#!/usr/bin/env bash
# V8 paso 1 (PROMPT-v10): diagnóstico de alcanzabilidad del oro por variante. Un comando, desde la raíz del repo:
#   bash research/bench/investors/go-v8-diagnostico.sh
# 1) tests v8; 2) claves (sin mostrarlas); 3) simulacro con costo esperado (sale sin gastar si supera el tope);
# 4) diagnóstico con tope CAP_USD (2) medido con exa_spend.mjs --usd-per-call 0.0089 y vigilante cada 10 s (--stop-file);
# 5) informe docs/benchmark/investors/V8-DIAGNOSTICO.md y commit (sin atribuciones). Cualquier fallo antes de gastar: se para.
set -uo pipefail
cd "$(dirname "$0")/../.."            # → research/
CAP_USD="${CAP_USD:-2}"; RATE=0.0089; INV=bench/investors; OUT=$INV/out/v8-diagnostico-2026-10-12; STOP=$OUT/.stop
mkdir -p "$OUT"; LOG=$INV/out/v8-diagnostico-$(date +%Y%m%d-%H%M).log
say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
spend() { node $INV/analysis/exa_spend.mjs --dirs "$OUT" --usd-per-call $RATE 2>/dev/null; }
fail() { say "PARADA: $* (no se gastó nada en este paso)"; exit 1; }

say "== 1/5 tests v8"
node --test tests/agent/investors.v8.test.mjs >>"$LOG" 2>&1 || fail "tests v8 fallan (ver $LOG)"
say "== 2/5 claves"
[[ -f .env ]] || fail "no existe research/.env"
grep -Eq '^EXA_API_KEY=.{8,}' .env || fail "EXA_API_KEY ausente o vacía en research/.env"
say "EXA_API_KEY presente (no se muestra)"
s=$(spend); [[ "$s" =~ ^[0-9]+(\.[0-9]+)?$ ]] || fail "no se puede medir el gasto con exa_spend.mjs ('$s')"
say "gasto ya registrado en el diagnóstico: US\$ $s"
say "== 3/5 simulacro"
node $INV/analysis/v8/diagnostico.v8.mjs --dry-run --cap-usd "$CAP_USD" > "$OUT/dry-run.json" 2>>"$LOG" || fail "simulacro falló o el costo máximo supera US\$ $CAP_USD (ver $OUT/dry-run.json)"
python3 - "$OUT/dry-run.json" <<'PY' | tee -a "$LOG"
import json, sys
d = json.load(open(sys.argv[1]))
print(f"costo esperado: fase A {d['phase_A']['units']} unidades = US$ {d['phase_A']['usd']}; fase B entre US$ {d['phase_B']['usd_min']} y {d['phase_B']['usd_max']}; máximo total US$ {d['total_usd_max']} (tope US$ {d['cap_usd']})")
PY
say "== 4/5 diagnóstico (tope US\$ $CAP_USD)"
rm -f "$STOP"
( while sleep 10; do s=$(spend); if ! [[ "$s" =~ ^[0-9]+(\.[0-9]+)?$ ]] || awk -v s="$s" -v c="$CAP_USD" 'BEGIN{exit !(s>=c)}'; then [[ -e "$STOP" ]] || { echo "vigilante: gasto US\$ ${s:-?} (tope $CAP_USD)" > "$STOP"; say "VIGILANTE: parada (gasto US\$ ${s:-?})"; }; fi; done ) &
WATCH=$!; trap 'kill $WATCH 2>/dev/null' EXIT
node --env-file=.env $INV/analysis/v8/diagnostico.v8.mjs --cap-usd "$CAP_USD" --stop-file "$STOP" 2>&1 | grep -v ExperimentalWarning | tee -a "$LOG"; rc=${PIPESTATUS[0]}
say "gasto Exa del diagnóstico medido: US\$ $(spend) (tope $CAP_USD)"
node $INV/analysis/exa_spend.mjs --dirs "$OUT" --usd-per-call $RATE --json >> "$LOG" 2>&1
say "== 5/5 informe"
node $INV/analysis/v8/diagnostico_report.v8.mjs --md ../docs/benchmark/investors/V8-DIAGNOSTICO.md 2>&1 | grep -v ExperimentalWarning | tee -a "$LOG"
if [[ $rc == 0 ]]; then
  git -C .. add docs/benchmark/investors/V8-DIAGNOSTICO.md   # out/ está en .gitignore: result.json y events.jsonl quedan en disco
  git -C .. commit -q -m "V8: resultados del diagnóstico de alcanzabilidad por variante" && say "commit hecho"
  say "FIN: docs/benchmark/investors/V8-DIAGNOSTICO.md. Avisa a Claude para seguir con los pasos 3 a 5."
else
  say "FIN CON CÓDIGO $rc: incompleto (ver $LOG y $OUT/result-incompleto.json). Se puede relanzar: lo pagado sale de la caché."
fi
exit $rc
