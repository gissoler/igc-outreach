# V9 — Prueba de nombres (candidatos del modelo, sin Exa)

Ejecutada: 2026-10-13T18:19:37.603Z. Prompt candidates/v1, hasta 40 fondos por caso. Regla (V9-PREREGISTRO.md §6): GO si el proveedor elegido nombra el oro en ≥ 4 de 6 casos de p01–p06.

| Proveedor | Modelo | Búsqueda web | Oro nombrado p01–p06 | p07–p12 | Firmas gain ≥ 2 nombradas | Errores | Segundos |
|---|---|---|---|---|---|---|---|
| fleet | Qwen/Qwen3-235B-A22B-Instruct-2507-FP8 | no | 2 | 4 | 9 de 64 | 0 | 170 |
| fleet_lists | Qwen/Qwen3-235B-A22B-Instruct-2507-FP8 | no | 5 | 4 | 14 de 64 | 0 | 542 |

| Caso | fleet: puesto del oro | fleet_lists: puesto del oro | Oro entre los nombres de las listas (puesto) |
|---|---|---|---|
| p01 | 30 | 17 | 20 |
| p02 | — | 10 | 101 |
| p03 | — | 6 | 77 |
| p04 | 11 | 1 | 70 |
| p05 | — | — | — |
| p06 | — | 7 | 27 |
| p07 | 2 | 3 | 35 |
| p08 | — | 1 | 4 |
| p09 | 21 | 25 | 99 |
| p10 | 12 | 4 | 20 |
| p11 | — | — | 3 |
| p12 | 19 | — | — |

Elegido: **fleet_lists** (oro en 5 de 6 en p01–p06, 4 de 6 en p07–p12). Resultado: **GO: se lanza la corrida formal v9**.
