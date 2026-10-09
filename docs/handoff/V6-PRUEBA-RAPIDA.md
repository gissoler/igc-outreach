# V6 — Prueba rápida (2026-10-09)

**No es la corrida formal.** 2 casos (p01 positivo, n04 nulo) × B1 y B2 × semilla 101 = 4 corridas, config v5 congelada (`run-v5-quick.sh`). Las 90 corridas formales se lanzaron y se cancelaron por tiempo (2 terminadas, 1 fallida por «The model didn't return JSON»). Resultados completos en `research/bench/investors/out/quick-v5-2026-10-09/` (ignorada por git).

## Resultado en una frase
El sistema encontró inversionistas con citas 100 % literales y recomendó firmas en el caso positivo, pero en el caso nulo se abstuvo por falta de evidencia (`insufficient_evidence`) y no por descarte claro.

## Criterios
| Criterio | Meta | Resultado | ¿Cumple? |
|---|---|---|---|
| Citas literales verificadas | 100 % | 100 % (165/165) | Sí |
| Firmas con sector, etapa, geografía y tipo conocidos | ≥ 60 % | 62,5 % en B2 (56,8 % con B1) | Sí en B2 |
| Firmas con ≥ 1 criterio núcleo conocido | ≥ 85 % | 100 % | Sí |
| FETCH_EMPTY | ≤ 10 % | 0 % (8,5 % contando profundización) | Sí |
| Rechazadas / fetches | ≤ 0,75 | 0,54 en B2 (0,57 con B1) | Sí |
| p01: recomendaciones (gain ≥ 2) | ≥ 1 | B1: 5 · B2: 8 | Sí, sin las 3 semillas |
| n04: recomendaciones falsas | 0 | 0 | Sí |
| n04: abstención por descarte claro | ≥ 80 % | 0 % (ambas `insufficient_evidence`) | No |

## Por corrida (semilla 101)
| Corrida | Firmas | gain ≥ 2 | Abstención | Búsquedas / fetches | Tokens descubrimiento + profundización |
|---|---|---|---|---|---|
| p01 / B1 | 11 | 5 | no | 10 / 28 | 96.997 + 70.153 |
| p01 / B2 | 17 | 8 | no | 10 / 27 | 127.257 + 100.002 |
| n04 / B1 | 9 | 0 | `insufficient_evidence` | 6 / 24 | 112.389 + 80.785 |
| n04 / B2 | 7 | 0 | `insufficient_evidence` | 7 / 25 | 110.208 + 44.035 |

## Qué no se puede afirmar
- Es una prueba de humo: 1 caso positivo, 1 nulo, 1 semilla. No evalúa la meta de ≥ 10/12 positivos ni permite comparar B1 con B2.
- No hay etiquetas nuevas: la calidad real de las firmas no está validada; solo se sabe que las citas son literales y que el juez les dio ganancia 2.
- La abstención por `insufficient_evidence` en n04 es la misma limitación del smoke v5 (etapa y geografía sin publicar); no empeoró ni mejoró.
