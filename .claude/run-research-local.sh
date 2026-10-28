#!/bin/sh
# Local Outreach research server for UI verification (27-10). Does NOT edit research/.env:
# process variables below take precedence over the file for this process only.
# Uses the existing Mac bridge ports (28016 chat GPT-OSS, 28017 engine Qwen30B) and a separate SQLite DB.
cd "$(dirname "$0")/../research" || exit 1
export RESEARCH_DB="${OUTREACH_LOCAL_DB:-/tmp/outreach-local-verify.sqlite}"
export INTAKE_CONTEXT_V2=1 INTAKE_LLM_ROLE=own
export INTAKE_LLM_BASE_URL=http://127.0.0.1:28016/v1 INTAKE_LLM_MODEL=openai/gpt-oss-120b INTAKE_LLM_REASONING_EFFORT=low
export ENGINE_LLM_URL=http://127.0.0.1:28017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507
export ENGINE_V2=1 ENGINE_AGENT=1 ENGINE_DOSSIER=1 ENGINE_INVESTOR_DOSSIER=1 ENGINE_GPTR=0 ORCHESTRATOR=0 RESEARCH_RUN_TIMEOUT_MS=300000
exec node --env-file-if-exists=.env server/index.mjs
