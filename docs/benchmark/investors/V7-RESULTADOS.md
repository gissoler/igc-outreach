# V7 — Resultados (v7 frente a v5)

Generado: 2026-10-12T23:55:42.015Z. Métricas y regla de decisión de docs/handoff/V7-PREREGISTRO.md. Solo cifras.

Línea base: v5 B2 p01–p06 variante A s101/202/303 (investors-internal-2026-10-09-v5-pairs). Brazo v7: bench/investors/out/investors-internal-2026-10-12-v7. Corridas válidas: v5 18, v7 18.

Resultado de la regla: **MEJORA SOLO EN M2 (volumen con cita)**. Citas verificadas v7 (v5_check): 100%.

## Regla de decisión

| Métrica | Suma de medianas v5 | Suma de medianas v7 | Casos v7 ≥ v5 | Casos v7 > v5 | Casos v7 < v5 | Mejora | Empeora |
|---|---|---|---|---|---|---|---|
| M1 firmas únicas con etiqueta gain>=2 | 7 | 7 | 5 | 1 | 1 | no | no |
| M2 firmas aceptadas con cita verificada | 84 | 131 | 6 | 6 | 0 | sí | no |

## Por caso (mediana y rango sobre 3 réplicas)

| Caso | M1 v5 | M1 v7 | M2 v5 | M2 v7 | Firmas v5 | Firmas v7 | Jaccard entre réplicas v5 | v7 |
|---|---|---|---|---|---|---|---|---|
| p01 | 2 (2-2) | 2 (2-2) | 14 (10-17) | 22 (21-24) | 14 (10-17) | 22 (21-24) | 0.292 (0.227-0.333) | 0.654 (0.643-0.667) |
| p02 | 0 (0-1) | 0 (0-0) | 14 (12-22) | 22 (19-22) | 14 (12-22) | 22 (19-22) | 0.259 (0.2-0.3) | 0.577 (0.467-0.708) |
| p03 | 4 (3-4) | 3 (3-3) | 13 (10-17) | 14 (12-15) | 13 (10-17) | 14 (12-15) | 0.227 (0.211-0.579) | 0.706 (0.688-0.733) |
| p04 | 1 (0-2) | 1 (0-2) | 18 (13-21) | 26 (22-27) | 18 (13-21) | 26 (22-27) | 0.107 (0.083-0.619) | 0.441 (0.432-0.548) |
| p05 | 0 (0-1) | 1 (1-2) | 13 (10-17) | 27 (21-28) | 13 (10-17) | 27 (21-28) | 0.154 (0.15-0.588) | 0.531 (0.486-0.548) |
| p06 | 0 (0-0) | 0 (0-0) | 12 (11-16) | 20 (18-20) | 12 (11-16) | 20 (18-20) | 0.227 (0.211-0.647) | 0.583 (0.538-0.652) |

## Secundarias por caso (mediana y rango)

| Caso | Búsquedas desc. v5 | v7 | Búsq. profundización v5 | v7 | Fetches v5 | v7 | Exa pagadas v5 | v7 | FETCH_EMPTY v5 | v7 | Rechazos por cita v5 | v7 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p01 | 10 (8-17) | 17 (16-18) | 11 (7-14) | 8 (8-8) | 61 (48-87) | 74 (73-77) | 9 (7-25) | 8 (8-9) | 10 (5-20) | 8 (6-11) | 13 (8-24) | 12 (10-15) |
| p02 | 9 (9-18) | 18 (18-18) | 18 (14-21) | 10 (10-11) | 80 (72-109) | 78 (76-80) | 27 (12-31) | 11 (10-12) | 15 (6-16) | 7 (6-10) | 19 (15-29) | 20 (19-20) |
| p03 | 12 (7-12) | 15 (15-18) | 16 (12-21) | 10 (10-10) | 74 (61-97) | 65 (63-74) | 16 (14-24) | 4 (4-8) | 4 (3-8) | 6 (4-7) | 19 (13-22) | 10 (7-14) |
| p04 | 16 (10-16) | 16 (16-18) | 18 (13-18) | 9 (9-10) | 111 (70-111) | 79 (79-82) | 23 (11-27) | 10 (8-11) | 7 (6-12) | 3 (2-4) | 24 (13-31) | 11 (11-13) |
| p05 | 7 (7-14) | 16 (14-17) | 15 (9-16) | 10 (9-11) | 63 (56-88) | 80 (64-81) | 22 (0-24) | 8 (3-10) | 10 (4-13) | 11 (11-11) | 22 (20-27) | 18 (14-20) |
| p06 | 11 (8-13) | 16 (15-18) | 14 (11-16) | 8 (8-8) | 80 (54-91) | 74 (72-76) | 12 (8-14) | 10 (8-10) | 9 (4-15) | 7 (5-9) | 24 (16-29) | 16 (15-18) |

## Totales

| Concepto | v5 | v7 |
|---|---|---|
| Corridas | 18 | 18 |
| Firmas únicas caso-firma | 170 | 190 |
| De ellas sin etiqueta | 148 | 173 |
| gain2_labeled (total / media por corrida) | 22 / 1.22 | 22 / 1.22 |
| firms_verified_quote (total / media por corrida) | 260 / 14.44 | 380 / 21.11 |
| firms (total / media por corrida) | 260 / 14.44 | 380 / 21.11 |
| searches_discovery (total / media por corrida) | 204 / 11.33 | 299 / 16.61 |
| searches_deepening (total / media por corrida) | 264 / 14.67 | 167 / 9.28 |
| fetches_events (total / media por corrida) | 1413 / 78.5 | 1347 / 74.83 |
| exa_paid (total / media por corrida) | 306 / 17 | 152 / 8.44 |
| fetch_empty (total / media por corrida) | 167 / 9.28 | 128 / 7.11 |
| rejected_quote (total / media por corrida) | 368 / 20.44 | 263 / 14.61 |
| Exa USD a 0.0089 por llamada pagada | 2.723 | 1.353 |
| stop_reason | {"no_more_actions":16,"budget_searches":1,"budget_fetches":1} | {"no_more_actions":11,"budget_fetches":2,"budget_searches":5} |
| Stops rechazados (C5) | 0 | 17 |
| Fetches saltados por dominio (C3) | 0 | 7 |

Notas: M1 solo cuenta firmas con etiqueta existente (adjudicator v3); las firmas nuevas sin etiqueta no suman a M1 y se cuentan aparte. Las semillas son etiquetas de réplica: el proveedor del LLM no aplica la semilla como control (H1).
