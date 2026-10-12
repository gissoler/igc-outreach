# Diagnóstico del benchmark de inversionistas — corrida nocturna 11-12/10/2026

Análisis de solo lectura sobre lo que ya existe. 0 llamadas a Exa, 0 llamadas a LLM, 0 etiquetas nuevas. No se tocó ningún archivo congelado.
Fuentes: `research/bench/investors/out/investors-internal-2026-10-09-v5-pairs` (48 result.json), `.../investors-internal-2026-10-09-v6` (3 result.json), sus `events.jsonl`, `gold/v3/labels/adjudicator.jsonl` (181 etiquetas), `cases/` y `cases-pairs/`.
Eventos: solo el último intento de cada run_id (hay intentos fallidos o abortados en los mismos events.jsonl). 3 de los 48 resultados de pares se reutilizaron del 09/10 (p01 B1/B2 s101 de `quick-v5-2026-10-09`, p02 B1 s101 de `investors-internal-2026-10-09-v5`); sus eventos se leyeron de esas carpetas.
Scripts: `research/bench/investors/analysis/v8_diagnostico/` (python3, solo lectura).

## 0. Contradicciones con las cifras del contexto (primero)

1. "Fallback a serper/tavily en 6 búsquedas": no hubo búsquedas servidas por serper ni tavily. Son 6 intentos (3 serper + 3 tavily) dentro de 3 búsquedas, todos con el mismo error `SEARCH_HTTP: fetch failed`, en el intento fallido de p06-ib B1 s101 a las 08:22:26 UTC. Los 5 errores "fetch failed" de Exa son del mismo intento y del mismo segundo. En los 51 resultados válidos: 0 errores de Exa, 0 resultados de serper/tavily; 2 búsquedas devolvieron 0 resultados (`SEARCH_EMPTY`, p03 B2 s303).
2. El primer intento de B2E p05 (04:11:56 UTC) no tiene run_end; sus eventos (14 `relevance_filter`) siguen en events.jsonl. `b2e.json` usa result.json y no los incluye; este informe tampoco.
3. "Casos con gain>=2 en >=2 de 3 semillas: 6/6" se cumple con la ganancia del sistema. Con las etiquetas existentes: 3/6 en A (p01, p03, p04) y 3/6 en B (p01, p03, p05).
4. Las demás cifras del contexto se reproducen: firmas A 260 / B 257; gain>=2 del sistema A 84 / B 74; corridas con >=1 gain>=2 A 18/18, B 17/18; oro A 0/18, B 2/18; Jaccard mediano entre semillas A 0.227, B 0.217; A frente a B misma semilla 0.195; B2E frente a B2: 26 vs 40 firmas, 2 vs 6 gain>=2 por etiqueta, 59 vs 34 rechazadas; fallos "The model didn't return JSON." (p04-ib B2 s101, 05:15:31) y "fetch failed" (p06-ib B1 s101).

## 1. Resumen (10 líneas)

1. Oro: Exa devolvió el dominio del oro en 3 de 48 corridas de pares (2 aceptadas, 1 perdida en el extractor) y en 2 de 3 B2E. Lightrock, Celesta y eCAPITAL no aparecen en ninguna de 658 búsquedas de sus casos.
2. Ruido: el planner no es reproducible por semilla. Las 6 consultas iniciales coinciden 6/6 o 0/6 entre semillas; con 6/6 el Jaccard de firmas es 0.58-1.00, con 0/6 es 0.08-0.37.
3. De las firmas que una semilla halla y otra no, 88% (A, 122/139) y 84% (B, 150/178) no tienen su dominio en ningún resultado de Exa de la otra semilla: la diferencia nace en las consultas, no en triage, fetch o extractor.
4. Paradas: 31/36 corridas B2 terminan en `no_more_actions`; 21/36 porque el planner devuelve `stop=true` en su 2.ª llamada (9 búsquedas, presupuesto 18) con un rendimiento de 1.5 firmas nuevas por búsqueda en el último tercio.
5. Solo 5/36 corridas paran por presupuesto; tienen 19 firmas de mediana frente a 13 en las demás y su último tercio sigue en 1.5 firmas por búsqueda.
6. Extractor: 691 de 2.553 extracciones B2 (27%) se rechazan por `missing_literal_quote` con kind=institutional_investor; 290 pares dominio-corrida se pierden solo por eso, entre ellos el oro de p04 y una firma etiquetada gain 2 (boldtcapital.com).
7. Precisión: 40 de 260 (A) y 44 de 257 (B) firmas aceptadas tienen etiqueta; gain>=2 en 0.55 y 0.50 de las etiquetadas; 292 pares caso-firma sin etiqueta. Solo 23 (A) y 22 (B) firmas aparecen en las 3 semillas.
8. R1: el Jaccard entre variantes (mediana por par 0.10-0.25) cae dentro del rango entre semillas de la misma variante en los 6 pares. La regla pre-registrada (J<0.5) marca como sensible lo que ya es ruido.
9. R2 (B2E): los cosenos de 20 resultados se concentran en 0.756-0.819 (medianas del último y del primero); entre el puesto 10 y el 11 hay 0.0012. El filtro descartó 3 de las 5 firmas gain>=2 de B2 s101 que Exa sí devolvió (cometa.vc, petram.vc, semiconventures.com).
10. R3/R4: `sparse_after_round_2` nunca fue verdadero; el mínimo de firmas aceptadas al empezar la 3.ª ronda es 8 en 39 corridas, así que un umbral de 3 no puede activarse. Con un oro por caso, 0/18 frente a 2/18 da p=0.49 (Fisher bilateral).

## 2. Respuestas

### Pregunta 1. Cobertura del oro

Embudo por caso (8 corridas de pares por caso: B1 A/B s101 + B2 A/B × 3 semillas; más B2E s101 en p01, p03, p05). "Búsquedas del caso" = todos los `search_end` del caso en las 5 carpetas de salida.

| Caso | Oro | Búsquedas del caso | Corridas con el dominio en resultados de Exa | Abierto (fetch) | Extraído y aceptado | Dónde se pierde |
|---|---|---|---|---|---|---|
| p01 | magmapartners.com | 231 | 1/8 (p01-ib B2 s303) + B2E | 1/8 + B2E | 1/8 + B2E | 7/8 no devuelto. En B2E llegó por resolución: el nombre salió de un perfil en vcmatch.ai y la búsqueda de resolución devolvió el dominio |
| p02 | lightrock.com | 238 | 0/8 | 0 | 0 | No devuelto (0 apariciones del dominio) |
| p03 | celesta.vc | 209 | 0/8 + 0/1 B2E | 0 | 0 | No devuelto. Única mención: f4.fund/firms/celesta-fka-wrvi (p03-ib B2 s303), dominio en la denylist |
| p04 | golden.ventures | 241 | 1/8 (p04 B2 s202, puesto 4 de 10) | 1/8 (5.243 caracteres) | 0/8 | Extractor: `missing_literal_quote` |
| p05 | worldfund.vc | 233 | 1/8 (p05-ib B2 s101, puesto 7) + B2E (puesto 5 de 20, conservado por el filtro) | 1/8 + B2E | 1/8; B2E 0 | B2E: extractor `missing_literal_quote` sobre la misma portada (3.278 caracteres) que en p05-ib B2 s101 se aceptó |
| p06 | ecapital.vc | 211 | 0/8 | 0 | 0 | No devuelto |

Totales: 48 corridas de pares: no devuelto 45, devuelto y aceptado 2, devuelto y perdido en extractor 1. Triage, dedupe y fetch no descartaron el oro en ninguna corrida (0 descartes de triage, 0 fallos de fetch sobre su dominio).

Clasificación:
- T: p04 (1 caso) y p05-B2E: el pipeline lo tuvo y el extractor lo rechazó por la cita literal. En p05 la misma página da aceptado en una carpeta y rechazado en otra (cachés distintas): el extractor no es determinista a temperature=0 en 15 de 1.800 pares URL+longitud vistos en más de una corrida.
- P o D (no se puede separar sin gastar): p02, p03, p06 y 7/8 de p01. Exa no devolvió el dominio con 10 resultados por consulta en 658 búsquedas (p02+p03+p06). Las consultas del planner tienen mediana 28 palabras (14-44), 296 de 379 empiezan por "website/home page/page/about/investment-focus page of…" y ninguna lleva un nombre propio en la ronda inicial.
- D: la evidencia del oro de p04 no es una cita ("Internal-gold adjudication records Golden Ventures as a defensible retrieval anchor."); las de p02 ("The fund will invest in health, education, renewable energy…") y p05 ("energy, buildings, manufacturing, transport, food…") son listas genéricas que no contienen el sector del perfil.

Consultas que habría que probar (no ejecutadas), cortas y en el vocabulario de la propia firma, para separar P de D:

| Caso | Consulta propuesta |
|---|---|
| p01 | Latin America seed venture capital fintech marketplaces |
| p02 | growth equity impact investor Brazil Latin America mobility Series B |
| p03 | deep tech venture capital hardware building blocks compute memory power delivery |
| p04 | Toronto pre-seed seed venture capital Canadian founders |
| p05 | European climate tech venture capital Series B buildings energy |
| p06 | German venture capital cybersecurity defense tech seed |

Costo de la prueba: 6 casos × 3 consultas = 18 llamadas × 0.0089 USD = 0.16 USD (con 25 resultados por consulta: unos 0.32 USD). Si el oro aparece: P/T del planner (consultas largas). Si no aparece: D (oro poco recuperable con búsqueda abierta).

### Pregunta 2. Precisión

| Condición | Variante | Corridas | Aceptadas | Con etiqueta | Sin etiqueta (ocurrencias / únicas) | gain>=2 por etiqueta | Proporción sobre etiquetadas | gain>=2 del sistema | De ellas etiquetadas / con etiqueta>=2 |
|---|---|---|---|---|---|---|---|---|---|
| B1 | A | 6 | 79 | 12 | 67 / 67 | 8 | 0.667 | 31 | 7 / 5 |
| B1 | B | 6 | 69 | 12 | 57 / 57 | 7 | 0.583 | 29 | 5 / 4 |
| B2 | A | 18 | 260 | 40 | 220 / 148 | 22 | 0.550 | 84 | 19 / 14 |
| B2 | B | 18 | 257 | 44 | 213 / 138 | 22 | 0.500 | 74 | 14 / 11 |
| B2E | A | 3 | 26 | 3 | 23 / 23 | 2 | 0.667 | 7 | 2 / 2 |

Pares caso-firma sin etiqueta en todas las condiciones: 292 (q2.py escribe la lista en unlabeled.json). Con 15-17% de firmas etiquetadas, la proporción gain>=2 describe solo a firmas que ya estaban en el pool de etiquetado.

Estabilidad entre semillas (B2):

| Variante | Firmas únicas | En 1 semilla | En 2 | En 3 | Ocurrencias 1/2/3 | Etiquetadas gain>=2 en 1/2/3 semillas |
|---|---|---|---|---|---|---|
| A | 170 | 103 | 44 | 23 | 103 / 88 / 69 (suma 260) | 5 / 1 / 5 |
| B | 162 | 89 | 51 | 22 | 89 / 102 / 66 (suma 257) | 6 / 2 / 4 |

Firmas en 3/3 semillas por caso (A, B): p01 4, 1; p02 5, 2; p03 4, 3; p04 3, 5; p05 3, 6; p06 4, 5.

### Pregunta 3. Ruido entre semillas (N)

Lote inicial del planner (6 consultas, misma entrada en las 3 semillas), por caso y variante. Letras iguales = mismas 6 consultas.

| Caso | A (101/202/303) | B (101/202/303) |
|---|---|---|
| p01 | A B C | A B C |
| p02 | A B C | A B C |
| p03 | A B C | A B B |
| p04 | A B A | A B A |
| p05 | A B B | A B B |
| p06 | A B B | A B B |

- Entre dos semillas el lote inicial comparte 6/6 consultas en 7 de 36 comparaciones y 2/6 en 2; en las 27 restantes, 0/6.
- Con seeds distintas salen consultas idénticas (p04 101 = 303, p05 202 = 303), así que el proveedor no aplica la semilla como control; la caché LLM sí incluye la semilla en la clave. Resultado: cada semilla es un nuevo muestreo del planner, no una réplica controlada.
- Cuando el lote inicial coincide, Exa (caché por consulta) y el extractor (seed 0, caché) repiten: Jaccard de firmas 0.58-1.00 (p05-B y p06-B 202/303: 1.00). Cuando no coincide: 0.08-0.37.

Solape por pares de semillas (mediana de 18 comparaciones por variante):

| Variante | Consultas del planner compartidas (mediana) | Jaccard URLs devueltas | Jaccard dominios devueltos | Jaccard URLs abiertas | Jaccard firmas |
|---|---|---|---|---|---|
| A | 0 | 0.155 | 0.224 | 0.143 | 0.227 |
| B | 0 | 0.145 | 0.238 | 0.133 | 0.217 |

Descomposición de las firmas presentes en una semilla y ausentes en otra: A 139, de ellas 17 con el dominio devuelto por Exa en la otra semilla y 3 abiertas; B 178, 28 devueltas y 15 abiertas. El resto (122 y 150) nunca llegó a los resultados de la otra semilla. Causa principal: planner (consultas distintas). Orden de Exa, límite de fetches y extractor explican como máximo 12-16%.

### Pregunta 4. Paradas

| stop_reason | Corridas B2 | Firmas (mediana, rango) | Búsquedas (mediana, máx.) | Fetches (mediana, máx.) | Llamadas al planner (mediana) |
|---|---|---|---|---|---|
| no_more_actions | 31 | 13 (9-29) | 10 (17) | 27 (51) | 2 |
| budget_fetches | 3 | 19 (18-26) | 17 (18) | 54 (54) | 4 |
| budget_searches | 2 | 19.5 (17-22) | 18 (18) | 48.5 (50) | 3 |

Presupuestos v5: 18 búsquedas, 54 fetches, 8 llamadas al planner, 300.000 tokens. Máximos observados: 18, 54, 4, 233.293.

Secuencias del planner: 21/36 corridas = lote inicial (6) + 1 paso (3) con `stop=true`; 6/36 paran en el 3.er paso; el resto continúa. Las corridas que paran por presupuesto son las que más firmas tienen, no las que menos.

Curvas `prefix_curve` (firmas acumuladas por búsqueda principal): mediana 2.29 firmas nuevas por búsqueda en el primer tercio y 1.50 en el último; 2 de 36 corridas tienen 0 firmas nuevas en el último tercio. En las 5 corridas cortadas por presupuesto, último tercio: 2.0, 1.5, 0.75, 1.5, 0.5 firmas por búsqueda (mediana 1.5).

Conclusión: subir max_searches o max_fetches cambiaría 5/36 corridas (P pequeño: unas +9 búsquedas × 1.2 firmas en esas 5). El límite que actúa en 31/36 es la decisión de parada del planner (T/D; el prompt está congelado). Costo de 1 búsqueda principal adicional con su resolución y profundización: 2.0 llamadas pagadas a Exa (579 pagadas / 288 principales en B2) × 0.0089 = 0.018 USD.

### Pregunta 5. Rechazos y fetch

B2 (36 corridas):

| Concepto | Cifra |
|---|---|
| fetch_end | 2.717 (ok 2.401; desde caché 1.128) |
| Vía | direct 2.268, crawl4ai 447, none 2 |
| FETCH_EMPTY | 314 (11.6%); FETCH_BLOCKED 2 |
| Rescates con contenido de búsqueda (`fetch_fallback` search_contents) | 206 |
| Fetches de profundización (fuera del presupuesto de 54) | 1.487 de 2.717 (54.7%) |
| Búsquedas: principales / resolución / profundización | 288 / 124 / 512 (de 924) |
| Llamadas pagadas a Exa: principales / resolución / profundización | 224 / 76 / 279 (de 579) |
| extract_end | 2.553; aceptadas 1.136 (44.5%) |
| Rechazos por tipo | missing_literal_quote 691, other 482, unresolved_firm_identity 215, identity_not_in_quote 25, llm_invalid_output 3, collection_page 1 |
| kind de los rechazados | institutional_investor 932, other 482 |
| Rechazados por patrón de URL | portafolio 145, noticias/blog 133, PDF 50, otro 1.089 |
| totals.rejected_non_investors | 671 |
| Errores de Exa en resultados válidos | 0 |

- Páginas abiertas que el extractor clasifica como no inversionista (kind=other): 482 de 2.553 extracciones (18.9%).
- Páginas de inversionista rechazadas por grounding (missing_literal_quote + identity_not_in_quote): 716 (28.0%). Pares dominio-corrida con página de inversionista nunca aceptada: 464; por motivo: missing_literal_quote 290, unresolved_firm_identity 156, identity_not_in_quote 16, otros 2. De los 290, 7 tienen etiqueta: 4 con gain 2 (golden.ventures en p04, boldtcapital.com en p02, ambos con varias ocurrencias), 1 con gain 1, 2 con gain 0.
- Dominios que fallan una y otra vez (fallo de fetch en >=3 corridas B2): innogy.ventures 12, superscout.co 10, assetmanagement.apg.nl 6, idbinvest.org 5, edp.com 4, stellantis.ventures 4, privateequitylist.com 4, appliedmaterials.com 4, investors.johnsoncontrols.com 4, johnsoncontrols.com 4, gi-de.com 4, sprung.capital 4 (y 8 más con 3). Por número de fallos: idbinvest.org 15, stellantis.ventures 12, johnsoncontrols.com 12, assetmanagement.apg.nl 12, impactequity.nl 12, innogy.ventures 12, superscout.co 11. T: no hay memoria de fallos entre corridas ni por dominio.
- B1 (12 corridas): FETCH_EMPTY 80 de 757; missing_literal_quote 177 de 703 extracciones. B2E (3): FETCH_EMPTY 39 de 179; missing_literal_quote 30 de 151.

### Pregunta 6. Sensibilidad a la intención (R1)

Jaccard de firmas, B2, mediana (rango). "Dentro" = entre semillas de la misma variante (3 comparaciones); "entre" = A_s frente a B_t para todas las semillas (9 comparaciones).

| Par | J dentro de A | J dentro de B | J entre A y B | n A (101/202/303) | n B | gain>=2 etiqueta A | B | gain>=2 sistema A | B |
|---|---|---|---|---|---|---|---|---|---|
| p01 | 0.29 (0.23-0.33) | 0.15 (0.10-0.37) | 0.23 (0.15-0.35) | 17/14/10 | 13/13/10 | 2/2/2 | 3/2/3 | 8/6/3 | 6/3/7 |
| p02 | 0.26 (0.20-0.30) | 0.24 (0.12-0.37) | 0.16 (0.10-0.24) | 14/22/12 | 17/19/9 | 0/1/0 | 0/0/0 | 3/3/3 | 3/1/2 |
| p03 | 0.23 (0.21-0.58) | 0.17 (0.14-0.80) | 0.18 (0.14-0.26) | 10/13/17 | 9/12/15 | 3/4/4 | 3/3/3 | 2/3/3 | 3/2/2 |
| p04 | 0.11 (0.08-0.62) | 0.24 (0.19-0.58) | 0.10 (0.05-0.16) | 13/18/21 | 26/11/15 | 0/2/1 | 1/0/0 | 2/4/4 | 6/0/3 |
| p05 | 0.15 (0.15-0.59) | 0.19 (0.19-1.00) | 0.22 (0.17-0.24) | 13/17/10 | 29/9/9 | 1/0/0 | 2/1/1 | 2/8/4 | 8/3/3 |
| p06 | 0.23 (0.21-0.65) | 0.22 (0.22-1.00) | 0.25 (0.21-0.35) | 11/12/16 | 15/13/13 | 0/0/0 | 0/0/0 | 10/7/9 | 8/7/7 |

- p04: J entre variantes 0.10 frente a 0.11 dentro de A. La diferencia de n (D mediana 0.39) la produce B s101 (26 firmas, la corrida que agotó fetches). No separable del ruido.
- p05: J entre variantes 0.22, mayor que dentro de A (0.15). La diferencia de n (D 0.47) la produce B s101 (29 firmas, única corrida B2 de p05 con 12 búsquedas). No separable del ruido.
- p02 es el único par con J entre (0.16) menor que ambas medianas dentro (0.26, 0.24), con 3 semillas; insuficiente para afirmarlo.
- investor_type p04: A VC 38, CVC 7, unknown 7; B VC 38, CVC 10, unknown 3, other 1. p05: A VC 19, CVC 10, other 8, unknown 2, family office 1; B VC 23, CVC 9, unknown 8, other 5, family office 2.
- Tipos de consulta del planner (clasificación por palabras clave) p04: A vc 16, otra 8, cvc 5, gobierno 3, impacto 2, aceleradora 1 (35 consultas); B vc 19, cvc 4, gobierno 4, impacto 2, otra 1, aceleradora 1 (31). p05: A vc 12, impacto 6, cvc 4, gobierno 4, otra 3, angel/family 1 (30); B vc 10, impacto 6, gobierno 6, otra 6, cvc 5 (33).
- Conclusión: con el ruido del planner (J ≈ 0.2 entre semillas), no hay pérdida de resultados atribuible a la redacción en ningún par. La regla pre-registrada compara J contra 0.5, cuando el propio sistema da 0.22 consigo mismo (D).

### Pregunta 7. Filtro de embeddings (R2)

Eventos `relevance_filter` del último intento: 69 (p01 19, p03 26, p05 24); 1.160 resultados; conservados 447, descartados por coseno (puestos 11-20) 554, descartados por el LLM dentro del top 10: 159. El evento no registra la razón del LLM por URL (solo índices conservados): la columna "razón" no se puede llenar.

| Grupo | URLs | Coseno mediano | Mín. | Máx. |
|---|---|---|---|---|
| Conservados | 447 | 0.7947 | 0.7519 | 0.8468 |
| Descartados por el LLM | 159 | 0.8067 | 0.7608 | 0.8535 |
| Descartados por coseno | 554 | 0.7721 | 0.7201 | 0.8117 |

Cosenos por consulta (medianas): puesto 1 0.819, puesto 10 0.7864, puesto 11 0.7852, puesto 20 0.7564. El corte top_k=10 separa resultados que difieren en 0.0012. Los descartados por el LLM tienen coseno mediano mayor que los conservados.

Contra etiquetas (por URL): conservados con etiqueta gain 2: 13; descartados por coseno con gain 2: 14; descartados por LLM con gain 2: 1; con gain 0: conservados 7, descartados 15. Por dominio: de 6 dominios etiquetados gain>=2 que aparecen en los resultados B2E, 3 nunca se conservaron (cometa.vc en p01, petram.vc y semiconventures.com en p03); los 3 eran gain>=2 en B2 s101 del mismo caso. Dominios vistos y nunca conservados: p01 44 de 92, p03 93 de 172, p05 64 de 129.

10 descartes:

| Caso | Etapa | Puesto | Coseno | Etiqueta | Firma aceptada en otra corrida del caso | URL |
|---|---|---|---|---|---|---|
| p01 | coseno | 20 | 0.7477 | 2 | sí | https://www.cometa.vc/about |
| p01 | coseno | 13 | 0.7847 | 2 | sí | https://magmapartners.com/press |
| p03 | coseno | 12 | 0.7801 | 2 | sí | https://semiconventures.com/ |
| p05 | coseno | 16 | 0.7728 | sin etiqueta | no | businesswire.com/…/EIP-Closes-over-$1-Billion… |
| p03 | coseno | 12 | 0.7859 | sin etiqueta | no | wpnews.pro/news/jane-street-and-tsmc-s-venture-arm… |
| p01 | LLM | 2 | 0.8242 | 2 | sí | https://magmapartners.com/work-with-us |
| p05 | LLM | 1 | 0.8413 | sin etiqueta | no | https://linkedin.com/company/enternow |
| p01 | LLM | 9 | 0.8121 | sin etiqueta | sí | dff.ventures/our-companies/companies/kennek |
| p05 | LLM | 2 | 0.8227 | sin etiqueta | sí | vestas.com/…/sustainability/reports-and-ratings |
| p05 | LLM | 2 | 0.8143 | sin etiqueta | sí | kfw-capital.de/…/KfW-Capital-ESG-Policy-202603_EN.pdf |

10 conservados:

| Caso | Puesto | Coseno | Etiqueta | Firma aceptada en otra corrida del caso | URL |
|---|---|---|---|---|---|
| p01 | 2 | 0.8297 | 2 | sí | finnovista.com/en/what-we-do/finnovista-vc-venture-capital/ |
| p05 | 5 | 0.8020 | 2 | sí | https://www.worldfund.vc/ |
| p01 | 10 | 0.7878 | 2 | sí | https://magmapartners.com/ |
| p03 | 10 | 0.7653 | sin etiqueta | no | https://aiwiki.ai/wiki/lux_capital |
| p05 | 6 | 0.7995 | sin etiqueta | no | eu-startups.com/2024/03/amsterdam-based-carbon-equity… |
| p01 | 3 | 0.8105 | sin etiqueta | no | https://linkedin.com/company/cathay-latam |
| p03 | 2 | 0.7904 | sin etiqueta | sí | itic.com.tw/portfolio-posts/rachel-lee/ |
| p03 | 8 | 0.7885 | sin etiqueta | sí | https://yanvc.com/ |
| p01 | 8 | 0.7927 | sin etiqueta | no | bakingbusiness.com/articles/58905-bimbo-ventures-invests… |
| p05 | 7 | 0.8005 | sin etiqueta | no | openvc.app/fund/EIT InnoEnergy |

B2 frente a B2E (p01, p03, p05, s101): búsquedas 29 vs 35, fetches 80 vs 91, rechazadas 34 vs 59, aceptadas 40 vs 26, etiquetadas 7 vs 3, gain>=2 por etiqueta 6 vs 2 (p01 2 vs 2, p03 3 vs 0, p05 1 vs 0). Costos aparte del filtro: 69 llamadas LLM, 94.964 tokens, 177.8 s de LLM, 14.2 s de embeddings.

top_k y resultados por consulta:
- Con cosenos tan juntos, subir top_k de 10 a 15 o 20 equivale casi a no filtrar por coseno; el filtro útil sería el LLM (o un umbral absoluto, no un rango).
- Precio: 0.0089 USD por llamada medido sobre 789 llamadas pagadas de la noche (68 de ellas con 20 resultados). Con la tarifa de exa_spend.mjs escalada al cobro real (7/20.89 = 0.335), una consulta de 20 resultados cuesta unos 0.019 USD y una de 10 unos 0.009. B2E usó 18 llamadas pagadas por corrida: unos 0.33 USD por corrida si todas fueran de 20 resultados.
- Muestra mínima: diferencia por caso observada −1.33 gain>=2 (DE 1.53 entre 3 casos); DE entre semillas de gain>=2 por etiqueta en B2: 0.5 por corrida. Prueba pareada (α 0.05, potencia 0.8): 11 pares caso-semilla para una diferencia de 1.33, 19 para 1.0, 74 para 0.5. Ya existen 18 corridas B2 A (6 casos × 3 semillas): faltan 15 corridas B2E. Requiere además etiquetar las firmas nuevas (23 de 26 B2E están sin etiqueta).

### Pregunta 8. R3 y R4

- `sparse_after_round_2` = false en las 3 corridas B2E; firmas aceptadas al empezar la 3.ª llamada del planner: 9, 8, 9.
- Equivalente en las 36 corridas B2 (firmas acumuladas a las 9 búsquedas principales; total final si no hubo 3.ª llamada): mínimo 8, mediana 12, máximo 17.
- Umbral (`intent-clarify.mjs`, threshold=3, apagado): se activaría en 0 de 39 corridas con <3, <5 u <8; en 10 de 39 con <10; en 17 de 39 con <12. Con <10 se activa en p04-ib B2 s101, que terminó con 26 firmas.
- Conclusión (D): el número de firmas aceptadas tras 2 rondas no distingue búsquedas pobres. Una señal basada en gain>=2 del sistema o en firmas nuevas por búsqueda requiere rediseño; no se probó.

### Pregunta 9. Calidad del benchmark (D)

Etiquetas existentes y cobertura sobre ellas (número de firmas etiquetadas gain>=2 halladas por corrida):

| Caso | Etiquetas | gain>=2 | Oro etiquetado | B1 A | B1 B | B2 A (101/202/303) | B2 B | B2E |
|---|---|---|---|---|---|---|---|---|
| p01 | 17 | 8 | gain 2 | 2 | 2 | 2/2/2 | 3/2/3 | 2 |
| p02 | 9 | 3 | gain 2 | 0 | 0 | 0/1/0 | 0/0/0 | — |
| p03 | 15 | 9 | gain 2 | 4 | 4 | 3/4/4 | 3/3/3 | 0 |
| p04 | 25 | 11 | gain 2 | 1 | 0 | 0/2/1 | 1/0/0 | — |
| p05 | 6 | 2 | gain 2 | 1 | 1 | 1/0/0 | 2/1/1 | 0 |
| p06 | 8 | 4 | gain 2 | 0 | 0 | 0/0/0 | 0/0/0 | — |

Cobertura media sobre gain>=2 etiquetadas: B1 A 0.214, B1 B 0.199, B2 A 0.171, B2 B 0.227, B2E 0.083 (3 corridas).

- Un oro por caso: 18 observaciones por brazo; 0/18 frente a 2/18 da p=0.49. No mide cobertura.
- Las etiquetas existentes vienen de pools de versiones anteriores: 292 pares caso-firma de esta noche no tienen etiqueta, así que la cobertura sobre etiquetas no ve firmas nuevas.
- Anclas necesarias para distinguir una mejora relativa de 20% (bilateral α 0.05, potencia 0.8, sin efecto de diseño; con correlación entre semillas del mismo caso hacen falta más):

| Cobertura base | Mejora a | Observaciones ancla-corrida por brazo | Anclas por caso con 6 casos × 3 semillas | Con 12 casos × 3 semillas |
|---|---|---|---|---|
| 0.20 | 0.24 | 1.678 | 94 | 47 |
| 0.50 | 0.60 | 385 | 22 | 11 |

Con la cobertura actual (~0.2), 20% relativo exige del orden de 50-100 anclas por caso. Anclas más recuperables (base 0.5) bajan la cifra a 11-22.

## 3. Tabla de hallazgos

Costos: Exa a 0.0089 USD por llamada pagada (789 llamadas, 7 USD). Las horas son estimaciones propias, no salen de los eventos.

| Hallazgo | Tipo | Evidencia | Acción mínima | Costo USD / horas |
|---|---|---|---|---|
| H1. Seed no controla al planner; la variación entre semillas es muestreo del proveedor | N (origen T) | Lote inicial 6/6 o 0/6 compartido; seeds distintas con salidas idénticas; J firmas 0.58-1.00 con lote igual y 0.08-0.37 con lote distinto; 84-88% de diferencias sin el dominio en los resultados de la otra semilla | Declarar las semillas como réplicas no controladas; para comparar condiciones, fijar el lote inicial (reutilizar las consultas de una corrida) o subir réplicas | 0 / 1 h (documentar); fijar lote inicial: 0 USD, 3 h |
| H2. Regla de sensibilidad R1 con umbral J<0.5 por debajo del ruido | D | J entre variantes 0.10-0.25 dentro del rango entre semillas en 6/6 pares; J dentro de la misma variante 0.22 | Redefinir la regla contra el ruido (J entre < J dentro, con intervalo) en un pre-registro nuevo | 0 / 2 h |
| H3. El planner para en la 2.ª llamada con rendimiento positivo | T/D | 21/36 paran tras 9 búsquedas; último tercio 1.5 firmas por búsqueda; 31/36 no llegan al presupuesto | En config nueva (no v5): mínimo de búsquedas antes de aceptar `stop` | Código 2 h; prueba 6 casos × 1 semilla con 18 búsquedas: ~36 llamadas pagadas × 0.0089 ≈ 0.32 USD por corrida, ~1.9 USD |
| H4. Rechazo por cita literal en páginas de inversionista | T | 691/2.553 extracciones B2 (27%); 290 pares dominio-corrida perdidos; incluye oro p04 y boldtcapital.com (gain 2) | Releer desde caché las 290 páginas con una regla de cita relajada y contar cuántas pasan (sin Exa) | 0 USD Exa; LLM ~290 llamadas (tokens no tasados); 3 h |
| H5. Extractor no determinista a temperature=0 | N/T | 15 de 1.800 pares URL+longitud con resultados distintos; worldfund.vc aceptado y rechazado sobre la misma página | Compartir una caché de extracción entre carpetas de salida | 0 / 1 h |
| H6. Oro no devuelto por Exa en 45/48 corridas | P o D | 0 apariciones de lightrock.com, celesta.vc, ecapital.vc en 658 búsquedas; consultas de 28 palabras de mediana | Prueba de alcanzabilidad: 18 consultas cortas sin nombre (tabla P1) | 0.16 USD (0.32 con 25 resultados) / 0.5 h |
| H7. Evidencia de oro débil | D | p04 sin cita; p02 y p05 con listas genéricas | Rehacer evidencia de los 3 anclas con cita de la página oficial | 0 / 1 h |
| H8. Un oro por caso no mide cobertura | D | 0/18 vs 2/18, p=0.49; cobertura sobre etiquetas 0.17-0.23 | 22-94 anclas por caso según cobertura base (tabla P9) | 0 USD; curaduría 20-60 h |
| H9. 85% de firmas aceptadas sin etiqueta | D | 40/260 y 44/257 etiquetadas; 292 pares sin etiqueta | Etiquetar los 292 con el adjudicador y muestra humana | LLM: 292 adjudicaciones (tokens no tasados); humano 2 min por firma ≈ 10 h |
| H10. Filtro B2E: corte top_k sin separación y pérdida de firmas buenas | T/D | Puesto 10 vs 11: 0.0012; 3 de 5 firmas gain>=2 de B2 descartadas; LLM descarta cosenos mayores que los conservados | Antes de más corridas B2E, decidir el corte (umbral absoluto o solo LLM); luego 15 corridas para 18 pares | 15 corridas × ~0.33 = ~5 USD / 2 h + etiquetado |
| H11. Profundización consume la mitad de Exa fuera del presupuesto | P | 512/924 búsquedas, 279/579 llamadas pagadas, 1.487/2.717 fetches | Contar la profundización dentro del presupuesto o limitar max_firms_per_run (16) | 0 / 1 h; ahorro ~48% de Exa por corrida |
| H12. Dominios que fallan siempre | T | innogy.ventures 12 corridas, superscout.co 10, apg.nl 6, idbinvest.org 5 | Lista de fallos persistente por dominio (saltar tras 2 fallos) | 0 / 1 h |
| H13. FETCH_EMPTY 11.6% | T/P | 314/2.717; 206 rescates con contenido de búsqueda | Medir cuántos FETCH_EMPTY se rescatan con contenidos de Exa | Contenidos Exa: ~0.001-0.002 USD por página, 314 páginas ≈ 0.3-0.6 USD por 36 corridas |
| H14. Umbral R3/R4 inalcanzable | D | Mínimo 8 firmas tras 2 rondas en 39 corridas; umbral 3 | Rediseñar la señal (gain>=2 o firmas nuevas por búsqueda) | 0 / 2 h |
| H15. Corridas por presupuesto aún crecen | P | 5/36; último tercio 1.5 firmas por búsqueda | Subir max_searches a 27 solo si H3 no lo resuelve | ~0.16 USD por corrida afectada |

## 4. Qué hacer con 13 USD y qué requiere presupuesto nuevo

Con los 13 USD (orden por impacto/costo):
1. Prueba de alcanzabilidad del oro (H6): 18 llamadas, 0.16-0.32 USD. Separa P de D para p02, p03, p06.
2. Releer páginas rechazadas por cita (H4) y compartir caché de extracción (H5): 0 USD Exa.
3. Profundización dentro del presupuesto (H11): 0 USD; baja el costo por corrida de ~0.14 a ~0.07 USD (de 16 a ~8 llamadas pagadas).
4. Mínimo de búsquedas antes de `stop` (H3), 6 casos × 1 semilla: ~1.9 USD.
5. Réplica de B2 con el lote inicial fijado (H1), 6 casos × 3 semillas: consultas iniciales en caché, ~0.10 USD por corrida, ~1.8 USD. Mide el ruido que queda sin el planner.
6. B2E en 15 corridas tras decidir el corte (H10): ~5 USD.
Total 1-6: unos 9 USD; quedan unos 4 USD de reserva.

Presupuesto nuevo:
- Exa por consulta para una corrida formal con más casos: 12 casos × 3 condiciones × 3 semillas = 108 corridas × 0.14 USD ≈ 15 USD (≈ 7.6 USD con H11).
- Exa con 25 resultados por consulta en todo el benchmark: ~2× el costo por llamada (0.009 → ~0.019).
- Exa contents para FETCH_EMPTY (H13): ≈ 0.3-0.6 USD por 36 corridas.
- Otra fuente de búsqueda: serper y tavily están configurados, pero 0 búsquedas válidas los usaron; no hay cifra de costo en los eventos.
- Tokens LLM: B2 usa 113.006 tokens nominales de mediana por corrida (no_more_actions) y 228.075 las que agotan presupuesto; B2E añade ~31.700 tokens por corrida para el filtro. Los eventos no traen precio por token.
- Etiquetado humano: 292 firmas sin etiqueta (≈ 10 h a 2 min por firma) y anclas nuevas (20-60 h para 22-94 por caso en 6 casos).

## 5. Lo que no se pudo verificar y por qué

- Razón del LLM en cada descarte de B2E: `relevance_filter` solo registra índices conservados.
- Si Exa devolvería el oro con otras consultas o más resultados: requiere llamadas pagadas (P1, H6).
- Precio exacto por llamada según número de resultados y contenidos: solo hay el total de 7 USD del panel; 0.0089 es un promedio de 789 llamadas mezcladas.
- Precio por token del LLM: no figura en eventos ni configuración.
- Si el proveedor del LLM ignora la semilla o la aplica de forma no determinista: se infiere de salidas idénticas con semillas distintas; no hay registro del proveedor.
- Calidad de 292 firmas sin etiqueta y de las 290 páginas rechazadas por cita: etiquetarlas estaba fuera del alcance.
- La pregunta "tipo de consultas del planner" en R1 usa una clasificación por palabras clave propia; no es una etiqueta validada.
- Horas de trabajo: estimaciones propias.
