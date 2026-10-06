# Handoff para Codex

Lee primero, en este orden: `/AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/contracts/README.md`, `docs/handoff/ACCEPTANCE.md` y luego la tarea que vas a implementar.

## Orden de las tareas
Primero B1 funcional y con log, después el harness y las métricas, y B2 al final.

| Tarea | Resultado | ACC | Depende de |
|---|---|---|---|
| TASK-01 | contratos, prompts, dependencias y script de test | 01, 01n, 02, 03 | — |
| TASK-02 | cliente LLM, caché y fixture transport | 04, 05 | 01 |
| TASK-03 | URLs, identificadores, oficialidad, tools search/fetch y fixtures | 06, 07 | 01 |
| TASK-04 | extractor, registry y validez | 08, 09, 10 | 02, 03 |
| TASK-05 | señales, paciencia, gaps y logger | 11, 17 | 04 |
| TASK-06 | eligibility_judge y ranking | 14, 14p, 15, 16 | 02, 04 |
| TASK-07 | search_agent con B0 y B1, run.mjs y `cli run` → **B1 funcional y con log** | 13 (initial_batch), 18, 19, 21 (B0/B1), 22 | 05, 06 |
| TASK-08 | adaptadores de perfil | 23 | 01 |
| TASK-09 | harness: validate, run-all y pool | 30, 31, 32, 40 | 07 |
| TASK-10 | preanotador, muestra ciega e importación de etiquetas | 33 | 09 |
| TASK-11 | métricas, estadística, decisión y reporte | 34–39 | 10 |
| TASK-12 | **B2 adaptativo** | 12, 13 (resto), 20, 21 (B2) | 07 |
| TASK-13 | smoke y piloto con proveedores reales (lo ejecuta una persona) | — | 09–12 |

Las tareas son pequeñas y cada una tiene su propio PR. Si una tarea revela que un contrato o un prompt es ambiguo o está mal, **no lo cambies**: escribe la duda en la descripción del PR y detente en ese punto.

## Pasos humanos (Codex no los hace)
H1 perfiles a ciegas · H2 anclas, casos nulos y búsqueda manual · H3 aprobar el catálogo y los dominios oficiales · H4 aprobar la regla de decisión, N y los presupuestos · H5 congelar run_config · H9 autorizar proveedores y gasto · H6 adjudicar · H7 segundo revisor · H8 leer fallos. Detalle en `docs/BENCHMARK_PROTOCOL.md` §9.
