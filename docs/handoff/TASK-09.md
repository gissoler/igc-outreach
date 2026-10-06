# TASK-09 · Harness: validate, run-all y pool

## Objetivo
Ejecutar el benchmark completo de forma reproducible y construir el pool por caso.

## Archivos
- Crear `research/bench/runAll.mjs` y `research/bench/pool.mjs`, y ampliar `research/bench/cli.mjs` con `validate`, `run-all` y `pool`.
- Crear `research/bench/cases/README.md`, con el formato de `manifest.json`: `{bench_id, created_at, cases:[{path, sha256, profile_sha256}]}`.
- Crear `research/tests/agent/bench.test.mjs`.

## Contratos que usa
`run_config`, `case`, `profile`, `manual_search` y `run_result`.

## Especificación
- **`validate`:** valida la config y todos los `cases/*.json` (sin entrar en subcarpetas), comprueba que `profile_sha256` coincide con el sha256 de los bytes del archivo de perfil y que el manifest coincide. Código de salida 0 u 1 (ACC-40).
- **`run-all --config`:**
  - Guardas de ACC-31.
  - Para cada caso (orden alfabético) y cada seed (orden de config), ejecuta las condiciones en `conditionOrder(seed)`.
  - Caché única en `out/<bench_id>/cache.sqlite`.
  - Es reanudable: salta las corridas cuyo `result.json` ya existe y valida.
  - Mientras B2 no exista (antes de TASK-12), `--conditions B0,B1` permite correr un subconjunto.
- **`pool --bench`:**
  - Por caso, une el top-20 de cada `result.json`, el ancla y `cases/manual/<case_id>.json`.
  - Fusiona con union-find por `identifierKeys`.
  - Escribe `out/<bench>/pool/<case_id>.json` = `[{item_key, stable_id, names[], urls[], identifiers[], source_doc_ids[], from:{runs:[run_id], anchor:bool, manual:bool}}]`.
  - `item_key = sha256(case_id|stable_id).slice(0,12)`.
  - El campo `from` **solo** lo usa el código; nunca aparece en la hoja ciega.

## Criterios de aceptación
ACC-30, ACC-31, ACC-32 y ACC-40.

## No tocar
`research/bench/config/v0.json`: el estado `frozen` lo pone una persona (H5).
