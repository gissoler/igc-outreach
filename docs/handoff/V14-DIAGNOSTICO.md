# V14 · C1 · Diagnóstico (13/10/2026)

Sin cambios de código. Todo lo de abajo se midió en el Mac (Node v22.23.2) sobre `main` en 3889b4d, salvo lo marcado «no medido».

## 0. Herramientas y reproducción

| Qué | Herramienta | Comando |
|---|---|---|
| Gráfica de importaciones y funciones alcanzables | `research/eval/v14/graph.mjs` (acorn 8 + acorn-walk 8, instalados fuera del repo) | `mkdir -p /tmp/v14 && cd /tmp/v14 && npm i acorn@8 acorn-walk@8 && cp <repo>/research/eval/v14/graph.mjs . && cd <repo>/research && node /tmp/v14/graph.mjs . /tmp/v14/g.json "servidor=server/index.mjs" "engineRun=scripts/engine-run.mjs" "agente=bench/cli.mjs" "benchInv=bench/investors/run-experiment.v9.mjs,bench/investors/cli.mjs" "scripts=<los otros 20 scripts/*.mjs separados por coma>" "tests=<tests/**/*.test.mjs>"` |
| Descartes página por página | `research/eval/v14/drops.mjs` | `node eval/v14/drops.mjs eval/runs/<corrida>/result.json` |
| Plantilla de etiquetado | `research/eval/v14/gold.mjs` | `node eval/v14/gold.mjs . eval/gold-etiquetado-igc.csv` |
| Salidas guardadas | `research/eval/v14/grafica-2026-10-13.json`, `descartes-*.json` | — |

Qué mide `graph.mjs`: importaciones estáticas (`import`, `export … from`, `import()` con literal) desde cada punto de entrada; dentro de cada archivo alcanzable, funciones de nivel superior alcanzables desde las exportaciones usadas y desde el código de nivel superior. Límite: es análisis estático. Una rama detrás de una bandera (`ENGINE_JUDGE`, `ENGINE_RESEARCH_STEPS`, `ENGINE_V2`) cuenta como alcanzable aunque no se ejecute. Qué se ejecutó de verdad en una corrida no está medido; F1 lo mide con `NODE_V8_COVERAGE` (ver plan).

### Líneas (`git ls-files <dir> | grep -E '\.(mjs|js)$' | xargs cat | wc -l`)

| Directorio | Archivos | Líneas | Cifra del prompt |
|---|---|---|---|
| `server/` | 75 | 14.526 | 14.526 en 75 · coincide |
| `server/research/` | 51 | 10.783 | 10.783 · coincide |
| `agent/` | 23 | 3.186 | 2.974 · no coincide; no sé cómo se contó 2.974 |
| `bench/` | 106 versionados (+4 sin versionar en `bench/investors/out/_to_delete/`) | 8.304 versionadas | 8.361 en 110 · no coincide; la diferencia incluye los 4 sin versionar |
| `tests/` | 85 | 9.604 | coincide |
| `scripts/` | 21 | 1.008 | coincide |
| `capital/` | 6 | 457 | no estaba en el prompt |

### Línea base de pruebas (medida hoy)

`node --test tests/*.test.mjs`: 485 · 483 pasan · 1 falla · 1 omitida. `node --test tests/agent/*.test.mjs`: 191 · 190 pasan · 1 falla. Coincide con el prompt.

## (a) Gráfica de llamadas

Puntos de entrada usados y archivos alcanzados:

| Entrada | Archivos alcanzados | Nota |
|---|---|---|
| Servidor HTTP `server/index.mjs` (importa `pipeline.mjs`) | 77 | 72 de `server/` + 5 de `capital/` |
| `scripts/engine-run.mjs` (el que produjo las corridas V13) | 27 | 26 de `server/` (lista en `grafica-2026-10-13.json`, clave `reachBy.engineRun`) |
| Agente del banco `bench/cli.mjs` → `agent/run.mjs` | 48 | usa 16 archivos de `server/` (incluye `verify.mjs`, `dates.mjs`, `applicant.mjs`, `pageType.mjs`, `grantMatch.mjs`) |
| Banco de inversionistas `bench/investors/run-experiment.v9.mjs` y `cli.mjs` | 59 | — |
| Los otros 20 `scripts/*.mjs` | 93 | — |
| `tests/**/*.test.mjs` | 249 | — |

`pipeline.mjs` tiene tres caminos: `runEngine` (si `ENGINE_V2=1` y hay buscador y modelo, líneas 147–172), `orchestrator.mjs` (421 líneas) y `runAgenticLoop` de `loop.mjs` (89 líneas). Cuál corre en producción depende de `research/.env`, que no se lee: no medido.

Archivos de `server/` que ninguna entrada de producto alcanza: `server/research/apify.mjs` (467 líneas, solo pruebas), `server/analysis/backtest.mjs` (100) y `server/analysis/dealIngest.mjs` (99), estos dos usados por scripts. En `agent/`: `agent/profile.mjs` (243, solo pruebas).

Archivos no alcanzados desde ninguna entrada salvo las pruebas: 72.

| Grupo | Archivos | Líneas (`wc -l`) | Criterio |
|---|---|---|---|
| Solo los importan pruebas | 20 | 2.475 | aparecen en `reachBy.tests` |
| Ejecutables sueltos | 38 | 2.338 | tienen `process.argv` o los llama un `.sh` |
| Sin ningún uso encontrado | 14 | 266 | ni pruebas, ni `.sh`, ni `process.argv` |

Los 14 sin uso: `bench/investors/out/_to_delete/{chk.tmp,check_L_offline,llm_candidates,peek}.mjs` (sin versionar), `capital/evaluation.mjs`, `bench/investors/analysis/v7/c3_domains.mjs`, `bench/investors/analysis/v9/{nodomain_dump,ceiling_rank,gain2_coverage,nodomain_matcher,gain2_in_lists,pipeline_v8}.mjs`, `bench/investors/workspace.v6.mjs`, `bench/investors/analysis/make_intent_pairs.mjs`.

Funciones de nivel superior no alcanzables dentro de archivos alcanzables (`server/`, `agent/`, `capital/`): 15 funciones, 58 líneas. `grantSources.mjs` 7 (`median`, `tally`, `foaIdsIn`, `reporterIntel`, `nsfIntel`, `loadPortals`, `resetPortals`; las dos de intel se pasan por parámetro en `grantIntel` y el análisis no sigue ese uso, así que pueden estar vivas), `webscrape.mjs` 4, `discovery.mjs` 2, `firecrawlLedger.mjs` 1, `capital/apollo.mjs` 1. Conclusión medida: el código de `server/` casi todo es alcanzable de forma estática; el volumen está en ramas alternativas y en reglas, no en funciones muertas.

## (b) Quién decide hoy cada criterio

Fuente: lectura del código y conteo en las corridas V13 (`ENGINE_JUDGE=1`). Regex contadas con acorn: `applicant.mjs` 89, `grantMatch.mjs` 67, `dates.mjs` 44, `verify.mjs` 27, `pageType.mjs` 25, `investor.mjs` 21, `engine.mjs` 16, `judge/audit.v13.mjs` 0.

| Criterio | Sin `ENGINE_JUDGE` | Con `ENGINE_JUDGE=1` (V13) | Medido en 23-09-v13-jefe-2 |
|---|---|---|---|
| Host agregador o red social | código: `AGGREGATORS`, `AGGREGATORS_EXTRA`, `DIRECTORY_PATH` (`verify.mjs:32–37`); la página no se lee | igual | 41 trazas (53 en el resumen) descartadas sin leer |
| Tipo de página | código: `classifyPage` (`pageType.mjs`, reglas de URL, texto y título; el tipo del modelo es una señal más) | igual: el juez da `page_type` pero no decide | 29 descartes `not_a_call:*` por código; en 7 el juez decía `call` o `forecast_notice` |
| Fecha de cierre y estado | código: `deadlineDecision` (`dates.mjs`), el modelo se contrasta | juez asigna rol y cita a cada fecha; código valida la cita literal y resta contra hoy (`judge/audit.v13.mjs`) | 12 `closed`, todos por juez + auditor |
| Elegibilidad (quién puede postular) | código `checkApplicant` (`applicant.mjs`) + modelo con cita | juez con cita; un «no» con cita descarta (`NO_TO_DROP`, `audit.v13.mjs:97`) | 21 por juez, 1 por `applicant.mjs` |
| Región | código dentro de `checkApplicant` | juez (`region`) | incluida en los 21 |
| Tipo de entidad | código dentro de `checkApplicant` | juez (`entity_type`) | incluida en los 21 |
| Etapa | código: solo requisitos tardíos (`stage_requirement`) | juez (`stage`) | incluida en los 21 |
| Encaje temático | modelo (`scope_fit`) + regla de vocabulario biomédico (`verify.mjs:200–206`) | juez (`topic_fit`) | 4 por juez |
| Oficial | modelo + tipo de host | igual | 0 descartes |
| No dilutivo | modelo + `DILUTIVE_RX` | igual | 0 descartes |
| Tipo de contraparte (`kind`), dinero, relevancia | modelo lector; el código aplica la lista de tipos del objetivo (`engine.mjs:150–161`) | igual | 5 `wrong_kind`, 1 `wrong_money`, 4 `not_relevant` |
| Decisión final (main/verify/drop) | código, orden fijo en `verify.mjs:218–230` | igual | — |
| Inversionistas: tesis, etapa, geografía, contacto, actividad | código con frases de la página (`investor.mjs`); el «sí» del modelo no se usa | juez con 4 criterios (`region`, `entity_type`, `stage`, `topic_fit`) | no hay corrida V13 de inversionistas: no medido |

## (c) Causas de las 0 verificadas

Cada traza de `result.json` se clasificó con `drops.mjs`. El motor guarda hasta 160 trazas; el resumen (`audits[0].dropped`) cuenta más agregadores que las trazas (53 frente a 41 y 82 frente a 43) porque las trazas de páginas no leídas tienen tope (`ENGINE_TRACE_SKIPPED_MAX`).

| Motivo y quién lo decidió | 22-44-v13-jefe | 23-09-v13-jefe-2 | 19-37-repro-jefe (235B, sin juez) |
|---|---|---|---|
| Segundos | 632 | 539 | 1.727 |
| Páginas en el tope de lectura | 80 | 80 | 80 |
| Leídas con JSON válido | 59 | 77 | 80 |
| Verificadas | 0 | 0 | 12 (0 apply, 12 watch) |
| Agregador sin leer · código, lista de hosts (trazas / resumen) | 43 / 82 | 41 / 53 | 67 / 102 |
| Fuera del tope de páginas · código (trazas / resumen) | 37 / 633 | 39 / 583 | 13 / 644 |
| Red social · código (resumen) | 99 | 83 | 111 |
| Lectura inválida del compilador · página sin decidir | 21 | 3 | 0 |
| Cerrada · juez + auditor | 10 | 12 | 21 (código, `dates.mjs`) |
| No elegible · juez | 13 | 21 | 3 (modelo lector) |
| No elegible · `applicant.mjs` | 1 | 1 | 0 |
| Fuera de tema · juez | 4 | 4 | 2 (modelo lector) |
| No es convocatoria · `pageType.mjs` | 24 | 29 | 24 |
| `wrong_kind`, `wrong_money`, `not_relevant`, `not_official`, `not_a_call` del lector | 7 | 10 | 18 |
| Llamadas compilador / juez | 80 / 80 | 80 / 80 | 0 / 0 |
| JSON inválido compilador / juez | 20 / 0 | 2 / 2 | — |
| ms compilador / juez (suma) | 547.238 / 1.230.384 | 565.180 / 1.188.927 | — |

En 23-09-v13-jefe-2 hubo 20 páginas que el juez dejó en `open`, `upcoming` o `forecast`. Las 20 se descartaron: 10 por elegibilidad, región, entidad o etapa en «no» con cita del juez (8 de ellas en hosts del Reino Unido: ukri.org 6, iuk-business-connect.org.uk 1, nihr.ac.uk 1), 3 por tema (`scope_mismatch`), 6 por `pageType.mjs` o `kind` (directorio o índice), 1 `not_relevant`. Si esos descartes son correctos para IGC (empresa de EE. UU.) no está medido: no hay referencia manual. Por eso la plantilla de etiquetado (C3) va antes de cualquier umbral.

Otras cifras de las dos corridas V13:
- Brief: `product` = «mint ad», `oneLiner` = herramienta de estratificación de riesgo de Alzheimer, `stage` = «marketed», `round` = «seed», `country` vacío, `state` = Maryland. Razonamientos `topic_fit` del juez que mencionan `advertis|marketing|promot`: 28/80 (22-44) y 29/80 (23-09). La cifra 45/80 del prompt usa otro criterio que no conozco.
- El commit 8d56031 (el juez ve `oneLiner`) es de 23:21 UTC. La corrida 23-09 empezó a las 23:09 UTC y terminó a las 23:18 UTC. No hay corrida medida después del cambio; si 23-09 usaba el cambio sin commitear no se puede saber desde `result.json`.
- El investigador (`researcher.mjs`) paró en 23-09 con `no_actions` tras 2 pasos, 0 búsquedas, 0 aperturas; en 22-44 hizo 8 búsquedas y 6 aperturas.

## (d) Expansión

- Por qué no arrancó: las semillas salen solo de páginas que pasaron la verificación (`engine.mjs:336`, `seedPool.push` dentro de `if (v.keep)`). Con 0 verificadas, 0 semillas en las dos corridas V13; en 19-37 hubo 4 semillas.
- Error aparte: `lateral.mjs:21` llama `today.getUTCFullYear()` y `scripts/engine-run.mjs:16` pasa `today` como texto (`'2026-10-12'`). Falla OpenAlex en las tres corridas. `edgarPeers` (`lateral.mjs:37`, `today.getTime()`) fallaría igual en inversionistas: no medido porque no hubo corrida.
- Pistas que hubo y se tiraron (23-09-v13-jefe-2): 16 páginas leídas con `page_type` news o cohort_announcement o con descarte `not_a_call:news|cohort` (p. ej. «FY26 Grant Awardees · Maryland Business Innovation Association», «Meet the 10 startups in Techstars' first DC healthcare accelerator»), y 5 agregadores sin leer con señal de financiación en el título (p. ej. «Constantiam lands $2.5M NIH grant to scale Alzheimer's risk test», dealroom.co, presente en las tres corridas). En 19-37: 15 leídas y 7 agregadores.
- Cuánto aportaría con semillas de pistas: no medido. Tope actual por código: 4 semillas, 6 enlaces por semilla, 12 páginas nuevas por corrida (`expandLimits`). Con esos límites el aporte máximo es 12 páginas; si alguna se verifica depende de la lectura. F1 registra las pistas; F2 mide qué produce cada una.

## (e) Reglas por patrones que corrigieron un caso concreto

Commits que citan el caso en el mensaje (`git log -- dates.mjs pageType.mjs applicant.mjs verify.mjs investor.mjs grantMatch.mjs`; 25 commits distintos sobre esos 6 archivos; se listan los 10 que nombran el caso):

| Commit | Fecha | Regla | Caso | Pruebas que lo citan |
|---|---|---|---|---|
| 2bad1b8 | 06/10 | descarta si la página no menciona enfermedad, fármacos ni trabajo clínico (`verify.mjs:200–206`) | DOE «Genesis Mission: AI for science and energy» | 0 |
| 264926d | 01/10 | el modelo juzga encaje con cita; las reglas de palabras pasan a pistas | CogNeuro | 2 |
| c9aa1e3 | 05/10 | fechas, filtro de ruido, fuentes federales | PA-27-100, RHTP | 3 y 1 |
| 42bd2f9 | 30/09 | el periodo de contrato «from … to …» no es plazo | periodo de proyecto | — |
| f0d982c | 30/09 | «small business concern» para empresa fuera de EE. UU. | SBIR para extranjera | 1 |
| 1747c0f | 30/09 | rúbrica de matching; caso negativo en el gold | NSF 23-525 | 8 |
| 8f9f797 | 05/10 | descarta premios individuales y programas de otro estado | otro estado | 1 |
| 2280bb3 | 05/10 | descarta individual, ayuda exterior, tribal, VA, otro estado | tribal, VA | 3 y 33 (cadena «VA ») |
| c0d4e6b | 05/10 | cierra páginas de reunión, portada e índice | IHS/institucionales | — |
| e388c1e | 05/10 | descarta programas que excluyen ensayos clínicos, listados de ensayos, artículos | ensayos clínicos | — |

Regla que rompió un caso (de V13-AUDITORIA): `TABLE_HEAD_RX` (`dates.mjs` ~248) corrió una columna las etiquetas de fechas en los avisos NIA/NIAGADS; el modelo las tenía bien. NIAGADS aparece en 5 pruebas.

## Resumen en cifras

- En 23-09: de 160 trazas, 80 sin leer por decisión del código (41 lista de hosts, 39 tope), 3 lectura inválida, 77 leídas; de las 77, 37 descartadas por el juez (12 cierre, 21 elegibilidad, 4 tema), 29 por `pageType.mjs`, 11 por campos del lector y reglas de objetivo. 0 verificadas.
- 16 páginas leídas y 5 sin leer eran noticias de financiación o anuncios de cohortes; el código las descarta y la expansión no las usa.
- Ninguna de las dos corridas V13 es posterior al commit que da `oneLiner` al juez.
- No hay corrida de inversionistas con este brief: la línea base de inversionistas la produce F1.
