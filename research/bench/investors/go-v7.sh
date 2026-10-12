#!/usr/bin/env bash
# Revisa todo, hace commit y deja la corrida v7 andando en segundo plano con tope de gasto (basado en go-overnight.sh).
# Uso, desde cualquier sitio:   bash ~/Documents/PROJECTS/AGENT/research/bench/investors/go-v7.sh
# Si algo falla, se detiene ANTES de gastar y dice qué. No muestra claves.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
CAP="${CAP_USD:-9}"; T="${TMPDIR:-/tmp}"
ok()   { printf '  OK   %s\n' "$*"; }
fail() { printf '  FALLA %s\n\nNO se lanzó nada y no se gastó nada.\n' "$*"; exit 1; }

echo "1/7 tests"
node --test research/tests/agent/investors.v5.test.mjs research/tests/agent/investors.v6.test.mjs research/tests/agent/investors.v6-r4.test.mjs research/tests/agent/investors.v7.test.mjs > "$T/go-v7-tests.txt" 2>&1 \
  && ok "$(grep -E '^# pass' "$T/go-v7-tests.txt") $(grep -E '^# fail' "$T/go-v7-tests.txt")" || fail "tests (ver $T/go-v7-tests.txt)"
(cd research && node bench/investors/freeze.mjs --config bench/investors/config/v5-2026-10-09.json --check > "$T/go-v7-fp5.txt" 2>&1) && ok "fingerprint v5: 89 archivos originales idénticos" || fail "el fingerprint v5 cambió (ver $T/go-v7-fp5.txt)"
(cd research && node bench/investors/freeze.mjs --config bench/investors/config/v7-2026-10-12.json --check > "$T/go-v7-fp7.txt" 2>&1) && ok "fingerprint v7 coincide con los archivos" || fail "el fingerprint v7 no coincide (ver $T/go-v7-fp7.txt)"

echo "2/7 claves (sin mostrarlas)"
for k in EXA_API_KEY ENGINE_LLM_URL ENGINE_LLM_MODEL; do grep -qE "^$k=.+" research/.env || fail "falta $k en research/.env"; done
ok "EXA_API_KEY, ENGINE_LLM_URL, ENGINE_LLM_MODEL presentes"

echo "3/7 Docker y Crawl4AI"
docker info >/dev/null 2>&1 || { open -a Docker 2>/dev/null; echo "  esperando a Docker…"; for i in $(seq 1 30); do sleep 4; docker info >/dev/null 2>&1 && break; done; }
docker info >/dev/null 2>&1 || fail "Docker no responde (ábrelo y vuelve a correr esto)"
(cd research && bash bench/investors/crawl4ai-local.sh > "$T/go-v7-crawl.txt" 2>&1) || fail "Crawl4AI no arrancó (ver $T/go-v7-crawl.txt)"
(cd research && node --env-file=.env --env-file-if-exists=.env.crawl4ai bench/investors/preflight-reader.mjs --out "$T/go-v7-reader.json" > "$T/go-v7-reader.txt" 2>&1) \
  && ok "Crawl4AI responde" || fail "preflight del lector (ver $T/go-v7-reader.txt)"

echo "4/7 LLM devuelve JSON real (extractor v3, esquema investor_extraction.v2)"
(cd research && node --env-file=.env --input-type=module -e '
import { createInvestorLlm } from "./bench/investors/external.mjs";
import { loadInvestorPrompt } from "./bench/investors/prompts.mjs";
import { render } from "./agent/prompts.mjs";
const prompt = loadInvestorPrompt("extractor", "v3", { manifest: "manifest.v7.json" });
const page = "Andes Seed Fund is a venture capital firm. Andes Seed Fund invests in seed-stage fintech startups in Mexico and Peru. Contact us at andesseed.example.";
const user = render(prompt.user, { today: "2026-10-09", url: "https://andesseed.example/", page_text: page });
const out = await createInvestorLlm({ family: "agent" }).call({ prompt, user, schemaName: "investor_extraction.v2", temperature: 0, seed: 0, maxTokens: 6000 });
console.log(JSON.stringify({ entity_kind: out.json.entity_kind, canonical_name: out.json.canonical_name, quote: out.json.quote }));
process.exit(out.json.entity_kind === "institutional_investor" ? 0 : 1);' > "$T/go-v7-llm.txt" 2>&1) \
  && ok "LLM responde JSON del extractor: $(tail -1 "$T/go-v7-llm.txt")" || fail "el LLM no respondió JSON válido (ver $T/go-v7-llm.txt)"

echo "5/7 simulacro (no gasta): plan y costo esperado"
DRY_RUN=1 bash research/bench/investors/run-v7.sh > "$T/go-v7-dry.txt" 2>&1 && sed 's/^/   /' "$T/go-v7-dry.txt" || fail "DRY_RUN (ver $T/go-v7-dry.txt)"

echo "6/7 commit (sin atribuciones)"
git add research/bench/investors/{extractor.v7.mjs,engine.v7.mjs,external.v7.mjs,cache-layers.v7.mjs,workspace.v7.mjs,run-experiment.v7.mjs,run-v7.sh,go-v7.sh,freeze.mjs,exa-guard.sh} \
        research/bench/investors/config/{v7-2026-10-12.json,v7-initial-batches.json} research/bench/investors/analysis/exa_spend.mjs \
        research/bench/investors/analysis/v7 research/bench/investors/analysis/v8_diagnostico/*.py \
        prompts/investor/manifest.v7.json docs/contracts/investor/investor_run_config.v5.schema.json research/tests/agent/investors.v7.test.mjs \
        docs/handoff/{PROMPT-v8-diagnostico.md,PROMPT-v9-correcciones.md,V7-CAMBIOS.md,V7-PREREGISTRO.md} docs/benchmark/investors/DIAGNOSTICO-2026-10-12.md
git diff --cached --quiet || git commit -q -m "V7: brazo v7 (profundización a 8 firmas, relectura de citas, salto de dominios que fallan, mínimo de 14 búsquedas antes de stop, lote inicial fijo), pre-registro y go-v7.sh" \
  && ok "commit $(git log -1 --format=%h)" || fail "git commit"

echo "7/7 lanzamiento (C4 + 18 corridas, tope US\$ $CAP)"
L="research/bench/investors/out/v7-launch-$(date +%Y%m%d-%H%M).txt"
nohup env CAP_USD="$CAP" bash research/bench/investors/run-v7.sh > "$L" 2>&1 < /dev/null &
PID=$!; disown; sleep 3
ok "corriendo en segundo plano (PID $PID), tope US\$ $CAP"
echo
echo "Puedes cerrar esta terminal. Deja el Mac CONECTADO a la corriente y con la tapa ABIERTA."
echo "Ver avance:     tail -f $ROOT/$L"
echo "Gasto Exa v7:   (cd $ROOT/research && node bench/investors/analysis/exa_spend.mjs --dirs bench/investors/out/investors-internal-2026-10-12-v7,bench/investors/out/reachability-v7-2026-10-12 --usd-per-call 0.0089)"
echo "Detenerla:      touch $ROOT/research/bench/investors/out/.v7-stop   (termina las corridas en curso y para)"
echo "Al terminar:    docs/benchmark/investors/V7-RESULTADOS.md y ALCANZABILIDAD-ORO.md"
