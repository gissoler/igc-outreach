# TASK-07 · search_agent con B0 y B1, y corrida completa (B1 funcional y con log)

## Objetivo
Correr un caso de punta a punta en B0 y B1 y obtener `steps.jsonl` y `result.json` válidos. Es el primer hito usable.

## Archivos
- Crear `research/agent/search_agent.mjs`, `research/agent/conditions.mjs`, `research/agent/planner.mjs` (en esta tarea solo `initial_batch`) y `research/agent/run.mjs`.
- Crear `research/bench/cli.mjs` con el subcomando `run`.
- Crear `research/tests/agent/e2e.test.mjs` (con ACC-18, ACC-19, ACC-21 para B0/B1 y ACC-22) y añadir ACC-13 (casos de `initial_batch`) a `loop.test.mjs`.

## Contratos que usa
`run_config`, `case`, `profile`, `planner_input`, `planner_output`, `log_entry` y `run_result`.

## Especificación
- **`planner.mjs`:**
  - `buildPlannerInput({mode, state, limits, today, step, budgetLeft, patience, profile, catalog})` → objeto que valida `planner_input`.
    - Los `results_unfetched` (≤ 30, ordenados por búsqueda desc y rank asc) y los `links_unfetched` (≤ 20) envuelven `title`, `snippet` y `anchor_text` en `<page_data>…</page_data>` tras `sanitizePageText`.
    - `profile.known` solo incluye los campos no nulos y `unknown_fields` los nulos.
  - `callPlanner({llm, prompt, input, seed, temperature, maxTokens, meta})`.
  - `validateActions(output, input, mode, limits, {executedQueriesNorm, fetchedNormUrls, refs})` → `{accepted, rejected:[{index, reason}]}`, con los motivos de ARCHITECTURE §5.3.
- **`conditions.mjs`:**
  - `b0Queries(profile, templates, today)` sigue ARCHITECTURE §4 (B0).
  - `conditionOrder(seed)` usa `mulberry32` y Fisher–Yates; se implementa aquí y se usa en TASK-09.
- **`search_agent.mjs`:** `runDiscovery({caseObj, profile, condition, seed, config, deps})`.
  - `deps = {search, fetch, llm, logger, prompts, catalog, domainsCfg, onPlannerInput?}`.
  - Bucle común: búsqueda → descarga por defecto → extracción → registry → señales → paciencia → presupuesto, en el orden y con las comprobaciones de ARCHITECTURE §3, §4 y §7.3.
  - Contadores de presupuesto en valores nominales.
  - Registra los logs `planner_call`, `search`, `fetch` y `extract` con `budget_used`.
  - Devuelve `{registry, stop_reason, totals, prefix_curve}`.
  - **B2 lanza `Error('B2 not implemented')` en esta tarea.**
- **`run.mjs`:** `runCase({caseObj, profile, condition, seed, config, deps, outDir})`.
  - Valida las entradas (en tests, `status: draft` está permitido) y escribe `run_start`.
  - Ejecuta `runDiscovery`, luego `registry.finalize()`, luego el judge (TASK-06), luego `rank`.
  - Escribe un log `judge` por entidad juzgada, después `run_end`, y `result.json` validado. `run_id` = `${bench_id}__${case_id}__${condition}__s${seed}`.
  - Ante una excepción no prevista: `stop_reason = 'fatal_error'`, se escribe `result.json` con lo que haya y se relanza **después** de escribir.
- **`cli.mjs run --config <path> --case <path> --condition B0|B1 --seed <n> [--out <dir>]`:**
  - Sin `--out`, escribe en `research/bench/out/<bench_id>/runs/<run_id>/`.
  - Con la config real usa el transport de `fleet` y el proveedor de `run_config.search.provider`. Exige que las variables de entorno estén configuradas; si falta alguna, sale con código 2 y un mensaje claro.

## Criterios de aceptación
ACC-13 (casos de `initial_batch`), ACC-18, ACC-19, ACC-21 (B0 y B1) y ACC-22.

## No tocar
El pipeline de producción (`server/research/engine.mjs`, `orchestrator.mjs`, `pipeline.mjs`) y la UI.
