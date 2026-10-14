#!/usr/bin/env bash
# V14.3: levanta el servidor de Outreach con el agente PARALELO (ENGINE_AGENT=1, ENGINE_AGENT_PARALLEL=1) para probar desde el frontend.
# Ejecutar en el Mac, desde research/:  bash scripts/v14-app.sh
# Tiempo: objetivo 300 s (hasta 540 s si sigue encontrando candidatas), 60 s reservados para los jueces. Sin créditos de Apollo del agente.
set -u
cd "$(dirname "$0")/.."
bash scripts/tunnel-g355.sh dual-status || bash scripts/tunnel-g355.sh dual-bg
bash scripts/tunnel-g355.sh dual-status || { echo "Los túneles no responden: no se arranca."; exit 1; }
export ENGINE_JUDGE=1 ENGINE_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 ENGINE_LLM_TIMEOUT_MS=90000
export COMPILER_LLM_URL=http://127.0.0.1:8017/v1 COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 COMPILER_LLM_JSON_MODE=1 COMPILER_LLM_TIMEOUT_MS=240000
export JUDGE_LLM_URL=http://127.0.0.1:8016/v1 JUDGE_LLM_MODEL=openai/gpt-oss-120b JUDGE_LLM_REASONING_EFFORT=medium JUDGE_LLM_JSON_MODE=1 JUDGE_LLM_TIMEOUT_MS=120000
export ENGINE_AGENT=1 ENGINE_AGENT_PARALLEL=1 ENGINE_AGENT_LLM_URL=http://127.0.0.1:8016/v1 ENGINE_AGENT_LLM_MODEL=openai/gpt-oss-120b ENGINE_AGENT_LLM_REASONING_EFFORT=low ENGINE_AGENT_LLM_JSON_MODE=1 ENGINE_AGENT_LLM_TIMEOUT_MS=120000
export ENGINE_AGENT_SECONDS=300 ENGINE_AGENT_HARD_SECONDS=540 ENGINE_AGENT_JUDGE_RESERVE_SECONDS=60 ENGINE_AGENT_STEPS=40 ENGINE_AGENT_OPENS=40 ENGINE_AGENT_SEARCHES=24 ENGINE_AGENT_APOLLO_CREDITS=0
# El .env apunta el intake y el chat al 235B, que ya no está en 8016 (ahora sirve gpt-oss-120b): se redirigen aquí, sin tocar .env.
export INTAKE_LLM_ROLE=own INTAKE_LLM_BASE_URL=http://127.0.0.1:8016/v1 INTAKE_LLM_MODEL=openai/gpt-oss-120b VLLM_CHAT_URL=http://127.0.0.1:8016/v1 VLLM_CHAT_MODEL=openai/gpt-oss-120b
# El pipeline corta toda la investigación a los 240 s por defecto; con el agente se amplía a 11 min. El orquestador viejo se apaga: relanzaría búsquedas después del agente.
export ENGINE_AGENT_TRACE_DIR="eval/runs/app-$(date +%Y%m%d-%H%M%S)"
export RESEARCH_RUN_TIMEOUT_MS=660000 ORCHESTRATOR=0
echo "Servidor con agente paralelo en http://127.0.0.1:${RESEARCH_PORT:-8788} (frontend: el de siempre). Cada investigación debe terminar en 5 a 10 minutos."
npm start
