# Tests de aceptación (especificación exacta)

Escritos **antes** de las tareas. Cada `ACC-xx` se convierte en uno o más `test()` de `node:test` en el archivo indicado, y el nombre del test **empieza con el id** (por ejemplo `test('ACC-11 patience counter…')`). Una tarea está terminada cuando sus ACC pasan y la suite anterior no empeora (ver REVIEW.md).

Convenciones:
- Fixtures en `research/tests/agent/fixtures/world-v1/`. Ahí está `expected.json`, que es la referencia de los valores esperados.
- `today = "2026-10-20"` en todos los tests.
- `F = research/tests/agent/fixtures/world-v1`; `E = F/expected.json`.
- Comparaciones de números reales con tolerancia `1e-4` salvo que se indique otra.
- Ningún test usa red. Todo el LLM pasa por `createFixtureTransport(F, {condition, profileId})` (TASK-02).

---

## Contratos y prompts — `research/tests/agent/contracts.test.mjs`

**ACC-01 · Ejemplos y datos válidos.** Validan sin errores:
- cada archivo de `docs/contracts/examples/`, contra el schema cuyo nombre es el prefijo del archivo antes del primer `.`;
- `docs/contracts/criteria_catalog.grant.v1.json` contra `criteria_catalog`;
- `research/agent/config/official_domains.v1.json` contra `official_domains`;
- `research/bench/config/v0.json` contra `run_config`;
- `F/profile.json` contra `profile`, `F/case.json` contra `case` y `F/run_config.json` contra `run_config`;
- cada respuesta de `F/llm.json` contra su schema (`extraction`, `planner_output`, `judge_output`, `preannotator_output`).

**ACC-01n · Negativos.** Cada uno de estos objetos debe **fallar** la validación (se construyen copiando el ejemplo y modificando una cosa):
- (a) un case con `construction.profile_builder_saw_anchor: true`;
- (b) un judgment con un criterio en estado `"maybe"`;
- (c) un profile sin la clave `fields["applicant.country"]`;
- (d) un log_entry `kind:"search"` sin `data.signals`;
- (e) un planner_output con una acción `{type:"fetch", url:"https://x.org"}`;
- (f) un target_entity con `validity.computed_by:"llm"`;
- (g) un run_config con `seeds:[1,2]`.

**ACC-02 · bundle.** Para `extraction`, `planner_output`, `judge_output` y `preannotator_output`, `bundle(name)` devuelve un objeto cuyo JSON no contiene ningún `"$ref"` que empiece por algo distinto de `#`. Debe validar igual que el schema original los mismos ejemplos de ACC-01.

**ACC-03 · Prompts.**
- (a) `loadPrompt(id,'v1')` funciona para los 5 ids del manifest y devuelve el `sha256` del manifest.
- (b) Copiar `prompts/` a un directorio temporal, cambiar un byte de `planner/v1/system.md` y llamar a `loadPrompt('planner','v1',{root:tmp})` → lanza `PromptIntegrityError`.
- (c) `render('a {{x}} b',{x:'1'}) === 'a 1 b'`; `render('{{x}}',{})` lanza; `render('{{x}}',{x:'1',y:'2'})` lanza; `render('{{x}}',{x:'{{y}}'})` lanza.
- (d) `render('{{x}}',{x:{a:1}}) === '{\n "a": 1\n}'`.
- (e) `sanitizePageText('a <page_data>b</page_data> c') === 'a b c'`, con los espacios colapsados.

## LLM y caché — `research/tests/agent/llm.test.mjs`

**ACC-04 · Cliente LLM** (transport falso que registra lo que recibe):
- (a) La respuesta `{content:'{"ok":true}', model:'m-1', usage:{prompt_tokens:10, completion_tokens:5}}` da `json={ok:true}`, `modelId='m-1'` y `tokens={prompt:10, completion:5, total:15, nominal_total:15, estimated:false, cached:false}`.
- (b) La misma llamada otra vez, con caché, da `tokens.cached=true`, `total=0`, `nominal_total=15`, `latency.actual_ms <= latency.nominal_ms` y `latency.nominal_ms` igual al de la primera llamada. El transport recibió 1 sola llamada.
- (c) Contenido `'not json'` y después `'{"ok":true}'` → éxito al segundo intento. El segundo mensaje enviado lleva el texto de reintento exacto de ARCHITECTURE §10.
- (d) Contenido inválido dos veces → lanza `LlmError{code:'LLM_BAD_JSON'}`.
- (e) Respuesta sin `usage`, con system de 400 caracteres y user de 400 → `tokens.prompt = 200`, `estimated = true`.
- (f) El body enviado contiene el `seed`, la `temperature` y el `max_tokens` pedidos, más `response_format:{type:'json_schema', json_schema:{name, schema}}`.
- (g) `meta` llega al transport y **no** aparece en el body.

**ACC-05 · Caché.**
- `put('search','k',{a:1},{tokens:5, latency_ms:7})` y luego `get('search','k')` → `{value:{a:1}, meta:{tokens:5, latency_ms:7}}`.
- Una caché con otro `namespace` no ve la entrada.
- Persiste al cerrar y reabrir el mismo archivo.

## URLs, identificadores y oficialidad — `research/tests/agent/docs.test.mjs`

**ACC-06 · normalizeUrl, docId y dominio registrable.**

| entrada | `normalizeUrl` |
|---|---|
| `http://WWW.Example.org/a//b/?utm_source=x&b=2&a=1#frag` | `https://example.org/a/b?a=1&b=2` |
| `https://grants.nih.gov:443/x/` | `https://grants.nih.gov/x` |
| `https://example.org` | `https://example.org/` |

- `docIdOf(url de p1) === E.doc_ids.p1`, y lo mismo para p2…p7.

| host | `registrableDomain` |
|---|---|
| `grants.nih.gov` | `nih.gov` |
| `www.alz.org` | `alz.org` |
| `minciencias.gov.co` | `minciencias.gov.co` |
| `foo.bar.co.uk` | `bar.co.uk` |
| `eic.ec.europa.eu` | `europa.eu` |

- `officialBasisOf` sobre las páginas del fixture, con sus extracciones de `llm.json`, devuelve `E.official`.
- Casos extra:
  - host `www.example.org`, extracción con `issuer_domain:'example.org'`, `page_type:'call'` y `how_to_apply_quote` no nulo → `issuer_match`;
  - lo mismo con `page_type:'news'` → `none`;
  - `https://www.fundsforngos.org/x` → `none`.

**ACC-07 · Identificadores.**

| texto | `identifiersFromText` |
|---|---|
| `"see RFA-AG-27-010 now"` | `[{scheme:'nih', value:'RFA-AG-27-010'}]` |
| `"nsf 23-525"` | `[{scheme:'nsf', value:'23-525'}]` |
| `"PD 24-1699"` | `[{scheme:'nsf', value:'PD-24-1699'}]` |
| `"https://www.grants.gov/search-results-detail/359740"` | `[{scheme:'grantsgov', value:'359740'}]` |
| `"HORIZON-EIC-2026-PATHFINDEROPEN-01"` | `[{scheme:'eu', value:'HORIZON-EIC-2026-PATHFINDEROPEN-01'}]` |
| `"horizon-eic-2026"` | `[]` (la regla `eu` distingue mayúsculas) |

- `stableIdOf([{nih,'NOT-AG-26-001'},{nih,'RFA-AG-27-010'},{url,'x.org/a'}]) === 'opp:nih:RFA-AG-27-010'`: los `NOT-` tienen la prioridad más baja dentro de `nih`.
- `stableIdOf([{grantsgov,'359740'},{nsf,'23-525'}]) === 'opp:nsf:23-525'`.
- `urlIdentifier('https://www.alz.org/research/for_researchers/grants/part-the-cloud/')` → `{scheme:'url', value:'alz.org/research/for_researchers/grants/part-the-cloud'}`.

## Extractor, registry y validez — `research/tests/agent/extract.test.mjs`

**ACC-08 · Extractor (p1).** `extractDocument` sobre p1, con fixture transport, `step=1` y `fetch_seq=0`:
- `evidence.length === 8` (la cita de `G-PI` no es literal y se rechaza);
- `rejected.quotes === 1` y `rejected.identifiers === 0`;
- el `REQ` queda como `REQ-01`;
- los `evidence_id` coinciden con `E.evidence_ids['opp:nih:RFA-AG-27-010']`, filtrados a `doc:'p1'`;
- `official_links` sale con `link_id:'l000-00'`;
- el log `extract` valida contra el schema.

**ACC-09 · Registry y merge.**
- (a) Registrar p1 y después p5: una sola entidad `opp:nih:RFA-AG-27-010`. p5 tiene `isNew=false` y `newOfficial=false`; la entidad tiene 2 `source_doc_ids`.
- (b) En un registry nuevo, registrar p5 primero: `isNew=true`, `official=false`, `newOfficial=false`. Después p1: `isNew=false` y `newOfficial=true`, porque la entidad pasó a ser oficial.
- (c) Registrar p7 después de p1: la entidad conserva `stable_id = 'opp:nih:RFA-AG-27-010'`.

**ACC-10 · Validez.**
- Para cada entidad del fixture, `validity.status` y `closes_on` coinciden con `E.validity` y `deadline_doc_id` es el doc indicado.
- Una entidad cuyo documento fuente tiene `page_type='award_record'` sale con `status='awarded'`.
- Dos documentos oficiales con fechas distintas dan `conflict=true`.

## Señales, gaps y planner — `research/tests/agent/loop.test.mjs`

**ACC-11 · Paciencia.**
- Con nuevas oficiales por búsqueda `[2,1,0,0,0,0,0,0]` y `N=6`: contadores `[0,0,1,2,3,4,5,6]` y parada `patience` después del índice 7.
- Con `[0,1,0]` y `N=6`: contadores `[1,0,1]`.
- Con descargas extra que aportan 1 nueva cuando el contador vale 4 → el contador pasa a 0.

**ACC-12 · Gaps.** Al correr B2 con el fixture y el hook `deps.onPlannerInput(input)`, el `input.gaps.map(g => g.gap_id)` de la llamada con `step === 1` es exactamente `E.conditions.B2.gaps_offered_at_call_1`, en ese orden. Además, ese `input` valida contra `planner_input`.

**ACC-13 · Validación de acciones** (con `planner_input` del ejemplo y `limits {max_searches:2, max_fetches:1}`):

| acción | motivo de rechazo |
|---|---|
| search con query igual a una de `queries_run`, cambiando mayúsculas y puntuación | `duplicate_query` |
| tercera búsqueda válida | `over_limit` |
| fetch `r999-01` | `unknown_ref` |
| fetch de un result ya descargado | `already_fetched` |
| fetch de un result cuyo host es aggregator | `blocked_host` |
| fetch en `initial_batch` | `fetch_not_allowed_in_initial_batch` |
| target `g-00000000` no ofrecido | `unknown_gap` |
| target `coverage:anything` | aceptada |

## eligibility_judge — `research/tests/agent/judge.test.mjs`

**ACC-14 · Reglas** (`applyRules` con entradas mínimas; entidad con evidencias `ev-a` y `ev-b`):

| caso | entrada (criterio · llm) | estado final | overrides |
|---|---|---|---|
| R5 | G-STATUS, `llm:'not_met'`, `validity.status='open'` y `closes_on` posterior a hoy | `met` | `[R5_code_criterion]` |
| R6 | G-ENTITY sin respuesta | `unknown` | `[R6_missing_answer]` |
| R7+R1 | G-ENTITY `met`, `[ev-zzz]` (ajena) | `unknown` | `[R7_foreign_evidence, R1_no_evidence]` |
| R1 | G-ENTITY `not_met`, `[]` | `unknown` | `[R1_no_evidence]` |
| R2 | G-SCOPE `conflict`, `[ev-a]` | `unknown` | `[R2_conflict_needs_two]` |
| R2 ok | G-SCOPE `conflict`, `[ev-a, ev-b]` | `conflict` | `[]` |
| R3 | G-PI `met`, `[ev-a]`, perfil `team.pi.credentials=null` | `unknown` | `[R3_profile_unknown]` |
| R4a | G-GEO `not_applicable`, `[]` | `unknown` | `[R4a_na_forbidden]` |
| R4b | G-COSTSHARE `not_applicable`, `[]`, sin doc oficial `call` | `unknown` | `[R4b_na_needs_call_text]` |
| R4b ok | igual, con doc oficial `call` | `not_applicable` | `[]` |
| unknown se queda | G-ENTITY `unknown`, `[ev-a]` | `unknown` | `[]` |

**ACC-14p · Invariante.** Con 2 000 entradas aleatorias (mulberry32 seed 99): estados aleatorios, evidencias aleatorias (propias o ajenas) y perfil aleatorio (nulos o no). Nunca puede darse `final === 'met' && llm_state !== 'met'` para criterios `llm`.

**ACC-15 · Agregado y abstención.**
- Para las 4 entidades del fixture (judge con fixture transport), `eligibility_class`, `recommendable`, `soft_score`, `hard_not_met`, `hard_unknown`, `route` y los estados coinciden con `E.judgments`.
- Los `overrides` de G-PI de RFA dependen de la condición, como indica `E.judgments[…].overrides`.
- Una corrida en la que ninguna entidad es `recommendable` da `abstained = true`.
- Si la llamada al judge falla dos veces → `eligibility_class = 'unjudged'` y `recommendable = false`.

**ACC-16 · Ranking.**
- Con las entidades y juicios de B1 del fixture, el orden es `E.conditions.B1.ranked`.
- `sortKey` de ADDF en B1 = `[0,0,0,0,-1,'2026-12-01',1,2,'opp:url:alzdiscovery.org/research-and-grants/funding-opportunities/data-science-2026']`.

## Log — `research/tests/agent/logger.test.mjs`

**ACC-17 · Logger.**
- Al escribir una entrada inválida, lanza `ContractError` y el archivo no crece.
- `seq` va 0,1,2… sin huecos.
- Cada línea es JSON válido terminado en `\n`.

## End-to-end con fixture — `research/tests/agent/e2e.test.mjs`

Para cada condición `X ∈ {B0, B1, B2}`: `runCase({caseObj:F/case.json, profile:F/profile.json, condition:X, seed:101, config:F/run_config.json, deps:{search:fixture, fetch:fixture, transport:fixture}, outDir:tmp})`.

**ACC-18 (B0), ACC-19 (B1), ACC-20 (B2):**
- `result.json` valida contra `run_result` y cada línea de `steps.jsonl` valida contra `log_entry`.
- `stop_reason`, `totals.searches`, `totals.fetches`, `totals.planner_calls`, `totals.tokens_discovery_nominal` y `totals.tokens_judge_nominal` coinciden con `E.conditions[X]`.
- Por cada búsqueda `i`, el log `search` tiene `query`, `origin`, los `result_id` de `results`, `signals.new_unique_docs`, `signals.duplicates`, `signals.new_official_opportunities` y `signals.searches_without_new_official` iguales a `E.conditions[X].searches_log[i]`.
- `ranked.map(r => r.stable_id)` coincide con `E.conditions[X].ranked`; `abstained === false`.
- Las entidades en orden de registro coinciden con `entities_in_registration_order`, y sus fuentes (páginas) con `entity_sources`.
- `versions.model_id === 'fixture-model'`, y `versions.prompts` incluye las versiones y sha del manifest usadas en la condición: B0 = extractor, eligibility_judge y b0_templates; B1 y B2 = planner, extractor y eligibility_judge.
- Solo B0: las queries son `E.b0_queries` en orden, hasta la parada.
- Solo B1 y B2: los `actions_rejected` de cada `planner_call` coinciden con `E.conditions[X].planner_rejected`.
- Solo B2: hay un log `fetch` con `ref:'l000-00'` y `trigger:'planner'`, y en el log `planner_call` del paso 1 `gaps_offered === 4`.
- Ningún log de tipo `planner_call`, `search` ni `fetch` contiene la clave `judgment`, `eligibility_class` ni `recommendable`. Es la comprobación estática de que no hay circularidad.

**ACC-21 · Determinismo y caché.**
- Correr B2 dos veces seguidas sobre el mismo archivo de caché da `result.json` iguales salvo `ts`, `retrieved_at` y `fetched_at`. En la segunda corrida, todos los logs `extract` tienen `tokens.cached = true` y `tokens.total = 0`, y `totals.tokens_discovery_nominal` es el mismo.
- B0 y B1 corridos sobre la misma caché reutilizan la extracción de p1: un solo cache miss del extractor para p1 entre las dos corridas.

**ACC-22 · Presupuestos.** B0 con fixture y:
- `budgets.searches=3` → `stop_reason='budget_searches'` y `totals.searches=3`;
- `budgets.fetches=2` → `stop_reason='budget_fetches'` y `totals.fetches=2`;
- `budgets.tokens_nominal=2000` → `stop_reason='budget_tokens'`.
- En los tres casos se escribe `result.json` válido.

**ACC-23 · Adaptador de perfil.**
- `briefToProfile(research/eval/briefs/aha-nonprofit.json, {as_of:'2026-10-20'})` → `applicant.entity_type.value='nonprofit'` con `source` que contiene `aha-nonprofit.json#entityType`; `applicant.country.value=null`; `funding.amount_needed_usd.value=350000`; `provenance.source_kind='legacy_brief'`. Valida contra el schema.
- Con `mentiva.json`: `applicant.entity_type.value=null` (nunca el default `for_profit`) y `applicant.country.value=null`.

## Harness — `research/tests/agent/bench.test.mjs`

**ACC-30 · Orden de condiciones.** `conditionOrder(seed)`, con mulberry32 y Fisher–Yates (i de n−1 a 1, `j=floor(rand()*(i+1))`):

| seed | orden |
|---|---|
| 101 | `['B2','B1','B0']` |
| 202 | `['B2','B1','B0']` |
| 303 | `['B0','B1','B2']` |

Además, `mulberry32(1)` produce `0.6270739406, 0.0027357212, 0.5274470400` (redondeado a 10 decimales).

**ACC-31 · Guardas de run-all.** `run-all` lanza error si:
- `status='draft'`;
- alguna familia es `'TO-SET-AT-FREEZE'`;
- `agent_model.family === preannotator_model.family`;
- algún case no valida;
- el `profile_sha256` de un case no coincide con el archivo.

**ACC-32 · Pool.** Con 2 `result.json` sintéticos (uno con `opp:nih:RFA-AG-27-010`; otro con `opp:url:grants.nih.gov/grants/guide/rfa-files/rfa-ag-27-010.html`, que comparte la clave url con la primera), el ancla del fixture y un manual_search con 1 ítem nuevo → pool de 2 ítems, y el primero se fusiona en `opp:nih:RFA-AG-27-010`.

**ACC-33 · Muestra ciega.**
- `sample` con seed 7 sobre un pool sintético de 30 ítems con preanotaciones conocidas incluye: el ancla, todos los `recommendable`, todos los positivos preanotados, ≤ 10 de S4, ≥ 3 negativos y ≤ 5 difíciles.
- Las columnas de la hoja son exactamente `item_key, case_id, profile_summary, name, urls, status, deadline, identity_correct, scope, hard_eligibility, route, criteria_to_label, confidence, notes`.
- Ninguna celda contiene `B0`, `B1`, `B2`, `seed`, `rank`, `recommendable` ni `eligibility_class`.
- `item_key` es un hash opaco.

**ACC-34 · Gain.**

| status | scope | hard_eligibility | route | gain |
|---|---|---|---|---|
| open | on | eligible | direct_apply | 3 |
| rolling | partial | undetermined | direct_apply | 2 |
| upcoming | on | eligible | direct_apply | 2 |
| open | on | undetermined | partner_subaward | 2 |
| open | on | eligible | future_cycle | 1 |
| unknown | on | eligible | direct_apply | 1 |
| closed | on | eligible | direct_apply | 0 |
| open | off | eligible | direct_apply | 0 |
| open | on | ineligible | direct_apply | 0 |
| awarded | on | eligible | procurement_vendor | 0 |

**ACC-35 · Métricas.**
- hit@20: el ancla en la posición 20 → 1; en la 21 → 0.
- pooled_recall@20: positivos {a,b,c,d} y top-20 que contiene a y c → 0,5; sin positivos → `null`.
- nDCG@10: ganancias del top `[3,0,2,0,0,1,0,0,0,0]` y del pool `{3,2,2,1}` → `0.818241341` (tolerancia 1e-6).
- hard_false_positive_rate: 4 recomendados adjudicados, uno `ineligible` y otro `scope off` → 0,5; ninguno recomendado → `null`.
- status/deadline/identity: 3 ítems adjudicados del top-20, con identidad `[true,true,false]`, status igual en 1 de los 2 con identidad correcta y deadline igual en 1 de 1 → `identity=0.6667`, `status=0.5`, `deadline=1`.

**ACC-36 · Estadística.**
- Prueba de signos unilateral: `(n=12,w=10) → 0.019287109375`, `(12,9) → 0.072998046875`, `(10,9) → 0.0107421875`, `(7,7) → 0.0078125`.
- Bootstrap con `d=[0.10,0.05,0.0,-0.02,0.20,0.15,0.08,-0.05,0.12,0.0,0.30,0.07]`, B=10000 y seed 20261006: índices `floor(rand()*n)`, medias ordenadas ascendentes, `lo = s[floor(0.025*B)]`, `hi = s[ceil(0.975*B)-1]` → `[0.030833333333333334, 0.14083333333333334]` (tolerancia 1e-12).
- Kappa: tabla 2×2 (10 sí-sí, 15 no-no, 3 sí-no, 2 no-sí) → `0.6575342466`.

**ACC-37 · Victorias, empates y derrotas.** Con τ=0,05 y `d=[0.06,0.05,-0.051,0,0.2]` → victorias 2, empates 2 y derrotas 1 (`|d|≤τ` es empate). Casos con `null` → excluidos y contados en `excluded`.

**ACC-38 · Regla de decisión** (`decide()` con entradas sintéticas ya agregadas):

| escenario | entrada clave | salida |
|---|---|---|
| A | vs B1: w=10, t=0, l=2, IC [0.02,0.15]; vs B0: w=8, l=3; HFP B2 0.05 / B0 0.04 / B1 0.06; abst. correctas B2 2, B0 2, B1 3; hit B2 0.9, B1 0.9; integridad ok | `ADOPT_B2` |
| B | igual que A, pero vs B1 w=9, l=3 (p=0.073) | `INCONCLUSIVE` |
| C | igual que A, pero HFP B2 0.15 | `DO_NOT_ADOPT` (falla D4) |
| D | vs B1: w=4, l=5 | `DO_NOT_ADOPT` |
| E | igual que A, pero 7 de 12 casos empatados vs B1 | `INCONCLUSIVE` |
| F | igual que A, pero κ=0.55 | `INCONCLUSIVE` (falla D7) |
| G | igual que A, pero abst. correctas B2 1, B1 3 | `DO_NOT_ADOPT` (falla D5) |

En todos los casos `decision.label === 'business_rule_exploratory'`.

**ACC-39 · Curva.** Una corrida sintética con `prefix_curve` de 3 puntos (tokens 40k, 90k y 160k) y positivos descubiertos en los puntos 2 y 3 → malla `0:0, 50k:0, 100k:0.5, 150k:0.5, 200k:1.0, …, 600k:1.0`.

**ACC-40 · CLI.** `node research/bench/cli.mjs validate --config F/run_config.json --cases <dir con F/case.json>` sale con código 0. Con un case inválido, sale con código 1 e imprime el error de Ajv.
