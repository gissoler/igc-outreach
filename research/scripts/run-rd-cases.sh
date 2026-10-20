#!/usr/bin/env bash
# Diez casos del Pipeline I+D con preflight de rendimiento (P0.7). Copia de run-all.sh del vault, que no se modifica.
# Corre los casos SOLO con CONFIRM_SPEND=1: gastan búsquedas pagadas (Exa, You, Tavily, Serper) y pueden gastar Apollo.
# Uso:  PIPELINE_ROOT="…/Fuentes/Pipeline I+D Outreach - 2026-10-19" OUT_NAME=runs-v4 [CONFIRM_SPEND=1] research/scripts/run-rd-cases.sh
# Variables P0 (con su valor por defecto): ENGINE_AGENT_UNDERSTAND_MODE=parallel, ENGINE_AGENT_UNDERSTAND_TIMEOUT_MS=20000,
#   ENGINE_AGENT_ASSESS_CONTRACT=lite, ENGINE_AGENT_APOLLO_STAGE=tool (post_judge para la etapa nueva), PREFLIGHT_MIN_TOKS=80,
#   ENGINE_SEARCH_PROVIDERS_OFF= (p. ej. jina si sigue sin saldo), APOLLO_ENABLED=0 (Apollo APAGADO por defecto; 1 lo enciende, tope ENGINE_AGENT_APOLLO_CREDITS=5), ENGINE_AGENT_APOLLO_SEED=1 (Apollo como fuente inicial: busca organizaciones con los
#   términos del brief antes del primer paso, 1 crédito estimado por búsqueda, dentro del tope; 0 lo apaga). Tope de tokens de assess: 2000. Ninguna decide por sí sola una comparación: ver 09/10 del vault.
set -u
WT="${WT:-$(cd "$(dirname "$0")/../.." && pwd)}"
ROOT="${PIPELINE_ROOT:?define PIPELINE_ROOT (carpeta con profiles/)}"
OUT_NAME="${OUT_NAME:?define OUT_NAME, una carpeta NUEVA dentro de PIPELINE_ROOT (p. ej. runs-v4)}"
ENV_FILE="${ENV_FILE:-/Users/gcaicedo/Documents/PROJECTS/AGENT/research/.env}"
NODE="${NODE:-node}"
OUT="$ROOT/$OUT_NAME"
if test -e "$OUT" || test -e "$OUT.preflight.json"; then echo "$OUT ya existe; no se sobrescriben corridas." >&2; exit 2; fi
cd "$WT/research" || exit 1

for port in 8016 8017; do
  curl -fsS --max-time 6 "http://127.0.0.1:$port/v1/models" >/dev/null || { echo "Model preflight failed on local port $port; no cases were started." >&2; exit 2; }
done
# Rendimiento real (no solo /v1/models): una inferencia de ~500 tokens con el esquema de lectura en cada modelo.
"$NODE" scripts/model-preflight.mjs --endpoints "agent=http://127.0.0.1:8016/v1#openai/gpt-oss-120b,compiler=http://127.0.0.1:8017/v1#Qwen/Qwen3-30B-A3B-Instruct-2507" \
  --min-toks "${PREFLIGHT_MIN_TOKS:-80}" --out "$OUT.preflight.json" || { echo "Throughput preflight failed; no cases were started." >&2; exit 3; }
if [ "${CONFIRM_SPEND:-0}" != "1" ]; then echo "Preflight ok. Para correr los diez casos (búsquedas pagadas, tope Exa USD 0,25 y Apollo solo si pones APOLLO_ENABLED=1, con tope de 5 créditos por caso) repite con CONFIRM_SPEND=1."; exit 0; fi

export ENGINE_JUDGE=1 ENGINE_JUDGE_BLIND=1
export ENGINE_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 ENGINE_LLM_TIMEOUT_MS=90000
export COMPILER_LLM_URL=http://127.0.0.1:8017/v1 COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 COMPILER_LLM_JSON_MODE=1 COMPILER_LLM_TIMEOUT_MS=90000
export JUDGE_LLM_URL=http://127.0.0.1:8016/v1 JUDGE_LLM_MODEL=openai/gpt-oss-120b JUDGE_LLM_REASONING_EFFORT=low JUDGE_LLM_JSON_MODE=1 JUDGE_LLM_TIMEOUT_MS=100000
export ENGINE_AGENT=1 ENGINE_AGENT_PARALLEL=1 ENGINE_AGENT_LLM_URL=http://127.0.0.1:8016/v1 ENGINE_AGENT_LLM_MODEL=openai/gpt-oss-120b ENGINE_AGENT_LLM_REASONING_EFFORT=low ENGINE_AGENT_LLM_JSON_MODE=1 ENGINE_AGENT_LLM_TIMEOUT_MS=90000
export ENGINE_AGENT_UNDERSTAND_ROLE="${ENGINE_AGENT_UNDERSTAND_ROLE:-agent}" ENGINE_AGENT_ASSESS_ROLE="${ENGINE_AGENT_ASSESS_ROLE:-agent}"
export ENGINE_AGENT_SECONDS=180 ENGINE_AGENT_HARD_SECONDS=240 ENGINE_AGENT_JUDGE_RESERVE_SECONDS=60
export ENGINE_AGENT_UNDERSTAND_TIMEOUT_MS="${ENGINE_AGENT_UNDERSTAND_TIMEOUT_MS:-20000}" ENGINE_AGENT_STEP_TIMEOUT_MS=45000 ENGINE_AGENT_ASSESS_TIMEOUT_MS=60000 ENGINE_AGENT_JUDGE_TIMEOUT_MS=90000
export ENGINE_AGENT_STEPS=32 ENGINE_AGENT_OPENS=30 ENGINE_AGENT_SEARCHES=12 ENGINE_AGENT_APOLLO_CREDITS="${ENGINE_AGENT_APOLLO_CREDITS:-5}" APOLLO_ENABLED="${APOLLO_ENABLED:-0}"
export ENGINE_AGENT_UNDERSTAND_MODE="${ENGINE_AGENT_UNDERSTAND_MODE:-parallel}" ENGINE_AGENT_ASSESS_CONTRACT="${ENGINE_AGENT_ASSESS_CONTRACT:-lite}" ENGINE_AGENT_APOLLO_STAGE="${ENGINE_AGENT_APOLLO_STAGE:-tool}"
export ENGINE_SEARCH_PROVIDERS_OFF="${ENGINE_SEARCH_PROVIDERS_OFF:-jina}"
mkdir -p "$OUT"

run_case() {
  id="$1" profile="$2" objective="$3"; out="$OUT/$id"
  if [ -n "${ONLY:-}" ] && ! echo ",$ONLY," | grep -q ",$id,"; then return 0; fi   # ONLY=RD-04,RD-05 corre solo esos casos
  if test -f "$out/result.json"; then echo "$id already complete"; return 0; fi
  mkdir -p "$out"; echo "=== $id $objective ==="
  NODE_V8_COVERAGE="$out/coverage" "$NODE" --env-file="$ENV_FILE" scripts/engine-run.mjs \
    --brief "$ROOT/profiles/$profile" --objectives "$objective" --today "${TODAY:-2026-10-19}" \
    --no-cache --trace --exa-usd-cap 0.25 --out "$out"
}

run_case RD-01 RD-01-binding-platform.json investment
run_case RD-02 RD-02-cb1-cb2.json investment
run_case RD-03 RD-03-gip-glp1.json investment
run_case RD-04 RD-04-mint-ad-genomics.json grant
run_case RD-05 RD-05-mint-ad-clinical-mri.json grant
run_case RD-06 RD-06-differential-dementia.json grant
run_case RD-07 RD-07-sociodemographic.json grant
run_case RD-08 RD-08-er-detection.json grant
run_case RD-09 RD-09-audio.json investment
run_case RD-10 RD-10-retrosynthesis.json investment
