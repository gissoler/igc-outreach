# Decisiones humanas pendientes antes de la corrida formal

1. Ventana exacta de “evidencia reciente” para `active` e `INV-RECENCY`.
2. Margen práctico mínimo de B2 sobre B0 y B1 en pooled_recall@20.
3. Umbral alfa de la prueba de signos y política de multiplicidad.
4. No-inferioridad aceptable de nDCG@10.
5. Límite máximo de hard_false_positive_rate.
6. Mínimo de abstenciones correctas en los 2–3 casos nulos y máximo de falsas abstenciones.
7. Presupuestos de búsquedas, fetches, tokens, tiempo y planner calls.
8. Seeds y familias/modelos exactos del agente y preanotador.
9. Buscador, parámetros de SearXNG y política de caché congelados.
10. Estratos y tamaño de la muestra de segundo revisor; κ mínimo aceptable.
11. Taxonomías canónicas de etapa, ronda, región, sector y modelo de negocio.
12. Tratamiento de firmas multi-marca o plataformas con equipos de inversión realmente independientes.

Hasta aprobarlos, la regla de decisión conserva `status: proposed` y ninguna corrida puede presentarse como formal.

## Entrada v4 (2026-10-09) — requiere aprobación antes de la corrida formal (FIX_SPEC §2 FIX-06/07/09)

13. **Regla `plausible` (FIX-07, ajustada en V4-DBG-2 con D3)**, en `judgeInvestorV2`:
    * `irrelevant` si es inelegible o sector `off`;
    * `strong` si actividad `met`, sector `on`, etapa `met`, geografía `met` y `eligible`;
    * `plausible` si (sector ∈ {on, partial} y geografía `met`), o (sector `on`, geografía `unknown` y etapa `met` con evidencia **explícita**: seed / Series X, no solo "early-stage");
    * si no, `weak`.

    El spec permitía "etapa `met` o geografía `met`". En D3 (nulo) eso daba 4 gain 2 con firmas sin mandato geográfico, "early-stage" genérico y sector `partial`. Sustituye a "menos de 5 unknown de 12". `ranking.mjs` no cambia.
14. **Tablas `normalization.v1`** (`docs/contracts/investor/vocab/normalization.v1.json`, FIX-06). Son las del spec, con estas desviaciones explícitas:
    * (a) `seed` y `series a` no casan dentro de `pre-seed` / `pre-series a`;
    * (b) geografía: una cadena se expande por las regiones y países que nombra como palabra completa ("Latin America and the Caribbean" → Latin America);
    * (c) una cadena que no nombra ninguna región ni país conocido es `unknown`, nunca `not_met`;
    * (d) Nauru añadido a Pacific Islands y Oceania;
    * (e) lista de países del mundo y alias (español, abreviaturas), para que un país nombrado se reconozca y dé `not_met` cuando corresponda;
    * (f) "serie"/"semilla"/"etapa temprana" en etapas.
15. **`activity.recency_days = 540`** (FIX-09).
16. **Comparación literal de citas** (FIX-03/04): página y cita se comparan tras NFKC, quitar marcas markdown y unificar comillas y guiones tipográficos. No cambia palabras.
17. **Evidencia de inversión atribuida** (FIX-04): el verbo de inversión debe ir después del nombre de la firma, o la firma debe ser el agente ("led/backed by X"). Es más estricto que el spec; resuelve el caso Acme/Northwind.

## Aprobación de la usuaria (2026-10-09) — entradas 13, 14 y 15

Aprobadas por la usuaria el 2026-10-09, tal como están escritas arriba:

* **#13 — Regla `plausible` (FIX-07):** `irrelevant` si es inelegible o el sector no encaja (`off`); `strong` si actividad `met`, sector `on`, etapa `met`, geografía `met` y `eligible`; `plausible` si (sector ∈ {on, partial} y geografía `met`) o (sector `on`, geografía `unknown` y etapa `met` con evidencia explícita); si no, `weak`. **Aprobada.**
* **#14 — Tablas `normalization.v1`** (`docs/contracts/investor/vocab/normalization.v1.json`), tal como están, con las desviaciones (a)–(f). **Aprobada.**
* **#15 — `activity.recency_days = 540`** (540 días). **Aprobada.**

Las entradas 16 y 17 no formaron parte de esta aprobación explícita; quedan descritas pero sin aprobación registrada.

Versión aprobada: `normalization.v1.json` sha256 `ce332e4073878ada476802ef908252b1c1f879ea3c430aa98a2245a62df58b07`, código en `main@e81d1ad`.

## Entrada v5 (2026-10-09) — requiere aprobación antes de la corrida formal (PROMPT-v5 Cambio 3)

18. **Presupuesto de la ronda de profundización** (`config/v5-2026-10-09.json`, `deepening`). Cambia el presupuesto frente a v3/v4:
    * además de los topes de descubrimiento de v4 (18 búsquedas, 54 fetches, 300k tokens nominales por corrida), cada corrida puede profundizar hasta `max_firms_per_run = 16` firmas (propuesto en V5-DBG-3; era 8 en V5-DBG-1/2, donde el tope solo limitaba en D3 con 14 firmas aceptadas) aceptadas, con `max_queries_per_firm = 2` búsquedas (Exa con `includeDomains` del dominio oficial) y `max_fetches_per_firm = 4` páginas propias (incluido `sitemap.xml` si se pide);
    * tope adicional por corrida: 32 búsquedas y 64 fetches (16 firmas × 2 y × 4); los tokens de la ronda no tienen tope propio y se reportan aparte;
    * búsquedas, fetches, tokens y firmas profundizadas se cuentan aparte en `v2_stats.deepening` (`investor_run_result.v3`); `totals` sigue siendo solo descubrimiento, así que `rejected_non_investors/fetches` conserva su definición;
    * sustituye al enriquecimiento de v4 (`enrichment.enabled = false` en v5).

    **Sin aprobación registrada.** No se presenta como aprobada; las 90 corridas no se lanzan hasta que la usuaria la apruebe.
