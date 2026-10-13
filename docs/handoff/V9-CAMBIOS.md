# V9 — Cambios (PROMPT-v11, solución del oro)

Estado: cerrado con NO-GO (diagnóstico ejecutado por el usuario el 2026-10-12, 21:11–21:20; ver al final). Pasos 0 a 3 hechos sin gasto. Resultado: NO-GO para cualquier diseño solo con Exa (techo 2 de 6). El único diseño con techo ≥ 4 (L128, resolución por Serper) tiene techo exacto 4 de 6 con tres capas sin medir; queda un diagnóstico de un comando (US$ 0.107 de Exa) que completa el paso 0 y decide si se implementa. No hay motor v9 ni go-v9.sh: la regla del encargo (techo < 4 → no implementar) aplica hasta que el diagnóstico dé GO condicional. Pre-registro: `docs/handoff/V9-PREREGISTRO.md`. Cifras: `docs/benchmark/investors/V9-TECHOS-SIN-GASTO.md`.

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

## Resultado del diagnóstico (ejecutado por el usuario; `docs/benchmark/investors/V9-DIAGNOSTICO.md`)

NO-GO según la regla pre-registrada. No se implementa motor v9 ni go-v9.sh.

| Capa | p01–p06 | p07–p12 |
|---|---|---|
| Sitio del oro en el puesto 1 de Exa al buscarlo por nombre | 6 | 6 |
| Oro seleccionado con K = 128 | 4 (p01 p02 p03 p06) | 4 (p08 p09 p10 p11) |
| Seleccionado y aceptado, resolución por Exa | 3 | 2 |
| Seleccionado y aceptado, resolución por Serper | 3 (p01 p02 p06) | 3 (p08 p10 p11) |

Costo: 12 unidades Exa = US$ 0.107 al medidor (costDollars 0.084); 12 consultas Serper; 16 llamadas LLM; 78 descargas. Gasto Exa total v9: US$ 0.107 de 5. Panel: 8 → 8 USD (sin decimales: no sirve para calibrar 12 llamadas).

Causa: (ii). Exa encuentra el sitio de los 12 oros por su nombre (puesto 1) y el sitio pasa el extractor en 10 de 12 con alguno de los dos buscadores. Lo que falla es llegar al nombre: por tema Exa no devuelve el sitio (≤ 1 de 6), y en las páginas de listas el oro es 1 nombre entre 150 y 560, citado en 1 o 2 páginas, en los puestos 19 a 101 (p04 70 y p05 558 en una sola réplica).

Cambio necesario (benchmark o producto), con cifras:
1. Más oros por caso: medir el recall sobre las 37 firmas con gain ≥ 2 ya etiquetadas en p01–p06 (hoy 9 en v7, 24%; 6 en v8) en lugar de un solo oro por caso. No requiere etiquetar.
2. Etiquetado: v8 aceptó 166 pares caso–firma sin etiqueta (v7 173). Etiquetarlos (unas 170 adjudicaciones) haría que M1 mida lo que el motor sí encuentra.
3. Otra fuente para el descubrimiento: directorios estructurados que filtren por país, etapa y sector del brief (en p01 el oro es la primera fila de una tabla de agregador filtrada por país y sector). Hay que medir su alcance antes de diseñar: no hay datos v9 de eso.
4. Aceptación: 4 de 12 portadas del oro (p03, p04, p08, p09) no pasan la cita literal con verbo de inversión. Revisar ese patrón es un cambio de la regla de aceptación, fuera de este encargo.

Corrección menor posterior: go-v9-diagnostico.sh usa `--test-reporter=tap` para que la línea de tests muestre los conteos (en el Mac salió vacía; los tests pasaron).

## Brazo v9 de candidatos del modelo (12-10, después del diagnóstico)

Petición del usuario: que la búsqueda quede como si se usara Claude o Gemini. El diagnóstico muestra que con el nombre todo lo demás funciona (sitio en el puesto 1 en 12 de 12, aceptado en 10 de 12). Diseño y regla: V9-PREREGISTRO.md §6.

| Archivo | Qué es |
|---|---|
| `prompts/investor/candidates/v1/{system,user}.md`, `prompts/investor/manifest.v9.json` | Prompt nuevo (manifest.v7 + candidates; ningún prompt existente cambia) |
| `research/bench/investors/name-candidates.v9.mjs` | Proveedores fleet / anthropic / gemini, búsqueda web opcional, normalización y caché |
| `research/bench/investors/engine.v9.mjs` | Copia de engine.v8 + fase de candidatos del modelo; sin la clave es igual a v8 (V9-12) |
| `workspace.v9.mjs`, `run-experiment.v9.mjs`, `config/v9-2026-10-13.json` | Validación, runner y config (proveedor "auto" = el que elige la prueba de nombres) |
| `analysis/v9/names_check.mjs`, `analysis/v9/v9_results.mjs` | Prueba de nombres (sin Exa) e informe de la corrida |
| `run-v9.sh`, `go-v9.sh` | Corrida con tope y un comando que lo hace todo |
| `freeze.mjs` | Rama para configs /6 con b2.model_candidates (añade los módulos v9 y el prompt); v5, v7, v8 y v9-diagnóstico idénticas |

Tests: v5–v9 69/69 (v9: 16). No se gastó nada en este paso. Desde la VM no se puede llamar a ningún modelo ni a Exa: la prueba de nombres corre en el Mac con go-v9.sh.
