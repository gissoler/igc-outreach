# V14 · F3.0 · Lista para firmar (archivos no alcanzados, 13/10/2026)

Origen: los 72 archivos que `eval/v14/graph.mjs` no alcanza desde ninguna entrada salvo pruebas (`V14-DIAGNOSTICO.md` (a)). Moverlos con `git mv` a `research/_archivo/<misma ruta>` no borra nada; se deshace con `git mv` de vuelta.

Columnas: «En huella» = el nombre aparece en `bench/investors/freeze.mjs` (moverlo hace fallar `freeze.mjs --check` de esa versión). «Lo alcanzan pruebas» = algún `tests/**/*.test.mjs` lo importa directa o indirectamente (moverlo rompe la suite si no se mueve la prueba). «.sh» = scripts de shell que lo nombran.

Propuesta: A = se puede mover sin romper huella, pruebas ni `.sh` (26 archivos, 1.048 líneas). B = no se propone (42). C = sin versionar, ya en `_to_delete/` (4).

Firma: Gisel escribe `si` en la última columna de cada fila que aprueba, y su nombre y fecha al final. Codex mueve solo las filas con `si`. Una fila B con `si` se mueve junto con lo que rompe (prueba o `.sh`) en el mismo commit, y la huella afectada se anota en `V14-CAMBIOS.md`.

| # | Archivo | Líneas | Congelado | En huella de freeze.mjs | Lo alcanzan pruebas | .sh que lo nombran | Versionado | Propuesta | Firma Gisel (si/no) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `agent/profile.mjs` | 242 | no | no | si | 0 | si | B: no mover (rompe pruebas) |  |
| 2 | `bench/investors/analysis/audit_runs.mjs` | 28 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 3 | `bench/investors/analysis/build_pool.mjs` | 16 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 4 | `bench/investors/analysis/exa_spend.mjs` | 31 | no | no | no | 9 | si | B: no mover (rompe .sh) |  |
| 5 | `bench/investors/analysis/expand_labels.mjs` | 32 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 6 | `bench/investors/analysis/llm_vs_design.mjs` | 195 | no | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 7 | `bench/investors/analysis/make_intent_pairs.mjs` | 22 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 8 | `bench/investors/analysis/make_sheets.mjs` | 25 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 9 | `bench/investors/analysis/render_reports.mjs` | 17 | no | no | no | 2 | si | B: no mover (rompe .sh) |  |
| 10 | `bench/investors/analysis/run_metrics.mjs` | 174 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 11 | `bench/investors/analysis/v4_check.mjs` | 68 | no | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 12 | `bench/investors/analysis/v5_check.mjs` | 76 | no | no | no | 4 | si | B: no mover (rompe .sh) |  |
| 13 | `bench/investors/analysis/v6_b2e.mjs` | 27 | no | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 14 | `bench/investors/analysis/v6_formal_metrics.mjs` | 55 | no | no | no | 4 | si | B: no mover (rompe .sh) |  |
| 15 | `bench/investors/analysis/v6_pairs.mjs` | 43 | no | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 16 | `bench/investors/analysis/v7/c3_domains.mjs` | 17 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 17 | `bench/investors/analysis/v7/common.mjs` | 53 | no | no | si | 0 | si | B: no mover (rompe pruebas) |  |
| 18 | `bench/investors/analysis/v7/cost_c1.mjs` | 36 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 19 | `bench/investors/analysis/v7/make_initial_batches.mjs` | 39 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 20 | `bench/investors/analysis/v7/prefix_c5.mjs` | 16 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 21 | `bench/investors/analysis/v7/reachability.mjs` | 43 | no | no | si | 1 | si | B: no mover (rompe pruebas, .sh) |  |
| 22 | `bench/investors/analysis/v7/reachability_report.mjs` | 24 | no | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 23 | `bench/investors/analysis/v7/reread.mjs` | 68 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 24 | `bench/investors/analysis/v7/v7_results.mjs` | 86 | no | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 25 | `bench/investors/analysis/v8/diagnostico.v8.mjs` | 137 | si | no | si | 1 | si | B: no mover (rompe pruebas, .sh) |  |
| 26 | `bench/investors/analysis/v8/diagnostico_report.v8.mjs` | 29 | si | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 27 | `bench/investors/analysis/v8/list_funnel.mjs` | 48 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 28 | `bench/investors/analysis/v8/queries.v8.mjs` | 52 | si | si | si | 0 | si | B: no mover (rompe huella, pruebas) |  |
| 29 | `bench/investors/analysis/v8/v8_results.mjs` | 85 | no | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 30 | `bench/investors/analysis/v9/ceiling_lists.mjs` | 26 | no | si | si | 0 | si | B: no mover (rompe huella, pruebas) |  |
| 31 | `bench/investors/analysis/v9/ceiling_rank.mjs` | 21 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 32 | `bench/investors/analysis/v9/ceiling_replicas.mjs` | 30 | no | si | si | 0 | si | B: no mover (rompe huella, pruebas) |  |
| 33 | `bench/investors/analysis/v9/data.v9.mjs` | 35 | no | si | si | 0 | si | B: no mover (rompe huella, pruebas) |  |
| 34 | `bench/investors/analysis/v9/diagnostico.v9.mjs` | 154 | no | si | si | 1 | si | B: no mover (rompe huella, pruebas, .sh) |  |
| 35 | `bench/investors/analysis/v9/diagnostico_report.v9.mjs` | 32 | no | si | no | 1 | si | B: no mover (rompe huella, .sh) |  |
| 36 | `bench/investors/analysis/v9/gain2_coverage.mjs` | 22 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 37 | `bench/investors/analysis/v9/gain2_in_lists.mjs` | 24 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 38 | `bench/investors/analysis/v9/names_check.mjs` | 91 | no | no | si | 1 | si | B: no mover (rompe pruebas, .sh) |  |
| 39 | `bench/investors/analysis/v9/nodomain_dump.mjs` | 18 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 40 | `bench/investors/analysis/v9/nodomain_matcher.mjs` | 22 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 41 | `bench/investors/analysis/v9/pipeline_v8.mjs` | 27 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 42 | `bench/investors/analysis/v9/sin_gasto_report.mjs` | 88 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 43 | `bench/investors/analysis/v9/v9_results.mjs` | 62 | no | no | no | 1 | si | B: no mover (rompe .sh) |  |
| 44 | `bench/investors/embed-check.mjs` | 12 | no | no | no | 2 | si | B: no mover (rompe .sh) |  |
| 45 | `bench/investors/engine.v7.mjs` | 289 | si | si | si | 1 | si | B: no mover (rompe huella, pruebas, .sh) |  |
| 46 | `bench/investors/engine.v8.mjs` | 323 | si | si | si | 1 | si | B: no mover (rompe huella, pruebas, .sh) |  |
| 47 | `bench/investors/exa-direct.v8.mjs` | 40 | si | si | si | 1 | si | B: no mover (rompe huella, pruebas, .sh) |  |
| 48 | `bench/investors/extractor-quality-check.mjs` | 23 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 49 | `bench/investors/find.mjs` | 79 | no | no | si | 0 | si | B: no mover (rompe pruebas) |  |
| 50 | `bench/investors/freeze.mjs` | 66 | no | no | no | 8 | si | B: no mover (rompe .sh) |  |
| 51 | `bench/investors/import-gold.mjs` | 134 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 52 | `bench/investors/intent-clarify.mjs` | 53 | no | no | si | 1 | si | B: no mover (rompe pruebas, .sh) |  |
| 53 | `bench/investors/out/_to_delete/check_L_offline.mjs` | 14 | no | no | no | 0 | no | C: sin versionar, ya en _to_delete; no se toca |  |
| 54 | `bench/investors/out/_to_delete/chk.tmp.mjs` | 11 | no | no | no | 0 | no | C: sin versionar, ya en _to_delete; no se toca |  |
| 55 | `bench/investors/out/_to_delete/llm_candidates.mjs` | 23 | no | no | no | 0 | no | C: sin versionar, ya en _to_delete; no se toca |  |
| 56 | `bench/investors/out/_to_delete/peek.mjs` | 9 | no | no | no | 0 | no | C: sin versionar, ya en _to_delete; no se toca |  |
| 57 | `bench/investors/preannotate.mjs` | 11 | no | no | si | 0 | si | B: no mover (rompe pruebas) |  |
| 58 | `bench/investors/preflight-chain.mjs` | 43 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 59 | `bench/investors/preflight-reader.mjs` | 34 | no | no | si | 12 | si | B: no mover (rompe pruebas, .sh) |  |
| 60 | `bench/investors/relevance-embeddings.mjs` | 82 | no | no | si | 1 | si | B: no mover (rompe pruebas, .sh) |  |
| 61 | `bench/investors/replay-v3.mjs` | 28 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 62 | `bench/investors/run-experiment.mjs` | 127 | si | no | no | 4 | si | B: no mover (rompe .sh) |  |
| 63 | `bench/investors/run-experiment.v6.mjs` | 147 | si | no | no | 3 | si | B: no mover (rompe .sh) |  |
| 64 | `bench/investors/run-experiment.v7.mjs` | 129 | si | si | no | 2 | si | B: no mover (rompe huella, .sh) |  |
| 65 | `bench/investors/run-experiment.v8.mjs` | 130 | si | si | no | 2 | si | B: no mover (rompe huella, .sh) |  |
| 66 | `bench/investors/workspace.v6.mjs` | 21 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 67 | `bench/investors/workspace.v7.mjs` | 29 | si | si | no | 1 | si | B: no mover (rompe huella, .sh) |  |
| 68 | `bench/investors/workspace.v8.mjs` | 29 | si | si | no | 1 | si | B: no mover (rompe huella, .sh) |  |
| 69 | `capital/evaluation.mjs` | 15 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 70 | `eval/regression/mentiva-grants.mjs` | 235 | no | no | si | 0 | si | B: no mover (rompe pruebas) |  |
| 71 | `eval/regression/mentiva-investment.mjs` | 41 | no | no | no | 0 | si | A: mover a research/_archivo/ |  |
| 72 | `server/research/apify.mjs` | 466 | no | no | si | 0 | si | B: no mover (rompe pruebas) |  |

Firma: ____________________  Fecha: __________
