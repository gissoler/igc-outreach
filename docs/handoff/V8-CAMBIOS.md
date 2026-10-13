# V8 — Cambios (PROMPT-v10, alcanzabilidad del oro)

Estado: pasos 1 y 2 listos (diagnóstico preparado y pre-registrado, sin gastar). Pasos 3 a 5 pendientes del resultado del diagnóstico. Pre-registro: `docs/handoff/V8-PREREGISTRO.md`.

Ningún archivo congelado se editó (config v5, manifest.v5, normalization.v1, extractor.mjs, judge.mjs, engine.mjs, normalize.mjs, resolve.mjs, deepening.mjs, prompts v5, run-experiment.mjs, run-experiment.v6.mjs, gold/, cases/, archivos .v7). Las carpetas de resultados v5, v6 y v7 no se escribieron. `freeze.mjs --check` con la config v5: 89 de 89 archivos idénticos.

## Corrección de v7_results.mjs (sin costo)

| Archivo | Cambio | Motivo |
|---|---|---|
| `research/bench/investors/analysis/v7/v7_results.mjs` | `arm()` recibe las carpetas de eventos; el brazo v7 lee `events.jsonl` de su propia carpeta | `loadRuns` buscaba eventos solo en v5, v5-pairs, quick y v6: las secundarias de v7 salían en 0 |

Informe regenerado (solo relectura): `docs/benchmark/investors/V7-RESULTADOS.md` y `V7-RESULTADOS.json` (el json va a docs/ para no escribir en la carpeta v7). Veredicto sin cambio: MEJORA SOLO EN M2 (M1 7 → 7, M2 84 → 131). Cifras v7 corregidas, totales de 18 corridas: fetches 1.347 (media 74.83), Exa pagadas 152 (8.44; 1.353 USD a 0.0089), FETCH_EMPTY 128 (7.11), rechazos por cita 263 (14.61), stops rechazados C5 17, fetches saltados C3 7. events.jsonl tiene 1.399 fetch_end; la diferencia de 52 son del intento fallido de la corrida que se reintentó (run_start 19 para 18 corridas), que el informe excluye porque cuenta solo el último intento.

## Archivos nuevos (pasos 1 y 2)

| Archivo | Qué es |
|---|---|
| `research/bench/investors/exa-direct.v8.mjs` | Llamada directa a Exa /search con `category` y `numResults` hasta 100; caché; unidades de costo = ceil(nominal / 0.027); intentos en el formato de exa_spend.mjs |
| `research/bench/investors/analysis/v8/queries.v8.mjs` | Plantillas de consultas (cortas, largas, empresas, inversores por empresa, listas) desde el perfil; formas del nombre del oro para buscarlo en texto |
| `research/bench/investors/analysis/v8/diagnostico.v8.mjs` | Diagnóstico por variante, fases A y B, regla de elección, tope, guardia de saldo, `--dry-run` |
| `research/bench/investors/analysis/v8/diagnostico_report.v8.mjs` | Informe `docs/benchmark/investors/V8-DIAGNOSTICO.md` |
| `research/bench/investors/go-v8-diagnostico.sh` | Un comando: tests v8, clave (sin mostrarla), medición de gasto, simulacro, diagnóstico con vigilante, informe, commit |
| `research/tests/agent/investors.v8.test.mjs` | 8 pruebas (V8-1 a V8-8) |
| `docs/handoff/V8-PREREGISTRO.md` | Pre-registro |

Tests: v5 14/14, v6 6/6, v6-r4 3/3, v7 16/16, v8 8/8.

Simulacro del diagnóstico (sin red): fase A 108 unidades = 0.961 USD; fase B entre 0.320 y 0.961 USD; máximo 1.922 USD; tope 2 USD.

No se pudo ejecutar desde esta máquina: Exa solo es alcanzable desde el Mac.
