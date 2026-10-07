# Handoff para Codex

Lee primero, en este orden: `/AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/contracts/README.md`, `docs/handoff/ACCEPTANCE.md` y luego la tarea que vas a implementar.

## Orden de las tareas
Primero B1 funcional y con log, después el harness y las métricas, y B2 al final.

Cada tarea tiene un único ámbito propietario. Las tareas de agente construyen el motor aislado; las de benchmark consumen sus contratos sin redefinirlo; el piloto es exclusivamente humano.

| Tarea | Ámbito propietario | Resultado | ACC | Depende de |
|---|---|---|---|---|
| TASK-01 | Agente — fundamentos compartidos | contratos, prompts, dependencias y script de test | 01, 01n, 02, 03 | — |
| TASK-02 | Agente | cliente LLM, caché y fixture transport | 04, 05 | 01 |
| TASK-03 | Agente | URLs, identificadores, oficialidad, tools search/fetch y fixtures | 06, 07 | 01 |
| TASK-04 | Agente | extractor, registry y validez | 08, 09, 10 | 02, 03 |
| TASK-05 | Agente | señales, paciencia, gaps y logger | 11, 17 | 04 |
| TASK-06 | Agente | eligibility_judge y ranking | 14, 14p, 15, 16 | 02, 04 |
| TASK-07 | Agente | search_agent con B0 y B1, run.mjs y `cli run` → **B1 funcional y con log** | 13 (initial_batch), 18, 19, 21 (B0/B1), 22 | 05, 06 |
| TASK-08 | Agente | adaptadores de perfil | 23 | 01 |
| TASK-09 | Benchmark | harness: validate, run-all y pool | 30, 31, 32, 40 | 07 |
| TASK-10 | Benchmark | preanotador, muestra ciega e importación de etiquetas | 33 | 09 |
| TASK-11 | Benchmark | métricas, estadística, decisión y reporte | 34–39 | 10 |
| TASK-12 | Agente | **B2 adaptativo** | 12, 13 (resto), 20, 21 (B2) | 07 |
| TASK-13 | Piloto humano | smoke con proveedores reales; Codex solo prepara artefactos y checklist | — | 09–12 |

La hoja generada por TASK-10 usa como contrato manual la plantilla canónica [`docs/benchmark/adjudication-template.csv`](../benchmark/adjudication-template.csv). No contiene condición, seed, rank, juicio del sistema ni preanotación.

Las tareas son pequeñas y cada una tiene su propio PR. Si una tarea revela que un contrato o un prompt es ambiguo o está mal, **no lo cambies**: escribe la duda en la descripción del PR y detente en ese punto.

## Pasos humanos (Codex no los hace)
H1 perfiles a ciegas · H2 anclas, casos nulos y búsqueda manual · H3 aprobar el catálogo y los dominios oficiales · H4 aprobar la regla de decisión, N y los presupuestos · H5 congelar run_config · H9 autorizar proveedores y gasto · H6 adjudicar · H7 segundo revisor · H8 leer fallos. Detalle en `docs/BENCHMARK_PROTOCOL.md` §9.
