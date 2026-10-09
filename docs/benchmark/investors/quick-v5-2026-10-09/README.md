# Prueba rápida v5 — 2026-10-09 (no es la corrida formal)

Config v5 congelada (`investors-internal-2026-10-09-v5`), script `research/bench/investors/run-v5-quick.sh`. Casos p01 (positivo) y n04 (nulo) × B1 y B2 × semilla 101 = 4 corridas, todas válidas, 0 fallidas. Se lanzó mientras las 90 corridas formales estaban en marcha (se cancelaron a petición de la usuaria; solo 2 llegaron a terminar). Muestra mínima: sirve como prueba de humo, no para concluir las metas del benchmark ni para comparar B1 con B2.

| Criterio | Meta | Resultado | Cumple |
|---|---|---|---|
| Citas literales verificadas | 100 % | 100 % (165/165) | sí |
| Firmas con sector, etapa, geografía y tipo ≠ unknown | ≥ 60 % | 62,5 % en B2 (56,8 % B1+B2) | sí en B2 |
| Firmas con ≥ 1 criterio núcleo ≠ unknown | ≥ 85 % | 100 % | sí |
| FETCH_EMPTY (descubrimiento) | ≤ 10 % | 0 % (8,5 % con profundización) | sí |
| Rechazadas / fetches (descubrimiento) | ≤ 0,75 | 0,54 en B2 (0,57 B1+B2) | sí |
| p01: firmas con gain ≥ 2 | ≥ 1 | B1: 5 · B2: 8 | sí (1 semilla; la meta es ≥ 2 de 3) |
| n04: recomendaciones con gain ≥ 2 | 0 | 0 | sí |
| n04: abstención `no_candidates`/`all_hard_not_met` | ≥ 80 % | 0 % (ambas `insufficient_evidence`) | no |

| Corrida | Firmas | gain ≥ 2 | Abstención | Búsquedas / fetches | Tokens descubrimiento + profundización |
|---|---|---|---|---|---|
| p01 / B1 | 11 | 5 | no | 10 / 28 | 97.000 + 70.000 |
| p01 / B2 | 17 | 8 | no | 10 / 27 | 127.000 + 100.000 |
| n04 / B1 | 9 | 0 | `insufficient_evidence` | 6 / 24 | 112.000 + 81.000 |
| n04 / B2 | 7 | 0 | `insufficient_evidence` | 7 / 25 | 110.000 + 44.000 |

No hay etiquetas nuevas: la calidad real de las firmas no está validada. Los `result.json` de las 4 corridas están en `runs/`. Los eventos y la caché completos quedaron en el Mac (`research/bench/investors/out/quick-v5-2026-10-09/`, ignorado por git).
