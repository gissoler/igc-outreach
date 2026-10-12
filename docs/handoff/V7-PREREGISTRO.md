# V7 — Pre-registro (brazo v7, correcciones del diagnóstico 12/10)

Registrado el 2026-10-12 17:40 (America/Bogota), antes de gastar en la corrida formal v7 y antes de la prueba de alcanzabilidad C4. Nada de este documento se ajusta después de ver resultados. Cambios de código: `docs/handoff/V7-CAMBIOS.md`.

## (a) Qué cambia (frente a v5, en una config nueva `config/v7-2026-10-12.json`, bench_id `investors-internal-2026-10-12-v7`)

| Id | Hallazgo | Cambio | Clave de config |
|---|---|---|---|
| C1 | H11 | Profundización limitada a 8 firmas por corrida (antes 16) | `deepening.max_firms_per_run = 8` |
| C2 | H4, H5 | Extractor v7: si v5 se queda sin cita, se usa el tramo literal de la cita del modelo (normalización de espacios, comillas, guiones, mayúsculas, invisibles y escapes de markdown; o un tramo entre "…" / fin de oración). La cita guardada es texto copiado de la página. Caché compartida con las carpetas v5/v6 (solo lectura) | `extractor_impl = v7`, `cache_layers` |
| C3 | H12 | Un dominio con 2 fetches fallidos y ninguno bueno en la corrida no se vuelve a pedir | `fetch_domain_skip = {enabled, after_failures: 2}` |
| C5 | H3 | En B2 no se acepta stop (ni un paso sin consultas) antes de 14 búsquedas (`totals.searches`, misma unidad que `budgets.searches`); se pide un paso más con el aviso en el estado | `b2.min_searches_before_stop = 14` |
| C6 | H1 | Lote inicial fijo: las 6 primeras consultas son las de la corrida v5 B2 s101 del mismo caso (variante A), en las 3 réplicas | `b2.fixed_initial_batch = v7-initial-batches.json` |

No cambia: presupuestos (18 búsquedas, 54 fetches, 8 llamadas al planner, 300.000 tokens), umbrales, juez, etiquetas, prompts (manifest v7 = copia de v5, mismos sha256), `today = 2026-10-09`, Exa (auto, 10 resultados, texto 4000, highlights). B2E y el filtro de embeddings (H10) quedan apagados.

Justificación de 14 (prefix_curve de v5, 36 corridas B2 de pares; `analysis/v7/prefix_c5.mjs`): firmas nuevas por búsqueda (mediana) 1.5 en 0-6, 1.0 en 6-9, 0.667 en 9-12, 1.0 en 12-14 (9 corridas) y 1.25 en 14-18 (3 corridas); 24 corridas llegan a 9 búsquedas, 16 a 12, 9 a 14 y 3 a 18. El rendimiento no cae a 0 antes de 14; 14 deja margen para un paso de 3 consultas más resolución dentro del presupuesto de 18.

## (b) Métricas y regla de decisión (fijadas ahora)

Métricas primarias, por corrida:
- M1 = firmas únicas (stable_id) de la corrida con etiqueta existente (adjudicator v3) de ganancia >= 2 (misma regla de ganancia que el diagnóstico).
- M2 = firmas aceptadas con al menos una cita verificada literal en el texto que vio el extractor (caché de fetch o texto del buscador).

Secundarias, por corrida: búsquedas del descubrimiento (`totals.searches`) y de la profundización, fetches (eventos `fetch_end`), llamadas pagadas a Exa (attempts de Exa con `cached=false`), FETCH_EMPTY (`fetch_end` sin texto o con menos de 200 caracteres), rechazos por cita (`missing_literal_quote` + `identity_not_in_quote`), Jaccard de firmas entre réplicas del mismo caso, stops rechazados (C5) y fetches saltados por dominio (C3).

Comparación: por caso, mediana y rango sobre las 3 réplicas (no pares semilla a semilla: la semilla no controla al planner).

Regla, para M1 y M2 por separado:
- Mejora: la suma de las 6 medianas por caso de v7 es mayor que la de v5 y v7 >= v5 en al menos 4 de 6 casos.
- Empeora: la suma de medianas de v7 es menor que la de v5 y v7 < v5 en al menos 4 de 6 casos.
- Si no: sin cambio.

Condición necesaria para que el resultado sea válido: citas verificadas = 100% en v5_check.mjs sobre la carpeta v7, y 6 casos con 3 réplicas válidas. Veredicto, en este orden: MEJORA si M1 mejora y M2 no empeora; MEJORA SOLO EN M2 si M2 mejora y M1 ni mejora ni empeora; EMPEORA si M1 o M2 empeora y M1 no mejora; SIN CAMBIO en cualquier otro caso (incluido M1 mejora con M2 que empeora). Lo calcula `analysis/v7/v7_results.mjs` y lo escribe en `docs/benchmark/investors/V7-RESULTADOS.md`.

Limitación declarada: M1 solo ve firmas con etiqueta; las firmas nuevas sin etiqueta se cuentan aparte y no suman. En v5 (línea base), 148 de 170 firmas únicas caso-firma no tienen etiqueta.

## (c) Línea base exacta (ya existe; no se repite ni se regenera)

Corridas v5 B2 de p01–p06, variante A, semillas 101/202/303, en `research/bench/investors/out/investors-internal-2026-10-09-v5-pairs/runs/` (18 result.json; p01 s101 es la copia de `quick-v5-2026-10-09`, cuyos eventos están en esa carpeta). Cifras de la línea base (v7_results.mjs sin brazo v7):

| Caso | M1 (mediana, rango) | M2 (mediana, rango) |
|---|---|---|
| p01 | 2 (2-2) | 14 (10-17) |
| p02 | 0 (0-1) | 14 (12-22) |
| p03 | 4 (3-4) | 13 (10-17) |
| p04 | 1 (0-2) | 18 (13-21) |
| p05 | 0 (0-1) | 13 (10-17) |
| p06 | 0 (0-0) | 12 (11-16) |
| Suma de medianas | 7 | 84 |

Media por corrida en la línea base: 11.33 búsquedas de descubrimiento, 14.67 de profundización, 78.5 fetches, 17.0 llamadas pagadas a Exa, 9.28 FETCH_EMPTY, 20.44 rechazos por cita.

## (d) Qué se considera mejora

Lo de la regla (b): MEJORA = M1 mejora con citas al 100%. Que solo crezca M2 (más firmas con cita) se informa como MEJORA SOLO EN M2: más volumen sin evidencia de más firmas buenas según las etiquetas existentes.

## Prueba de alcanzabilidad C4 (regla fijada antes de ejecutarla)

18 consultas (3 por caso, sin nombre de firma; `analysis/v7/reachability.mjs`), solo Exa, 10 resultados. Un caso es P si el dominio del oro aparece en al menos 1 de sus 3 consultas; D si no aparece en ninguna. Global: P con 4 o más casos P (el problema es de las consultas largas del planner); D con 2 o menos (el oro es poco recuperable con búsqueda abierta); mixto con 3.

## Ejecución y costo esperado

- Una sola corrida formal: 6 lotes (uno por caso) × 3 réplicas = 18 corridas B2 v7 en `out/investors-internal-2026-10-12-v7`. Si una corrida falla por infraestructura, se reintenta solo esa; las válidas no se repiten.
- Costo esperado = 18 corridas × 17 llamadas pagadas medias (v5 B2 variante A, medido) × 0.0089 USD = 2.72 USD; más C4 = 18 × 0.0089 = 0.16 USD; total 2.88 USD. Cota alta sin ningún acierto de caché: 18 × 34 × 0.0089 + 0.16 = 5.61 USD. C1 baja la cifra (13.83 llamadas por corrida con datos v5) y C5 la sube; las 6 consultas iniciales y muchas páginas ya están en las cachés v5.
- Tope duro: 9 USD sobre todo el gasto v7 (corridas + C4), medido con `exa_spend.mjs --usd-per-call 0.0089`; entre lotes se para a 8 USD (reserva 1), el vigilante corta a 9 cada 20 s; si el gasto no se puede medir, se para. Error de saldo de Exa (401/402/403/429, credits, balance, quota) o 3 errores seguidos: se para y se descarta la corrida a medias.
