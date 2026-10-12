#!/usr/bin/env bash
# Corrida nocturna con TOPE DE GASTO en Exa (no es la corrida formal de 90: es el plan priorizado que cabe en el presupuesto).
# Orden de prioridad (lo que pidió David el 09/10): 1) filtro por embeddings B2E (compuerta barata), 2) pares de intenciones, 3) más semillas.
# Se detiene sola al llegar a CAP_USD (estimado desde events.jsonl; el cobro real lo da el panel de Exa).
# Uso, desde la raíz del repo:   CAP_USD=14 bash research/bench/investors/run-overnight.sh        (DRY_RUN=1 solo lista, no gasta)
set -uo pipefail
if [[ -z "${CAFFEINATED:-}" ]] && command -v caffeinate >/dev/null 2>&1 && [[ -z "${DRY_RUN:-}" ]]; then exec env CAFFEINATED=1 caffeinate -i bash "$0" "$@"; fi
cd "$(dirname "$0")/../.."            # → research/
CAP_USD="${CAP_USD:-14}"; CONC="${CONCURRENCY:-3}"
INV=bench/investors; V5=$INV/config/v5-2026-10-09.json; V6=$INV/config/v6-2026-10-09.json
OUT5=$INV/out/investors-internal-2026-10-09-v5; QUICK=$INV/out/quick-v5-2026-10-09; OUTP=$INV/out/investors-internal-2026-10-09-v5-pairs; OUT6=$INV/out/investors-internal-2026-10-09-v6
LOG=$INV/out/overnight-$(date +%Y%m%d-%H%M).log; START=$(date -u +%Y-%m-%dT%H:%M:%SZ); ENVS="--env-file=.env --env-file-if-exists=.env.crawl4ai"
mkdir -p "$OUT5" "$OUTP" "$OUT6"
say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
spend() { node $INV/analysis/exa_spend.mjs --dirs "$OUT5,$OUTP,$OUT6" --since "$START"; }
over() { local s; s=$(spend); say "gasto Exa estimado esta noche: US\$ $s (tope $CAP_USD)"; awk -v s="$s" -v c="$CAP_USD" 'BEGIN{exit !(s>=c)}'; }

if [[ -z "${DRY_RUN:-}" ]]; then
  grep -q '"status": "frozen"' "$V5" || { say "La config v5 no está frozen."; exit 1; }
  node $ENVS $INV/preflight-reader.mjs --out "$OUT5/preflight-reader.json" > "$OUT5/preflight-reader.txt" 2>&1 || bash $INV/crawl4ai-local.sh || true
  node $ENVS $INV/preflight-reader.mjs --out "$OUT5/preflight-reader.json" > "$OUT5/preflight-reader.txt" 2>&1 || { say "READER_UNAVAILABLE: no se lanza."; exit 1; }
  (npm ls @xenova/transformers >/dev/null 2>&1 || npm install --no-save @xenova/transformers@2.17.2 >>"$LOG" 2>&1)
  if node $INV/embed-check.mjs >>"$LOG" 2>&1; then EMB=1; say "embedder OK"; else EMB=0; say "EMBEDDER NO DISPONIBLE: se omiten las etapas B2E (ver $LOG)"; fi
else EMB=1; fi

# batch <nombre> <config> <carpeta de casos> <carpeta de salida> <condiciones> <semillas> <casos> [flags extra]
batch() {
  local name=$1 cfg=$2 cases=$3 out=$4 conds=$5 seeds=$6 only=$7; shift 7
  if [[ -z "${DRY_RUN:-}" ]] && over; then say "TOPE alcanzado: se omite '$name' y lo que sigue"; return 1; fi
  say "== $name ($conds × $seeds × $only)"
  local cmd=(node $ENVS $INV/run-experiment.v6.mjs --config "$cfg" --cases "$cases" --out "$out" --conditions "$conds" --seeds "$seeds" --only-cases "$only" --concurrency "$CONC" "$@")
  if [[ -n "${DRY_RUN:-}" ]]; then "${cmd[@]}" --dry-run 2>&1 | grep -v Warning | python3 -c "import sys,json; d=json.load(sys.stdin); print('   programadas',d['scheduled'],'ya hechas',d['already_done'],'por correr',d['to_run'])"; return 0; fi
  "${cmd[@]}" 2>&1 | grep -v ExperimentalWarning | tail -2 | tee -a "$LOG"
  "${cmd[@]}" 2>&1 | grep -v ExperimentalWarning | tail -1 | tee -a "$LOG"     # reintento de las que fallaron por infraestructura (reutiliza las válidas)
  return 0
}

# Los pares (variante A original + variante B reescrita) corren JUNTOS en una sola carpeta para que el tope de gasto nunca deje un par a medias.
PC=$OUTP/_cases; mkdir -p "$PC"; cp $INV/cases/inv-case-syn-p0[1-6].json $INV/cases-pairs/inv-case-syn-p0[1-6]-ib.json "$PC/"
# Reutiliza corridas YA hechas con la misma config v5 congelada (mismo run_id): ahorra búsquedas pagadas. Se declara en el informe.
for src in "$OUT5" "$QUICK"; do for d in "$src"/runs/*__inv-case-syn-p0[1-6]__B[12]__s101; do
  [[ -f "$d/result.json" && ! -e "$OUTP/runs/$(basename "$d")/result.json" ]] || continue
  [[ -n "${DRY_RUN:-}" ]] || { mkdir -p "$OUTP/runs/$(basename "$d")" && cp "$d/result.json" "$OUTP/runs/$(basename "$d")/result.json" && say "reutilizada: $(basename "$d") (de ${src##*/})"; }
done; done
ALL6=p01,p02,p03,p04,p05,p06,p01-ib,p02-ib,p03-ib,p04-ib,p05-ib,p06-ib

# 0) Compuerta B2E: un caso, para saber si el filtro funciona con el modelo real antes de gastar más en él.
GATE=0
if [[ $EMB == 1 ]]; then
  batch "0 compuerta B2E (p05, semilla 101)" $V6 $INV/cases $OUT6 B2E 101 p05 --enable-embeddings
  if [[ -z "${DRY_RUN:-}" ]]; then
    node -e "
const fs=require('fs'),d='$OUT6/runs/',n=fs.existsSync(d)?fs.readdirSync(d).find(x=>x.includes('p05__B2E__s101')):null;
if(!n||!fs.existsSync(d+n+'/result.json'))process.exit(1);
const r=JSON.parse(fs.readFileSync(d+n+'/result.json','utf8')),f=r.relevance_filter;
const ok=f&&f.results_in>0&&f.llm_calls>0&&f.results_kept>0&&r.entities.length>0;
console.log(JSON.stringify({gate:ok?'OK':'FALLA',results_in:f?.results_in,kept:f?.results_kept,llm_calls:f?.llm_calls,firms:r.entities.length,sparse_after_round_2:r.sparse_after_round_2}));process.exit(ok?0:1)" | tee -a "$LOG" && GATE=1 || say "COMPUERTA B2E FALLÓ: se omiten las demás etapas B2E"
  else GATE=1; fi
fi
# 1) Pares de intenciones, B2, semilla 101 (A y B juntos).
batch "1 pares · B2 · s101" $V5 $PC $OUTP B2 101 $ALL6 || true
# 2) Filtro B2E en más casos; la línea base B2 s101 de p01, p03 y p05 sale del lote 1.
[[ $GATE == 1 ]] && { batch "2 B2E · s101 · p01,p03" $V6 $INV/cases $OUT6 B2E 101 p01,p03 --enable-embeddings || true; }
# 3) Semillas 202 y 303 de los pares con B2 (la regla de sensibilidad pre-registrada usa las 3).
for S in 202 303; do batch "3 pares · B2 · s$S" $V5 $PC $OUTP B2 $S $ALL6 || break; done
# 4) Si sobra presupuesto: pares con B1.
batch "4 pares · B1 · s101" $V5 $PC $OUTP B1 101 $ALL6 || true

say "FIN. $(spend) USD estimados gastados esta noche."
if [[ -z "${DRY_RUN:-}" ]]; then
  R=$INV/out/overnight-report-$(date +%Y%m%d); mkdir -p "$R"
  node $INV/analysis/v6_pairs.mjs --a "$OUTP" --b "$OUTP" --json "$R/pairs.json" --md "$R/pairs.md" > "$R/pairs.txt" 2>&1
  node $INV/analysis/v6_b2e.mjs --b2 "$OUTP" --b2e "$OUT6" --seed 101 --json "$R/b2e.json" > "$R/b2e.txt" 2>&1
  say "Informes en research/$R (pairs.md, pairs.json, b2e.json)"
fi
