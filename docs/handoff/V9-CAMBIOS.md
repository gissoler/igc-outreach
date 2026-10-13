# V9 — Cambios (PROMPT-v11, solución del oro)

Estado: pasos 0 a 3 hechos sin gasto. Resultado: NO-GO para cualquier diseño solo con Exa (techo 2 de 6). El único diseño con techo ≥ 4 (L128, resolución por Serper) tiene techo exacto 4 de 6 con tres capas sin medir; queda un diagnóstico de un comando (US$ 0.107 de Exa) que completa el paso 0 y decide si se implementa. No hay motor v9 ni go-v9.sh: la regla del encargo (techo < 4 → no implementar) aplica hasta que el diagnóstico dé GO condicional. Pre-registro: `docs/handoff/V9-PREREGISTRO.md`. Cifras: `docs/benchmark/investors/V9-TECHOS-SIN-GASTO.md`.

Ningún archivo congelado se editó (config v5, manifest.v5, normalization.v1, extractor.mjs, judge.mjs, engine.mjs, normalize.mjs, resolve.mjs, deepening.mjs, prompts, run-experiment.mjs, run-experiment.v6.mjs, gold/, cases/, archivos .v7 y .v8). Ninguna carpeta de resultados v5–v8 se escribió (solo lectura). El único archivo existente modificado es `freeze.mjs` (rama nueva para la config del diagnóstico v9; las ramas v5, v7 y v8 no cambian).

## Lo que se midió (sin gasto)

| Medida | Cifra |
|---|---|
| Resoluciones en events.jsonl de v8 (18 corridas + intento descartado de p05 s202, que aporta 7) | aceptadas 92, no_domain 109, otros 41 (incluye 1 already_seen) |
| no_domain con el tipo del agregador pegado ("… VC Fund") | 36 de 109 |
| no_domain con el sitio propio o de la matriz en los resultados guardados (revisión manual de hosts) | unas 47 de 109 |
| no_domain que el emparejador v9 resuelve con los resultados guardados | 23 (14 nombres) |
| Intentos de resolver el oro en v8 | 0 |
| Búsquedas por el nombre del oro ya en caché | Magma Partners y World Fund: dominio del oro en el puesto 1 (Exa, consultas de profundización) |
| Oro aceptado en un intento v8 descartado por fallo de infraestructura | p05 s202, worldfund.vc (el reintento válido no lo encontró) |
| Oro nombrado en las páginas de lista abiertas, ≥ 2 de 3 réplicas v8 | 4 de 6 (p01 p02 p03 p06); p04 y p05 en 1 de 3 |
| Oro como candidato crudo del LLM (tope 10) | 3 de 6 (p01 p02 p06) |
| Nombres distintos por réplica con el extractor determinista (forma de firma) | 153 a 563 |
| Puesto del oro por réplica (firm_pages) | p01 19–20, p02 96–101, p03 76–79, p04 70 (1 réplica), p05 558 (1 réplica), p06 27–29 |
| Casos con el oro dentro del cupo K en ≥ 2 de 3 réplicas | K 8: 0, 16: 0, 32: 2, 64: 2, 128: 4, 256: 4 |
| Cupo pagable con Exa (tope 5 USD) | 66 resoluciones por caso → techo 2 de 6 |
| p07–p12 (diag, una lista por caso), oro ≤ K | K 32: 3, 64: 4, 128: 5 |
| Firmas gain ≥ 2 etiquetadas p01–p06 | 37; v7 encuentra 9 y v8 6 (unión de réplicas) |
| Llamadas al LLM para reextraer | 0 (la selección, no la extracción, fija el techo) |
| Gasto Exa del trabajo v9 hasta aquí | 0 |

## Archivos nuevos

| Archivo | Qué es |
|---|---|
| `research/bench/investors/list-names.v9.mjs` | Extractor determinista de nombres de páginas de listas (filas de tabla, encabezados numerados, líneas cortas, listas de inversores, enlaces, nombres con sufijo de firma) y órdenes `pages`, `firm_pages`, `position`. Sin nombres de firma en el código |
| `research/bench/investors/resolve-match.v9.mjs` | Emparejamiento nombre–dominio v9 (etiqueta registrable, acentos, nombres cortos exactos, siglas, sigla entre paréntesis) y `stripTypeTail` |
| `research/bench/investors/resolve.v9.mjs` | Copia de resolve.mjs con el emparejador como parámetro y la consulta sin el tipo pegado. Con los valores por defecto es igual a resolve.mjs (prueba V9-5). Regla de aceptación sin cambios |
| `research/bench/investors/config/v9-diagnostico-2026-10-12.json` | Config frozen del diagnóstico (investor_diag_config/1) |
| `research/bench/investors/analysis/v9/data.v9.mjs` | Lectura de cachés y eventos v8 (listas del diagnóstico y de la corrida) |
| `analysis/v9/ceiling_lists.mjs`, `ceiling_rank.mjs`, `ceiling_replicas.mjs` | Puesto del oro por fuente, orden y réplica; techo por cupo K |
| `analysis/v9/nodomain_dump.mjs`, `nodomain_matcher.mjs` | Las 109 no_domain de v8 y lo que recupera el emparejador v9 |
| `analysis/v9/gain2_coverage.mjs`, `gain2_in_lists.mjs` | Hipótesis (g): firmas gain ≥ 2 por caso, cuántas encuentra el motor y cuántas nombran las listas |
| `analysis/v9/sin_gasto_report.mjs` | Genera `docs/benchmark/investors/V9-TECHOS-SIN-GASTO.md` y `.json` |
| `analysis/v9/diagnostico.v9.mjs`, `diagnostico_report.v9.mjs` | Diagnóstico (fases N, S, L), regla `decide()`, informe `V9-DIAGNOSTICO.md` |
| `research/bench/investors/go-v9-diagnostico.sh` | Un comando: tests v5–v9, huellas, claves sin mostrarlas, Docker/Crawl4AI/LLM, commit de los archivos v9, simulacro, saldo del panel (opcional), diagnóstico con vigilante y tope 0.25 USD, informe y commit |
| `research/tests/agent/investors.v9.test.mjs` | 10 pruebas (V9-1 a V9-10) |
| `docs/handoff/V9-PREREGISTRO.md`, `V9-CAMBIOS.md`; `docs/benchmark/investors/V9-TECHOS-SIN-GASTO.md` y `.json` | Documentación |

Tests: v5 14/14, v6 6/6, v6-r4 3/3, v7 16/16, v8 14/14, v9 10/10. Huellas: v5 89 de 89, v7 110 de 110, v8 111 de 111 idénticas; la v9 se genera aparte en `out/v9-diagnostico-2026-10-12/fingerprint.json`.

Prueba de no-fuga (V9-1): ni el nombre (alias de cases/, nombre del ancla, nombre de consulta) ni el dominio del oro de los 12 casos aparecen en list-names.v9.mjs, resolve-match.v9.mjs, resolve.v9.mjs ni en la config v9. La prueba encontró y obligó a quitar dos comentarios con nombres vistos en páginas del oro. Los nombres del oro solo están en los scripts de medición de `analysis/v9/` (como en v8).

## Lo que no se pudo verificar

- Paso 0 con Exa (12 búsquedas por nombre): Exa solo es alcanzable desde el Mac. Lo mide go-v9-diagnostico.sh.
- Resolución y aceptación en su sitio de los oros de p02, p03, p04 y p06 (p04: su portada se rechazó por falta de cita literal en v5-pairs, con el extractor anterior a v7).
- Si la selección de p07–p12 se mantiene con las páginas que abriría el motor: las páginas de listas cambian con los parámetros de Exa (en p02, p03 y p04 la página con el oro salió solo en las búsquedas del motor, no en las del diagnóstico).
- El extractor determinista se escribió mirando páginas de listas, incluidas las que nombran al oro (estructuras genéricas: tabla con tipo pegado, iniciales de avatar, listas de inversores). p07–p12 sirven de control, con el sesgo declarado.
- Cobro real de Exa: medidor 0.0089 por llamada frente a costDollars; la calibración con el panel queda en el diagnóstico.
- Saldo de Exa (~8 USD): no verificado.

## Siguiente paso

El usuario confirma el saldo en el panel de Exa y lanza `bash research/bench/investors/go-v9-diagnostico.sh` desde el Mac. Con `docs/benchmark/investors/V9-DIAGNOSTICO.md`: si da NO-GO, se cierra con la evidencia y el cambio de benchmark o producto del informe; si da GO condicional, se implementa el brazo v9 del §4 del pre-registro y se pide aprobar el gasto de Serper antes de go-v9.sh.
