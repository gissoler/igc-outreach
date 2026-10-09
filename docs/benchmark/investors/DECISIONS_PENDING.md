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
