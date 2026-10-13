# V8 — Cambios (PROMPT-v10, alcanzabilidad del oro)

Estado: pasos 1 a 5 hechos. Diagnóstico y corrida formal ejecutados por el usuario; resultado de la regla pre-registrada: SIN CAMBIO (ver abajo y `docs/benchmark/investors/V8-RESULTADOS.md`). Pre-registro: `docs/handoff/V8-PREREGISTRO.md`.

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


## Resultado del diagnóstico (paso 1; detalle en `docs/benchmark/investors/V8-DIAGNOSTICO.md`)

156 unidades pagadas = US$ 1.388 a 0.0089; tarifa nominal US$ 3.24; `costDollars` de Exa, suma, US$ 2.818. Casos con el oro: base 1 de 6 (A) y 2 de 6 (B); b30, b50, a10, a25, e10, e25: 1 de 6 cada una en A (igual que la base); c: 0 de 6; d: 3 de 6 en A y 5 de 6 en B. Elegida y confirmada: solo d (páginas de listas). Por dominio, d alcanza 1 de 6 en A y 1 de 6 en B; el resto de los aciertos de d son el nombre del oro en el texto de la página.

## Pasos 3 y 4 — brazo v8 (variante d)

| Archivo | Qué es |
|---|---|
| `research/bench/investors/list-discovery.v8.mjs` | Plantilla de las 2 consultas de listas (una sola copia; `analysis/v8/queries.v8.mjs` la importa) |
| `research/bench/investors/engine.v8.mjs` | Copia de engine.v7.mjs + fase de listas antes del planner (`b2.list_discovery`); sin esa clave es idéntico a v7 (prueba V8-11) |
| `research/bench/investors/workspace.v8.mjs`, `run-experiment.v8.mjs` | Validación y runner de la config v8 (copias de los v7 con el motor v8) |
| `research/bench/investors/config/v8-2026-10-12.json` | Config v8 (`investor_run_config/6`, bench_id `investors-internal-2026-10-12-v8`, frozen) |
| `docs/contracts/investor/investor_run_config.v6.schema.json` | Esquema v6 = v5 + `b2.list_discovery` (el esquema v5 no se tocó: está en la huella v7) |
| `research/bench/investors/analysis/v8/v8_results.mjs` | Informe v8 frente a v7: O1, O2, M1, M2, secundarias y veredicto |
| `research/bench/investors/run-v8.sh`, `go-v8.sh` | Corrida con tope y vigilante; comando único con tests, huellas v5/v7/v8, claves, Crawl4AI, LLM, simulacro, commit y lanzamiento |

Cambios de comportamiento frente a v7 (todos detrás de `b2.list_discovery.enabled`):

| Id | Cambio | Motivo |
|---|---|---|
| D1 | 2 consultas de listas antes del lote inicial del planner, con la plantilla del diagnóstico | Variante d: 3 de 6 (A) y 5 de 6 (B) frente a 1 y 2 de la base |
| D2 | Esas consultas saltan el triage y abren hasta 6 páginas por puesto, 2 por sitio como máximo | El triage descarta títulos "top … VC" y rutas de lista, y los hosts agregadores; la mayoría de los aciertos del diagnóstico estaban ahí (prueba V8-12 lo detectó) |
| D3 | Los nombres que el extractor saca de esas páginas se resuelven a su sitio oficial con la resolución de siempre; cupo de la fase 8 resoluciones, 10 búsquedas, 20 fetches | Sin cambiar la regla: solo cuenta la firma cuyo sitio oficial pasa el extractor con cita literal |
| D4 | Al terminar la fase, los topes de búsquedas y fetches y `min_searches_before_stop` suben en lo gastado | El planner conserva las 18 búsquedas y 54 fetches de v7 (prueba V8-13) |
| D5 | Capa de lectura de caché añadida: la caché de la corrida v7 | Las páginas y extracciones ya hechas en v7 no se repiten ni se repagan |

No se implementó (no pasó la regla de elección): category "company", 30 y 50 resultados, búsqueda por inversiones (c), consultas largas del brief. Tampoco B2E ni filtros de embeddings.

Huella: `freeze.mjs --config config/v8-2026-10-12.json` genera `out/investors-internal-2026-10-12-v8/fingerprint.json` (111 archivos) aparte. v5: 89 de 89 idénticos; v7: 110 de 110 idénticos.

Tests: v5 14/14, v6 6/6, v6-r4 3/3, v7 16/16, v8 14/14 (V8-9 a V8-14: config, huellas, equivalencia con v7 sin la fase, firma que solo sale de una lista, presupuesto de la fase, consultas iguales a las medidas).

Costo esperado de la corrida formal: US$ 2.96 (18 × 18.5 × 0.0089); cota alta sin caché US$ 7.05; más US$ 1.388 del diagnóstico, total esperado US$ 4.35 y cota alta US$ 8.44, tope 9.

## Lo que no se pudo verificar

- (Resuelto por la corrida) Que el extractor saque al oro como candidato con cita literal y que la resolución encuentre su sitio: no ocurre; ver el resultado.
- El cobro real del diagnóstico: mi medida es US$ 1.388, `costDollars` de Exa suma US$ 2.818. Con la misma tasa de v7 (panel 7 USD frente a 20.89 de tarifa nominal) el cobro real sería menor que ambas, pero no está medido: hay que mirar el saldo en el panel de Exa.
- Que `category: "company"` no cambie el precio: la documentación de Exa no lo indica.

## Resultado de la corrida formal (paso 5)

SIN CAMBIO según la regla pre-registrada. Oro aceptado en 0 de 18 corridas (v7: 1 de 18); dominio del oro en resultados en 0 de 18 (v7: 1 de 18). M1 7 → 6, M2 131 → 137, citas verificadas 100%. Costo medido US$ 3.658 en total (diagnóstico 1.388 + corrida 2.270). La fase de listas aportó 112 firmas aceptadas y ninguna fue el oro. Cifras y lectura: `docs/benchmark/investors/V8-RESULTADOS.md`; embudo: `docs/benchmark/investors/V8-EMBUDO-LISTAS.md` (`analysis/v8/list_funnel.mjs`).

Qué pasó: el diagnóstico midió el nombre del oro en el texto que devuelve Exa; en el motor el nombre pasa por tres filtros que el diagnóstico no medía y el oro no pasa ninguno: (1) el modelo lista como máximo 10 firmas por página y el oro entra en 3 de 6 casos; (2) la verificación de cita de candidatos (cita literal con el nombre completo y un verbo de inversión) lo descarta en esos 3; (3) la resolución solo toma 8 firmas. Los candidatos de la fase están en `extractor.mjs` y su prompt, que están congelados y no se tocaron.

No se hizo: ningún cambio posterior a la corrida (una sola corrida formal), ni se relajó la verificación de candidatos.
