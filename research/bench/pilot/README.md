# Real-provider pilot (human-run only)

This pilot is outside the benchmark. Do not run it until H9 authorizes sending the two profiles to the configured search and model providers and authorizes any resulting spend.

1. Set the `ENGINE_LLM_*` variables and the key for the search provider selected during H5. Do not change the provider implicitly.
2. For each case in `cases/`, run B0, B1 and B2 with seed 101 and `config.pilot.json`.
3. Confirm all six runs avoid `fatal_error`, every `steps.jsonl` validates, at least one official entity was found, `fetch_errors / fetches < 0.5`, no log has `QUOTE_NOT_LITERAL` for more than 30% of its citations, the returned model id is the expected one, and nominal latency stays under budget.
4. Manually sample five evidence quotes and verify each quote appears literally on its linked page.
5. Record every problem in the Outreach vault. Prompt corrections require a new prompt version and must happen before H5; never edit `v1`.

Example (repeat for B0, B1 and B2 and for both cases):

```bash
node research/bench/cli.mjs run --config research/bench/pilot/config.pilot.json --case research/bench/pilot/cases/case-pilot-aha.json --condition B0 --seed 101
```
