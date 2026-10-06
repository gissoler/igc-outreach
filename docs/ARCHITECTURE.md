# Arquitectura — agente de búsqueda iterativo (v0)

Estado: **propuesta de diseño** (06/10/2026). La implementó Codex por tareas (`docs/handoff/`). Los contratos de `docs/contracts/` son la fuente de verdad: si este documento y un schema se contradicen, manda el schema y se abre una incidencia en lugar de elegir.

**Alcance honesto.** Esto es un *harness exploratorio para comparar búsqueda estática y adaptativa sobre oportunidades ancla conocidas*. No mide recall exhaustivo de grants elegibles, no valida el producto con usuarios y no reemplaza el pipeline de producción (`research/server/research/engine.mjs` y lo que lo rodea). Hoy cubre grants. El esquema ya está preparado para investors y usuarios, pero esas dos partes no están implementadas.

---

## 1. Diagrama

```
                  ┌──────────────────────── run_config (congelado) ────────────────────────┐
                  │ mismo modelo · mismo buscador · mismos topes · N · seeds · versiones     │
                  └────────────────────────────────────────────────────────────────────────┘
 case + profile ─►┌───────────────────────────── search_agent ─────────────────────────────┐
                  │  condición B0 ─ queries estáticas (prompts/b0)                          │
                  │  condición B1 ─ planner(mode=initial_batch) 1 vez                       │
                  │  condición B2 ─ planner(initial_batch) + planner(adaptive_step)×k       │
                  │                                                                         │
                  │   ┌─ tools ────────────────────────────────────────────────────────┐    │
                  │   │ search(query) ─► results (r###-##)                              │    │
                  │   │ fetch(ref)    ─► Document (+texto en caché)                     │    │
                  │   │ extract(doc)  ─► Extraction ─(código verifica)─► Evidence,      │    │
                  │   │                  identificadores, validez (dates.mjs)           │    │
                  │   └─────────────────────────────────────────────────────────────────┘    │
                  │   registry (stable IDs, merge) ─► signals.mjs ─► patience/stop         │
                  │                                └► gaps.mjs ─► (solo B2) planner        │
                  │   logger ─► steps.jsonl (LogEntry validado)                            │
                  └───────────────────────────────┬─────────────────────────────────────────┘
                                                  │ discovery terminada (stop_reason)
                                                  ▼
                  ┌──────────────── eligibility_judge (DESPUÉS del discovery) ─────────────┐
                  │ LLM por oportunidad → judge_output → reglas R1–R7 en código → Judgment │
                  └───────────────────────────────┬─────────────────────────────────────────┘
                                                  ▼
                       ranking.mjs (orden determinista) → run_result.json (abstención incluida)
                                                  ▼
                  bench/: pool → preanotación (otra familia) → muestra ciega → humano → métricas → decisión
```

Flechas que **no existen** y que nunca deben aparecer: judge → planner, judge → signals y judge → stop.

---

## 2. Módulos

Todo el código nuevo está en `research/agent/` y `research/bench/`. Es Node 22 ESM, sin TypeScript. El pipeline de producción no importa nada de aquí y aquí no se modifica nada del pipeline. Lo único que se reutiliza son funciones puras ya existentes (§14).

| Archivo | Responsabilidad | API pública (exacta) |
|---|---|---|
| `agent/contracts.mjs` | Cargar y validar schemas (Ajv 2020) | `validate(name, obj)` → `obj` o lanza `ContractError{name, errors}`; `bundle(name)` → schema autocontenido (sin `$ref` externos) para `response_format` |
| `agent/prompts.mjs` | Cargar prompts versionados y comprobar sha | `loadPrompt(id, version)` → `{id, version, sha256, system, user}` (o `{templates}` para `b0_templates`); `render(template, vars)` → string |
| `agent/llm.mjs` | Cliente LLM con seed, uso y latencia | `createLlm({env, role, transport, cache, family})` → `{call({promptRef, system, user, schemaName, temperature, seed, maxTokens})}` → `{json, modelId, tokens, latency}` |
| `agent/cache.mjs` | Caché SQLite compartida por el benchmark | `createBenchCache({path, namespace})` → `{get(kind,key), put(kind,key,value,meta)}` con `kind ∈ search, fetch, llm` |
| `agent/docs.mjs` | URLs, dominios y oficialidad | `normalizeUrl(u)`, `docIdOf(u)`, `registrableDomain(host)`, `officialBasisOf({url, extraction}, domainsCfg)` |
| `agent/identifiers.mjs` | IDs estables | `identifiersFromText(text)`, `urlIdentifier(url)`, `stableIdOf(identifiers)`, `identifierKeys(entityOrAnchor)` |
| `agent/tools/search.mjs` | Un único proveedor de búsqueda | `createSearchTool({provider, env, transport, cache, resultsPerQuery, recency})` → `{search(query)}` → `{results:[{rank,url,title,snippet,published}], latency, error}` |
| `agent/tools/fetch.mjs` | Descargar texto | `createFetchTool({env, transport, cache})` → `{fetch(url)}` → `{ok, text, title, via, http_status, latency, error}` |
| `agent/extractor.mjs` | Leer un documento y producir Evidence | `extractDocument({doc, text, llm, prompt, catalog, today, step, maxChars})` → `{extraction, evidence[], identifiers[], validityInput, rejected:{quotes, identifiers}, tokens, latency, error}` |
| `agent/registry.mjs` | Entidades, merge y novedad | `createRegistry({today})` → `{register(docResult, ctx)` → `{stable_id, isNew, official}`, `entities()`, `evidenceFor(stable_id)`, `byRef(ref)}` |
| `agent/validity.mjs` | Estado y fechas (código) | `computeValidity(entity, docs, texts, today)` → `validity` |
| `agent/signals.mjs` | Señales independientes del judge | `searchSignals(before, after, searchCtx)` → `signals`; `updatePatience(counter, newOfficialCount)` |
| `agent/gaps.mjs` | Vacíos documentales | `computeGaps(registry, catalog, links, mentions)` → `gaps[]` (orden §7.4) |
| `agent/planner.mjs` | Único planner con herramientas | `buildPlannerInput(state, mode, limits)`; `callPlanner({llm, prompt, input, seed, temperature})`; `validateActions(output, input, mode, limits)` → `{accepted[], rejected[]}` |
| `agent/conditions.mjs` | B0, B1 y B2 | `b0Queries(profile, templates, today)`; `runB0/runB1/runB2(ctx)` |
| `agent/search_agent.mjs` | Bucle común, presupuestos, parada y log | `runDiscovery({caseObj, profile, condition, seed, config, deps})` → `{registry, docs, stop_reason, totals, prefix_curve}` |
| `agent/eligibility_judge.mjs` | Juicio por criterio | `judgeEntity({entity, evidence, profile, catalog, llm, prompt, today, config})` → `Judgment`; `applyRules(raw, ctx)`; `aggregate(criteria, route)` |
| `agent/ranking.mjs` | Orden final | `sortKey(entity, judgment)`; `rank(entities, judgments)` |
| `agent/run.mjs` | Orquestación de una corrida | `runCase({caseObj, profile, condition, seed, config, deps, outDir})` → `RunResult` (escribe `steps.jsonl` y `result.json`) |
| `agent/profile.mjs` | Adaptadores de perfil | `briefToProfile(brief, meta)`; `intakeToProfile(intakeState, meta)` |
| `agent/logger.mjs` | JSONL validado | `createRunLogger({dir, header})` → `{log(kind, step, data, {tokens, latency, errors, budget_used})}` |
| `bench/*.mjs` | Harness | ver `BENCHMARK_PROTOCOL.md` §8 y TASK-09…11 |

Los nombres de módulo que pediste se corresponden así: **search_agent** = `search_agent.mjs` con sus tools, extractor, registry, signals y gaps; **planner** = `planner.mjs`; **eligibility_judge** = `eligibility_judge.mjs`.

---

## 3. Flujo de una corrida

`runCase` hace siempre lo mismo, sea cual sea la condición:

1. Valida `case`, `profile` y `run_config` (status `frozen` en el benchmark; `draft` se permite en tests). Escribe `run_start`.
2. `runDiscovery` ejecuta la condición (§4) hasta que se cumpla una razón de parada (§7.3).
3. Para las entidades a juzgar (§6.1), llama a `judgeEntity`. Un `judge` se registra por entidad.
4. `rank` produce el orden final. `abstained = !ranked.some(r => r.recommendable)`.
5. Escribe `run_end` y `result.json` (validado con `run_result.schema.json`).

Todo es secuencial salvo un caso: las descargas y extracciones por defecto de **una misma búsqueda** pueden correr en paralelo, pero se registran en el registry **en orden de rank del resultado**. Así el resultado es determinista con la caché llena.

`today` sale siempre de `run_config.today`. Prohibido `new Date()` en lógica de fechas. `ts` del log es la única hora real.

---

## 4. Condiciones (idénticas salvo de dónde salen las acciones)

**Común a las tres:** después de cada búsqueda se ejecuta la *política de descarga por defecto*: recorrer los resultados por rank y descargar los primeros `default_fetch_per_search` (3) que cumplan `host_kind === 'other'`, `isPublicUrl(url)` y que no se hayan intentado ya en la corrida. Cada documento descargado con `ok && text_chars >= 200` pasa por `extractDocument`. Después se actualizan registry, señales y paciencia (§7).

### B0 — queries estáticas
`b0Queries(profile, templates@v1, today)`:
- Recorre `templates` en orden. Una plantilla se omite si alguna variable que usa vale `null` o si no cumple su `requires`.
- Variables (exactas):
  - `{sector}` = `project.sector.value[0]`; `{sector2}` = `project.sector.value[1]`.
  - `{work}`: `basic_research`→"basic research", `applied_research`→"applied research", `data_or_software_infrastructure`→"data infrastructure", `product_development`→"product development", `clinical`→"clinical research", `training`→"training", `other`→null.
  - `{entity}`: `for_profit`→"small business", `nonprofit`→"nonprofit", `academic`→"university", `government`→"public agency", `individual`→"individual".
  - `{country}` = nombre en inglés según la tabla `COUNTRY_NAMES` de `prompts/b0/v1/templates.json`; si el código no está en la tabla, se usa el propio código.
  - `{region}` = `applicant.region.value`; `{year}` = año de `today`.
- Deduplica con `norm()` de `core.mjs` conservando la primera aparición.
- Las queries resultantes se ejecutan en orden. Cero llamadas al planner.

### B1 — una tanda del LLM, sin adaptación
Hace una sola llamada al planner en `mode = "initial_batch"`, con estado vacío y `limits.batch_size = budgets.searches`. Se aceptan solo acciones `search` válidas (§5.3), en orden y como máximo `batch_size`. Después se ejecutan como en B0. No hay más llamadas al planner. Si la llamada falla dos veces seguidas (reintento incluido), `stop_reason = planner_error` y no se ejecuta ninguna búsqueda.

### B2 — planner adaptativo
1. **Paso 0:** llama al planner en `initial_batch` con `batch_size = b2.initial_batch` (6) y ejecuta esas búsquedas como en B1.
2. **Pasos 1…k:** mientras no se cumpla una razón de parada, llama al planner en `adaptive_step` con:
   - `limits.max_searches = min(b2.max_searches_per_step, budget_left.searches)`
   - `limits.max_fetches = min(b2.max_extra_fetches_per_step, budget_left.fetches)`
3. Primero ejecuta las búsquedas aceptadas, en orden y cada una con su descarga por defecto, extracción y control de paciencia. Después ejecuta las descargas extra aceptadas (`fetch` con `ref` = `r…` o `l…`) y sus extracciones.
4. Si un paso no tiene ninguna acción aceptada: con `stop:true` → `no_more_actions`; sin `stop:true` es un *paso vacío*, y dos pasos vacíos seguidos → `no_more_actions`.
5. Si fallan dos llamadas al planner seguidas → `planner_error`.
6. Si una razón de parada aparece a mitad de un paso, el resto de acciones de ese paso se descarta y se registra en `actions_rejected` con `reason: "stopped"`.

**Por qué B1 usa el mismo prompt que B2:** así B1 es exactamente «B2 sin adaptación». La diferencia medida entre ambos es la adaptación y no un prompt distinto (decisión de diseño propia).

---

## 5. search_agent: herramientas, extracción e identidad

### 5.1 Búsqueda (un solo motor)
- `run_config.search.provider` fija el proveedor. Se reutilizan los adaptadores de `searchApis.mjs` (`PROVIDER_FN[provider]`), **nunca** `multiSearch`.
- Proveedor `fixture`: buscador offline para tests (§13).
- Caché: `kind=search`, clave `sha256(provider|results_per_query|recency|norm(query))`. En un acierto se devuelven los resultados guardados y `latency.nominal_ms` = la latencia guardada.
- IDs de resultado: `r{search_index:03d}-{rank:02d}`. Ejemplo: `r004-02` es el rank 2 de la búsqueda número 4 (base 0). Los rank empiezan en 1.

### 5.2 Descarga
- Cadena fija: `fetchPage` (descarga directa, `localSearch.mjs`) → `crawl4aiRead` si `CRAWL4AI_URL` está configurado y el texto tiene menos de 400 caracteres → `jinaRead` si sigue por debajo de 400. **Firecrawl queda fuera de la v0**: sus créditos y su caché diaria introducen asimetrías.
- Caché: `kind=fetch`, clave = `normalizeUrl(url)`. Guarda `{text, title, via, http_status}` con `latency`.
- `fetch_errors` cuenta: `ok=false` o `text_chars < 200`.

### 5.3 Validación de acciones del planner (código)
Una acción se rechaza (y se registra con su motivo) si:
- `type=search` y `norm(query)` ya se ejecutó en la corrida (`duplicate_query`), o se excede `max_searches` (`over_limit`).
- `type=fetch` y el `ref` no existe (`unknown_ref`), ya se descargó (`already_fetched`), su host no es `other` (`blocked_host`), está en `initial_batch` (`fetch_not_allowed_in_initial_batch`) o se excede `max_fetches` (`over_limit`).
- Algún `targets` es un `g-…` que no está entre los gaps ofrecidos en esa llamada (`unknown_gap`). Los targets `coverage:*` siempre se aceptan.

### 5.4 Extracción (`extractDocument`)
1. Texto para el LLM: `excerptForExtraction(text, extract_max_chars)`.
   - Si el texto limpio (espacios colapsados) cabe, va completo.
   - Si no, van los primeros 6000 caracteres y después ventanas de 1200 caracteres centradas en cada coincidencia de:
     `/\b(eligib\w*|who (?:can|may) apply|applicants?|deadline|due date|closing date|letter of intent|open to|not eligible|cost[- ]shar\w*|foreign|award (?:ceiling|amount|size)|budget|purpose|objective|priorit\w*|will not (?:fund|support)|out of scope|how to apply|submission)\b/gi`
     Las ventanas se toman en orden de aparición, se fusionan si se solapan, se unen con `" … "` y se corta en `max`.
2. Llamada con `prompts/extractor/v1`, `response_format` = `bundle('extraction')`, `temperature = temperatures.extractor` (0) y el seed de la corrida. Caché `kind=llm`, clave `sha256(prompt.sha256|model_id|sha256(user_rendered)|temperature|seed_policy)`. Para el extractor y el judge `seed_policy = "fixed:0"`: usan siempre seed 0, para que el mismo documento produzca la misma extracción en B0, B1 y B2. Para el planner `seed_policy = seed`.
3. Verificación en código:
   - Cada `evidence[i].quote` debe cumplir `literalIn(quote, fullText)` (de `verify.mjs`). Si no, se descarta y se suma a `quotes_rejected`.
   - Los `REQ` sin `requirement_summary` se descartan.
   - Los `REQ` válidos se numeran `REQ-01…` por entidad, en orden de primera aparición; el mismo texto normalizado reutiliza su número.
   - `about.identifier_texts[i]` debe aparecer literal en el texto o en la URL. Después se normaliza con `identifiersFromText`. Los que fallan suman a `identifiers_rejected`.
   - `official_links[i].url` debe aparecer literal en el texto y ser `isPublicUrl`. Se le asigna `link_id = l{fetch_seq:03d}-{i:02d}`, donde `fetch_seq` es el ordinal (desde 0) del intento de descarga dentro de la corrida e `i` es el índice entre los links aceptados.
4. Se crea una entidad solo si `about != null` y `page_type ∈ {call, program_page, award_record, news, blog}`.

### 5.5 Identificadores y `stable_id` (código, determinista)
`identifiersFromText(s)` aplica estas regex en orden y deduplica:

| scheme | regex (flags `i` salvo indicación) | valor |
|---|---|---|
| `nih` | `\b(RFA|PAR|PA|PAS|RFP|NOT|OTA)-([A-Z]{2})-(\d{2})-(\d{3})\b` | `${1}-${2}-${3}-${4}` en mayúsculas |
| `nsf` | `\bNSF[\s-]?(\d{2})-(\d{3})\b` | `${1}-${2}` |
| `nsf` | `\bPD[\s-]?(\d{2})-(\d{4})\b` | `PD-${1}-${2}` |
| `grantsgov` | URL `grants\.gov/search-results-detail/(\d{5,7})` o texto `\bOpportunity ID[:\s]+(\d{5,7})\b` | `${1}` |
| `eu` | `\b((?:HORIZON|EU4H|DIGITAL|ERC|LIFE)-[A-Z0-9]+(?:-[A-Z0-9]+){1,6})\b` (sensible a mayúsculas) | `${1}` |

`urlIdentifier(url)` → `{scheme:'url', value: host_sin_www + path}`, todo en minúsculas, sin query ni fragmento y sin `/` final. Siempre se añade.

**Identificadores de un `about`:** para cada `identifier_text` que aparezca literal en el texto o en la URL se aplica `identifiersFromText(text)`; a eso se suma `identifiersFromText(doc.url)` y siempre `urlIdentifier(doc.url)`. Nunca se toman todas las coincidencias de la página: una página puede mencionar muchos números.

`stableIdOf(ids)`: prioridad `nih > nsf > eu > grantsgov > url`. Dentro de `nih`, los valores con prefijo `NOT-` (avisos, no convocatorias) van al final. Después, orden lexicográfico. Resultado: `opp:${scheme}:${value}`. Los esquemas `sbir` y `ukri` están reservados y la v1 no los produce.

**Merge.** El registry mantiene un union-find sobre las claves `${scheme}:${value}`. Un documento cuyo `about` comparte alguna clave con una entidad existente se fusiona con ella. Una entidad es **nueva** si ninguna de sus claves se había visto antes en la corrida. El `stable_id` final se recalcula al terminar con la prioridad anterior. Los logs guardan el `stable_id` que tenía en ese momento y `result.json` conserva todas las claves, así que una entidad sigue identificable aunque su `stable_id` final cambie.

### 5.6 Oficialidad (código)
`official = host_kind === 'other' && basis !== 'none'`. La base se elige así:
1. `suffix`: el host termina en uno de `official_domains.suffixes`.
2. `curated_list`: `registrableDomain(host)` está en `official_domains.domains`, o el host es igual a un dominio de la lista, o termina en `.` + ese dominio.
3. `issuer_match`: `extraction.about.issuer_domain`, normalizado, coincide con `registrableDomain(host)`; `page_type ∈ {call, program_page}`; y existe `how_to_apply_quote` literal o alguna evidencia verificada de `G-ENTITY`.
4. En cualquier otro caso, `none`.

`registrableDomain(host)`: quita `www.`. Si las dos últimas etiquetas son `<sld>.<cc>`, con `sld ∈ {co, com, gov, gob, ac, org, net, edu, go, or, ne, nic}` y `cc` de dos letras, devuelve las tres últimas. Si no, las dos últimas.

Una entidad es `official` si alguno de sus documentos lo es; su `official_basis` es el del primer documento oficial.

### 5.7 Validez (código, `validity.mjs`)
- **Documento fuente:** el primer documento oficial de la entidad con `page_type=call`. Si no hay, el primero oficial. Si tampoco, el primero.
- `d = deadlineDecision(fullText(doc), {today, title, url})` (de `dates.mjs`, reutilizado tal cual). Se asigna:
  - `status = d.status`
  - `closes_on = d.deadline ?? null`
  - `opens_on = d.opens ?? null`
  - `deadline_label = d.phase ?? null`
  - `deadline_quote = d.quote || null`
  - `deadline_doc_id = doc.doc_id`
- Si el documento fuente tiene `page_type = award_record` → `status = 'awarded'`.
- **Conflicto:** dos documentos oficiales con `closes_on` distinto y no nulo → `conflict:true`. Se queda el valor del documento fuente.
- El código nunca emite `not_a_call`; ese valor es solo de etiqueta humana.

---

## 6. eligibility_judge (después del discovery)

### 6.1 Qué se juzga
Las entidades se ordenan por (`official` desc, `first_seen.search_index` asc, `first_seen.order` asc) y se juzgan las primeras `judge.max_opportunities` (40). Las demás quedan `eligibility_class = "unjudged"`.

### 6.2 Entrada del LLM
- **Perfil:** todos sus campos; los nulos se muestran como `"UNKNOWN"`.
- **Entidad:** nombre, issuer, `validity` y `official`.
- **Criterios:** los del catálogo con `evaluator = llm`, más los `REQ-xx` de la entidad (máximo 8).
- **Evidencia:** la evidencia verificada de la entidad (máximo `max_evidence_per_opportunity`), en este orden: oficial primero, `binding` primero, `step` ascendente. Cada pieza lleva `evidence_id`, `criterion_id`, `quote`, `url`, `official` y `retrieved_at`.

Se usa `temperature = 0`, `seed_policy = fixed:0` y `response_format = bundle('judge_output')`.

### 6.3 Reglas (en este orden y únicas autorizadas a cambiar un estado)
Para cada criterio `c` aplicable a la entidad:
- **R5:** si `c.evaluator === 'code'`, el estado lo calcula el código:
  - `G-STATUS`: `met` si `status ∈ {open, rolling}`, o `status = upcoming`, o `closes_on >= today` con `status ≠ closed/awarded`; `not_met` si `status ∈ {closed, awarded}`; `unknown` en otro caso.
  - `P-TIMELINE`: según el catálogo.
  - `P-ROUTE`: según el catálogo, usando la `route` del judge.
  - Se ignora lo que diga el LLM; `llm_state = null`.
- **R6:** si el LLM no contestó `c` → `unknown`.
- **R7:** de `evidence_ids` se eliminan los que no pertenecen a la entidad.
- **R1:** `met` o `not_met` con 0 evidencias válidas → `unknown`.
- **R2:** `conflict` con menos de 2 evidencias válidas → `unknown`.
- **R3:** `met` o `not_met` con algún `c.profile_fields` nulo en el perfil → `unknown`.
- **R4a:** `not_applicable` con `c.applicability = always` → `unknown`.
- **R4b:** `not_applicable` sin evidencia y sin ningún documento oficial con `page_type = call` → `unknown`.

Invariante (con test): **ninguna regla produce `met` a partir de otro estado**, y un `unknown` del LLM sigue `unknown`.

Si la llamada falla dos veces: `judge_call.ok = false`, todos los criterios `llm` quedan `unknown` (R6), `eligibility_class = unjudged` y `recommendable = false`.

### 6.4 Agregado
- `hard_not_met`, `hard_conflict` y `hard_unknown` son listas de ids de criterios `hard`.
- `eligibility_class`:
  - `ineligible` si `hard_not_met` no está vacío;
  - si no, `conflict` si `hard_conflict` no está vacío;
  - si no, `eligible_pending` si `hard_unknown` no está vacío;
  - si no, `eligible`.
- `soft_score` = nº de soft `met` / nº de soft con estado ≠ `not_applicable` (0 si el denominador es 0).
- `recommendable` = `eligibility_class ∈ {eligible, eligible_pending}` y `G-SCOPE = met` y `G-STATUS = met` y `route ∉ {not_actionable, null}`.
- **Abstención:** la corrida se abstiene si ninguna entidad es `recommendable`. Es una salida válida y se evalúa (protocolo §5.7).

---

## 7. Señales, gaps y parada (independientes del judge)

### 7.1 Señales por búsqueda (`signals.mjs`, solo código)
| Señal | Definición exacta |
|---|---|
| `new_unique_docs` | resultados cuya `normalizeUrl` no se había visto (en resultados ni en links) en la corrida |
| `duplicates` | resultados cuya `normalizeUrl` ya se había visto |
| `new_official_opportunities` | `stable_id` de las entidades **oficiales** que pasaron a existir en el registry, atribuidas a esta búsqueda |
| `new_official_domains` | `registrableDomain` de documentos oficiales descargados por primera vez |
| `fetch_errors` | descargas de esta búsqueda con `ok=false` o `text_chars<200` |
| `deadlines_parsed` | de `new_official_opportunities`, cuántas tienen `closes_on ≠ null` o `status = rolling` |
| `criteria_unknown` | nº total de gaps `criterion_missing` (sin tope) tras esta búsqueda |
| `searches_without_new_official` | contador de paciencia después de esta búsqueda |

Una entidad que era no oficial y se vuelve oficial cuenta como «nueva oficial» en el momento en que se vuelve oficial.

### 7.2 Gaps (vacíos documentales, `gaps.mjs`)
| Tipo | Se genera cuando |
|---|---|
| `official_source_missing` | entidad con `official = false` |
| `criterion_missing` | entidad oficial × criterio de catálogo `hard`, `evaluator = llm`, `applicability = always` (`G-SCOPE`, `G-ENTITY`, `G-GEO`, `G-INSTRUMENT`) sin evidencia verificada |
| `deadline_unparsed` | entidad oficial con `closes_on = null` y `status = unknown` |
| `link_unfetched` | `official_link` no descargado |
| `mention_unresolved` | `mention` cuyo `identifier_text` normalizado no casa con ninguna entidad y cuyo `norm(name)` no es igual al `norm(name)` de ninguna entidad (se guardan las 10 más recientes) |

- `gap_id = 'g-' + sha256(type|stable_id|criterion_id|detail_key).slice(0,8)`, donde `detail_key` es el `link_id` o el `norm(name)` de la mención.
- **Orden:** tipo en el orden de la tabla, luego `first_seen.order` de la entidad, luego el orden del criterio en el catálogo. Tope de 40.
- Las entidades se muestran al planner como `o1, o2…` según `first_seen.order`.

### 7.3 Parada (idéntica en B0, B1 y B2)
- **Contador de paciencia `c`** (empieza en 0):
  - Al terminar cada búsqueda (con su descarga y extracción por defecto): `c = (nuevas oficiales de esta búsqueda > 0) ? 0 : c + 1`.
  - Tras las descargas extra de un paso de B2: si aportaron alguna nueva oficial, `c = 0`. Esas nuevas se atribuyen a la última búsqueda ejecutada; si no hubo ninguna, a `search_index = 0`.
  - Una búsqueda que falla cuenta como búsqueda y suma 1.
- **Razones de parada** (se comprueban antes de iniciar cada acción y después de cada búsqueda; gana la primera que se cumple, en este orden):
  1. `patience`: `c >= patience_n` (comprobada después de cada búsqueda)
  2. `budget_searches`: búsquedas usadas ≥ tope (antes de buscar)
  3. `budget_fetches`: descargas usadas ≥ tope (antes de descargar)
  4. `budget_tokens`: tokens nominales de discovery ≥ tope (antes de cualquier llamada LLM o búsqueda)
  5. `budget_time`: segundos nominales de discovery ≥ tope
  6. `budget_planner_calls`: solo B2
  7. `no_more_actions`: B0/B1 sin queries restantes; B2 según §4
  8. `planner_error`
  9. `fatal_error`: una excepción no prevista. La corrida termina, `result.json` se escribe con lo que haya y se cuenta como corrida, nunca se descarta.
- La acción en curso siempre termina; no se interrumpe nada a mitad de camino.
- **N se fija antes de correr** y es el mismo para las tres condiciones: `run_config.patience_n` (propuesto: 6).

**Por qué no usa el judge:** si la misma decisión del judge definiera a la vez el progreso y la parada, el agente se detendría cuando su propio juez estuviera satisfecho, y un juez que sobre-etiqueta positivos (Alaofi et al., SIGIR-AP 2024) cortaría la búsqueda pronto con falsa confianza. Kamoi et al. (2024) y Huang et al. (2024) muestran que la autocorrección solo es fiable con feedback externo fiable. Por eso las señales son conteos documentales verificables en código. La forma concreta de la regla (N búsquedas sin oportunidad oficial con ID estable) es **decisión de diseño propia**; ningún paper la respalda.

---

## 8. Ranking (común a B0, B1 y B2)

`sortKey` es una tupla ascendente:
1. `class_rank`: eligible 0, eligible_pending 1, conflict 2, ineligible 3, unjudged 4
2. `official ? 0 : 1`
3. `scope_rank` de `G-SCOPE`: met 0, unknown/not_applicable 1, conflict 2, not_met 3; las no juzgadas 1
4. `hard_unknown.length` (las no juzgadas 99)
5. `-soft_score`
6. `closes_on ?? '9999-12-31'`
7. `first_seen.search_index`
8. `first_seen.order`
9. `stable_id`

`result.ranked` contiene **todas** las entidades. Las métricas usan los primeros 10 o 20.

---

## 9. Caché y costo nominal

- **Un archivo por benchmark:** `research/bench/out/<bench_id>/cache.sqlite`, tabla `entries(kind, key, value_json, meta_json, created_at)`, con `namespace = run_config.cache_namespace`.
- **Todas las condiciones y seeds comparten la caché.** Así la misma query devuelve los mismos resultados el mismo día, y el mismo documento produce la misma extracción.
- **Costo nominal:** cada entrada guarda los tokens y la latencia de su primera llamada. Los presupuestos y las métricas de costo usan los valores **nominales**, de modo que quien corre después no sale beneficiado por encontrar la caché llena.
- **Orden de ejecución:** para cada caso y seed, las condiciones se ejecutan en un orden permutado con `seed` (`shuffle(['B0','B1','B2'], mulberry32(seed))`).

## 10. Cliente LLM

- Envuelve el `post` de `fleet.mjs`. Se refactoriza `chatJSON` para aceptar `seed`, `temperature` y `maxTokens` por llamada y para devolver `usage` y `latency`, sin cambiar sus llamadores actuales.
- `model_id` se toma de `data.model` de la respuesta.
- Si la API no devuelve usage: `tokens = ceil(chars/4)` y `estimated: true`.
- Reintento: si el JSON es inválido o no cumple el schema, **1 reintento** con el mismo seed y un mensaje de usuario añadido: `"Your previous reply was not valid JSON for the schema. Reply only with valid JSON."`. Tras el segundo fallo: error `LLM_BAD_JSON` o `LLM_SCHEMA`.
- `family` viene de `run_config.agent_model.family`. El harness se niega a correr si la familia del preanotador coincide con la del agente, o si alguna vale `TO-SET-AT-FREEZE`.

## 11. Log

Cada evento es un `LogEntry` validado con `log_entry.schema.json` antes de escribirse en `research/bench/out/<bench_id>/runs/<run_id>/steps.jsonl`. Si la validación falla, la corrida aborta con `CONTRACT`: es un bug de implementación y no se tolera.

Cada entrada registra la query, los resultados, los documentos únicos, las oportunidades nuevas, los errores, los tokens, el tiempo, las versiones de modelo y prompt, y el seed.

## 12. Seguridad

- Todo texto procedente de páginas que llega a un prompt va entre `<page_data>` y `</page_data>`. Antes se elimina del texto cualquier aparición literal de esas etiquetas.
- El planner no escribe URLs, solo `result_id` y `link_id`.
- Solo se descargan URLs `isPublicUrl` (sin SSRF).
- Ningún email ni dato personal entra en los prompts.
- La v0 no envía nada a terceros salvo las queries al buscador y los textos al modelo configurado. Activar proveedores externos es el paso humano H9.

## 13. Mundo de pruebas offline (`research/tests/agent/fixtures/world-v1/`)

Sirve para probar el sistema de extremo a extremo sin red. Lo escribió el arquitecto y Codex no lo modifica. Está especificado en `ACCEPTANCE.md` §E2E:
- `pages/*.md`: páginas ficticias marcadas como **FIXTURE**.
- `world.json`: páginas, URL y keywords.
- `llm.json`: respuestas guionizadas del extractor, del judge, del planner y del preanotador.
- `profile.json`: el perfil de prueba.

---

## 14. Decisiones de diseño y su respaldo

| # | Decisión | Razón | Respaldo |
|---|---|---|---|
| A1 | Elegibilidad por criterio, con evidencia citada por criterio | Un veredicto global oculta una inelegibilidad dura bajo un buen score | TrialGPT (Jin et al., Nat. Commun. 2024) usa evaluación criterio a criterio con explicación y localización de evidencia en *patient–trial matching*. **No demuestra transferencia a grants**: aquí el formato es una hipótesis de diseño |
| A2 | Cinco estados, y `unknown` nunca se convierte en `met` | Lo desconocido no puede tratarse como cumplido | Decisión de diseño propia, alineada con la regla ya aprobada en el vault («un ? nunca se convierte en ✔») |
| A3 | Judge después del discovery; parada y reflexión con señales documentales | Evita la circularidad; el feedback del propio sistema no es externo | Kamoi et al. (TACL 2024): la autocorrección requiere feedback externo fiable. Huang et al. (ICLR 2024): sin feedback externo, la autocorrección no mejora el razonamiento. La regla concreta es **propia** |
| A4 | Baselines B0 y B1 con el mismo modelo, buscador y topes | Una mejora atribuida a la adaptación tiene que descontar el costo | Kamoi et al. y Huang et al. piden comparar con baselines fuertes de costo comparable. B0/B1/B2 como tales son **diseño propio** |
| A5 | Evaluación end-to-end con buscador fijo; oracle fuera de la v0 | Separar recuperación de razonamiento queda para más adelante | FRAMES (Krishna et al., NAACL 2025) evalúa end-to-end con recuperación fija y un oracle documental. Aquí solo se toma lo de buscador fijo y evaluación end-to-end; el oracle se excluye por decisión aprobada |
| A6 | El LLM preanota, el humano adjudica, y el preanotador es de otra familia | Los jueces LLM sobre-etiquetan positivos y son sensibles a la redacción | Alaofi et al. (SIGIR-AP 2024): los jueces LLM pueden ser inducidos a etiquetar como relevante. Thomas et al. (SIGIR 2024): calibrar el juez LLM contra gold humano; sensible a paráfrasis del prompt. Lo de «otra familia» es **diseño propio** |
| A7 | Extractor y judge con temperatura 0 y seed fijo, cacheados | La variación entre corridas debe venir del planner, no del lector | Diseño propio |
| A8 | Costo nominal para presupuestos | La caché compartida no debe favorecer a quien corre después | Diseño propio |
| A9 | Firecrawl, `multiSearch`, Grants.gov API y RePORTER fuera de la v0 | Deben correr las mismas herramientas en las tres condiciones | Diseño propio. Se reincorporan como tools en una v1 |
| A10 | Perfil con `value: null = unknown`, sin defaults | El default actual «for-profit startup» de `applicantProfile` inventa elegibilidad | Diseño propio. Corrige el problema documentado en «Brief de inversionistas frente a elegibilidad de grants» |

## 15. Qué se reutiliza del código actual

| Pieza | Destino | Nota |
|---|---|---|
| `searchApis.PROVIDER_FN`, `localSearch.fetchPage/isPublicUrl`, `crawl4ai.crawl4aiRead`, `searchApis.jinaRead` | **reutilizar** | Importar sin cambios |
| `verify.literalIn`, `verify.hostKind`, `verify.hostOf`, `core.norm` | **reutilizar** | Importar sin cambios |
| `dates.deadlineDecision` | **reutilizar** | Es la única fuente de estado y fechas |
| `fleet.chatJSON`/`post` | **refactorizar** | Añadir `seed`, `maxTokens` y `latency` por llamada; compatible hacia atrás (TASK-02) |
| `firecrawlLedger` (patrón de caché SQLite y versión por hash) | **reutilizar el patrón** | Caché nueva propia, en `agent/cache.mjs` |
| `analysis/eligibility.IGC_PROFILE`, `RULE_TYPES`, `intake.FIELDS` | **refactorizar** | Mapeo a `profile.schema.json` y al catálogo (TASK-08) |
| `researcher.mjs` (candidatos por número, `<page_data>`, presupuesto en código) | **reemplazar**, conservando sus principios | El planner nuevo hereda las tres reglas de seguridad |
| `orchestrator.mjs`, `loop.mjs`, `sufficiency.mjs` | **reemplazar** (en el camino nuevo) | Deciden suficiencia con conteos de prioritarios que salen de la verificación: circular |
| `engine.planQueries/followUpQueries/readPrompt/verifyFinding` | **reemplazar** | Prompts dentro del código, sin versión; elegibilidad de 3 estados; niveles que mezclan dimensiones |
| `applicant.checkApplicant`, `grantMatch`, regla de palabras del commit `60ff27e` | **reemplazar** como juez | Juicio por palabras, contrario a la decisión del 01/10 |
| `eval/metrics.mjs`, `eval/replay.mjs`, `scripts/eval-search.mjs` | **reemplazar** | Métricas de otro problema |
| `tests/*.test.mjs` existentes | **no tocar** | `searchQuality.test.mjs:37` ya falla en `main`; no forma parte de esta línea de trabajo |

## 16. Extensión a investors y usuarios (no implementar en v0)
- `profile.target_types` admite `investor` y `user`. Los campos nuevos (`investor.round`, `investor.check_size_usd`, `user.segment`…) llegarán en `profile/2`.
- `target_entity.entity_type` ya admite `investor` y `user`, con `stable_id` de esquema `inv:` y `usr:`. `validity` se reinterpreta como vigencia de tesis (inversión reciente con fecha) o de cuenta.
- Habrá un catálogo por tipo (`criteria_catalog.investor@v1`) con el mismo contrato `criterion`.
- search_agent, planner, judge, signals, parada y harness no cambian. Solo cambian el catálogo, las regex de identificadores, la plantilla B0 y la regla de oficialidad.
