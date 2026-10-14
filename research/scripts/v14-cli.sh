#!/usr/bin/env bash
# V14.3 por línea de comandos, sin frontend: mismo brief del jefe, agente paralelo, traza completa.
# Uso desde research/:  bash scripts/v14-cli.sh [grant|investment]      (por defecto grant)
# Modelo que decide: AGENT_MODEL=grande (por defecto) o AGENT_MODEL=rapido.
set -u
cd "$(dirname "$0")/.."
caso="${1:-grant}"; out="eval/runs/v14-3-$caso-$(date +%H%M%S)"
bash scripts/tunnel-g355.sh dual-status || bash scripts/tunnel-g355.sh dual-bg
bash scripts/tunnel-g355.sh dual-status || { echo "Los túneles no responden: no se corre nada."; exit 1; }
export ENGINE_JUDGE=1 ENGINE_JUDGE_BLIND=1 ENGINE_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 ENGINE_LLM_TIMEOUT_MS=90000
export COMPILER_LLM_URL=http://127.0.0.1:8017/v1 COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 COMPILER_LLM_JSON_MODE=1 COMPILER_LLM_TIMEOUT_MS=240000
export JUDGE_LLM_URL=http://127.0.0.1:8016/v1 JUDGE_LLM_MODEL=openai/gpt-oss-120b JUDGE_LLM_REASONING_EFFORT=low JUDGE_LLM_JSON_MODE=1 JUDGE_LLM_TIMEOUT_MS=100000
if [ "${AGENT_MODEL:-grande}" = "rapido" ]; then export ENGINE_AGENT_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_AGENT_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 ENGINE_AGENT_LLM_REASONING_EFFORT=
else export ENGINE_AGENT_LLM_URL=http://127.0.0.1:8016/v1 ENGINE_AGENT_LLM_MODEL=openai/gpt-oss-120b ENGINE_AGENT_LLM_REASONING_EFFORT=low; fi
export ENGINE_AGENT=1 ENGINE_AGENT_PARALLEL=1 ENGINE_AGENT_LLM_JSON_MODE=1 ENGINE_AGENT_LLM_TIMEOUT_MS=90000
export ENGINE_AGENT_SECONDS=300 ENGINE_AGENT_HARD_SECONDS=540 ENGINE_AGENT_JUDGE_RESERVE_SECONDS=100 ENGINE_AGENT_STEPS=40 ENGINE_AGENT_OPENS=40 ENGINE_AGENT_SEARCHES=24 ENGINE_AGENT_APOLLO_CREDITS=0
echo "=== $caso → $out ==="
node --env-file-if-exists=.env scripts/engine-run.mjs --brief eval/briefs/jefe-igc-mint-ad-2026-10-12.json --objectives "$caso" --today 2026-10-12 --no-cache --trace --exa-usd-cap 0.50 --out "$out"
echo "Listo. Informe: $out/report.md · traza: $out/events.jsonl · resumen: $out/summary.json"
