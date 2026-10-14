#!/usr/bin/env bash
# V14 F2.6: corre grant e inversionistas con ENGINE_AGENT=1 (prompt v14.2). Ejecutar en el Mac, desde research/:  bash scripts/v14-f2.sh
# Autorizado por Gisel (13/10): envío de consultas del brief a Exa y Apollo; Exa <= 0,50 USD por caso y <= 5 USD en V14; Apollo <= 25 créditos por caso.
set -u
cd "$(dirname "$0")/.."
bash scripts/tunnel-g355.sh dual-status || bash scripts/tunnel-g355.sh dual-bg
bash scripts/tunnel-g355.sh dual-status || { echo "Los túneles no responden: no se corre nada."; exit 1; }
[ -d eval/runs/v14-f2-grant ] && [ ! -d eval/runs/v14-f2-grant-v1 ] && mv eval/runs/v14-f2-grant eval/runs/v14-f2-grant-v1 && echo "corrida fallida v14.1 guardada en eval/runs/v14-f2-grant-v1"
export ENGINE_JUDGE=1 ENGINE_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507
export COMPILER_LLM_URL=http://127.0.0.1:8017/v1 COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 COMPILER_LLM_JSON_MODE=1 COMPILER_LLM_TIMEOUT_MS=240000
export JUDGE_LLM_URL=http://127.0.0.1:8016/v1 JUDGE_LLM_MODEL=openai/gpt-oss-120b JUDGE_LLM_REASONING_EFFORT=medium JUDGE_LLM_JSON_MODE=1 JUDGE_LLM_TIMEOUT_MS=240000
export ENGINE_AGENT=1 ENGINE_AGENT_LLM_URL=http://127.0.0.1:8016/v1 ENGINE_AGENT_LLM_MODEL=openai/gpt-oss-120b ENGINE_AGENT_LLM_REASONING_EFFORT=medium ENGINE_AGENT_LLM_JSON_MODE=1 ENGINE_AGENT_LLM_TIMEOUT_MS=240000
export ENGINE_JUDGE_BLIND=1 ENGINE_AGENT_APOLLO_CREDITS=25 APOLLO_ENABLED=1
for caso in grant investment; do
  out="eval/runs/v14-f2-$caso"
  [ -d "$out" ] && { echo "$out ya existe: no se sobrescribe"; continue; }
  echo "=== $caso ==="
  node --env-file-if-exists=.env scripts/engine-run.mjs --brief eval/briefs/jefe-igc-mint-ad-2026-10-12.json --objectives "$caso" --today 2026-10-12 --no-cache --trace --dry-run --exa-usd-cap 0.50 --out "$out"
  NODE_V8_COVERAGE="$out/coverage" node --env-file-if-exists=.env scripts/engine-run.mjs --brief eval/briefs/jefe-igc-mint-ad-2026-10-12.json --objectives "$caso" --today 2026-10-12 --no-cache --trace --exa-usd-cap 0.50 --out "$out"
done
echo "Listo. Avisa a Claude para revisar eval/runs/v14-f2-grant y v14-f2-investment."
