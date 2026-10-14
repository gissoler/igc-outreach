#!/usr/bin/env bash
# V14.3: levanta el servidor de Outreach con el agente PARALELO (ENGINE_AGENT=1, ENGINE_AGENT_PARALLEL=1) para probar desde el frontend.
# Ejecutar en el Mac, desde research/:  bash scripts/v14-app.sh
# Tiempo: tope duro de 300 s en total (el bucle corta a los 210 s y se reservan 90 s para los jueces). Apollo hasta 25 créditos.
set -u
cd "$(dirname "$0")/.."
bash scripts/tunnel-g355.sh dual-status || bash scripts/tunnel-g355.sh dual-bg
bash scripts/tunnel-g355.sh dual-status || { echo "Los túneles no responden: no se arranca."; exit 1; }
export ENGINE_JUDGE=1 ENGINE_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 ENGINE_LLM_TIMEOUT_MS=90000
export COMPILER_LLM_URL=http://127.0.0.1:8017/v1 COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 COMPILER_LLM_JSON_MODE=1 COMPILER_LLM_SCHEMA_LOOSE=1 COMPILER_LLM_MAX_TOKENS=3000 COMPILER_LLM_TIMEOUT_MS=90000
export JUDGE_LLM_URL=http://127.0.0.1:8016/v1 JUDGE_LLM_MODEL=openai/gpt-oss-120b JUDGE_LLM_REASONING_EFFORT=low JUDGE_LLM_JSON_MODE=1 JUDGE_LLM_TIMEOUT_MS=100000
# Modelo que decide los pasos del agente: AGENT_MODEL=grande (por defecto, gpt-oss-120b con razonamiento bajo, como en el diseño y el benchmark) o AGENT_MODEL=rapido (Qwen3-30B, más veloz y menos capaz).
# La comprensión del brief y la lectura de cada página van con Qwen3-30B: en la traza del 13/10 la comprensión con gpt-oss-120b superó 120 s dos veces.
if [ "${AGENT_MODEL:-grande}" = "rapido" ]; then export ENGINE_AGENT_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_AGENT_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 ENGINE_AGENT_LLM_REASONING_EFFORT=
else export ENGINE_AGENT_LLM_URL=http://127.0.0.1:8016/v1 ENGINE_AGENT_LLM_MODEL=openai/gpt-oss-120b ENGINE_AGENT_LLM_REASONING_EFFORT=low; fi
export REGISTRY_VERIFY=${REGISTRY_VERIFY:-off}
export ENGINE_GPTR=1 GPTR_MODE=${GPTR_MODE:-deep} GPTR_SECONDS=${GPTR_SECONDS:-270} GPTR_JUDGE=${GPTR_JUDGE:-node} ENGINE_AGENT_OPENS=40
export ENGINE_AGENT=1 ENGINE_AGENT_PARALLEL=1 ENGINE_AGENT_LLM_JSON_MODE=1 ENGINE_AGENT_LLM_TIMEOUT_MS=45000
export ENGINE_AGENT_SECONDS=420 ENGINE_AGENT_HARD_SECONDS=420 ENGINE_AGENT_JUDGE_RESERVE_SECONDS=60 ENGINE_AGENT_STEPS=40 ENGINE_AGENT_OPENS=40 ENGINE_AGENT_SEARCHES=40 ENGINE_DISCOVERY=1 ENGINE_AGENT_APOLLO_ORGS=5 ENGINE_AGENT_APOLLO_CREDITS=25 APOLLO_ENABLED=1
# El .env apunta el intake y el chat al 235B, que ya no está en 8016 (ahora sirve gpt-oss-120b): se redirigen aquí, sin tocar .env.
export INTAKE_LLM_ROLE=own INTAKE_LLM_BASE_URL=http://127.0.0.1:8016/v1 INTAKE_LLM_MODEL=openai/gpt-oss-120b VLLM_CHAT_URL=http://127.0.0.1:8016/v1 VLLM_CHAT_MODEL=openai/gpt-oss-120b
# El pipeline corta toda la investigación a los 240 s por defecto; con el agente se amplía a 11 min. El orquestador viejo se apaga: relanzaría búsquedas después del agente.
export ENGINE_AGENT_TRACE_DIR="eval/runs/app-$(date +%Y%m%d-%H%M%S)"
export RESEARCH_RUN_TIMEOUT_MS=720000 ORCHESTRATOR=0
echo "Motor: ENGINE_GPTR=$ENGINE_GPTR GPTR_MODE=$GPTR_MODE GPTR_SECONDS=$GPTR_SECONDS GPTR_JUDGE=$GPTR_JUDGE · en esta terminal verás líneas [gptr …]; también quedan en $ENGINE_AGENT_TRACE_DIR/gptr.log"
echo "Servidor con agente paralelo en http://127.0.0.1:${RESEARCH_PORT:-8788} (frontend: el de siempre). Cada investigación debe terminar en 5 a 10 minutos."
npm start
