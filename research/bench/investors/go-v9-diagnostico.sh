#!/usr/bin/env bash
# V9 (PROMPT-v11) paso 0 y techo del diseño L128. Un comando, desde cualquier sitio:
#   bash ~/Documents/PROJECTS/AGENT/research/bench/investors/go-v9-diagnostico.sh
# 1) tests v5–v9 y huellas v5/v7/v8 (+ huella v9 aparte); 2) claves (sin mostrarlas); 3) Docker, Crawl4AI y LLM;
# 4) simulacro con costo esperado (12 llamadas Exa = US$ 0.107; tope CAP_USD = 0.25); 5) saldo del panel de Exa (opcional, para
# calibrar); 6) diagnóstico con vigilante (exa_spend.mjs --usd-per-call 0.0089, --stop-file); 7) informe y commit (sin atribuciones).
# Cualquier fallo antes de gastar: se para sin gastar.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT/research"
CAP_USD="${CAP_USD:-0.25}"; RATE=0.0089; INV=bench/investors; OUT=$INV/out/v9-diagnostico-2026-10-12; STOP=$OUT/.stop; T="${TMPDIR:-/tmp}"
mkdir -p "$OUT"; LOG=$INV/out/v9-diagnostico-$(date +%Y%m%d-%H%M).log
say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
spend() { node $INV/analysis/exa_spend.mjs --dirs "$OUT" --usd-per-call $RATE 2>/dev/null; }
fail() { say "PARADA: $* (no se gastó nada en este paso)"; exit 1; }

say "== 1/7 tests y huellas"
node --test tests/agent/investors.v5.test.mjs tests/agent/investors.v6.test.mjs tests/agent/investors.v6-r4.test.mjs tests/agent/investors.v7.test.mjs tests/agent/investors.v8.test.mjs tests/agent/investors.v9.test.mjs >"$T/go-v9d-tests.txt" 2>&1 \
  && say "tests: $(grep -E '^# pass' "$T/go-v9d-tests.txt") $(grep -E '^# fail' "$T/go-v9d-tests.txt")" || fail "tests (ver $T/go-v9d-tests.txt)"
node $INV/freeze.mjs --config $INV/config/v5-2026-10-09.json --check >"$T/go-v9d-fp5.txt" 2>&1 && say "huella v5 idéntica" || fail "la huella v5 cambió (ver $T/go-v9d-fp5.txt)"
node $INV/freeze.mjs --config $INV/config/v7-2026-10-12.json --check >"$T/go-v9d-fp7.txt" 2>&1 && say "huella v7 idéntica" || fail "la huella v7 cambió (ver $T/go-v9d-fp7.txt)"
node $INV/freeze.mjs --config $INV/config/v8-2026-10-12.json --check >"$T/go-v9d-fp8.txt" 2>&1 && say "huella v8 idéntica" || fail "la huella v8 cambió (ver $T/go-v9d-fp8.txt)"
if [[ -f "$OUT/fingerprint.json" ]]; then node $INV/freeze.mjs --config $INV/config/v9-diagnostico-2026-10-12.json --check >"$T/go-v9d-fp9.txt" 2>&1 && say "huella v9 idéntica" || fail "la huella v9 cambió (ver $T/go-v9d-fp9.txt)"
else node $INV/freeze.mjs --config $INV/config/v9-diagnostico-2026-10-12.json | tee -a "$LOG"; fi

say "== 2/7 claves (sin mostrarlas)"
[[ -f .env ]] || fail "no existe research/.env"
for k in EXA_API_KEY ENGINE_LLM_URL ENGINE_LLM_MODEL; do grep -qE "^$k=.+" .env || fail "falta $k en research/.env"; done
grep -qE '^SERPER_API_KEY=.{8,}' .env && say "SERPER_API_KEY presente (no se muestra)" || say "AVISO: SERPER_API_KEY ausente: la parte Serper queda sin medir y la regla no podrá dar GO"
s=$(spend); [[ "$s" =~ ^[0-9]+(\.[0-9]+)?$ ]] || fail "no se puede medir el gasto con exa_spend.mjs ('$s')"
say "gasto Exa ya registrado en el diagnóstico v9: US\$ $s"

say "== 3/7 Docker, Crawl4AI y LLM"
docker info >/dev/null 2>&1 || { open -a Docker 2>/dev/null; say "esperando a Docker…"; for i in $(seq 1 30); do sleep 4; docker info >/dev/null 2>&1 && break; done; }
docker info >/dev/null 2>&1 || fail "Docker no responde (ábrelo y vuelve a correr esto)"
bash $INV/crawl4ai-local.sh >"$T/go-v9d-crawl.txt" 2>&1 || fail "Crawl4AI no arrancó (ver $T/go-v9d-crawl.txt)"
node --env-file=.env --env-file-if-exists=.env.crawl4ai $INV/preflight-reader.mjs --out "$T/go-v9d-reader.json" >"$T/go-v9d-reader.txt" 2>&1 && say "Crawl4AI responde" || fail "preflight del lector (ver $T/go-v9d-reader.txt)"
node --env-file=.env --input-type=module -e '
import { createInvestorLlm } from "./bench/investors/external.mjs";
import { loadInvestorPrompt } from "./bench/investors/prompts.mjs";
import { render } from "./agent/prompts.mjs";
const prompt = loadInvestorPrompt("extractor", "v3", { manifest: "manifest.v7.json" });
const page = "Andes Seed Fund is a venture capital firm. Andes Seed Fund invests in seed-stage fintech startups in Mexico and Peru.";
const out = await createInvestorLlm({ family: "agent" }).call({ prompt, user: render(prompt.user, { today: "2026-10-09", url: "https://andesseed.example/", page_text: page }), schemaName: "investor_extraction.v2", temperature: 0, seed: 0, maxTokens: 6000 });
process.exit(out.json.entity_kind === "institutional_investor" ? 0 : 1);' >"$T/go-v9d-llm.txt" 2>&1 && say "LLM responde JSON del extractor" || fail "el LLM no respondió JSON válido (ver $T/go-v9d-llm.txt)"

say "== 3b commit de los archivos v9 (sin atribuciones)"
git -C .. add research/bench/investors/{list-names.v9.mjs,resolve-match.v9.mjs,resolve.v9.mjs,go-v9-diagnostico.sh,freeze.mjs} research/bench/investors/config/v9-diagnostico-2026-10-12.json \
  research/bench/investors/analysis/v9 research/tests/agent/investors.v9.test.mjs docs/handoff/{V9-PREREGISTRO.md,V9-CAMBIOS.md,PROMPT-v11-oro.md} docs/benchmark/investors/V9-TECHOS-SIN-GASTO.{md,json}
git -C .. diff --cached --quiet || git -C .. commit -q -m "V9: techos sin gasto, diagnóstico de un comando (búsqueda por nombre del oro y techo L128) y pre-registro" \
  && say "commit $(git -C .. log -1 --format=%h)" || fail "git commit"

say "== 4/7 simulacro (no gasta)"
node --no-warnings $INV/analysis/v9/diagnostico.v9.mjs --dry-run --cap-usd "$CAP_USD" >"$OUT/dry-run.json" 2>>"$LOG" || fail "simulacro falló o el costo esperado supera US\$ $CAP_USD (ver $OUT/dry-run.json)"
python3 - "$OUT/dry-run.json" <<'PY' | tee -a "$LOG"
import json, sys
d = json.load(open(sys.argv[1]))
print(f"costo esperado Exa: {d['exa_units_expected']} unidades = US$ {d['exa_usd_expected']} (tope US$ {d['cap_usd']}); Serper: {d['serper_queries']} consultas; LLM ≤ {d['llm_calls_max']}; descargas ≤ {d['fetches_max']}")
PY

say "== 5/7 saldo del panel de Exa (para calibrar el medidor; Enter para omitir)"
BEFORE=""; if [[ -t 0 ]]; then read -r -p "  Saldo que muestra ahora el panel de Exa (USD): " BEFORE; fi

say "== 6/7 diagnóstico (tope US\$ $CAP_USD)"
rm -f "$STOP"
( while sleep 10; do s=$(spend); if ! [[ "$s" =~ ^[0-9]+(\.[0-9]+)?$ ]] || awk -v s="$s" -v c="$CAP_USD" 'BEGIN{exit !(s>=c)}'; then [[ -e "$STOP" ]] || { echo "vigilante: gasto US\$ ${s:-?} (tope $CAP_USD)" > "$STOP"; say "VIGILANTE: parada (gasto US\$ ${s:-?})"; }; fi; done ) &
WATCH=$!; trap 'kill $WATCH 2>/dev/null' EXIT
node --no-warnings --env-file=.env --env-file-if-exists=.env.crawl4ai $INV/analysis/v9/diagnostico.v9.mjs --cap-usd "$CAP_USD" --stop-file "$STOP" 2>&1 | tee -a "$LOG"; rc=${PIPESTATUS[0]}
say "gasto Exa del diagnóstico v9 medido: US\$ $(spend) (tope $CAP_USD)"
node $INV/analysis/exa_spend.mjs --dirs "$OUT" --usd-per-call $RATE --json >> "$LOG" 2>&1
AFTER=""; if [[ -t 0 && -n "$BEFORE" ]]; then sleep 20; read -r -p "  Saldo que muestra ahora el panel de Exa (USD; espera ~1 min a que se actualice): " AFTER; fi
if [[ $rc == 0 && -f "$OUT/result.json" ]]; then
  node -e 'const f=process.argv[1],r=require(f),b=parseFloat(process.argv[2]),a=parseFloat(process.argv[3]);r.panel={before:isNaN(b)?null:b,after:isNaN(a)?null:a,delta:isNaN(a)||isNaN(b)?null:+(b-a).toFixed(4),usd_per_unit_panel:isNaN(a)||isNaN(b)||!r.paid_units?null:+((b-a)/r.paid_units).toFixed(5)};require("fs").writeFileSync(f,JSON.stringify(r,null,1)+"\n")' "$ROOT/research/$OUT/result.json" "$BEFORE" "$AFTER"
fi

say "== 7/7 informe"
node --no-warnings $INV/analysis/v9/diagnostico_report.v9.mjs --md ../docs/benchmark/investors/V9-DIAGNOSTICO.md 2>&1 | tee -a "$LOG"
if [[ $rc == 0 ]]; then
  git -C .. add docs/benchmark/investors/V9-DIAGNOSTICO.md
  git -C .. commit -q -m "V9: resultados del diagnóstico (búsqueda por nombre del oro y techo L128)" && say "commit hecho"
  say "FIN: docs/benchmark/investors/V9-DIAGNOSTICO.md. Avisa a Claude para seguir."
else
  say "FIN CON CÓDIGO $rc: incompleto (ver $LOG y $OUT/result-incompleto.json). Se puede relanzar: lo pagado sale de la caché."
fi
exit $rc
