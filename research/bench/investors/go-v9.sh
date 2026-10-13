#!/usr/bin/env bash
# V9: candidatos del modelo ("como Claude o Gemini"). Un comando, desde cualquier sitio:
#   bash ~/Documents/PROJECTS/AGENT/research/bench/investors/go-v9.sh
# 1) tests y huellas; 2) claves (sin mostrarlas; ANTHROPIC_API_KEY y GEMINI_API_KEY son opcionales); 3) Docker, Crawl4AI y LLM;
# 4) commit; 5) prueba de nombres SIN Exa: cada modelo disponible propone 40 fondos por caso y se mide si el oro está;
# 6) si el mejor nombra el oro en ≥ 4 de 6 casos: simulacro y corrida formal en segundo plano (tope Exa US$ 5 sobre todo v9).
# Cualquier fallo antes de gastar: se para sin gastar.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT/research"
INV=bench/investors; CFG=$INV/config/v9-2026-10-13.json; T="${TMPDIR:-/tmp}"; NOUT=$INV/out/v9-nombres-2026-10-13
ok()   { printf '  OK   %s\n' "$*"; }
fail() { printf '  FALLA %s\n\nNO se lanzó nada y no se gastó nada en Exa.\n' "$*"; exit 1; }

echo "1/6 tests y huellas"
node --test --test-reporter=tap tests/agent/investors.v5.test.mjs tests/agent/investors.v6.test.mjs tests/agent/investors.v6-r4.test.mjs tests/agent/investors.v7.test.mjs tests/agent/investors.v8.test.mjs tests/agent/investors.v9.test.mjs > "$T/go-v9-tests.txt" 2>&1 \
  && ok "$(grep -E '^# pass' "$T/go-v9-tests.txt") $(grep -E '^# fail' "$T/go-v9-tests.txt")" || fail "tests (ver $T/go-v9-tests.txt)"
for c in v5-2026-10-09 v7-2026-10-12 v8-2026-10-12 v9-diagnostico-2026-10-12; do node $INV/freeze.mjs --config $INV/config/$c.json --check > "$T/go-v9-fp.txt" 2>&1 && ok "huella $c idéntica" || fail "la huella $c cambió (ver $T/go-v9-fp.txt)"; done
if [[ -f $INV/out/investors-internal-2026-10-13-v9/fingerprint.json ]]; then node $INV/freeze.mjs --config "$CFG" --check > "$T/go-v9-fp9.txt" 2>&1 && ok "huella v9 idéntica" || fail "la huella v9 cambió (ver $T/go-v9-fp9.txt)"
else node $INV/freeze.mjs --config "$CFG" | sed 's/^/  /'; fi

echo "2/6 claves (sin mostrarlas)"
[[ -f .env ]] || fail "no existe research/.env"
for k in EXA_API_KEY ENGINE_LLM_URL ENGINE_LLM_MODEL; do grep -qE "^$k=.+" .env || fail "falta $k en research/.env"; done
PROV="fleet"; for k in ANTHROPIC_API_KEY GEMINI_API_KEY; do if grep -qE "^$k=.{8,}" .env; then ok "$k presente"; PROV="$PROV,$( [[ $k == ANTHROPIC_API_KEY ]] && echo anthropic || echo gemini )"; else echo "  --   $k no está (opcional: con ella se prueba también ese modelo)"; fi; done
ok "modelos que se van a probar: $PROV"

echo "3/6 Docker, Crawl4AI y LLM propio"
docker info >/dev/null 2>&1 || { open -a Docker 2>/dev/null; echo "  esperando a Docker…"; for i in $(seq 1 30); do sleep 4; docker info >/dev/null 2>&1 && break; done; }
docker info >/dev/null 2>&1 || fail "Docker no responde (ábrelo y vuelve a correr esto)"
bash $INV/crawl4ai-local.sh > "$T/go-v9-crawl.txt" 2>&1 || fail "Crawl4AI no arrancó (ver $T/go-v9-crawl.txt)"
node --env-file=.env --env-file-if-exists=.env.crawl4ai $INV/preflight-reader.mjs --out "$T/go-v9-reader.json" > "$T/go-v9-reader.txt" 2>&1 && ok "Crawl4AI responde" || fail "preflight del lector (ver $T/go-v9-reader.txt)"

echo "4/6 commit (sin atribuciones)"
git -C .. add research/bench/investors/{engine.v9.mjs,name-candidates.v9.mjs,workspace.v9.mjs,run-experiment.v9.mjs,run-v9.sh,go-v9.sh,go-v9-diagnostico.sh,freeze.mjs,resolve.v9.mjs,resolve-match.v9.mjs} \
  research/bench/investors/config/v9-2026-10-13.json research/bench/investors/analysis/v9 research/tests/agent/investors.v9.test.mjs \
  prompts/investor/candidates prompts/investor/manifest.v9.json docs/handoff/{V9-PREREGISTRO.md,V9-CAMBIOS.md} docs/benchmark/investors/V9-DIAGNOSTICO.md 2>/dev/null
git -C .. diff --cached --quiet || git -C .. commit -q -m "V9: brazo de candidatos del modelo (engine.v9), prueba de nombres y go-v9.sh" && ok "commit $(git -C .. log -1 --format=%h)" || fail "git commit"

echo "5/6 prueba de nombres (sin Exa; puede tardar unos minutos con búsqueda web)"
node --no-warnings --env-file=.env $INV/analysis/v9/names_check.mjs --providers "$PROV" --md ../docs/benchmark/investors/V9-NOMBRES.md 2>&1 | grep -v '^{' | sed 's/^/   /'; rc=${PIPESTATUS[0]}
CHOSEN=$(cat $NOUT/chosen_provider.txt 2>/dev/null | tr -d '[:space:]')
sed -n '/^| Proveedor/,/^$/p' ../docs/benchmark/investors/V9-NOMBRES.md | sed 's/^/   /'; tail -1 ../docs/benchmark/investors/V9-NOMBRES.md | sed 's/^/   /'
git -C .. add docs/benchmark/investors/V9-NOMBRES.md && git -C .. commit -q -m "V9: prueba de nombres" 2>/dev/null
if [[ $rc != 0 ]]; then
  echo; echo "NO-GO de la prueba de nombres: ningún modelo nombra el oro en 4 de 6 casos. No se gastó nada en Exa."
  echo "Para probar con Claude o Gemini, añade a research/.env  ANTHROPIC_API_KEY=...  o  GEMINI_API_KEY=...  y vuelve a correr este comando"
  echo "(las listas ya pedidas quedan en caché; solo se piden las nuevas)."; exit 5
fi

echo "6/6 corrida formal (18 corridas, candidatos: $CHOSEN, tope Exa US\$ ${CAP_USD:-5} sobre todo v9)"
CANDIDATES_PROVIDER="$CHOSEN" DRY_RUN=1 bash $INV/run-v9.sh 2>&1 | sed 's/^/   /' || fail "simulacro"
L="$INV/out/v9-launch-$(date +%Y%m%d-%H%M).txt"
cd "$ROOT"; nohup env CANDIDATES_PROVIDER="$CHOSEN" CAP_USD="${CAP_USD:-5}" bash research/bench/investors/run-v9.sh > "research/$L" 2>&1 < /dev/null &
PID=$!; disown; sleep 3
ok "corriendo en segundo plano (PID $PID)"
echo
echo "Deja el Mac CONECTADO a la corriente y con la tapa ABIERTA. Tarda unas 3 a 5 horas."
echo "Ver avance:   tail -f $ROOT/research/$L"
echo "Detenerla:    touch $ROOT/research/bench/investors/out/.v9-stop"
echo "Al terminar:  docs/benchmark/investors/V9-RESULTADOS.md (se hace commit solo)"
