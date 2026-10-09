# V6 — Pre-registro: pares de intenciones (sección 2.1 / Fase C.1)

Registrado el 2026-10-09 14:34 (America/Bogota), **antes** de correr ninguna variante B. Exploratorio y descriptivo; no hay prueba de hipótesis confirmatoria.

## Qué se compara
- 6 pares sobre p01–p06. Variante A = brief original (corridas formales v5, no se repiten). Variante B = brief reescrito (`research/bench/investors/intent-pairs/briefs-B.json`; casos `cases-pairs/inv-case-syn-pNN-ib`).
- Solo cambian `description` y `product` (texto libre). Sector, subsectores, etapa, mercados, tipos de inversor y el resto de campos estructurados son idénticos; el oro (anchors) es el mismo; `profile_builder_saw_investors: false` (las reescrituras se hicieron sin leer inversionistas ni oro de estos casos).
- Config v5 congelada sin cambios; condiciones B1 y B2; semillas 101/202/303 ⇒ 6 × 2 × 3 = 36 corridas nuevas. Comparación por semilla (A_s frente a B_s).

## Definiciones (para el informe)
- **Semánticamente equivalentes**: mismo significado literal; los mismos hechos de producto, clientes, modelo de ingresos y uso de la ronda; no se añade ni se quita ningún hecho, cifra ni restricción.
- **Pragmáticamente distintos**: distinto énfasis, vocabulario o intención comunicativa; la variante B parte del problema del cliente o del incentivo (p. ej. «brecha de caja», «sin esperar la carga») en lugar de describir el producto, y usa otro vocabulario.
- Limitación: la equivalencia semántica la juzgó quien redactó las variantes (Claude); no hay revisión humana independiente todavía.

## Métricas (sin etiquetas nuevas), por par × condición × semilla
1. Número de firmas aceptadas (entidades deduplicadas del resultado) en A y en B.
2. Jaccard de firmas por `stable_id` entre A_s y B_s.
3. Distribución de tipos de inversor (`investor_type`) de las firmas aceptadas.
4. Proporción de firmas con ganancia ≥ 2 según las etiquetas ya existentes; las firmas sin etiqueta se cuentan y se listan, no se etiquetan.
5. Número de queries y de fetches (`totals.searches`, `totals.fetches`; la ronda de profundización aparte).
Se reporta mediana y rango sobre las 3 semillas, por par y condición.

## Regla de sensibilidad (fijada ahora)
Para cada par × condición se calcula, por semilla, `J_s` = Jaccard(A_s, B_s) y `D_s` = |n_A − n_B| / max(n_A, n_B) con n = firmas aceptadas (D_s = 0 si ambos son 0). **El par es sensible** en esa condición si la mediana de `J_s` < 0,5 **o** la mediana de `D_s` > 0,30. Se reporta además cuántos de los 6 pares son sensibles por condición. No se ajusta el umbral después de ver datos.
