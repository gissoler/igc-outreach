# FIX_SPEC — motor de búsqueda de inversionistas (post benchmark v3)

Fecha: 2026-10-08 · Autor del diagnóstico: Claude (lectura de código y evidencia; sin gasto de API, sin escrituras en el repositorio) · Destinatario: implementador (GPT/Codex), que debe aplicar este documento **literalmente**.

---

## 0. Base de código, alcance y convenciones

**Base que se debe modificar.** El código que produjo v3 **no está en el repositorio** `AGENT` (HEAD `ad5ac6f`). Vive solo en el snapshot de ejecución:

```
SNAP = /Users/gcaicedo/Documents/Product Brain/Outreach/Fuentes/Benchmark investors - execution 2026-10-08/workspace/AGENT-snapshot
```

Ejemplos: `AGENT/research/bench/investors/extractor.mjs` tiene 21 líneas (versión previa a la corrección); la del snapshot tiene 74 (sha256 `d00dbafa…`). En `AGENT/research/bench/investors/` faltan `run-experiment.mjs`, `search-failover.mjs`, `external.mjs` (versión v3), `config/v1..v3` y `out/`. **FIX-00** porta el snapshot al repositorio antes de cualquier cambio.

Todas las referencias `archivo:línea` de este documento son a `SNAP/…`. Abreviaturas:

* `INV = SNAP/research/bench/investors`
* `OUT = INV/out/investors-internal-2026-10-08-v3`
* `run_id` abreviado: `p01/B1/s101` = `investors-internal-2026-10-08-v3__inv-case-syn-p01__B1__s101`

**Método.** Leí el código y reconstruí las 180 corridas a partir de `OUT/events.jsonl` y `OUT/cache.sqlite`, en una copia de solo lectura. Las entradas `llm` del caché guardan el JSON crudo del extractor. Su clave se recalculó con la función de `external.mjs:29`: `sha(prompt.sha256 | sha(user) | schema | 0 | 0)`. Así se emparejaron 1.740 de 1.740 páginas en caché con su extracción. Los resultados de búsqueda se reconstruyeron con la clave de `search-failover.mjs:19`, y se resolvieron las 1.422 de 1.422 consultas. Los scripts de análisis quedaron fuera del repositorio y de la carpeta del benchmark.

**Uso del gold.** Las etiquetas y anclas se usaron **solo para diagnosticar**. Ningún umbral, regex ni tabla de normalización de este documento se ajustó para que un caso del gold pase. Las pruebas de aceptación usan textos sintéticos escritos aquí y los 3 casos de depuración nuevos de §5.2.

---

## 1. Diagnóstico por causa

### 1.0 Verificación de los hechos medidos

| # | Hecho declarado | Verificación | Resultado |
|---|---|---|---|
| 1 | 180/180 se abstuvieron | `abstained=true` en los 180 `result.json`; `engine.mjs:56` `abstained: !ranked.some(x => x.gain >= 2)` | ✔ |
| 2 | Recall@20 B0 0,104 · B1 0,203 · B2 0,221 · B3 0,186 | `REPORT.md` §3/§4 y `metrics_report.json` | ✔ (citado, no recalculado) |
| 3 | Hit@20 en anclas: B2 2/36, B0 y B1 0/36 | Reconstrucción por ancla (§1.B): solo Endiya (p10) entra al ranking, en p10/B2/s101 (rank 3) y s202 (rank 2) | ✔ |
| 4 | No-inversores rechazados / fetches ≈ 0,89–0,92 | `extract_end` de las corridas finales: 3.753 rechazos de 4.233 extracciones = **0,887** | ✔ |
| 5 | Activity accuracy 0,17–0,24 | `REPORT.md` (0,18 / 0,24 / 0,17) | ✔ (citado) |
| 6 | `capital_strategy_context` forzado a false | `run-experiment.mjs:95` y `:103` lo escriben como literal `false`. **Además, el motor del benchmark no tiene ningún punto de integración**: solo lo importa `server/research/pipeline.mjs:27` | ✔, y es peor: no existe la integración |
| 7 | Todos los INV-* `unknown` aunque la página los contiene | 2.287 extracciones `institutional_investor`: `stages` aparece **0** veces, `sectors` 3, `geographies` 2, `quote` **0**, `official_domain` **0** (§1.A) | ✔ |

### 1.A Extractor — **causa raíz de la abstención universal** (tarea A)

**Mecanismo, en cuatro eslabones (todos verificados):**

1. **El contrato permite omitir todo.** `docs/contracts/investor/investor_extraction.schema.json:5` solo exige `["entity_kind","canonical_name","source_kind"]`. `external.mjs:34` pasa ese schema como `response_format: json_schema`. Con `gpt-oss-120b` y temperatura 0, el modelo devuelve el objeto mínimo. Formas reales de las 2.287 extracciones de inversor:
   * `{aliases, canonical_name, canonical_url, contradictions, entity_kind, source_kind}`: 2.016 (88 %).
   * La misma forma más `active_status`: 190.
   * Presencia de cada campo: `quote` 0 · `official_domain` 0 · `stages` 0 · `rounds` 0 · `sectors` 3 · `geographies` 2 · `investor_type` 22 · `check_range_usd` 1 · `lead_follow` 0 · `published_on` 9.
2. **El prompt no pide lo que el schema tiene.** `prompts/investor/extractor/v1/user.md:1` pide "thesis", que no existe en el schema, y no pide `quote`. `extractor/v1/system.md:1` dice "use null or unknown when absent". Hay evidencia de que el modelo aplicó esa literalidad incluso al dominio: en Cometa y Petram escribió en `contradictions` "The page does not list an official domain in the text". Además, **v3 corrió con el prompt `extractor v1`** (`config/v3-2026-10-08.json:19`), no con el `v2` que existía en el manifiesto.
3. **El extractor rellena con vacíos.** `extractor.mjs:64-66` asigna `sectors ?? []`, `stages ?? []`, `geographies ?? []`, `investor_type ?? 'unknown'`, `lead_follow ?? 'unknown'`, etc.
4. **El juez convierte vacío en `unknown`.** `judge.mjs:14` (`!entity.sectors.length → 'unknown'`), `:16` (stage), `:18` (geo), `:11` (type `'unknown'`), `:20` (check), `:21` (round), `:23` (business model), `:25` (lead), `:27` (regulatory) y `:30` (recency). Resultado: `unknown_count` 10–11 de 12. `judge.mjs:43` → `unknowns >= 5 ? 'weak'`. `ranking.mjs:5` exige `overall_relevance === 'plausible'` para gain 2, así que el gain queda en 1 y la corrida se abstiene (`engine.mjs:56`).

**Muestra de 10 firmas con etiqueta positiva** (adjudicator `plausible`, gain de etiqueta = 2) que el sistema **sí** descargó y aceptó. La columna "extraído" es el JSON crudo del caché. En las 10, todos los INV-* salieron `unknown` por la cadena 1→4. Las únicas excepciones son INV-PORTFOLIO-CONFLICT=`met`, porque `judge.mjs:29` marca `met` cuando el perfil tiene lista de conflictos, e INV-ACTIVE=`met` cuando el modelo escribió `active_status` (Cometa, Cradle).

| # | Caso · firma · run_id | Lo que la página dice (literal) | Lo que se extrajo | Criterios del juez | Etiqueta |
|---|---|---|---|---|---|
| 1 | p01 · Finnovista.vc · `p01/B1/s101` | "Finnovista.vc is a venture capital firm that leads rounds in pre-seed and seed stage Fintech companies in Spanish-speaking Latin America." | `{entity_kind, canonical_name:"Finnovista.vc", aliases, source_kind:"official", canonical_url, contradictions:["none"]}` | 11 unknown; sector/stage/geo/lead/type vacíos | plausible; stage met, geo met |
| 2 | p01 · Cometa · `p01/B0/s101` | "COMETA is a venture capital firm that invests in early-stage technology companies targeting Spanish-speaking markets globally." | Igual que el anterior, más `active_status:"active"`; contradicción "no official domain in text" | 10 unknown (ACTIVE=met) | plausible |
| 3 | p03 · Semicon Ventures · `p03/B0/s101` | "…venture capital services firm dedicated to the industrial systems behind semiconductor manufacturing…"; "Growth-stage and scale-up" | 6 claves, sin sector ni etapa | 11 unknown | plausible (sector on) |
| 4 | p03 · Petram Ventures · `p03/B0/s101` | "### Semiconductor Ecosystem Only", "### Seed and Series A Only" | 6 claves; "The page does not list a website URL…" | 11 unknown | plausible; stage met |
| 5 | p04 · Array Ventures · `p04/B0/s101` | "Array Ventures \| Preseed & Early Stage VC for Enterprise Software" | 6 claves | 11 unknown | plausible; stage met |
| 6 | p06 · Glilot Capital · `p06/B0/s101` | "Today, we invest in cybersecurity, AI and enterprise software at seed and early growth…" | 6 claves | 11 unknown | plausible; stage met |
| 7 | p08 · HealthCap Africa · `p08/B0/s101` | "we invest in pre-Series A healthtech and fintech startups operating in … Nigeria, South Africa, Kenya, and Egypt." | 6 claves; contradicción sobre contadores "0" de la página | 11 unknown | plausible; geo met |
| 8 | p10 · 4point0 · `p10/B0/s101` | "4point0 - Venture Capital Firm in India \| Healthcare Seed Funding" | 6 claves | 11 unknown | plausible; stage met, geo met |
| 9 | p11 · Circle Capital · `p11/B1/s101` | "Singapore-based venture capital firm focused on Asia's Energy Transition." | 6 claves | 11 unknown | plausible; geo met |
| 10 | p12 · Cradle Seed Ventures · `p12/B1/s101` | "CSV is an early-stage venture fund that focuses on the digital and technology sector…"; "invested in 10 startups based in Malaysia and Singapore" | 6 claves más `parent_firm` y `active_status:"active"` | 10 unknown | plausible; stage met, geo met |

**Además, el gate deterministic rechaza firmas reales por razones mecánicas** (`extractor.mjs:34-53`). Distribución de rechazos en las 4.233 extracciones finales:

| Razón | Cantidad | Causa verificable |
|---|---|---|
| `missing_literal_quote` | 1.888 | El modelo nunca emite `quote` (0/2.303). El *fallback* de `extractor.mjs:24-27` exige **una sola oración** que contenga el nombre y además case con `INVESTMENT_EVIDENCE` (`:6`). Esa regex no reconoce "invests in early-stage technology companies", "leads rounds in pre-seed" ni "we back founders from day one". Caso real: Golden Ventures (ancla de p04), cuya portada no contiene ninguna de esas frases. |
| `missing_identity` | 846 | `canonical_name` vale "unknown"/null en listas, noticias y directorios. El schema admite **una** firma por página, así que una noticia con 5 inversores produce 0 entidades. |
| `unresolved_firm_identity` | 577 | `official_domain` nunca viene del modelo. La inferencia `:29` solo aplica si `source_kind==='official'` y el nombre canónico coincide con el host, y **no prueba aliases**. Ejemplo: SEACEF (ancla de p11) tiene `canonical_name` "Southeast Asia Clean Energy Facility", alias "SEACEF" y host `seacef.org`; el alias coincide pero no se prueba. Las páginas de terceros (noticias de Clime Capital, Ventures Platform) no tienen mecanismo de resolución. |
| `insufficient_page_text` | 366 | Lector (§1.D) |
| `collection_page` | 59 | — |
| otros | 17 | — |

El modelo clasificó como `institutional_investor` 1.727 de 1.740 páginas distintas. **La clasificación del LLM no discrimina; todo el trabajo lo hace el gate.** Eso explica la tasa ≈ 0,89 del hecho 4.

### 1.A' Juez/ranking — **segundo bloqueo, independiente del extractor**

Arreglar solo el extractor **empeoraría** el resultado. Lo comprobé con *counterfactuals* deterministas: ejecuté `judge.mjs` y `ranking.mjs` reales del snapshot con entidades que contienen **los hechos literales de la página**.

| Entidad simulada (perfil) | Gain | Por qué |
|---|---|---|
| Finnovista literal: type `venture_capital`, sector Fintech, stages pre-seed y seed, geo "Spanish-speaking Latin America", lead (p01) | **0** | `INV-TYPE=not_met`: `judge.mjs:11` compara por igualdad `venture_capital` con `accepted_investor_types=['generalist_vc','specialist_vc']`, dos vocabularios disjuntos. `INV-TYPE` es *hard* en el catálogo, así que la firma queda `ineligible`. Además `INV-GEO=not_met`: "Latin America" ≠ "Mexico" (`:18`, igualdad exacta). |
| Igual, con geo "Mexico" | **0** | Sigue `INV-TYPE=not_met` |
| Igual, con type `unknown` | **1** | 7 unknown ≥ 5 → `weak` (`judge.mjs:43`) |
| Todo conocido y compatible, `active`, con evidencia reciente (p01) | **0** | `INV-TYPE=not_met`; `INV-LEAD=not_met` porque "seeking lead" ≠ "lead" (`:25`) |
| p02, etapa "Series B" vs perfil `series_b` | **0** | `INV-STAGE=not_met` por `norm('Series B') !== norm('series_b')` (`:16`) |
| p08, HealthCap "pre-Series A" vs perfil `pre-seed` | **0** | `INV-STAGE=not_met` (hard) aunque "pre-Series A" incluye pre-seed |

Defectos del juez que esto demuestra:

1. **Vocabulario de tipos disjunto.** El perfil usa `*_vc`, `growth_investor`, `impact_investor`, y textos libres como "strategic energy corporates". El enum de la entidad es `venture_capital|corporate_venture_capital|family_office|…`. Con evidencia real, `INV-TYPE` nunca puede ser `met`.
2. **Etapas comparadas como strings exactos** (`series_b` vs "Series B"; "pre-seed" vs "pre-Series A"; "early stage"). No hay escala ordinal.
3. **Geografía sin jerarquía** (país ⊂ región).
4. **`lead_preference` es texto libre** ("seeking lead") comparado por igualdad.
5. **`overall_relevance='plausible'` exige menos de 5 unknown de 12** (`judge.mjs:43`). Ni una extracción perfecta de una portada típica conoce CHECK, ROUND, BUSINESS-MODEL, REGULATORY y RECENCY: son 5 unknown estructurales. El protocolo no fija esa regla: `PROTOCOL.md:48-49` define gain 2 como "plausible … sin criterio duro not_met" y gain 1 como "varios unknown", y `LABELING_GUIDE.md:32` dice "`plausible` permite algunos unknown sin ningún hard not_met". **El código es más estricto que el protocolo congelado.**
6. **Sector:** `judge.mjs:13` produce `off`, y por tanto gain 0, cuando no hay token común de 5 letras o más. Ejemplos: "AI" vs "Enterprise software", "climate tech" vs "Building decarbonisation". Un falso `off` es peor que `unknown`.
7. **Actividad:** `activity.mjs` (`classifyActivity`) **no se importa en ningún sitio del motor** (grep: solo `activity.mjs:3`). `entity.active_status` es lo que el LLM escribió (205 veces `active`, 20 `unknown`, el resto ausente). Las etiquetas son 55 % `possibly_active`, 29 % `active` y 15 % `unknown`, de ahí la precisión de 0,17–0,24 (hecho 5).

### 1.B Anclas no encontradas (tarea B)

Reconstrucción de las 12 anclas × B0/B1/B2/B3 × 3 semillas. Fuentes: `search_start` → resultados de caché → `fetch_end` → `extract_end` → `result.json`.

| Caso · ancla | ¿En SERP? (consulta, posición) | ¿Abierta? | Resultado | Punto de pérdida |
|---|---|---|---|---|
| p01 Magma Partners | Nunca (0/12 corridas) | — | — | Planner/buscador: ninguna consulta la devuelve |
| p02 Lightrock | Nunca en p02 | — | — | Planner/buscador |
| p03 Celesta Capital | Nunca | — | — | Planner/buscador |
| p04 Golden Ventures | B1/s202 (q6, pos 5); B2/s101 (q2 pos 4, q7 pos 3, q9 pos 4) | B2/s101: sí | `missing_literal_quote` | Lector (top-3) y **extractor** (regex/quote) |
| p05 World Fund | B2/s101 (q0, pos 5) | No | — | **Top-3 por consulta** (`engine.mjs:22`, `config v3:16`) |
| p06 eCAPITAL | En las 12 corridas (B0 pos 10; B1/B2 pos 1–3) | Sí, 9 veces | `insufficient_page_text` siempre | **Lector**: portada sin texto (`fetch.mjs:29-36`; Crawl4AI no configurado; Jina no rescató) |
| p07 Novastar Ventures | Nunca | — | — | Planner/buscador |
| p08 Ventures Platform | B2/s202 (q7, pos 3), página de noticia propia | Sí | `unresolved_firm_identity` | **Extractor**: `source_kind=news` en su propio dominio; sin dominio oficial |
| p09 A91 Partners | Nunca | — | — | Planner/buscador |
| p10 Endiya Partners | B1 s101 (pos 7) y s303 (pos 9); B2 s101/s202 (pos 2–5) | B2 sí | **Aceptada**; rank 3 y 2 | En B1: top-3. B2 es el único hit@20 |
| p11 SEACEF / Clime | En B1/B2/B3, 9/9 corridas (pos 1–10) | Sí, 8 veces | `missing_literal_quote` / `unresolved_firm_identity` | **Extractor**: "invests in innovative development-stage clean energy projects" no casa con `:6`; alias no probado en `:29` |
| p12 SGInnovate | Nunca | — | — | Planner/buscador |

Resumen: **6/12 anclas nunca aparecieron en SERP**. Las otras 6 sí aparecieron y se perdieron así:

* 3 por el extractor o el gate (Golden, Ventures Platform, SEACEF).
* 1 por el lector (eCAPITAL).
* 1 por el corte top-3 (World Fund).
* 1 encontrada (Endiya).

**Embudo sobre todas las firmas positivas.** Se cuentan las 64 positivas de etiqueta más las anclas, deduplicadas a 68, por caso, × 3 semillas = 204 pares (firma, corrida) por condición:

| | Nunca en SERP | En SERP, no abierta | Abierta y rechazada | En entidades/top-20 |
|---|---|---|---|---|
| B0 | 159 (78 %) | 21 | 0 | 24 (12 %) |
| B1 | 126 (62 %) | 31 | 5 | 42 (21 %) |
| B2 | 126 (62 %) | 23 | 5 | 50 (25 %) |

**Sesgo de construcción que hay que leer junto a esta tabla.** El pool (y por tanto los positivos) se construyó con el top-20 del propio sistema más las anclas. Una firma que el gate rechazó en todas las corridas nunca entró al pool y no aparece como pérdida. La columna "abierta y rechazada" es por eso **una cota inferior**. Evidencia: en 597 páginas rechazadas de B2 que se leyeron, 38 nombran literalmente a un positivo o ancla del caso, y **22 pares (firma, corrida) de positivos que no llegaron a entidades aparecen nombrados en páginas rechazadas**. En B1 son 25.

**Presupuesto y paciencia** (`engine.mjs:32-34`, `config v3:15`). `noNew` cuenta consultas sin entidad nueva y para a las 5. Con 89 % de rechazo y 3 fetches por consulta, la paciencia se dispara pronto:

| | Paradas por paciencia | Búsquedas medias usadas (de 18) | Fetches medios (de 54) | Entidades medias |
|---|---|---|---|---|
| B0 | 9/45 | 5,3 (solo hay 6 plantillas) | 16,0 | 1,73 |
| B1 | **36/45** | 9,6 | 28,6 | 2,53 |
| B2 | **37/45** | 8,2 | 24,7 | 2,16 |

Hay **tres consecuencias**:

* B1 viola el protocolo, que dice "ejecuta la tanda completa sin adaptación" (`PROTOCOL.md:35`). El motor aplica paciencia a todas las condiciones.
* Ninguna corrida llena 20 entidades (máximo 9). **El orden del ranking no afecta hoy a recall@20**: todo lo aceptado entra al top-20. La palanca de recall es aceptar y descubrir más.
* Los fetches vacíos (22,5 %) cuentan como "sin entidad nueva" y adelantan la parada.

### 1.C B2 frente a B1 (tarea C)

| Métrica (45 corridas) | B1 | B2 |
|---|---|---|
| Llamadas al planner | 45 | 96 (51 adaptativas, ≈ 1,1 por corrida) |
| Consultas adaptativas propuestas | — | 152 |
| Entidades por consultas iniciales / adaptativas | 114 / — | 77 / 20 |
| Positivos (etiqueta) por consultas iniciales / adaptativas | 42 / — | 38 / **10** |
| Positivos en top-20 | 42 | 48 |
| Coincidencia de consultas: B2 inicial ∩ B1 (misma semilla) | — | 4 de 270 (normalizadas) |

Qué planea B2 que B1 no: sus consultas adaptativas derivan a tipos de capital de menor rendimiento (CVC, fondos gubernamentales, family offices). Ejemplo de `p01/B2/s101`:

* Paso 1: "corporate venture capital Mexico fintech seed investments", "government-backed funds fintech and payments Mexico"…
* Paso 2: "corporate venture capital Mexico fintech seed investments" (**repetida**), "government backed funds fintech payments Mexico seed stage" (**paráfrasis**)…

Por qué no se traduce en más positivos:

1. **El estado que recibe el planner está vacío de información útil.** `engine.mjs:49` envía `sectors/stages/geographies` de cada entidad, que siempre son `[]` (§1.A). No envía resultados de SERP, hosts vistos, rechazos ni candidatos sin resolver. La "reflexión sobre cobertura" del protocolo no tiene con qué trabajar.
2. **Solo se filtran duplicados exactos** (`conditions.mjs:21-22`). Las paráfrasis pasan y gastan presupuesto.
3. **La paciencia corta B2 tras ≈ 1 paso adaptativo** (37/45 paradas por paciencia), así que el bucle casi no llega a operar.
4. **B2 usa menos presupuesto que B1** (8,2 frente a 9,6 búsquedas). Su ventaja de +0,018 está dentro del ruido entre semillas (0,112–0,117).

### 1.D Lector

* 953 de 4.233 fetches (22,5 %) terminaron en `FETCH_EMPTY` (<200 caracteres): 927 vía `direct`, 17 tras Jina, 9 bloqueadas.
* Crawl4AI no intervino porque `CRAWL4AI_URL` no estaba definido (`PREFLIGHT.md`, `fetch.mjs:29`). Jina se usó 27 veces.
* Entre los hosts con 100 % vacío y 5 intentos o más hay agregadores (pitchbook.com, app.dealroom.co, f4.fund, fundraisingfox.com, foundersuite.com, pipeseed.com) y **sitios de firmas** renderizados con JavaScript (vernecapital.vc, staircaseventures.com, accel.com, omnivore.vc, ecapital.vc).
* Los fallos no se cachean (`fetch.mjs:69-76`).
* En la misma corrida, el 8,8 % de los fetches repite una URL ya abierta: `engine.mjs` no deduplica URLs entre consultas.
* Solo se abren los 3 primeros resultados de 10 (`engine.mjs:22`). Hay 3.095 resultados no abiertos con host "de firma" (`ventures|capital|partners|.vc|fund|invest`), frente a 1.536 abiertos.

### 1.E Capa `capital_strategy_context` (tarea D)

Lo que haría con los 12 perfiles lo verifiqué ejecutando `buildCapitalStrategyContext` **sin planner** (`plan=null`): es determinista, sin red y sin gasto.

1. **Integración inexistente.** El motor del benchmark no tiene ningún punto de entrada (§1.0 hecho 6). Activar la bandera no cambiaría nada.
2. **Contrato incompatible con el perfil.** `strategy.mjs:20-33` lee `brief.industry`, `brief.product`, etc. El perfil de inversor es `profile.fields.<campo>.value`. Pasado tal cual, en los 12 perfiles `declared_segment = "Segment not confirmed"`.
3. **Con un adaptador mínimo** (`industry=fields.sector.value`, …) y el *fallback* de `strategy.mjs:35-44`, produce 3 rutas y 3–4 consultas por perfil, todas del tipo:
   * "Which organizations currently fund Fintech?" (searxng)
   * "Which comparable products in Fintech have documented financing, grants, awards or pilots?" (official_grants)
   * "Which products enable the same outcome as Accounts-payable and supplier-financing platform … distribu?"

   Hay cuatro problemas:
   * **(a)** Las consultas son preguntas en lenguaje natural, truncadas a 100–120 caracteres a mitad de palabra (`clip`).
   * **(b)** Ignoran geografía y etapa, que son criterios duros.
   * **(c)** `tools.mjs:10` envía a `official_grants` toda pregunta que diga "grant/award", así que 1 de cada 2 consultas va a grants, fuera del alcance de inversores.
   * **(d)** `capitalQueries` filtra por `['searxng','official_grants','funding_round_sources']`, pero v3 usa el proveedor `failover` (exa/serper/tavily): habría que mapear nombres.

   Con planner LLM, las rutas dependerían del modelo: **no verificable sin gasto**.
4. **Efecto esperado en pooled_recall@20 con estas etiquetas: bajo o negativo.** El pool se construyó con el segmento declarado. Las firmas de segmentos adyacentes entrarían sin etiqueta, y además (`strategy.mjs:13` y la guía) **una ruta adyacente nunca puede volver `met` el sector del perfil congelado**. Su valor es de descubrimiento, no de gain≥2, y exige etiquetar firmas nuevas.

Conclusión: no tocarla en esta corrección. Queda como ablación posterior (FIX-16, diferida).

### 1.F Etiquetas y medición

* Etiquetas `model_adjudicated_internal` (claude-sonnet-5-5): 181 firmas; 65 con confianza baja; sin segundo revisor ni κ (`REPORT.md` §7).
* Hay pocos positivos en p02 (3), p05 (2) y p09 (2). El recall de esos casos se mueve en saltos de 0,33–0,5.
* `decide.mjs:6` evalúa `null <= 0.1`, que en JS es `true`, cuando `hard_false_positive_rate` es `null`. Ya está documentado como "no evaluable". **No se cambia** (§4).
* Sesgo de pool descrito en §1.B: recall relativo a lo que algún sistema ya encontró.

### 1.G Clasificación y orden de impacto (tarea E)

Leyenda: **Bloqueante** = sin el arreglo, gain≥2 es imposible. Estimaciones de recall sobre B2, con el pool actual. Son cotas, no promesas.

| Rk | Causa | Clase | Impacto en emitir gain≥2 | Impacto esperado en pooled_recall@20 | Evidencia |
|---|---|---|---|---|---|
| 1 | Campos no emitidos (schema opcional, prompt v1, sin `quote` ni dominio) | extractor | **Bloqueante** | Medio: el `quote` ausente causa 1.888 rechazos, que alimentan la paciencia | §1.A |
| 2 | Vocabularios disjuntos (type, stage, geo, lead) y regla `unknowns>=5` | judge/ranking | **Bloqueante, aun con extractor perfecto** | 0 directo (recall usa etiquetas; las entidades son <20) | §1.A' |
| 3 | Paciencia en B0/B1, que además cuenta fetches vacíos | presupuesto | Indirecto | **Alto**: el 62 % de los pares nunca llega a SERP y las corridas usan el 45–53 % del presupuesto de búsqueda. No verificable de forma contrafactual (las consultas no ejecutadas no tienen SERP en caché) | §1.B |
| 4 | Una sola firma por página y sin resolución de identidad de terceros | extractor | Indirecto | Medio-alto: ≤ +0,11 (22 de 204 pares nombrados en páginas rechazadas) | §1.B |
| 5 | Top-3 por consulta, sin triage ni deduplicación de URL | lector/presupuesto | — | Medio: ≤ +0,11 (23 de 204 pares en SERP sin abrir) | §1.B, §1.D |
| 6 | 22,5 % de páginas vacías (sitios JS) | lector | — | Bajo-medio (eCAPITAL y otros 4 sitios de firma) | §1.D |
| 7 | Actividad no cableada (`classifyActivity` sin uso) | judge | Necesario para gain 2 (`active\|possibly_active`) | 0 | §1.A' 7 |
| 8 | Estado vacío del planner B2, paráfrasis, sin candidatos por nombre | planner | — | Medio para B2−B1 | §1.C |
| 9 | Anclas que nunca aparecen en SERP (6/12) | buscador/cobertura | — | Desconocido: no separable de 3 y 8 sin gasto | §1.B |
| 10 | `capital_strategy_context` sin integrar e incompatible | adyacencias | Ninguno | Bajo o negativo con este pool | §1.E |
| 11 | Pool sesgado, etiquetas de modelo, pocos positivos en 3 casos | etiquetas | — | Medición, no sistema | §1.F |

---

## 2. Cambios FIX-00 … FIX-16

Reglas comunes a todos los FIX:

* **No editar** ningún archivo listado en §4. Todo comportamiento nuevo se activa por **config v4** (`config/v4-<fecha>.json`).
* Con config v2/v3, el código debe producir **exactamente** el comportamiento de v3. Lo garantiza la prueba de regresión FIX-00.T2.
* Pruebas en `research/tests/agent/investors.test.mjs` (existente; **añadir** casos, no modificar los existentes) o en un archivo nuevo `research/tests/agent/investors.v4.test.mjs`.
* Ningún fixture puede contener texto de páginas de firmas que estén en `OUT/pool/*.json` ni anclas de los 15 casos. Fixtures sintéticos o de los casos de depuración D1–D3.

### FIX-00 — Portar el snapshot v3 al repositorio (sin cambio de comportamiento)

* **Archivos:** copiar desde `SNAP` a `AGENT` los archivos de `research/bench/investors/*.mjs`, `research/bench/investors/config/*.json`, `research/bench/investors/cases/**`, `prompts/investor/**`, `docs/contracts/investor/**`, `docs/benchmark/investors/**`, `research/capital/**` y `research/tests/agent/investors.test.mjs`.
* **Cambio:** copia byte a byte. No copiar `out/` (es evidencia, se queda en la carpeta del benchmark).
* **Prueba de aceptación:**
  * **T1:** `sha256(extractor.mjs) = d00dbafa8d41f945397ad812d854541d426cf0fdd52d0b25948c60ee3db08471`, `sha256(ranking.mjs) = 45e9c0e71c25ee162c04e048330e6e90b18576696d8aaf2c7d30698c51146a03` y `sha256(config/v3-2026-10-08.json) = b6afc77992ea81e85da9ca0a5641f4827d546427604e731bcfb288a6d58ab4cd`. `npm run test:investors` debe dar 20/20.
  * **T2 (regresión):** script `research/bench/investors/replay-v3.mjs` (nuevo). Para 10 `result.json` de `OUT/runs` elegidos por `sort()[0..9]`, reconstruye las entidades desde `result.json.entities`, vuelve a ejecutar `judgeInvestor` y `rankInvestors` con el perfil, y compara: igualdad exacta de `judgments` y `ranked`.
* **Riesgo:** ninguno funcional; la regresión exige igualdad.
* **Métrica:** ninguna.

### FIX-01 — Contrato de extracción v2 (todos los campos obligatorios y evidencia por campo)

* **Archivo nuevo:** `docs/contracts/investor/investor_extraction.v2.schema.json` (`$id …/investor_extraction.v2.schema.json`). **No tocar** `investor_extraction.schema.json`.
* **Cambio:** copiar las propiedades de v1 y además:
  * `"required"`: **todas** las propiedades de v1, más `quote`, `official_domain`, `evidence` y `candidates`. Los nulos se expresan con `null`, `[]` o `"unknown"` según el tipo; omitir una clave es inválido.
  * `"quote": { "type": ["string","null"], "maxLength": 600 }`
  * `"evidence"`: objeto `additionalProperties:false` con claves `investor_type`, `sectors`, `stages`, `rounds`, `geographies`, `check_range_usd`, `lead_follow`, `business_models`, `active_status`, `published_on`. Cada una es `{"type":["string","null"],"maxLength":400}` y **todas son obligatorias**.
  * `"candidates"`: `{"type":"array","maxItems":10,"items":{"type":"object","additionalProperties":false,"required":["name","quote","domain_on_page"],"properties":{"name":{"type":"string","minLength":2,"maxLength":120},"quote":{"type":"string","minLength":10,"maxLength":400},"domain_on_page":{"type":["string","null"]}}}}`
* **Registro:** añadir `investor_extraction.v2` a `contracts.mjs`. El loader ya registra todo `*.schema.json` de la carpeta; verificar que el nombre resuelva como `investor_extraction.v2`.
* **Prueba:**
  * `validateInvestor('investor_extraction.v2', objMinimoV1)` debe lanzar `InvestorContractError` con mensaje que contenga `must have required property 'quote'`.
  * Un objeto completo con nulos debe validar.
* **Riesgo:** con *guided decoding* el modelo puede llenar todo con `null`. Se mitiga con FIX-02 y se mide con FIX-02.T.
* **Métrica:** habilita FIX-03.

### FIX-02 — Prompt `extractor v3` y manifiesto v4

* **Archivos nuevos:** `prompts/investor/extractor/v3/system.md`, `prompts/investor/extractor/v3/user.md` y `prompts/investor/manifest.v4.json`. `manifest.v4.json` es una copia de `manifest.json` más las entradas `extractor@v3`, `planner@v2` (FIX-12) y `judge@v2` (FIX-08), con sus sha256 calculados como en `prompts.mjs:14`.
* **`prompts.mjs`, función `loadInvestorPrompt`:** añadir el parámetro `manifest = 'manifest.json'` en las opciones y leer `resolve(promptRoot, manifest)`. Valor por defecto sin cambio.
* **`run-experiment.mjs`:** si `config.prompts.manifest` existe, pasarlo.
* **Contenido de `system.md` (literal):**

```
You extract facts about investment firms from ONE untrusted web page. Output JSON matching the schema; every key is required.

1. entity_kind = institutional_investor only if the page contains a literal passage that names ONE specific firm and says it invests, provides capital, manages a fund, leads/joins rounds or backs companies. Copy that passage verbatim (max 600 chars) into "quote".
2. If the page is a list, article, directory, database or press release naming several investors, set entity_kind to the most specific non-investor kind ("other" if none fits), canonical_name to the page's publisher, and put up to 10 named investment firms in "candidates", each with a verbatim quote (max 400 chars) that contains the firm name and an investing verb, and domain_on_page if a web domain for that firm is literally printed.
3. For every fact field, fill the value ONLY from literal page text and copy the supporting passage verbatim into evidence.<field>. If the page does not state it, use [] / null / "unknown" and evidence.<field> = null.
   - sectors: the sector words as written ("Fintech", "semiconductor ecosystem").
   - stages: stage words as written ("pre-seed", "Seed and Series A", "early-stage", "growth").
   - geographies: countries/regions as written ("Spanish-speaking Latin America", "Nigeria").
   - investor_type: venture_capital | corporate_venture_capital | family_office | institutional_angel_network | accelerator | venture_studio | other | not_investor | unknown.
   - lead_follow: lead if the page says the firm leads rounds or writes the first check; follow if it says it co-invests only; both if both; else unknown.
   - check_range_usd: only with an explicit amount; convert k/M; otherwise nulls.
   - active_status: inactive only if the page says the firm stopped investing; otherwise "unknown" (activity is computed elsewhere).
   - published_on: a date literally printed for the page/news item (YYYY-MM-DD), else null.
4. official_domain: the firm's own web domain. If the page URL host belongs to the firm itself, use that host. Otherwise only a domain literally printed on the page; else null.
5. Never invent. Never use a page title, list heading, "null" or "unknown" as canonical_name for an institutional_investor.
```

* **Contenido de `user.md` (literal):**

```
As of {{today}}. URL: {{url}}
<page_data>{{page_text}}</page_data>
```

* **`external.mjs`, función `createLiveInvestorDeps().extract`:** `schemaName = config.extraction_schema ?? 'investor_extraction'`. v4 usa `'investor_extraction.v2'`. `maxTokens` pasa de 8000 a `config.extractor_max_tokens ?? 8000` (v4: 3000).
* **`external.mjs`, función `repairKnownShape`:** aplicar la reparación de `canonical_url` también a `schemaName === 'investor_extraction.v2'`.
* **Prueba de aceptación (FIX-02.T):** solo en los casos de depuración D1–D3 (§5.2), con 30 páginas de firma de su primera corrida. Una persona marca a mano qué campos dice cada página; se pide (no se exige a ciegas):
  * `stages` no vacío en ≥ 70 % de las páginas que lo dicen.
  * `sectors` no vacío en ≥ 70 %.
  * `geographies` no vacío en ≥ 60 %.
  * `quote` no nulo en ≥ 90 % de las páginas `institutional_investor`.
  * **0** valores sin su `evidence.<campo>` literal.
* **Riesgo:** más tokens por extracción. Media actual 2,15k; estimado 2,8k.
* **Métrica:** se espera que `unknown_rate` de criterios pase de 1,00 a ≤ 0,65.

### FIX-03 — Anclaje determinista por campo (más estricto, no más laxo)

* **Archivo:** `research/bench/investors/extractor.mjs`.
* **Función nueva** `groundFieldsV2({ document, extraction })`, llamada desde `extractFixtureInvestorV2` (también nueva).
* **Cambio, en pseudocódigo exacto:**

```
text = normalized(document.text).toLowerCase()
lit(s) = s != null && normalized(s).length >= 3 && text.includes(normalized(s).toLowerCase())
for f in [sectors, stages, rounds, geographies, regulatory_restrictions, relevant_portfolio]:
    if !lit(extraction.evidence[f]): out[f] = []
    else: out[f] = out[f].filter(v => normalized(extraction.evidence[f]).toLowerCase().includes(normalized(v).toLowerCase()) || lit(v))
for f in [investor_type, lead_follow]: if !lit(extraction.evidence[f]): out[f] = 'unknown'
if !lit(extraction.evidence.check_range_usd): out.check_range_usd = {min:null,max:null,source_url:null}
else: out.check_range_usd.source_url = document.url
if !lit(extraction.evidence.business_models): out.business_models = {accepted:[], excluded:[]}
if out.active_status === 'inactive' && !lit(extraction.evidence.active_status): out.active_status = 'unknown'
if out.active_status !== 'inactive': out.active_status = 'unknown'   // FIX-09 la calcula
if !(out.published_on && lit(extraction.evidence.published_on)): out.published_on = null
out.field_evidence = { f: extraction.evidence[f] for f with value kept }   // se guarda en sources[0].field_evidence
```

* **Entidad:** `extractFixtureInvestorV2` construye la entidad igual que `extractFixtureInvestor` (`:55-73`) y añade `sources[0].field_evidence`. Requiere una propiedad opcional `field_evidence` (objeto de strings) en un **nuevo** `investor_entity.v2.schema.json`, copia de v1 más esa propiedad. No editar v1.
* **Prueba:**
  * Texto sintético `"Zentro Capital is a venture capital firm investing in seed-stage climate startups in Chile and Peru."` con `evidence.stages = "seed-stage climate startups"`, `stages=["seed"]`: se conserva `["seed"]`.
  * Con `evidence.stages = "Series C"` (no está en el texto): `stages=[]`.
  * Con `geographies=["Argentina"]` y la evidencia literal "in Chile and Peru": `[]`.
* **Riesgo:** el modelo puede parafrasear la evidencia, y se pierde el campo. Se mide con FIX-13 (`fields_dropped_by_grounding`).
* **Métrica:** 100 % de los criterios no `unknown` con cita literal verificable. Es un guardarraíl, no una mejora de recall.

### FIX-04 — Gate de identidad e inversión v2

* **Archivo:** `extractor.mjs`.
* **Función nueva** `investorExtractionRejectionV2`. La v1 queda intacta y se usa con config v1–v3.
* **Cambios respecto a `:34-53`:**
  1. **`quote`:** se usa la del modelo si es literal. Si no, el *fallback* busca en la **ventana de 2 oraciones consecutivas** (no solo una) que contenga el nombre o un alias y `INVESTMENT_EVIDENCE_V2`.
  2. **`INVESTMENT_EVIDENCE_V2`:** `INVESTMENT_EVIDENCE` (`:6`) en OR con:

     ```
     /\b(?:invest(?:s|ed|ing)?|back(?:s|ed|ing)?|fund(?:s|ed|ing)?|lead(?:s|ing)?|co-?lead(?:s)?|writ(?:e|es|ing) (?:the )?(?:first )?(?:check|cheque|ticket)s?)\b[^.]{0,120}\b(?:pre-?seed|seed|series [a-e]|early[- ]stage|growth[- ]stage|start-?ups?|founders?|companies|businesses|entrepreneurs|ventures|rounds?)\b/i
     /\b(?:venture (?:fund|firm|investor|arm)|vc (?:firm|fund)|seed fund|investment (?:firm|company|manager)|fund manager|asset manager)\b/i
     ```
  3. **Inferencia de dominio oficial:** `nameMatchesDomain` se evalúa sobre `[canonical_name, ...aliases]`. Basta una coincidencia, con la condición `source_kind ∈ {official, news}` **y** host de la página = host de la URL. Una nota de prensa en el dominio propio de la firma es de primera parte (caso Ventures Platform).
  4. **`unresolved_firm_identity`:** en lugar de descartar, devuelve `{ rejected_kind: 'unresolved_firm_identity', candidate: {name, quote, domain_on_page} }` para FIX-05. Se sigue contando como rechazo.
  5. **`missing_identity` y `collection_page` con `candidates.length > 0`:** devuelve `{ rejected_kind, candidates }` para FIX-05.
* **Pruebas adversariales:** fixtures sintéticos; nombres inventados.
  * **a)** `"Acme Robotics raised $5M led by Northwind Ventures."` en `acmerobotics.com`, con `canonical_name` "Acme Robotics": rechazo (`identity_not_in_quote` o `no_investment_evidence`). Acme no invierte.
  * **b)** La misma frase con `canonical_name` "Northwind Ventures": rechazo `unresolved_firm_identity`, que produce candidato.
  * **c)** `"Top 20 seed funds in Peru"`: `collection_page`, `candidates` conservados.
  * **d)** `"Kestrel Fund backs founders from day one at pre-seed."` en `kestrelfund.com` (oficial): **aceptado** con `official_domain=kestrelfund.com`.
  * **e)** `"SEAFX (South East Asia Fintech Exchange Facility) invests in innovative early-stage projects."` en `seafx.org`, alias `SEAFX`: aceptado vía alias.
  * **f)** Las 3 pruebas adversariales existentes de la corrección v2 (Sequoia sin evidencia, WHO/EIB, nombres null) siguen pasando con V2.
* **Riesgo:** falsos positivos de identidad. Control: precisión de identidad ≥ 0,95 en la re-ejecución (era 1,00).
* **Métrica:** `missing_literal_quote` de 1.888 a ≤ 900 (estimado); `rejected_non_investors/fetches` de 0,887 a ≤ 0,75.

### FIX-05 — Candidatos y resolución de identidad (de "una firma por página" a "pista → verificación")

* **Archivo nuevo:** `research/bench/investors/resolve.mjs`. Se integra en `engine.mjs`.
* **Cambio en `engine.mjs`, función `runInvestorDiscovery`:**
  1. Nueva cola `candidates` de elementos `{name, quote, domain_on_page, source_url, query_id}`, deduplicada por `normalized(name).toLowerCase()`.
  2. Tras cada `runQuery`, si `config.resolution?.enabled` y quedan presupuestos, se resuelven hasta `config.resolution.per_query` candidatos (v4: 2) con `resolveCandidate`:
     * Si `domain_on_page` existe, `deps.fetch('https://' + domain_on_page)`.
     * Si no, `deps.search('"' + name + '" ' + config.resolution.suffix)` (v4: `suffix = "venture capital"`), que cuenta como búsqueda. Se toma el **primer** resultado cuyo host cumpla `nameMatchesDomain(name, host)` y se hace fetch.
     * Se extrae con el mismo extractor y gate V2. Solo se acepta si el resultado es de primera parte (`officialFirstParty`).
     * `firstSeen.origin = 'resolution'`.
  3. **Presupuesto:** la resolución consume las mismas `budgets.searches` y `budgets.fetches` (sin presupuesto extra), con tope `config.resolution.max_per_run` (v4: 6). Igual para B0, B1 y B2.
  4. **Eventos:** `resolution_start`/`resolution_end` con `{name, outcome: accepted|no_domain|rejected:<kind>}`.
* **Prueba:**
  * Con dependencias simuladas, una página con `candidates=[{name:'Northwind Ventures',…}]` y una búsqueda que devuelve `https://northwind.vc/` cuyo texto pasa el gate produce una entidad con `stable_id inv:domain:northwind.vc` y `first_seen.origin='resolution'`.
  * Con presupuesto de búsquedas agotado: 0 resoluciones y `stop_reason` sin cambio.
* **Riesgo:** consume presupuesto que antes iba a consultas del planner. Es idéntico entre condiciones, así que la comparación B1/B2 no se sesga. Puede bajar el recall si `max_per_run` es alto: tope 6.
* **Métrica:** +0,03 a +0,08 en recall@20 de B2 (cota superior +0,11, §1.B). Reportar recall por `origin`.

### FIX-06 — Normalización del juez (tipos, etapas, geografía, lead)

* **Archivos nuevos:**
  * `docs/contracts/investor/vocab/normalization.v1.json`
  * `research/bench/investors/normalize.mjs`
* **Función nueva:** `judgeInvestorV2` en `judge.mjs`. **No modificar** `judgeInvestor` (`:6-45`).
* **`normalization.v1.json` (contenido mínimo obligatorio):**

```json
{
 "investor_type_map": {
  "generalist_vc": ["venture_capital"], "specialist_vc": ["venture_capital"], "climate_vc": ["venture_capital"],
  "hardtech_vc": ["venture_capital"], "growth_investor": ["venture_capital","other"],
  "impact_investor": ["venture_capital","family_office","other"], "institutional family office": ["family_office"],
  "strategic energy corporates": ["corporate_venture_capital"], "strategic diagnostics corporate": ["corporate_venture_capital"],
  "healthcare services investor": ["venture_capital","other"], "healthcare or agrifood specialist": ["venture_capital","other"]
 },
 "stage_ordinal": { "pre-seed": [0], "seed": [1], "series_a": [2], "series_b": [3], "series_c": [4] },
 "stage_patterns": [
  ["\\bpre-?series[ -]?a\\b", [0,1], "explicit"], ["\\bpre-?seed\\b", [0], "explicit"], ["\\bseed\\b", [1], "explicit"],
  ["\\bseries[ -]?a\\b", [2], "explicit"], ["\\bseries[ -]?b\\b", [3], "explicit"], ["\\bseries[ -]?[c-e]\\b", [4], "explicit"],
  ["\\bearly[- ]stage\\b", [0,1,2], "vague"], ["\\b(?:growth|scale-?up|late)[- ]?(?:stage)?\\b", [3,4], "vague"]
 ],
 "geo_regions": {
  "Latin America": ["Mexico","Brazil","Colombia","Chile","Peru","Argentina"], "Spanish-speaking Latin America": ["Mexico","Colombia","Chile","Peru","Argentina"],
  "North America": ["United States","Canada","Mexico"], "Europe": ["Netherlands","Germany","Belgium","Austria","Switzerland","Sweden","Finland","Poland"],
  "DACH": ["Germany","Austria","Switzerland"], "Benelux": ["Netherlands","Belgium"], "Nordics": ["Sweden","Finland","Norway","Denmark"],
  "Africa": ["Kenya","Uganda","Tanzania","Nigeria","Equatorial Guinea","South Africa","Egypt"], "East Africa": ["Kenya","Uganda","Tanzania"],
  "West Africa": ["Nigeria"], "Southeast Asia": ["Singapore","Vietnam","Philippines","Malaysia","Indonesia"],
  "South Asia": ["India"], "Asia": ["India","Singapore","Vietnam","Philippines","Malaysia","Indonesia","Taiwan","South Korea"],
  "Central Asia": ["Turkmenistan"], "Pacific Islands": ["Palau"], "Oceania": ["Palau"]
 },
 "geo_unknown_terms": ["global","worldwide","emerging markets","international"],
 "lead_map": { "seeking lead": "lead", "lead": "lead", "follow": "follow", "either": "both" }
}
```

  La tabla cubre los países y regiones de los 15 perfiles **y** de D1–D3 (Chile, Perú, Suecia, Finlandia, Nauru). Para D3 se añade `"Nauru"` a `"Pacific Islands"` y `"Oceania"`.

* **`normalize.mjs`** exporta:
  * `typeState(profileTypes, entityType)`:
    * `entityType === 'unknown'` → `unknown`.
    * `allowed = ∪ map[t]` sobre los tipos del perfil **mapeados**. Si algún tipo del perfil no está en el mapa, `unmapped=true`.
    * `entityType ∈ allowed` → `met`.
    * Si no, `unmapped` → `unknown`.
    * Si no, `not_met`.
  * `stageState(profileStage, entityStages)`:
    * `p = stage_ordinal[profileStage]`.
    * Por cada string de la entidad se aplican **todos** los patrones que casen. `explicit` es la unión de los ordinales de patrones `explicit`; `vague` lo mismo con los `vague`.
    * `p ∩ (explicit ∪ vague) ≠ ∅` → `met`.
    * Si no, `explicit ≠ ∅` → `not_met`.
    * Si no, `unknown`. Lo vago nunca produce `not_met`.
  * `geoState(profileCountries, entityGeos)`, con `profileCountries = unique(incorporation_country ∪ operating_regions ∪ target_markets)`:
    * Para cada string de la entidad, en minúsculas:
      * Si contiene un término de `geo_unknown_terms` → `vague`.
      * Si es un nombre de `geo_regions` (comparación sin mayúsculas) → expande a sus países.
      * Si no, se trata como país literal.
    * Algún país del perfil ∈ expandidos → `met`.
    * Si no, `expandidos ≠ ∅` y ningún string fue `vague` → `not_met`.
    * Si no, `unknown`.
  * `leadState(pref, entityLead)`: `pref` se normaliza con `lead_map`; si `pref == null` → `not_applicable`.
* **`judgeInvestorV2`:** mismo cuerpo que `judgeInvestor` salvo las líneas 11, 16, 18 y 25, que se sustituyen por `typeState`, `stageState(f.funding_stage.value, entity.stages)`, `geoState` y `leadState`; además usa el sector de FIX-08, la relevancia de FIX-07 y la actividad de FIX-09.
* **Pruebas (sintéticas):**
  * `typeState(['generalist_vc'],'venture_capital')='met'`; `typeState(['generalist_vc'],'accelerator')='not_met'`; `typeState(['foo_investor'],'accelerator')='unknown'`.
  * `stageState('series_b',['Series B'])='met'`; `stageState('pre-seed',['pre-Series A'])='met'`; `stageState('series_b',['early-stage'])='unknown'`; `stageState('series_b',['Seed and Series A Only'])='not_met'`.
  * `geoState(['Mexico'],['Spanish-speaking Latin America'])='met'`; `geoState(['Palau'],['North America'])='not_met'`; `geoState(['Palau'],['global'])='unknown'`.
  * `leadState('seeking lead','lead')='met'`.
* **Riesgo:**
  * La tabla de regiones es un juicio. Se versiona (`normalization.v1`) y cualquier cambio exige `v2` y config nueva.
  * `global → unknown` puede dejar fuera fondos globales legítimos (pierde gain 2 a cambio de no generar falsos positivos en nulos).
* **Métrica:** criterios `met|not_met` en INV-TYPE, INV-STAGE e INV-GEO ≥ 60 % de las firmas aceptadas (§5).

### FIX-07 — `overall_relevance` alineada con el protocolo congelado

* **Archivo:** `judge.mjs`, dentro de `judgeInvestorV2`. **No tocar** `ranking.mjs` (función de gain).
* **Cambio:** sustituir la expresión de `:43` por:

```
core = {sector: sector_fit, stage, geo}
if (hard_eligibility === 'ineligible' || sector_fit === 'off') overall = 'irrelevant'
else if (active === 'met' && sector_fit === 'on' && stage === 'met' && geo === 'met' && hard_eligibility === 'eligible') overall = 'strong'
else if (['on','partial'].includes(sector_fit) && (stage === 'met' || geo === 'met')) overall = 'plausible'
else overall = 'weak'
```

  Justificación: `LABELING_GUIDE.md:32` y `PROTOCOL.md:48-49`. "Plausible" exige evidencia positiva de sector y de al menos una dimensión dura (etapa o geografía), sin ningún *hard* `not_met` (eso ya lo impone `ranking.mjs:3-5`). La cuenta global de unknown castigaba criterios que casi ninguna página publica (CHECK, ROUND, BUSINESS-MODEL, REGULATORY).
* **Aprobación humana obligatoria** antes de la re-ejecución: es la operacionalización de una definición del protocolo. Se registra en `DECISIONS_PENDING.md` (añadir entrada, no editar las existentes).
* **Pruebas:**
  * sector `on`, stage `met`, geo `unknown`, sin *hard* `not_met`, actividad `possibly_active` → `plausible` y gain 2.
  * sector `on`, stage `unknown`, geo `unknown` → `weak` y gain 1.
  * geo `not_met` → `ineligible`, `irrelevant` y gain 0.
* **Riesgo:** más falsos positivos duros. Control: `hard_false_positive_rate` (según etiqueta) ≤ 0,10 en top-10 y nulos sin gain≥2.
* **Métrica:** habilita gain≥2.

### FIX-08 — `sector_fit` con LLM y guarda literal

* **Archivos nuevos:** `prompts/investor/judge/v2/system.md` y `user.md`. Función `sectorFitLLM` en `external.mjs`.
* **Cuándo se llama:** después de discovery, una llamada por entidad aceptada (tope `config.judge.max_llm_calls`, v4: 20). **Nunca** alimenta al planner (`PROTOCOL.md` §Condiciones).
* **Contrato de salida:** schema nuevo `investor_sector_fit.v1.schema.json`: `{ "sector_fit": "on|partial|off|unknown", "quote": string|null }`, ambos obligatorios.
* **`system.md` (literal):**

```
Decide whether an investment firm's stated sector focus covers a startup's sector. Use ONLY the firm quotes provided. on = the firm's stated focus explicitly includes the startup's sector or subsector; partial = a broader or adjacent stated focus that plausibly includes it (e.g. "technology", "climate"); off = the firm states an exclusive focus that excludes it; unknown = no sector statement. Copy the decisive firm quote verbatim into "quote" (null for unknown). Return JSON.
```

* **`user.md`:** `Startup sector: {{sector}}; subsectors: {{subsectors}}\nFirm quotes:\n{{quotes}}`. `quotes` es la unión de `sources[*].quote` y `field_evidence.sectors`, con un máximo de 1.500 caracteres.
* **Guarda determinista** (función `guardSectorFit`):
  * Si `quote` no es substring literal de `quotes` → `unknown`.
  * Si `sector_fit==='off'` y `quote` no casa con `/\b(only|exclusively|solely|dedicated to|focused (?:solely|exclusively))\b/i` → `unknown`.
  * Si el *match* determinista de `judge.mjs:12` es `on` → `on`, sin llamar al LLM.
* **Pruebas:** con un *stub* de LLM:
  * respuesta `off` sin "only" → `unknown`;
  * cita inventada → `unknown`;
  * coincidencia exacta "Fintech" → `on`, sin llamada.
* **Riesgo:** dependencia del modelo. Temperatura 0 y caché por clave (como `external.mjs:29`).
* **Métrica:** `sector_fit ≠ unknown` en ≥ 70 % de las aceptadas.

### FIX-09 — Actividad derivada (`classifyActivity` cableada)

* **Archivo:** `engine.mjs`. Antes de `judgeInvestorV2`, para cada entidad:

```
officialThesis = entity.sources.some(s => s.source_kind === 'official' && s.quote && INVESTMENT_EVIDENCE_V2.test(s.quote))
recent = entity.sources.filter(s => s.published_on).map(s => ({source_kind: s.source_kind === 'news' && sameDomain(host(s.url), entity.official_domain) ? 'official' : s.source_kind, published_on: s.published_on}))
entity.active_status = classifyActivity({ explicitInactive: entity.active_status === 'inactive', currentOfficialThesis: officialThesis, recentEvidence: recent, asOf: config.today, recencyDays: config.activity.recency_days })
if (recent.some(...official within window)) entity.recent_investment_evidence = those sources
```

* **Config v4:** `"activity": { "recency_days": 540 }`. El valor es una decisión: debe aprobarse y congelarse.
* **Pruebas:**
  * fuente oficial con tesis y sin fecha → `possibly_active`;
  * nota de prensa propia de hace 100 días → `active`;
  * "no longer making new investments" con evidencia → `inactive`.
* **Riesgo:** sobreestimar `possibly_active` en firmas cerradas que mantienen la web. La guía (`LABELING_GUIDE.md` §Actividad) lo admite como `possibly_active`.
* **Métrica:** activity accuracy de 0,17–0,24 a ≥ 0,45 (el 55 % de las etiquetas es `possibly_active`).

### FIX-10 — Paciencia, deduplicación y triage de SERP

* **Archivo:** `engine.mjs`, función `runQuery` y el bloque de parada. Todo bajo `config.engine_v ≥ 2`.
* **Cambios:**
  1. **Paciencia solo en B2** (`PROTOCOL.md:34-36`). B0 y B1 ejecutan todas sus consultas hasta presupuesto.
  2. **`noNew` cuenta solo consultas "leídas":** al menos un fetch con `text.length ≥ 200`, extraído. Las consultas cuyos fetches fueron todos vacíos o denegados no incrementan `noNew`.
  3. **Deduplicación por URL dentro de la corrida:** `seenUrls` sobre `canonicalInvestorUrl(url)`. No se vuelve a hacer fetch ni a contar.
  4. **Caché negativa por host en la corrida:** host con `FETCH_EMPTY` dos veces → se salta.
  5. **Denylist de fetch** (`config.fetch_denylist`, v4): `["pitchbook.com","app.dealroom.co","f4.fund","fundraisingfox.com","foundersuite.com","pipeseed.com","crunchbase.com"]`. Medido: 100 % vacíos en v3, salvo crunchbase, que se añade por ser agregador de pago. Estas URLs **no** se cuentan como fetch.
  6. **Triage:** de los `results_per_query` (10), se ordena así:
     * (i) host no visto en la corrida;
     * (ii) título u host casa `/\b(ventures?|capital|partners|fund|vc|investments?)\b|\.vc$/i`;
     * (iii) posición original.

     Se abren los `default_fetch_per_search` primeros (v4: 4) que no estén deduplicados ni denegados.
* **Pruebas:** con dependencias simuladas:
  * B1 con 18 consultas sin entidades: `searches === 18` y `stop_reason ∈ {budget_searches, queries_exhausted}` (nunca `patience`).
  * B2 con 5 consultas de fetches vacíos: no para por paciencia.
  * La misma URL en dos consultas genera 1 fetch.
  * Un resultado de firma en la posición 7 con 3 agregadores delante se abre.
* **Riesgo:** B1 gasta más presupuesto (de 9,6 a 18 búsquedas), así que su recall sube y **B2−B1 puede seguir sin diferencia**. Es lo correcto según el protocolo.
* **Métrica:** recall@20 B1 y B2 +0,05 a +0,12 cada uno (estimación; no verificable sin gasto).

### FIX-11 — Lector: preflight obligatorio

* **Archivos:** `preflight-chain.mjs` (ampliar) y `fetch.mjs`.
* **Cambio en `fetch.mjs`:** no se toca la lógica, solo se añade `error.code` al evento. El preflight v4:
  * Exige `CRAWL4AI_URL` respondiendo **o** que Jina devuelva ≥ 400 caracteres en 3 de 3 URLs de prueba **de los casos D1–D3** (sitios renderizados con JavaScript elegidos por la persona que crea D1–D3).
  * Si no se cumple → aborta con `READER_UNAVAILABLE`.
  * Registra en `preflight.json` la tasa de `FETCH_EMPTY` sobre 20 URLs de D1–D3: debe ser ≤ 0,10.
* **Prueba:** sin las variables del lector, `preflight-chain` sale con código 1 y `READER_UNAVAILABLE`.
* **Riesgo:** dependencia operativa (Crawl4AI).
* **Métrica:** `FETCH_EMPTY` de 22,5 % a ≤ 10 %.

### FIX-12 — Planner v2: estado informativo, sin paráfrasis y candidatos por nombre

* **Archivos nuevos:** `prompts/investor/planner/v2/system.md` y `user.md`.
* **Cambios en `engine.mjs:41,49`:** el estado adaptativo pasa a ser:

```
{ queries:[{q, results, fetched, accepted, rejected_by_kind}], hosts_seen:[...≤60], entities:[{name, sectors, stages, geographies, origin}],
  unresolved_candidates:[names ≤20], coverage:{sector:bool, subsector:bool, geography:bool, stage:bool, comparables:bool, funding_news:bool} }
```

  `coverage` es determinista: es `true` si alguna consulta ejecutada contiene el valor del perfil en minúsculas (para `funding_news`, el regex `/rais|round|led by|funding/`).
* **`conditions.mjs`, función `validatePlannerBatch`:** añadir rechazo `near_duplicate` si la similitud de Jaccard de tokens (≥ 3 letras, sin *stopwords* en inglés) con alguna consulta vista es ≥ 0,7. Se aplica a B1 y a B2 por igual.
* **Schema del planner** (nuevo `investor_planner_output.v2`): añade `candidate_firms: [{name, why}]` (≤ 6 por llamada) cuando `config.planner.allow_candidate_names`. Cada candidato entra a la cola de FIX-05 con `origin='planner_candidate'` y **solo cuenta si se verifica** en el sitio oficial.
* **`planner v2 system.md` (literal):**

```
You plan web searches to find institutional investment firms for a frozen startup profile. Prefer query types that surface firm pages or funding news: (1) "<subsector> <stage> fund <country/region>", (2) "investors in <comparable company>", (3) "<subsector> startup raises <stage> <country> led by", (4) firm-type + geography. Never repeat or paraphrase a query in the state. In adaptive_step use coverage, per-query yield and rejection kinds to choose uncovered dimensions; stop=true when two consecutive steps would only repeat covered dimensions. You may list up to 6 candidate_firms you believe match; they will be verified on official pages and are worthless if wrong. Never suggest individuals or contact data.
```

* **Pruebas:**
  * `validatePlannerBatch` rechaza `"government backed funds fintech payments Mexico seed stage"` frente a `"government-backed funds fintech and payments Mexico"` como `near_duplicate`.
  * El estado contiene `coverage.comparables=false` si ninguna consulta menciona `comparable_companies`.
* **Riesgo:**
  * **Contaminación:** los candidatos por nombre miden memoria del modelo; las anclas son firmas conocidas. Se reporta recall por `origin` y recall excluyendo `planner_candidate`.
  * El *flag* aplica por igual a B1 y B2.
* **Métrica:** B2−B1 recall ≥ +0,05 (la regla congelada). No se promete.

### FIX-13 — Observabilidad (aplicar primero tras FIX-00)

* **Archivos:** `run-experiment.mjs`, función `tracedDeps.extract`; `engine.mjs`.
* **Cambios:**
  * `extract_end` añade:
    * `kind`: `entity_kind` del modelo;
    * `fields_present`: lista de claves no nulas o no vacías antes del anclaje;
    * `fields_kept`: después del anclaje;
    * `quote_source`: `model|fallback|none`;
    * `candidates`: número de candidatos;
    * `official_domain_source`: `model|host_match|alias_match|none`.
  * `search_end` añade `urls` (lista ordenada) y `opened` (índices).
  * `result.json` añade `abstention_reason`:
    * `no_candidates`: 0 entidades;
    * `all_hard_not_met`: todas `ineligible` o `irrelevant`;
    * `insufficient_evidence`: el resto de abstenciones;
    * `null`: no se abstiene.

  Este cambio requiere un nuevo `investor_run_result.v2.schema.json` (copia de v1 más esas propiedades).
* **Prueba:** una corrida simulada genera los campos con tipos correctos y el schema v2 valida.
* **Riesgo:** tamaño de `events.jsonl` (+30 %).
* **Métrica:** habilita la verificación de §5.

### FIX-14 — Config v4 y versionado

* **Archivo nuevo:** `research/bench/investors/config/v4-<YYYY-MM-DD>.json`. Es una copia de v3 con:

```json
"bench_id": "investors-internal-<fecha>-v4",
"engine_v": 2, "judge_impl": "v2", "extraction_schema": "investor_extraction.v2", "extractor_max_tokens": 3000,
"prompts": { "manifest": "manifest.v4.json", "b0_templates": "v1", "planner": "v2", "extractor": "v3", "judge": "v2", "preannotator": "v1" },
"default_fetch_per_search": 4,
"patience_n": 5, "patience_conditions": ["B2"],
"resolution": { "enabled": true, "per_query": 2, "max_per_run": 6, "suffix": "venture capital" },
"planner": { "allow_candidate_names": true },
"judge": { "max_llm_calls": 20 },
"activity": { "recency_days": 540 },
"normalization": "normalization.v1",
"fetch_denylist": ["pitchbook.com","app.dealroom.co","f4.fund","fundraisingfox.com","foundersuite.com","pipeseed.com","crunchbase.com"],
"capital_strategy_context": false
```

  Budgets idénticos a v3 (18/54/8/300000/1800); `decision_rule` idéntica.
* **`cli.mjs`, `validateInvestorWorkspace`:** aceptar `investor_run_config` con las claves nuevas. Requiere `investor_run_config.v2.schema.json` nuevo.
* **Prueba:** config v3 → `engine_v` ausente → código v1 (FIX-00.T2 sigue en verde); config v4 valida.

### FIX-15 — Métricas adicionales (solo reporte; la regla no cambia)

* **Archivo:** `metrics.mjs`. Funciones nuevas; no modificar las existentes.
* **Métricas por corrida:**
  * `criteria_known_rate`: fracción de entidades con INV-SECTOR, INV-STAGE, INV-GEO e INV-TYPE ≠ `unknown`;
  * `any_core_known_rate`;
  * `system_gain2_count`;
  * `gain2_label_agreement`: de los ítems con gain de sistema ≥ 2, fracción con gain de etiqueta ≥ 2;
  * recall@20 por `origin`;
  * `abstention_reason`.
* **En el informe:** si `hard_false_positive_rate === null`, imprimir `no_evaluable`. `decide.mjs` no se toca.

### FIX-16 — (Diferido) `capital_strategy_context` como ablación B2+CSC

No forma parte de la re-ejecución mínima. Solo después de cumplir §5:

* **Adaptador** `profileToBrief(profile)`: `industry=sector`, `product`, `problem=description`, `stage=funding_stage`, `geography=operating_regions.join`, `businessModel`, `fundingTypes=[round_sought]`, `amount`.
* Las consultas de las rutas se reescriben como palabras clave: `<segment> <stage> fund <geography>`, sin preguntas ni truncamiento.
* Se excluye `official_grants`.
* Las consultas entran como `origin='csc'` dentro del mismo presupuesto.
* Se compara contra B2 de igual semilla. Requiere etiquetar las firmas nuevas.

---

## 3. Orden de aplicación y dependencias

```
FIX-00 (port + regresión)
  └─ FIX-13 (observabilidad)            ← primero, para medir todo lo demás
      ├─ FIX-01 → FIX-02 → FIX-03 → FIX-04      (extractor)
      │                              └─ FIX-05 (resolución; depende de FIX-04 candidatos)
      ├─ FIX-06 → FIX-07 → FIX-08 → FIX-09      (juez; FIX-08 depende de FIX-03 field_evidence)
      ├─ FIX-10 (motor)   FIX-11 (lector)
      └─ FIX-12 (planner; depende de FIX-05 para candidate_firms y de FIX-13 para el estado)
  └─ FIX-14 (config v4)  → FIX-15 (métricas)
  └─ Smoke D1–D3 (§5.2) → aprobación humana de FIX-06 tablas, FIX-07, FIX-09 recency_days → re-ejecución §5
```

Restricciones:

* FIX-01…04 y FIX-06…09 deben entrar **juntos** en v4. Solo el extractor convierte gain 1 en 0 (§1.A'); solo el juez no cambia nada.
* FIX-10 y FIX-12 se pueden evaluar por separado: los *flags* `patience_conditions` y `planner.allow_candidate_names` permiten ablaciones sin cambiar código.

## 4. Lo que NO se debe cambiar y cómo versionar

**Inmutables (sin edición, ni un byte):**

* `config/v0.json`, `v1-…`, `v2-2026-10-08.json` (sha `997115…`), `v3-2026-10-08.json` (sha `b6afc7…`) y `b3-extension-2026-10-08.json`.
* `prompts/investor/manifest.json` y todos los prompts existentes: `b0/v1`, `planner/v1`, `extractor/v1`, `extractor/v2`, `judge/v1`, `preannotator/v1`.
* Casos y perfiles del gold: `cases/*.json`, `cases/profiles/*.json`, `cases/manifest.json` y sus sha (`profile_sha256`).
* Etiquetas: `labels/adjudicator.jsonl` (sha `eaa34f…`), `labeling/`, `pool/` de v3 y todo `out/investors-internal-2026-10-08-v3/`.
* Regla de decisión: `decide.mjs`, `decision_rule` de cualquier config, `DECISIONS_PENDING.md` (solo se **añade** una entrada nueva para FIX-07/FIX-09/normalización).
* Función de gain: `ranking.mjs` (`investorGain`, `rankInvestors`).
* `criteria_catalog.investor.v1.json` y los schemas `*.schema.json` existentes. Los nuevos llevan sufijo `.v2`.
* Funciones v1 del motor (`judgeInvestor`, `extractFixtureInvestor`, `investorExtractionRejection`, `groundInvestorExtraction`): las nuevas viven al lado con sufijo `V2`.
* `research/capital/**` (FIX-16 diferido).

**Versionado:**

* Todo cambio de comportamiento se selecciona desde **config v4** (`engine_v`, `judge_impl`, `extraction_schema`, `prompts.manifest`).
* `fingerprint.json` de v4 registra los sha256 de:
  * config v4, `manifest.v4.json` y cada prompt nuevo;
  * `normalization.v1.json`;
  * `extractor.mjs`, `judge.mjs`, `engine.mjs`, `normalize.mjs` y `resolve.mjs`;
  * `events.jsonl`, `labels` y `metrics_report.json`.
* Todo ajuste posterior a la aprobación crea **v5**. Nunca se edita v4 después de la primera corrida formal.
* Salida en `out/investors-internal-<fecha>-v4/`.

## 5. Plan de re-ejecución mínimo

### 5.1 Alcance y presupuesto

* **Condiciones:** B1 y B2. B0 y B3 no corren: B0 no cambia de política y B3 es una ablación aparte.
* **Casos:** los 12 positivos (p01–p12) **más los 3 nulos** (n04, r13, r14). Sin los nulos no se verifica el criterio de abstención.
* **Semillas:** 101, 202 y 303.
* **Corridas:** 15 × 2 × 3 = **90**, con *budgets* por corrida idénticos a v3.

**Topes y estimaciones:**

| Recurso | Tope duro (config) | Estimado | Base de la estimación |
|---|---|---|---|
| Búsquedas | 90 × 18 = 1.620 | ≈ 1.500 | B1 sin paciencia usa ≈ 18 |
| Fetches | 90 × 54 = 4.860 | ≈ 4.000 | — |
| Tokens nominales | 90 × 300k | ≈ 9–12 M | 2,8k por extracción, 2,3k por planner, ≤ 20 llamadas de juez |
| Apollo | 0 créditos | — | — |
| Etiquetado de firmas nuevas del pool | — | 100–200 firmas | Mismo protocolo de adjudicación ciega; mismo modelo adjudicador **declarado** |

Costo monetario: no disponible (cuotas de Exa/Serper/Tavily y de la flota no expuestas; igual que v3).

### 5.2 Depuración fuera del gold (antes de gastar en §5.1)

Tres casos nuevos, construidos por una persona o contexto **que no haya visto inversores**, con perfil congelado antes de buscar y protocolo idéntico (`PROTOCOL.md` §Construcción):

| Id | Perfil | Tipo |
|---|---|---|
| D1 | Edtech B2B para colegios privados en Chile y Perú, seed USD 1,5M, SaaS por alumno | Positivo esperado |
| D2 | Foodtech de proteína fermentada en Suecia y Finlandia, Serie A EUR 8M, B2B ingredientes | Positivo esperado |
| D3 | Planta de reciclaje de fosfatos en Nauru, Serie A USD 20M, venta de fertilizante | Nulo: búsqueda manual de 20 min sin gain ≥ 2 |

Uso:

* Fixtures de FIX-02.T, preflight del lector de FIX-11 y smoke de B1/B2, con 1 semilla: 6 corridas.
* Se permite iterar código **solo** con D1–D3.
* Si D1–D3 pasan los criterios de §5.3 escalados, se congela v4 y se corre §5.1 **una sola vez**.

### 5.3 Criterios de éxito (se evalúan una vez, con las etiquetas existentes más las nuevas)

1. **Criterios no `unknown`:**
   * INV-SECTOR, INV-STAGE, INV-GEO e INV-TYPE distintos de `unknown` a la vez en **≥ 60 %** de las firmas aceptadas;
   * al menos uno de ellos ≠ `unknown` en **≥ 85 %**;
   * **100 %** de los criterios no `unknown` con cita literal verificable en `field_evidence` o `quote`.
2. **gain ≥ 2 por caso positivo:**
   * En B2, **≥ 10/12** casos con al menos una recomendación de gain de sistema ≥ 2 en **al menos 2 de 3** semillas; objetivo 12/12.
   * Referencia: en v3, aun con un juez perfecto, el techo de descubrimiento era 9/12 en B2 y 10/12 en B1 (casos con algún positivo de etiqueta entre las entidades, en cualquier semilla).
   * B1 se reporta igual.
3. **Calidad de los gain ≥ 2:**
   * `gain2_label_agreement` ≥ 0,70;
   * `hard_false_positive_rate` (top-10, según etiqueta) ≤ 0,10. Ahora es evaluable; si sale `null`, se reporta como fallo.
4. **Nulos:**
   * 0 recomendaciones con gain ≥ 2 en las 18 corridas nulas;
   * `abstention_reason ∈ {no_candidates, all_hard_not_met}` en ≥ 80 % de ellas;
   * `insufficient_evidence` ≤ 20 %. Abstenerse por desconocimiento ya no cuenta como abstención válida.
5. **Discovery:**
   * `rejected_non_investors/fetches` ≤ 0,75;
   * `FETCH_EMPTY` ≤ 0,10;
   * precisión de identidad ≥ 0,95;
   * activity accuracy ≥ 0,45.
6. **Recall:** se reporta pooled_recall@20 de B1 y B2 con el pool ampliado.
   * No es criterio de éxito de la corrección. **Sí lo es de la regla congelada** (B2−B1 ≥ 0,05, p ≤ 0,05), que se aplica tal cual.
   * Expectativa, no promesa: ambos ≥ 0,30.

Si fallan 1, 2 o 4, **no** se ajustan umbrales con el gold: se diagnostica con D1–D3, se crea v5 y se repite.

## 6. Qué seguirá sin poder concluirse aunque se corrija todo

1. **Superioridad de B2 sobre B1.** Con 12 casos y 3 semillas, la dispersión entre semillas (≈ 0,11) es del orden del efecto buscado (0,05). Es probable que B2−B1 siga sin significancia, y FIX-10 fortalece a B1 a propósito.
2. **Recall absoluto.** pooled_recall es relativo a un pool construido con las salidas del sistema más 1 ancla por caso. El universo de inversores compatibles es desconocido. El sesgo de pool (§1.B) subestima las pérdidas del gate.
3. **Validez de las etiquetas.** Son de modelo (`model_adjudicated_internal`), sin humano, segundo revisor ni κ. Además, el adjudicador (Claude) es de la misma familia que el autor de este diagnóstico. Ninguna cifra es gold humano.
4. **Contribución de la memoria del modelo.** Con `allow_candidate_names`, parte del recall medirá lo que gpt-oss recuerda de firmas conocidas (incluidas posibles anclas), no la búsqueda. Se separa por `origin`, pero no se elimina.
5. **Tasa de abstención en nulos.** Tres nulos (seis con D3 y repeticiones) no estiman una tasa. Además, la búsqueda manual de 20 min que los define puede haber pasado por alto inversores reales.
6. **Paridad con Claude/GPT con búsqueda web.** No hay una condición de referencia "Claude/GPT con web" corrida con el mismo perfil, presupuesto y etiquetas. Sin ella, "alcanzar su calidad" no es medible. Se requeriría una condición B-ref con protocolo propio.
7. **Adyacencias.** `capital_strategy_context` seguirá sin medir (FIX-16 diferido) y, con este pool, su efecto no es observable en recall.
8. **Resultados de negocio.** gain ≥ 2 no predice inversión, respuesta ni reunión (`PROTOCOL.md` §Pool).
9. **Causa exacta del objeto mínimo de gpt-oss.** No verifiqué si el servidor vLLM aplicó *guided decoding* estricto o solo validó después. FIX-01/02 funcionan en ambos casos, pero el comportamiento con "todo obligatorio" se confirma solo en el smoke de D1–D3.
10. **Counterfactual de las consultas no ejecutadas.** Las ≈ 8 consultas por corrida B1 que la paciencia canceló no tienen SERP en caché. El efecto de FIX-10 es una estimación.

---

### Anexo — reproducción del diagnóstico (solo lectura)

* **Emparejamiento página → extracción:** para cada URL de `extract_end` se busca la página en caché (`kind='fetch'`, clave `normalizeUrl`) y se calcula `user = render(extractor_v1.user, {today, url, page_text: sanitizePageText(text).replaceAll('{{','{ {').replaceAll('}}','} }').slice(0,24000)})` y `key = sha256([prompt.sha256, sha256(user), 'investor_extraction', 0, 0].join('|'))`, que se busca en `kind='llm'`. Resultado: 1.740/1.740 aciertos.
* **Resultados de búsqueda:** `key = sha256(provider + '|10||' + query.trim().toLowerCase())` para `provider ∈ [exa, serper, tavily]`. Resultado: 1.422/1.422.
* **Corridas finales:** eventos posteriores al último `run_start` de cada `run_id` (hay 250 `run_start` por los 18 reintentos archivados). Totales: 4.233 fetches y 1.422 búsquedas, que cuadran con `REPORT.md` §6.
* **Counterfactual del juez:** `judgeInvestor` e `investorGain` del snapshot con entidades sintéticas (§1.A').
* **Capa CSC:** `buildCapitalStrategyContext(..., {plan:null})` sobre los 12 perfiles, sin red.
