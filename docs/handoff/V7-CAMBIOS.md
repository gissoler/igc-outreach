# V7 — Cambios respecto a v5 (brazo v7, 2026-10-12)

Base: `docs/benchmark/investors/DIAGNOSTICO-2026-10-12.md` (H1-H15). Pre-registro: `docs/handoff/V7-PREREGISTRO.md`. Ningún archivo congelado se editó: config v5, manifest.v5, normalization.v1, extractor.mjs, judge.mjs, engine.mjs, engine.v2.mjs, normalize.mjs, resolve.mjs, deepening.mjs, prompts, run-experiment.mjs, run-experiment.v6.mjs, external.mjs, gold/ y cases/ están igual. `freeze.mjs --check` con la config v5: 89 de 89 archivos originales idénticos (hay 6 perfiles `-ib` añadidos después en cases/profiles que no estaban en el fingerprint; se listan, no se tocan). Las carpetas de salida v5, v6 y quick no se escribieron: sus cachés se abren en solo lectura.

Declaración (H1): las semillas 101/202/303 no controlan al planner. El proveedor del LLM no aplica la semilla como control (salidas idénticas con semillas distintas y distintas con la misma entrada). En v7 son etiquetas de réplica; la comparación es por distribuciones por caso, no semilla a semilla.

## Archivos nuevos

| Archivo | Qué es |
|---|---|
| `research/bench/investors/config/v7-2026-10-12.json` | Config v7 (schema `investor_run_config/5`, bench_id `investors-internal-2026-10-12-v7`, status frozen) |
| `research/bench/investors/config/v7-initial-batches.json` | Lote inicial fijo (C6): salida completa del planner de v5 B2 s101 por caso, leída de la caché LLM v5 y comprobada contra el evento `planner_end` |
| `prompts/investor/manifest.v7.json` | Copia byte a byte de manifest.v5.json (mismos prompts y sha256) |
| `docs/contracts/investor/investor_run_config.v5.schema.json` | Esquema de config v7 = v3 + claves nuevas |
| `research/bench/investors/extractor.v7.mjs` | Extractor v7 (C2) sobre extractor.mjs |
| `research/bench/investors/engine.v7.mjs` | Copia de engine.v2.mjs con C3 y C5 |
| `research/bench/investors/external.v7.mjs` | Dependencias en vivo de external.mjs con el extractor v7 |
| `research/bench/investors/cache-layers.v7.mjs` | Caché por capas: escribe en la propia, lee cachés anteriores en solo lectura |
| `research/bench/investors/workspace.v7.mjs` | Validación de la config v7 |
| `research/bench/investors/run-experiment.v7.mjs` | Runner v7 (solo B2): motor v7, lote fijo, caché por capas, guardia de Exa, `--stop-file` |
| `research/bench/investors/run-v7.sh` | Corrida con tope de gasto, vigilante cada 20 s, un lote por caso, C4 e informes |
| `research/bench/investors/go-v7.sh` | Un comando: tests, claves, Crawl4AI, LLM, DRY_RUN, commit, lanzamiento |
| `research/bench/investors/analysis/v7/*.mjs` | common, reread (C2), cost_c1 (C1), c3_domains (C3), prefix_c5 (C5), make_initial_batches (C6), reachability y reachability_report (C4), v7_results (informe) |
| `research/tests/agent/investors.v7.test.mjs` | 16 pruebas nuevas |

## Archivos existentes modificados (no congelados)

| Archivo | Línea | Cambio | Motivo |
|---|---|---|---|
| `research/bench/investors/freeze.mjs` | 3-4, 28-44 | `--check` compara con el fingerprint existente sin escribir; con config `investor_run_config/5` añade los archivos v7 | Reproducir el fingerprint v5 sin tocar out/ de v5 y generar el v7 aparte (110 archivos) |
| `research/bench/investors/analysis/exa_spend.mjs` | 5-7, 27-29 | Opción `--usd-per-call` (0.0089) | Medir el tope con el costo real por llamada pagada (7 USD / 789), no con la tarifa nominal (20.89 USD para las mismas llamadas). Sin la opción, igual que antes |

## Cambios de comportamiento frente a v5

| Id | Archivo | Línea | Cambio | Motivo |
|---|---|---|---|---|
| C1 | `config/v7-2026-10-12.json` | 107 | `deepening.max_firms_per_run` 16 → 8 | H11. Se eligió esta opción y no contar la profundización dentro de budgets.searches/fetches: con C5 (14 búsquedas mínimas de 18) dejaría ≤ 4 búsquedas para profundizar y mezclaría C5 con un recorte de la profundización |
| C2 | `extractor.v7.mjs` | 63-80 | Si `groundIdentityV2` deja la cita en null, se busca en la cita del modelo: (1) la cita entera con normalización de espacios (incluido el de antes de un signo), comillas, guiones, mayúsculas, caracteres invisibles y escapes de markdown (`literalSpan`, 40-48); (2) sus tramos separados por "…", fin de oración, encabezados o saltos (`literalSegments`, 51-56). Se acepta solo un tramo con la misma condición de atribución de v5. La cita guardada es el texto copiado de la página, así que es literal para `isLiteralIn` de extractor.mjs y para v5_check | H4 |
| C2 | `extractor.v7.mjs` | 69 | Si v5 ya tenía cita, no se toca: una página que v5 acepta da la misma entidad (prueba V7-4) | No cambiar lo que ya funciona |
| C2 | `external.v7.mjs` | 13-24 | Misma llamada al LLM y misma clave de caché que external.mjs; solo cambia el extractor y se añade `quote_check` al evento | H4 |
| C2/H5 | `run-experiment.v7.mjs` + `cache-layers.v7.mjs` | 49; 1-45 | Caché compartida: lee en solo lectura las cachés de v5-pairs, quick, v5 y v6 (`config.cache_layers`, línea 116) y copia los aciertos a la propia | H5: la misma página con la misma longitud da el mismo resultado; las búsquedas ya pagadas no se repagan |
| C3 | `engine.v7.mjs` | 72-84, 87-92, 141, 262 | Dominio con ≥ 2 fetches fallidos y ningún fetch bueno en la corrida: no se vuelve a pedir en descubrimiento, resolución ni profundización; si el buscador trajo ≥ 400 caracteres de texto, se usa ese texto; el salto no cuenta en `totals.fetches` ni en `fetch_empty` (sí en las cifras propias de la profundización, que es un archivo congelado) | H12 |
| C3 | `config/v7-2026-10-12.json` | 111-114 | `fetch_domain_skip = {enabled: true, after_failures: 2}` | H12 |
| C5 | `engine.v7.mjs` | 208-221 | En B2, stop o paso sin consultas con `totals.searches` < 14: se registra `planner_stop_rejected` y se pide un paso más con `state.stop_not_accepted`; si devuelve consultas, se ejecutan; si no, se para. Cuenta como llamada al planner (tope 8 sin cambios). B1 y B0 no cambian | H3 |
| C5 | `config/v7-2026-10-12.json` | 42 | `b2.min_searches_before_stop = 14` | H3; justificación en el pre-registro |
| C6 | `run-experiment.v7.mjs` | 108 | La llamada `initial_batch` devuelve la salida congelada de v5 B2 s101 del caso (consultas y candidate_firms) sin llamar al LLM; cuenta como llamada al planner con los tokens de la original | H1 |
| C6 | `config/v7-2026-10-12.json` | 43 | `b2.fixed_initial_batch = v7-initial-batches.json` | H1 |
| — | `run-experiment.v7.mjs` | 61-71, 81 | Guardia de Exa en el proceso: error con 401/402/403/429, credits, balance, quota… o 3 errores seguidos de Exa → crea el archivo de parada, corta la corrida en curso (failure.json, sin result.json) y sale con código 3 | Regla 5 del PROMPT-v9 (patrón de exa-guard.sh), sin seguir con serper/tavily |

No se cambió: presupuestos, umbrales, juez, etiquetas, prompts, regla de citas (sigue exigiendo cita literal verificada), triage, resolución, paciencia, `today = 2026-10-09` (se mantiene para que la clave de caché del extractor coincida con v5). B2E y el filtro de embeddings (H10) siguen apagados.

## Resultados sin gasto (0 llamadas a Exa, 0 llamadas al LLM)

### C1 — costo por corrida con datos v5 (`analysis/v7/cost_c1.mjs`)

Llamadas pagadas a Exa por fase en las 36 corridas B2 de pares: principales 224, resolución 76, profundización 279. Si solo se profundizan las 8 primeras firmas (en el orden del motor): profundización 176.

| Conjunto | Corridas | Pagadas por corrida antes (media / mediana) | Después (media / mediana) | USD por corrida antes | Después |
|---|---|---|---|---|---|
| B2, 36 corridas | 36 | 16.08 / 14.5 | 13.22 / 13 | 0.1431 | 0.1177 |
| B2 variante A | 18 | 17.00 / 15 | 13.83 / 13 | 0.1513 | 0.1231 |

Búsquedas de profundización 512 → 339; fetches de profundización 1.487 → 980; 29 de 36 corridas profundizaron más de 8 firmas. El ahorro medido es 18% de las llamadas pagadas, no el 48% estimado en H11: las primeras 8 firmas concentran más llamadas no cacheadas.

### C2 — relectura de las páginas rechazadas por cita (`analysis/v7/reread.mjs`)

Conjunto: 290 pares dominio-corrida (36 corridas B2) cuyo motivo de rechazo más frecuente es `missing_literal_quote`; 311 extracciones. Texto y salida del modelo reconstruidos desde las cachés: 311 de 311. Control: extractor.mjs reproduce `missing_literal_quote` en 311 de 311.

| Resultado con extractor v7 | Cifra |
|---|---|
| Extracciones aceptadas | 67 de 311 |
| Pares dominio-corrida que pasan | 66 de 290 |
| Firmas únicas caso-firma que pasan | 38 (p01 6, p02 6, p03 8, p04 5, p05 6, p06 7) |
| Origen de la cita aceptada | tramo literal de la cita del modelo: 67; cita entera normalizada: 0 |
| Pasan y tienen etiqueta | 2 pares (azora.com, ganancia 0 en ambos) |
| Pasan sin etiqueta | 64 pares |
| Siguen rechazadas | 244 extracciones: `missing_literal_quote` 237, `identity_not_in_quote` 7 |
| Por qué siguen rechazadas | 204 tienen tramos literales pero ninguno muestra a la firma invirtiendo según el patrón de evidencia de inversión de v5; 29 sin tramo literal (paráfrasis o frases unidas); 4 cita entera literal tras normalizar pero sin evidencia de inversión |

- Oro de p04 (golden.ventures, p04 B2 s202): no se recupera. La cita del modelo es "Golden Ventures ... With over 100 investments to date, we are experts at the seed stage."; el tramo literal no cumple el patrón de evidencia de inversión ("investments" no es un verbo de inversión en ese patrón).
- boldtcapital.com (gain 2, 3 corridas): no se recupera. Tramos literales: "We are investors – and we believe capital can be a force for transformation." y "We invest with knowledge, discipline, and purpose – scaling solutions that address the climate crisis head-on."; el patrón exige un objeto (startups, empresas, rondas…) tras el verbo.
- De los 7 pares de los 290 con etiqueta del dominio (4 con ganancia 2, 1 con 1, 2 con 0), v7 recupera solo los 2 de ganancia 0.
- Conclusión: la mayor parte de los 290 no son un problema de normalización de la cita sino del patrón de evidencia de inversión, que no se tocó (regla 3).
- H5: con la caché compartida, la misma clave (prompt + texto + semilla 0) devuelve siempre la primera respuesta guardada (orden: v5-pairs, quick, v5, v6).

### C3 — dominios que fallan (`analysis/v7/c3_domains.mjs`)

Simulación sobre las 36 corridas B2: la regla habría evitado 23 de 2.717 fetches (0.8%); 5 de esos 23 habrían salido bien. Por dominio: idbinvest.org 5, microtechventures.com 6, vef.vc 3; innogy.ventures, superscout.co y assetmanagement.apg.nl 0, porque fallan en muchas corridas pero como mucho 2 veces por corrida. Además, v5 ya salta en los resultados de búsqueda un host con 2 fetches vacíos (`emptyHosts`); C3 añade el salto en resolución y profundización y cuando hay texto del buscador. Una memoria entre corridas evitaría los fallos de innogy.ventures (12 corridas) y superscout.co (10), pero rompería la independencia entre corridas; no se implementó.

### C5 — prefix_curve de v5 (`analysis/v7/prefix_c5.mjs`)

Firmas nuevas por búsqueda (mediana): 0-6: 1.5 (36 corridas); 6-9: 1.0 (24); 9-12: 0.667 (16); 12-14: 1.0 (9); 14-18: 1.25 (3). stop_reason: no_more_actions 31, budget_fetches 3, budget_searches 2.

### C6 — lote inicial fijo (`analysis/v7/make_initial_batches.mjs`)

6 de 6 casos: la respuesta del planner (6 consultas; p03 además 6 candidate_firms) está en la caché LLM v5 (p01 en quick-v5, el resto en v5-pairs) y sus consultas coinciden con el evento `planner_end` de la corrida v5 B2 s101. `--check` vuelve a comprobarlo.

### Ensayo de integración sin red

Motor v7 completo sobre las cachés v5, con fallo de caché = vacío (no es una corrida formal ni cuenta para nada): p01 s101 17 firmas (16 en común con v5 s101), p03 s101 11 (10 en común), p05 s202 14; sin errores de esquema ni de integración.

## C4 — alcanzabilidad del oro

`analysis/v7/reachability.mjs` (18 consultas, 3 por caso, regla fijada en el pre-registro). Se intentó ejecutar desde este entorno el 12/10 a las 17:33: las 18 llamadas fallaron con "fetch failed" (el proxy de este entorno rechaza api.exa.ai; ninguna petición llegó a Exa, gasto 0) y no se guardó resultado. Se ejecuta una vez como primer paso de `run-v7.sh` en el Mac; el resultado queda en `docs/benchmark/investors/ALCANZABILIDAD-ORO.md`.
