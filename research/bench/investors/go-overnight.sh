#!/usr/bin/env bash
# Revisa todo, hace commit y deja la corrida nocturna andando en segundo plano. Uso, desde cualquier sitio:
#   bash ~/Documents/PROJECTS/AGENT/research/bench/investors/go-overnight.sh
# Si algo falla, se detiene ANTES de gastar y dice qué. No muestra claves.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
CAP="${CAP_USD:-14}"
ok()   { printf '  OK   %s\n' "$*"; }
fail() { printf '  FALLA %s\n\nNO se lanzó nada.\n' "$*"; exit 1; }

echo "1/7 tests"
node --test research/tests/agent/investors.v5.test.mjs research/tests/agent/investors.v6.test.mjs research/tests/agent/investors.v6-r4.test.mjs > /tmp/go-tests.txt 2>&1 \
  && ok "$(grep -E '^# pass' /tmp/go-tests.txt)" || fail "tests (ver /tmp/go-tests.txt)"

echo "2/7 claves (sin mostrarlas)"
for k in EXA_API_KEY ENGINE_LLM_URL ENGINE_LLM_MODEL; do
  grep -qE "^$k=.+" research/.env || fail "falta $k en research/.env"; done; ok "EXA_API_KEY, ENGINE_LLM_URL, ENGINE_LLM_MODEL presentes"

echo "3/7 Docker y Crawl4AI"
docker info >/dev/null 2>&1 || { open -a Docker 2>/dev/null; echo "  esperando a Docker…"; for i in $(seq 1 30); do sleep 4; docker info >/dev/null 2>&1 && break; done; }
docker info >/dev/null 2>&1 || fail "Docker no responde (ábrelo y vuelve a correr esto)"
(cd research && bash bench/investors/crawl4ai-local.sh >/tmp/go-crawl.txt 2>&1) || fail "Crawl4AI no arrancó (ver /tmp/go-crawl.txt)"
(cd research && node --env-file=.env --env-file-if-exists=.env.crawl4ai bench/investors/preflight-reader.mjs --out /tmp/go-reader.json >/tmp/go-reader.txt 2>&1) \
  && ok "Crawl4AI responde" || fail "preflight del lector (ver /tmp/go-reader.txt)"

echo "4/7 LLM devuelve JSON"
(cd research && node --env-file=.env --input-type=module -e '
import { createInvestorLlm } from "./bench/investors/external.mjs";
import { loadInvestorPrompt } from "./bench/investors/prompts.mjs";
const prompt = loadInvestorPrompt("relevance", "v1", { manifest: "manifest.v6.json" });
const user = "Founder intent: app that reduces carbon emissions\n\nSearch results:\n[0] Fund invests in carbon-reduction startups. The fund led a seed round.\n[1] Battery factory opens in Australia. Production starts next year.";
const out = await createInvestorLlm({ family: "agent" }).call({ prompt, user, schemaName: "investor_relevance.v1", temperature: 0, seed: 101, maxTokens: 2000 });
const it = out.json.items ?? []; console.log(JSON.stringify(it));
process.exit(it.some(x => x.i === 0 && x.about_investment === true) ? 0 : 1);' > /tmp/go-llm.txt 2>&1) \
  && ok "LLM responde JSON del filtro: $(tail -1 /tmp/go-llm.txt)" || fail "el LLM no respondió JSON válido del filtro (ver /tmp/go-llm.txt)"

echo "5/7 embeddings (descarga Xenova/multilingual-e5-small la primera vez)"
(cd research && { npm ls @xenova/transformers >/dev/null 2>&1 || npm install --no-save @xenova/transformers@2.17.2 >/tmp/go-npm.txt 2>&1; } && node bench/investors/embed-check.mjs > /tmp/go-embed.txt 2>&1) \
  && ok "$(grep -o '"cos_investment_text":[0-9.]*,"cos_unrelated_text":[0-9.]*' /tmp/go-embed.txt)" \
  || echo "  AVISO embeddings no disponibles (ver /tmp/go-embed.txt): la corrida seguirá sin las etapas B2E"

echo "6/7 simulacro (no gasta)"
DRY_RUN=1 bash research/bench/investors/run-overnight.sh > /tmp/go-dry.txt 2>&1 && ok "plan: $(grep -c '^\[.*== ' /tmp/go-dry.txt) lotes" || fail "DRY_RUN (ver /tmp/go-dry.txt)"
echo "   gasto Exa acumulado antes de empezar: US\$ $(cd research && node bench/investors/analysis/exa_spend.mjs --dirs bench/investors/out/quick-v5-2026-10-09,bench/investors/out/investors-internal-2026-10-09-v5,bench/investors/out/investors-internal-2026-10-09-v5-pairs,bench/investors/out/investors-internal-2026-10-09-v6)"

echo "7/7 commit y lanzamiento"
git add research/bench/investors/run-overnight.sh research/bench/investors/run-experiment.v6.mjs research/bench/investors/relevance-embeddings.mjs \
        research/bench/investors/embed-check.mjs research/bench/investors/intent-clarify.mjs research/bench/investors/go-overnight.sh research/tests/agent/investors.v6-r4.test.mjs
git diff --cached --quiet || git commit -q -m "V6-11: tope de gasto por corrida (vigilante + --stop-file), pares en lotes A+B, medición que falla cerrada, embed-check con comprobación, diseño R4 apagado" && ok "commit $(git log -1 --format=%h)"
L="research/bench/investors/out/overnight-launch-$(date +%Y%m%d-%H%M).txt"
nohup env CAP_USD="$CAP" bash research/bench/investors/run-overnight.sh > "$L" 2>&1 < /dev/null &
disown; sleep 3
ok "corriendo en segundo plano (PID $!), tope US\$ $CAP"
echo
echo "Puedes cerrar esta terminal. Deja el Mac CONECTADO a la corriente y con la tapa ABIERTA."
echo "Ver avance:   tail -f $ROOT/$L"
echo "Detenerlo:    touch $ROOT/research/bench/investors/out/.overnight-stop   (termina las corridas en curso y para)"
echo "Al terminar, los informes quedan en research/bench/investors/out/overnight-report-*/"
