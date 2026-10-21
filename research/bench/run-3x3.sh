#!/usr/bin/env bash
# Six-run execution slice: 3 grant profiles + 3 investor profiles, one B2 run each.
# This is an operational smoke/quality slice, not a replacement for the frozen formal benchmarks.
# Preview (no external calls): bash research/bench/run-3x3.sh
# Run overnight: RUN_LIVE=1 CONCURRENCY=2 bash research/bench/run-3x3.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
STAMP="${RUN_ID:-3x3-$(date +%Y%m%d-%H%M)}"
OUT="$ROOT/research/bench/out/$STAMP"
GRANTS_OUT="$OUT/grants"
INVESTORS_OUT="$OUT/investors"
LOG="$OUT/run.log"
ENVS=(--env-file-if-exists="$ROOT/research/.env" --env-file-if-exists="$ROOT/research/.env.crawl4ai")
GRANT_CASES=(case-pilot-aha case-pilot-mentiva case-pilot-igc-mint-ad)
INVESTOR_CASES="p01,p02,p03"

mkdir -p "$GRANTS_OUT/runs" "$INVESTORS_OUT"
note() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }

if [[ "${RUN_LIVE:-0}" != "1" ]]; then
  note "PREVIEW ONLY: six B2 runs are configured; no network, model, Apollo or paid search calls were made."
  note "Grants: ${GRANT_CASES[*]}"
  note "Investors: p01 p02 p03"
  note "To execute: RUN_LIVE=1 CONCURRENCY=2 bash research/bench/run-3x3.sh"
  exit 0
fi

note "Starting grant slice (B2 · seed 101)."
for case_id in "${GRANT_CASES[@]}"; do
  run_id="pilot__${case_id}__B2__s101"
  run_dir="$GRANTS_OUT/runs/$run_id"
  if [[ -s "$run_dir/result.json" ]]; then note "Grant $case_id already complete; reusing it."; continue; fi
  mkdir -p "$run_dir"
  node "${ENVS[@]}" research/bench/cli.mjs run \
    --config research/bench/pilot/config.pilot.json \
    --case "research/bench/pilot/cases/${case_id}.json" \
    --condition B2 --seed 101 --out "$run_dir" 2>&1 | tee -a "$LOG"
done

note "Starting investor slice (B2 · seed 101 · no Apollo calls in this benchmark condition)."
# Use the self-contained v6 runner. The later v9 protocol depends on historical,
# ignored cache layers that are not portable to a clean checkout.
node "${ENVS[@]}" research/bench/investors/run-experiment.v6.mjs \
  --config research/bench/investors/config/v6-2026-10-09.json \
  --cases research/bench/investors/cases \
  --out "$INVESTORS_OUT" \
  --conditions B2 --seeds 101 --only-cases "$INVESTOR_CASES" \
  --max-runs 3 --concurrency "${CONCURRENCY:-2}" --mode 3x3 2>&1 | tee -a "$LOG"

grant_ok="$(find "$GRANTS_OUT/runs" -name result.json -type f | wc -l | tr -d ' ')"
investor_ok="$(find "$INVESTORS_OUT/runs" -name result.json -type f 2>/dev/null | wc -l | tr -d ' ')"
note "Finished: $grant_ok/3 grant results and $investor_ok/3 investor results. Artifacts: $OUT"
[[ "$grant_ok" == "3" && "$investor_ok" == "3" ]]
