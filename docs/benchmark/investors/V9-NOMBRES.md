# V9 — Prueba de nombres (candidatos del modelo, sin Exa)

Ejecutada: 2026-10-13T16:03:00.203Z. Prompt candidates/v1, hasta 40 fondos por caso. Regla (V9-PREREGISTRO.md §6): GO si el proveedor elegido nombra el oro en ≥ 4 de 6 casos de p01–p06.

| Proveedor | Modelo | Búsqueda web | Oro nombrado p01–p06 | p07–p12 | Firmas gain ≥ 2 nombradas | Errores | Segundos |
|---|---|---|---|---|---|---|---|
| fleet | openai/gpt-oss-120b | no | 0 | 3 | 6 de 64 | 0 | 0 |
| fleet_lists | openai/gpt-oss-120b | no | 1 | 3 | 8 de 64 | 0 | 1 |

| Caso | fleet: puesto del oro | fleet_lists: puesto del oro | Oro entre los nombres de las listas (puesto) |
|---|---|---|---|
| p01 | — | — | 20 |
| p02 | — | — | 101 |
| p03 | — | — | 77 |
| p04 | — | 9 | 70 |
| p05 | — | — | — |
| p06 | — | — | 27 |
| p07 | 1 | 3 | 35 |
| p08 | 1 | 1 | 4 |
| p09 | — | — | 99 |
| p10 | 9 | 10 | 20 |
| p11 | — | — | 3 |
| p12 | — | — | — |

Elegido: **fleet_lists** (oro en 1 de 6 en p01–p06, 3 de 6 en p07–p12). Resultado: **NO-GO: no se lanza la corrida**.
