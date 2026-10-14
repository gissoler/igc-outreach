#!/usr/bin/env bash
# Banco nocturno desatendido: 3 briefs de grants + 3 de inversores, en serie, cada uno en su propio proceso.
# Ejecutar en el Mac, desde research/:   bash scripts/bench-overnight.sh            (real: abre túneles si faltan)
#                                        bash scripts/bench-overnight.sh --dry      (simulación sin red, ~10 s)
# Opcional: BENCH_CASES="g1-mint-ad i1-mint-ad" para correr solo algunos casos.
# Resultado: eval/results/bench-<fecha-hora>/RESUMEN.md (+ una carpeta por caso con trazas, job.json y result.json).
# Duración estimada (real): 6 casos × 6–9 min ≈ 40–55 min; tope duro 16 min por caso (≈ 1 h 40 min en el peor caso).
# Si un caso falla o se cuelga, se anota en RESUMEN.md y se sigue con el siguiente. No toca research/.env ni v14-app.sh.
set -u
cd "$(dirname "$0")/.."
DRY=""; [ "${1:-}" = "--dry" ] && DRY="--dry"
OUT="eval/results/bench-$(date +%Y%m%d-%H%M)${DRY:+-dry}"
mkdir -p "$OUT"
LOG="$OUT/bench.log"
echo "Banco nocturno → $OUT ${DRY:+(SIMULACIÓN)}" | tee -a "$LOG"

# El Mac no se duerme mientras corre (si existe caffeinate).
if command -v caffeinate >/dev/null 2>&1; then caffeinate -dimsu -w $$ & fi

if [ -z "$DRY" ]; then
  # Túneles: se abren solo si faltan (mismo comando que v14-app.sh). Si no responden, se intenta una vez más y luego se corre igual:
  # el resumen dirá qué falló (mejor un informe con errores que una noche perdida).
  bash scripts/tunnel-g355.sh dual-status >/dev/null 2>&1 || bash scripts/tunnel-g355.sh dual-bg 2>&1 | tee -a "$LOG"
  sleep 3
  bash scripts/tunnel-g355.sh dual-status 2>&1 | tee -a "$LOG" || { echo "AVISO: los túneles no responden; se intenta abrir otra vez." | tee -a "$LOG"; bash scripts/tunnel-g355.sh dual-bg 2>&1 | tee -a "$LOG"; sleep 10; }
  # Mismo entorno que v14-app.sh (copiado aquí para no editar ese script).
  export ENGINE_V2=1 ENGINE_JUDGE=1 ENGINE_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 ENGINE_LLM_TIMEOUT_MS=90000
  export COMPILER_LLM_URL=http://127.0.0.1:8017/v1 COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 COMPILER_LLM_JSON_MODE=1 COMPILER_LLM_SCHEMA_LOOSE=1 COMPILER_LLM_MAX_TOKENS=3000 COMPILER_LLM_TIMEOUT_MS=90000
  export JUDGE_LLM_URL=http://127.0.0.1:8016/v1 JUDGE_LLM_MODEL=openai/gpt-oss-120b JUDGE_LLM_REASONING_EFFORT=low JUDGE_LLM_JSON_MODE=1 JUDGE_LLM_TIMEOUT_MS=100000
  export ENGINE_AGENT_LLM_URL=http://127.0.0.1:8016/v1 ENGINE_AGENT_LLM_MODEL=openai/gpt-oss-120b ENGINE_AGENT_LLM_REASONING_EFFORT=low
  export REGISTRY_VERIFY=off ENGINE_GPTR=1 GPTR_MODE=${GPTR_MODE:-deep} GPTR_SECONDS=${GPTR_SECONDS:-270} GPTR_JUDGE=node GPTR_REPORT_GRACE_SECONDS=${GPTR_REPORT_GRACE_SECONDS:-30}
  export GPTR_JUDGE_MAX=${GPTR_JUDGE_MAX:-40} GPTR_OPEN_MAX=${GPTR_OPEN_MAX:-150}
  export ENGINE_AGENT=1 ENGINE_AGENT_PARALLEL=1 ENGINE_AGENT_LLM_JSON_MODE=1 ENGINE_AGENT_LLM_TIMEOUT_MS=45000
  export ENGINE_AGENT_SECONDS=420 ENGINE_AGENT_HARD_SECONDS=420 ENGINE_AGENT_JUDGE_RESERVE_SECONDS=60 ENGINE_AGENT_STEPS=40 ENGINE_AGENT_OPENS=40 ENGINE_AGENT_SEARCHES=40 ENGINE_DISCOVERY=1
  export ENGINE_AGENT_APOLLO_ORGS=5 ENGINE_AGENT_APOLLO_CREDITS=25 APOLLO_ENABLED=1
  export INTAKE_LLM_ROLE=own INTAKE_LLM_BASE_URL=http://127.0.0.1:8016/v1 INTAKE_LLM_MODEL=openai/gpt-oss-120b VLLM_CHAT_URL=http://127.0.0.1:8016/v1 VLLM_CHAT_MODEL=openai/gpt-oss-120b
  export RESEARCH_RUN_TIMEOUT_MS=720000 ORCHESTRATOR=0 RESEARCH_BROWSER=off
fi

CASES="${BENCH_CASES:-$(node scripts/bench-overnight.mjs --list)}"
i=0; n=$(echo $CASES | wc -w | tr -d ' ')
for c in $CASES; do
  i=$((i+1))
  echo "[$(date +%H:%M:%S)] caso $i/$n: $c" | tee -a "$LOG"
  # Cada caso en su propio proceso: un fallo o un cuelgue no tumba a los demás.
  node --env-file-if-exists=.env scripts/bench-overnight.mjs --case "$c" --out "$OUT" $DRY >>"$LOG" 2>&1 \
    && echo "  ok" | tee -a "$LOG" || echo "  FALLÓ (sigue con el siguiente; detalle en $LOG y $OUT/$c/result.json)" | tee -a "$LOG"
  [ -z "$DRY" ] && sleep 20   # respiro para los modelos y las APIs entre casos
done
node scripts/bench-overnight.mjs --summarize --out "$OUT" --cases "$CASES" | tee -a "$LOG"
echo "[$(date +%H:%M:%S)] Listo. Abre $OUT/RESUMEN.md" | tee -a "$LOG"
