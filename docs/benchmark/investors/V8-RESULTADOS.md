# V8 — Resultados (v8 frente a v7)

Generado: 2026-10-13T01:13:53.603Z. Métricas y regla de docs/handoff/V8-PREREGISTRO.md. Solo cifras.

Línea base: v7 B2 p01–p06 variante A s101/202/303 (investors-internal-2026-10-12-v7). Brazo v8: bench/investors/out/investors-internal-2026-10-12-v8. Corridas válidas: v7 18, v8 18. Citas verificadas v8 (v5_check): 100%.

Resultado de la regla: **SIN CAMBIO**.

## Objetivo: el oro

| | v7 | v8 |
|---|---|---|
| Corridas con el dominio del oro en resultados (O1), de 18 | 1 | 0 |
| Corridas con el oro aceptado (O2) | 1 | 0 |
| Casos con O1 en ≥ 2 de 3 réplicas | 0 | 0 |
| Casos con O2 en ≥ 2 de 3 réplicas | 0 | 0 |

| Caso | Oro | O1 v7 | O1 v8 | O2 v7 | O2 v8 |
|---|---|---|---|---|---|
| p01 | magmapartners.com | 0/3 | 0/3 | 0/3 | 0/3 |
| p02 | lightrock.com | 0/3 | 0/3 | 0/3 | 0/3 |
| p03 | celesta.vc | 0/3 | 0/3 | 0/3 | 0/3 |
| p04 | golden.ventures | 0/3 | 0/3 | 0/3 | 0/3 |
| p05 | worldfund.vc | 1/3 | 0/3 | 1/3 | 0/3 |
| p06 | ecapital.vc | 0/3 | 0/3 | 0/3 | 0/3 |

## Regla de decisión M1/M2 (v8 frente a v7)

| Métrica | Suma de medianas v7 | v8 | Casos v8 ≥ v7 | Casos v8 < v7 | Mejora | Empeora |
|---|---|---|---|---|---|---|
| M1 firmas únicas con etiqueta gain>=2 | 7 | 6 | 5 | 1 | no | no |
| M2 firmas aceptadas con cita verificada | 131 | 137 | 3 | 3 | no | no |

## Por caso (mediana y rango sobre 3 réplicas)

| Caso | M1 v7 | M1 v8 | M2 v7 | M2 v8 | Firmas de la fase de listas v8 | Jaccard v7 | v8 |
|---|---|---|---|---|---|---|---|
| p01 | 2 (2-2) | 2 (2-2) | 22 (21-24) | 23 (20-23) | 7 (5-7) | 0.654 (0.643-0.667) | 0.87 (0.87-0.917) |
| p02 | 0 (0-0) | 0 (0-0) | 22 (19-22) | 21 (20-27) | 3 (2-3) | 0.577 (0.467-0.708) | 0.567 (0.548-0.708) |
| p03 | 3 (3-3) | 3 (3-3) | 14 (12-15) | 18 (17-22) | 8 (7-9) | 0.706 (0.688-0.733) | 0.818 (0.773-0.944) |
| p04 | 1 (0-2) | 0 (0-0) | 26 (22-27) | 22 (21-23) | 5 (5-5) | 0.441 (0.432-0.548) | 0.667 (0.593-0.76) |
| p05 | 1 (1-2) | 1 (1-1) | 27 (21-28) | 25 (22-30) | 5 (5-6) | 0.531 (0.486-0.548) | 0.625 (0.571-0.808) |
| p06 | 0 (0-0) | 0 (0-0) | 20 (18-20) | 28 (27-28) | 10 (9-11) | 0.583 (0.538-0.652) | 0.719 (0.647-0.774) |

## Secundarias por caso (mediana y rango)

| Caso | Búsq. desc. v7 | v8 | Fetches v7 | v8 | Exa pagadas v7 | v8 | FETCH_EMPTY v7 | v8 | Rechazos por cita v7 | v8 |
|---|---|---|---|---|---|---|---|---|---|---|
| p01 | 17 (16-18) | 24 (24-25) | 74 (73-77) | 76 (74-78) | 8 (8-9) | 13 (11-14) | 8 (6-11) | 9 (6-11) | 12 (10-15) | 11 (9-15) |
| p02 | 18 (18-18) | 25 (24-28) | 78 (76-80) | 82 (77-90) | 11 (10-12) | 16 (12-17) | 7 (6-10) | 9 (6-10) | 20 (19-20) | 14 (13-17) |
| p03 | 15 (15-18) | 22 (22-26) | 65 (63-74) | 87 (83-97) | 4 (4-8) | 11 (9-14) | 6 (4-7) | 7 (7-9) | 10 (7-14) | 12 (12-15) |
| p04 | 16 (16-18) | 24 (19-25) | 79 (79-82) | 84 (80-88) | 10 (8-11) | 14 (9-16) | 3 (2-4) | 3 (3-6) | 11 (11-13) | 13 (8-16) |
| p05 | 16 (14-17) | 24 (20-25) | 80 (64-81) | 79 (77-86) | 8 (3-10) | 12 (5-19) | 11 (11-11) | 10 (10-18) | 18 (14-20) | 18 (17-20) |
| p06 | 16 (15-18) | 25 (25-25) | 74 (72-76) | 83 (79-86) | 10 (8-10) | 18 (15-19) | 7 (5-9) | 4 (2-7) | 16 (15-18) | 14 (13-17) |
## Totales

| Concepto | v7 | v8 |
|---|---|---|
| Corridas | 18 | 18 |
| Firmas únicas caso-firma | 190 | 180 |
| De ellas sin etiqueta | 173 | 166 |
| gain2_labeled (total / media por corrida) | 22 / 1.22 | 18 / 1 |
| firms_verified_quote (total / media por corrida) | 380 / 21.11 | 417 / 23.17 |
| firms (total / media por corrida) | 380 / 21.11 | 417 / 23.17 |
| O1 (total / media por corrida) | 1 / 0.06 | 0 / 0 |
| O2 (total / media por corrida) | 1 / 0.06 | 0 / 0 |
| searches_discovery (total / media por corrida) | 299 / 16.61 | 432 / 24 |
| searches_deepening (total / media por corrida) | 167 / 9.28 | 180 / 10 |
| fetches_events (total / media por corrida) | 1347 / 74.83 | 1486 / 82.56 |
| exa_paid (total / media por corrida) | 152 / 8.44 | 244 / 13.56 |
| fetch_empty (total / media por corrida) | 128 / 7.11 | 137 / 7.61 |
| rejected_quote (total / media por corrida) | 263 / 14.61 | 254 / 14.11 |
| list_entities (total / media por corrida) | 0 / 0 | 112 / 6.22 |
| list_searches (total / media por corrida) | 0 / 0 | 160 / 8.89 |
| list_fetches (total / media por corrida) | 0 / 0 | 270 / 15 |
| list_resolutions (total / media por corrida) | 0 / 0 | 127 / 7.06 |
| list_candidates (total / media por corrida) | 0 / 0 | 181 / 10.06 |
| Exa USD a 0.0089 por llamada pagada | 1.353 | 2.172 |
| stop_reason | {"no_more_actions":11,"budget_fetches":2,"budget_searches":5} | {"no_more_actions":16,"budget_searches":1,"patience":1} |

Notas: M1 solo cuenta firmas con etiqueta existente (adjudicator v3). Las páginas de lista que abre la fase de listas cuentan como rechazadas (no son firmas). Las semillas son etiquetas de réplica (H1).

## Lectura (añadida a mano tras el informe; embudo en V8-EMBUDO-LISTAS.md, análisis posterior no pre-registrado)

Corrida: 18 de 18 válidas. Una falló por infraestructura (p05 s202, "The model didn't return JSON") y se repitió solo esa, como fija el pre-registro; sus llamadas pagadas cuentan en el gasto. Citas verificadas 100%. Gasto Exa medido con `exa_spend.mjs --usd-per-call 0.0089` sobre las dos carpetas v8: US$ 3.658 (diagnóstico 1.388 + corrida 2.270, esperado 2.96 para la corrida). Tope 9.

Resultado de la regla pre-registrada: SIN CAMBIO. El oro se aceptó en 0 de 18 corridas (v7: 1 de 18) y su dominio apareció en resultados en 0 de 18 (v7: 1 de 18, p05 s303). M1 7 → 6 (p04 1 → 0); M2 131 → 137 (3 casos arriba, 3 abajo). M1 y M2 no empeoran según la regla.

Fase de listas (18 corridas): 160 búsquedas, 270 fetches, 127 resoluciones, 181 candidatos vistos, 112 firmas aceptadas (6.22 por corrida). Costo: búsquedas de descubrimiento 24 por corrida frente a 16.6, Exa pagadas 13.56 frente a 8.44, fetches 82.6 frente a 74.8. Resoluciones de toda la corrida: aceptadas 92, sin dominio 109, otros rechazos 40.

Dónde se pierde el oro (V8-EMBUDO-LISTAS.md, páginas únicas de lista por caso):
- El nombre del oro está en el texto de 1 o 2 de las 10 a 14 páginas de lista abiertas en los 6 casos.
- El modelo lista entre 30 y 60 firmas por caso y solo pasan la verificación de cita (cita literal con el nombre y un verbo de inversión) entre 7 y 22. El oro lo lista el modelo en 3 de 6 casos (p01, p02, p06), en alguna extracción de la caché; en p03, p04 y p05 el modelo no lo lista aunque el nombre esté en la página.
- Ninguno de los 3 pasa la verificación: p01 la cita es literal pero dice "Magma", no "Magma Partners"; p02 y p06 la cita no es literal en la página (p06 empieza por "They").
- El oro nunca llega a la resolución a su sitio oficial (0 intentos en 18 corridas).
- Además, la resolución está limitada a 8 firmas por corrida y a las primeras de la cola.
