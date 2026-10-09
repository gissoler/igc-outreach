> En pausa R-08…R-15 para inversionistas: ver [DECISION-2026-10-08-agente-inversionistas.md](DECISION-2026-10-08-agente-inversionistas.md).

# Plan de refactor: un agente y un benchmark para todos los dominios

Estado: **propuesta** (07/10/2026). Autor: arquitecto. Lo implementa Codex, tarea por tarea, **sin interpretar**. Si algo no está escrito aquí, en `docs/ARCHITECTURE_AGENT.md`, en `docs/ARCHITECTURE_BENCHMARK.md` o en un contrato, se pregunta en el PR y no se decide.

Lectura previa obligatoria: `AGENTS.md`, `docs/handoff/DIAGNOSIS-2026-10-07.md`, `docs/ARCHITECTURE_AGENT.md`, `docs/ARCHITECTURE_BENCHMARK.md`, y la tarea.

Alcance honesto: *harness exploratorio para comparar búsqueda estática y adaptativa sobre entidades ancla conocidas*.

---

## 0. Reglas de este plan

1. Siguen vigentes todas las reglas de `AGENTS.md` y de `docs/handoff/REVIEW.md`. Una tarea solo puede tocar los archivos de su sección «Puede tocar». Las excepciones a «no modificar `docs/contracts/**`, `prompts/**` y `fixtures/**`» las hace **el arquitecto** en las tareas A-xx, nunca Codex.
2. Un PR por tarea, con título `R-xx: <qué>`. Commits con el mismo prefijo.
3. **Valores congelados.** Desde R-01, los digests de ACC-50 son el contrato de comportamiento de grants. Una tarea solo puede cambiar un digest si esta guía lo declara (columna «Cambio declarado» de §2) y con el valor nuevo exacto. Cualquier otro cambio de digest = PR rechazado.
4. Producción (`research/server/**`), UI (`frontend/**`), backend Python (`backend/**`), `deploy/**` y los `.env` reales quedan **fuera**. La única excepción: R-07 edita `research/.env.example`.
5. Ningún test usa red (`HTTPS_PROXY=http://127.0.0.1:9`).
6. Línea base que no puede empeorar: `npm --prefix research test` = 415 pass, 1 fail preexistente (`UW-Madison I-Corps…`), 1 skip. `npm --prefix research run test:agent` = 56 pass hoy, y sube con cada tarea.

---

## 1. Orden y dependencias

```
H0 ─► R-01 ─► R-02 ─► R-03 ─► R-04 ─► R-05 ─► R-06 ─► R-07
                                                     │
              A-01 ─┬─ A-02 ────────────────────────►├─► R-08 ─► R-09a ─► R-09b ─┬─► R-10 (requiere A-03)
                    │                                                           ├─► R-11 ─► R-14
                    └─ A-03, A-04                                               └─► R-12 ─► R-13 ─► H-R15 ─► R-15
```

| Bloque pedido | Tareas |
|---|---|
| (a) caracterización de grants | R-01 |
| (a') correcciones con cambio declarado (salen del diagnóstico; van antes de limpiar para que la limpieza no esconda bugs) | R-02, R-03, R-04, R-05 |
| (b) código muerto, legibilidad y `.env` | R-06, R-07 |
| (c) DomainPack y paquete grants | A-01, A-02, R-08, R-09a, R-09b, R-10 |
| (d) benchmark general | R-11, R-14 |
| (e) paquete investors | R-12 |
| (f) fixture ficticia de inversores y prueba de adaptación | A-03, R-13 |
| retiro del benchmark hermano | H-R15, R-15 |

---

## 2. Inventario de limpieza convertido en tareas

### 2.1 Código y contratos (tabla B del diagnóstico)

| Id | Qué | Tarea | Comprobación **antes** | Comprobación **después** |
|---|---|---|---|---|
| B1 | borrar `loadJson` | R-06 | `grep -rn "loadJson" research/agent research/bench` → 1 línea (`contracts.mjs:21`) | 0 líneas |
| B2 | borrar `identifiersForAbout`; una sola función `identifiersForDocument` | R-06 (R-09a la reescribe declarativa) | `grep -rn "identifiersForAbout" research/` → 1 línea | 0 líneas; `grep -rn "identifiersForDocument" research/agent` → definición + usos en `registry.mjs` |
| B3 | borrar `BudgetStop` | R-06 | `grep -rn "BudgetStop" research/` → 1 línea | 0 líneas |
| B4 | conservar `intakeToProfile`, con test | R-06 | `grep -rn "intakeToProfile" research/tests` → 0 | ≥ 1 (ACC-23b de R-06) |
| B5–B9 | `loadInvestorJson`, `classifyActivity`, `assertUnknownNeverMet`, `preannotateInvestorItems`, prompts investor v1 sin uso | R-15 (con H-R15) | `ls research/bench/investors` → 20 archivos | carpeta inexistente; prompts v1 quedan en el manifest como historia |
| B10 | validar `manual_search` al leerla | R-05 | `grep -rn "validate('manual_search'" research/bench` → 0 | 1 |
| B11 | usar `max_tokens.*`, `temperatures.*`, `expected_model_id` | R-03 | `grep -n "maxTokens:8000" research/agent/extractor.mjs` → 1 | 0; ACC-58 |
| B12 | `code_sha` real | R-03 | `grep -n "0000000" research/agent/run.mjs` → 1 | solo como valor de tests en `status: draft`; ACC-58c |
| B13 | `decide` reaplica la regla | R-05 | `cli.mjs:93` no importa `decide` | ACC-57b |
| B14 | retirar el benchmark hermano | R-15 | — | ver R-15 |
| B15 | `research/bench/out/*` antiguos | — (persona) | — | — |

### 2.2 Variables de entorno (tabla C del diagnóstico; Anexo C)

| Acción | Tarea | Comprobación antes | Después |
|---|---|---|---|
| Documentar en `research/.env.example` las 50 variables que lee producción y faltan (lista L1 de ACC-74) y las 3 del preanotador (lista L2) | R-07 | `node -e` de ACC-74 → 53 ausentes | 0 ausentes |
| Marcar en `.env.example` los alias que lee producción (`SCRAPEGRAPH_API_KEY` ≡ `SGAI_API_KEY`, `TYPESAFE_API_KEY` ≡ `JEV_API_KEY`) y los respaldos de modelo (`INTAKE_LLM_*` → `chat` → `engine`) | R-07 | sin comentario | comentario `# alias de …` en la línea |
| Borrar variables | — | **ninguna**: 230 de 231 tienen lector; la restante es `APOLLO_API_KEY` | decide la persona en H-ENV |
| Copias `research/.env.bak-*` y `.env.tmp` con secretos | H-ENV (persona) | 6 archivos | lo que decida la persona |

---

## 3. ACC nuevos (escritos antes de las tareas)

Convenciones de `docs/handoff/ACCEPTANCE.md`. `F = research/tests/agent/fixtures/world-v1`, `E = F/expected.json`. Los tests nombran el ACC al inicio del título.

### ACC-50 · Caracterización de grants (digest de comportamiento)

Helper `research/tests/agent/helpers/digest.mjs` = **copia literal del Anexo D.1**. Harness = Anexo D.2: `runCase` con `seed: 101`, `createBenchCache({path: ':memory:', namespace: 'char-<X>'})`, tools fixture con `clock: () => 0`, `deps.clock = () => '2026-10-20T00:00:00.000Z'` y `onPlannerInput` que guarda `structuredClone(input)`.

| Condición | `digestSha(behaviorDigest(…))` hoy (`main`, `ed9fa6a`) | Desde R-02 |
|---|---|---|
| B0 | `c59bd43512ddfd633f1e69a2dcd876db610433f4871b358341792295d9904f13` | igual |
| B1 | `e5eed2554c7c12539757476f28ff8e1d058fc0db0162ecf7439696336cc8ce85` | igual |
| B2 | `ffc4bf0f22dabca69d88068d374bcdd27592fa285483cddb9885e05fe05b4423` | `4f6e3ef667d333fab8529bde3f7f29a22cbce6e73b9d2b2d67eeaa48d51bb39a` (ACC-53) |

Hasta R-09a el test usa el lector `V1`; desde R-09b usa `V2` y los valores **no cambian**. Los valores de la columna «hoy» se comprobaron dos veces seguidas en una copia del repo (deterministas).

### ACC-51 · Lo que ACC-18/19/20 piden y `e2e.test.mjs` no comprueba

Para cada `X ∈ {B0, B1, B2}` con el harness de ACC-50:
- (a) Por cada búsqueda `i`, `{query, origin, result_ids, signals.new_unique_docs, signals.duplicates, signals.new_official_opportunities, signals.searches_without_new_official}` del log `search` es igual a `E.conditions[X].searches_log[i]` sin las claves `search_index` y `result_pages`. (Desde R-09b, con los nombres v2 de `ARCHITECTURE_AGENT.md` §4.2.)
- (b) Solo B0: las queries ejecutadas son `E.b0_queries.map(q => q.query)` hasta la parada (las 8).
- (c) Solo B1/B2: el array de `actions_rejected` de cada log `planner_call` es igual a `E.conditions[X].planner_rejected`.
- (d) Solo B2: `plannerInputs.find(i => i.step === 1).gaps.map(g => g.gap_id)` es `E.conditions.B2.gaps_offered_at_call_1` = `["g-6081c557","g-bca609ee","g-e8e0f6f2","g-ad338336"]`, y ese input valida contra `planner_input`.
- (e) `result.entities.map(e => e.stable_id)` es `E.conditions[X].entities_in_registration_order`.
- (f) Ningún log `planner_call`, `search` ni `fetch` contiene, a ninguna profundidad, las claves `judgment`, `eligibility_class` ni `recommendable`.

Hoy (a)–(e) se cumplen (comprobado a mano); (f) se comprueba aquí por primera vez.

### ACC-52 · Pureza del núcleo

Archivos: `research/agent/*.mjs` y `research/agent/tools/*.mjs` (no entran `research/agent/domains/**` ni `research/agent/testing/**`). Se quitan los comentarios (`/* … */` y `// …` hasta fin de línea, fuera de cadenas) y se buscan estas regex; el total debe ser **0**:

```
/\bgrants?\b/i  /\binvestors?\b/i  /opportunit/i  /\bnih\b/i  /\bnsf\b/i  /grantsgov/i  /\bdeadline/i
/closes_on|opens_on/  /\bfunders?\b/i  /\bissuer/i  /\binstrument\b/i  /\broute\b/i  /\bawards?\b|\bawarded\b/i
/\b[GP]-[A-Z]/  /\bINV-/  /\btoy\b/i  /\bT-[A-Z]/  /\bTOY-/  /\bwidgets?\b/i
```

Además: `grep -rn "pack.id ===\|pack\.id==" research/agent/*.mjs research/agent/tools` → 0. Se activa en R-09b.

### ACC-53 · Un link descargado deja de ofrecerse (corrige D2)

Con el harness de ACC-50 en B2:
- `plannerInputs[2].links_unfetched` es `[]` (hoy `["l000-00"]`).
- `plannerInputs[2].gaps.map(g => g.gap_id)` es `["g-6081c557","g-bca609ee","g-5eff6270"]` (hoy, además, `g-e8e0f6f2`).
- El log `planner_call` del paso 2 tiene `gaps_offered: 3` (hoy 4).
- Comparando el digest de antes y el de después, las **únicas** rutas distintas son `planner_gaps[2].gaps` y `planner_calls[2].gaps_offered`.
- Digest B2 = `4f6e3ef667d333fab8529bde3f7f29a22cbce6e73b9d2b2d67eeaa48d51bb39a`.

### ACC-54 · Fusión real (union-find, corrige D8)

Registry nuevo con `today = 2026-10-20` y tres documentos sintéticos no oficiales, con `about` no nulo y `page_type: call`:
- A: identificadores `[nih:RFA-AG-27-010]` (+ url de A);
- B: `[nsf:23-525]` (+ url de B);
- C: `about.identifier_texts = ["RFA-AG-27-010", "NSF 23-525"]`, ambos literales en el texto.

Al registrarlos en orden A, B, C: `entities().length === 1`; `stable_id === 'opp:nih:RFA-AG-27-010'`; `source_doc_ids` = `[docA, docB, docC]`; la respuesta de `register` para C es `{isNew: false, newOfficial: false, merged: ['opp:nsf:23-525']}`. Si A tiene un `REQ-01` y B un `REQ-01` con otro texto, tras la fusión las evidencias de B usan `REQ-02`.

### ACC-55 · Correcciones del núcleo contra el diseño (no cambian ACC-50)

- (a) `link_id`: extracción con `official_links = [{url no literal}, {url literal}]` en `fetchSeq 0` → el aceptado es `l000-00` (hoy `l000-01`).
- (b) `new_official_domains`: `searchSignals` con un documento oficial de `nih.gov` cuando `nih.gov` ya estaba en los documentos oficiales de la corrida → `[]` (hoy `["nih.gov"]`).
- (c) Tope de `REQ`: una entidad con 10 `REQ-xx` verificados → el `criteria_json` del judge incluye exactamente `REQ-01`…`REQ-08`, y `applyRules` solo devuelve esos 8 `REQ`.
- (d) `creates_entity`: extracción con `page_type: "report"` y `about` no nulo → `register` devuelve `{stable_id: null, isNew: false, newOfficial: false}`, pero sus `mentions` y `official_links` se guardan con `stable_id: null`.
- (e) Página con `about: null` y `mentions: [{name: "Part the Cloud Challenge", identifier_text: null}]` → `registry.mentions().length === 1`.
- (f) `issuer_match` con una evidencia `G-ENTITY` cuya cita **no** es literal y `how_to_apply_quote: null` → `none` (hoy `issuer_match`).
- (g) Extracción que falla: con un transport que devuelve `'not json'` dos veces para la URL de p2 en B0 → no hay `fatal_error`; el log `fetch` de p2 lleva `errors[0].code === 'LLM_BAD_JSON'` y `errors[0].ref === E.doc_ids.p2`; no hay log `extract` para p2; `opp:nsf:23-525` no está en `result.entities`; `result.totals.fetches === E.conditions.B0.fetches`.
- (h) ACC-50 no cambia (B0, B1 y B2 desde R-02).

### ACC-56 · Métricas por intersección de identificadores (corrige D1)

Pool de un ítem: `{item_key: 'k1', stable_id: 'opp:nih:RFA-AG-27-010', identifiers: [nih:RFA-AG-27-010, url:grants.nih.gov/grants/guide/rfa-files/rfa-ag-27-010.html], from: {anchor: true}}`. Label `adjudicator` sobre `opp:nih:RFA-AG-27-010` con `status: open, scope: on, hard_eligibility: eligible, route: direct_apply` (gain 3). Corrida R2 con `ranked = [{stable_id: 'opp:url:grants.nih.gov/grants/guide/rfa-files/rfa-ag-27-010.html', recommendable: true}]` y su entidad con el identificador `url:` anterior.
- `pooled_recall_at_20(R2) = 1` (hoy 0); `ndcg_at_10(R2) = 1` (hoy `0`); `hit_at_20(R2) = 1` (igual que hoy).
- `hard_false_positive_rate(R2) = 0` (hoy `null`).
- Los valores de ACC-35 no cambian; el test se adapta solo para pasar `item_key`.

### ACC-57 · CLI y reporte

- (a) `report.md` contiene, literales, los 7 párrafos de `docs/BENCHMARK_PROTOCOL.md:225-231` sin el `N. ` inicial.
- (b) `decide --bench <b>` sobre un `metrics_report.json` cuyo `decision` se borró a mano lo vuelve a escribir igual al que produjo `metrics`.
- (c) `sample` escribe `labeling/second-<case_id>.csv` con las columnas de ACC-33 y exactamente `min(10,|S3|) + min(10,|S5|) + min(10,|S4 ∪ S6|)` filas, sin repetir `item_key` y todas presentes en la hoja principal. Selección: `shuffle` con `mulberry32(seed)` sobre cada estrato, en el orden S3, S5, S4 ∪ S6.
- (d) `preannotate` y `metrics` usan `--config`; sin `--config`, salen con código 1.
- (e) Un archivo `cases/manual/<case>.json` inválido hace fallar `pool` con `ContractError` (`manual_search`).
- (f) El `source_text` del preanotador es: hasta 3 documentos fuente, primero los oficiales, cada uno `excerptForExtraction(text, 8000)`, unidos por `\n=== <url> ===\n` (`prompts/README.md`), y `issuer` = `attributes.issuer.name` del ítem cuando existe.

### ACC-58 · Fidelidad de la configuración (B11, B12, D6, D11)

- (a) Con `F/run_config.json` (`max_tokens.extractor = 3000`), cada llamada del extractor envía `max_tokens: 3000` (hoy 8000).
- (b) Con `agent_model.expected_model_id = "other-model"` y el transport fixture (`fixture-model`): `runCase` termina con `stop_reason: 'fatal_error'`, escribe `result.json` válido y relanza un error con `code: 'CONTRACT'` y mensaje que contiene `expected_model_id`.
- (c) `versions.code_sha === deps.codeSha` cuando se pasa. El CLI lo calcula como `git rev-parse --short=12 HEAD` más `-dirty` si `git status --porcelain -- research docs prompts` no está vacío. Con `status: frozen` y sin `codeSha`, `runCase` lanza `CONTRACT`.
- (d) `run_start.case_sha256 = d2e46658d93bccd2a2f073a09e0ec0e252990667dcf2d476a1a1c456a2295bf1` y `run_start.run_config_sha256 = e4b48626dba6da6e56315ef80f3dbedd06fcc5528acb1174551e8733d5a29095` (sha256 de los bytes de `F/case.json` y `F/run_config.json`; hoy se calcula sobre `JSON.stringify`: `2b03467c…` y `365d1e34…`). Lo calculan quien lee el archivo (CLI y tests) y lo pasan en `deps.hashes`.
- (e) El CLI, con `search.provider = fixture`, crea las tools de búsqueda y descarga con `clock: () => 0`: dos corridas seguidas dan el mismo `seconds_discovery_nominal`.
- (f) ACC-50 no cambia.

### ACC-59 · Validación del paquete (`validateDomainPack`)

Sobre una copia en memoria del paquete grants (A-01 + R-08). Cada fila modifica una sola cosa:

| # | Modificación | Resultado |
|---|---|---|
| 1 | sin `entity_type` | `PACK_INVALID` |
| 2 | `pack.mjs` sin `gain` | `PACK_INVALID` |
| 3 | `schemas.validity = "domains/grants/missing"` | `PACK_INVALID` |
| 4 | `codeEvaluators` sin `P-ROUTE` | `PACK_INVALID` |
| 5 | `ranking.scope_criterion = "G-NOPE"` | `PACK_INVALID` |
| 6 | un criterio con `profile_fields: ["applicant.nope"]` | `PACK_INVALID` |
| 7 | `page_types.creates_entity` con `"memo"` | `PACK_INVALID` |
| 8 | `labels.columns` con `"nope"` | `PACK_INVALID` |
| 9 | `nsf.priority = 0` (igual que `nih`) | `PACK_INVALID` |
| 10 | un `regex` igual a `"("` | `PACK_INVALID` |
| 11 | `status: proposed` y `run_config.status: frozen` | `PACK_UNAPPROVED` |
| 12 | `status: proposed` y `run_config.status: draft` | válido |
| 13 | el paquete sin modificar | válido |

### ACC-60 a ACC-63 · Dominio ficticio `toy` (prueba de extensión)

Fixture `research/tests/agent/fixtures/toy-domain-v1/` (A-03). Datos que A-03 debe respetar:
- Paquete: `id: toy`, `entity_type: toy_item`, `stable_id_prefix: tst`, `case_id_prefix: case-`; esquema `code` (priority 0) con `regex: \bTOY-(\d{3})\b`, `flags: g`, `value: TOY-${1}`, `apply_to: ["identifier_texts","doc_url"]`; `url_priority: 1`; `official.config` con `domains: [{domain: "toy.example"}]`, `suffixes: []`; `page_types.values: ["item","news","other"]`, `creates_entity: ["item","news"]`, `primary: ["item"]`; `validity.dateless_parsed_statuses: ["open"]`; `computeValidity` = `open` con `quote: "Status: open"` y el `doc_id` del primer documento **oficial** cuyo texto incluye literalmente `Status: open`; si no, `unknown`; `valid_until`, `valid_from` y `label` siempre `null`. Catálogo: `T-FIT` (hard, llm, always, `profile_fields: ["need.topic"]`), `T-OPEN` (hard, code, always). `codeEvaluators.T-OPEN`: `open → met`, otro → `unknown`. `recommendable: {classes: ["eligible","eligible_pending"], required_met: ["T-FIT","T-OPEN"], extras_not_in: {}}`; `ranking.scope_criterion: T-FIT`; `b0.vars: {topic: {path: "need.topic"}, year: {special: "today_year"}}`; plantillas `tpl-1: "{topic} items"`, `tpl-2: "{topic} catalog {year}"`.
- Perfil: `need.topic = "widgets"`, `need.region = null`. `run_config/2`: `today 2026-10-20`, `budgets {searches 3, fetches 6, tokens_nominal 100000, seconds_nominal 1000, planner_calls 3}`, `patience_n 2`, `default_fetch_per_search 2`, `b2 {initial_batch 1, max_searches_per_step 1, max_extra_fetches_per_step 1}`, `judge {max_entities 20, max_evidence_per_entity 5}`.
- Páginas (keywords para el buscador fixture, misma regla que `createFixtureSearch`):
  - t1 `https://toy.example/items/TOY-001`, keywords `[widgets, items, catalog]`, texto con `Widget One serves widgets buyers in every region.` y `Status: open`. Extracción: `page_type: item`, `about {name: "Widget One", identifier_texts: ["TOY-001"]}`, evidencia `T-FIT` con esa frase.
  - t2 `https://news.example/2026/widgets`, keywords `[widgets, items, news]`, texto que menciona `TOY-002` y **no** contiene `Status: open`. Extracción: `page_type: news`, `about {name: "Widget Two", identifier_texts: ["TOY-002"]}`, sin evidencia.
  - t3 `https://toy.example/items/TOY-002`, keywords `[widget, two, official]`, texto con `Widget Two serves widgets buyers in every region.` y `Status: open`. Extracción: `page_type: item`, `about {name: "Widget Two", identifier_texts: ["TOY-002"]}`, evidencia `T-FIT` con esa frase.
- Judge (por `stable_id`, igual en las tres condiciones): `tst:code:TOY-001` → `T-FIT met` con `evidence_ids: ["ev-0ce4244dcc8e52bd"]`; `tst:code:TOY-002` → `T-FIT met` con `["ev-492906dda2009986"]`.
- Planner: B1 llamada 0 → `[search "widgets items"]`. B2 llamada 0 → `[search "widgets items"]`; llamada 1 → `[search "widget two official", targets ["g-51f2fbe4"]]`; llamada 2 → `{actions: [], stop: true}`.

Ids precalculados: `docId(t1) = doc-0b6d53e11eab5748`, `docId(t2) = doc-58e0396676158ad5`, `docId(t3) = doc-e70c9c9ac37ea145`; evidencias `ev-0ce4244dcc8e52bd` (t1) y `ev-492906dda2009986` (t3); gap `official_source_missing` de TOY-002 = `g-51f2fbe4`.

**ACC-60 (B0):** `stop_reason: no_more_actions`; `totals {searches: 2, fetches: 2, planner_calls: 0, tokens_discovery_nominal: 2200, tokens_judge_nominal: 2200}`; queries `["widgets items", "widgets catalog 2026"]`; entidades en orden `["tst:code:TOY-001", "tst:code:TOY-002"]` con `official [true, false]`; señales de la búsqueda 0: `new_verified_entities ["tst:code:TOY-001"]`, `validity_parsed 1`, `searches_without_new_verified 0`; de la búsqueda 1: `[]`, `0`, `1`; `ranked` = mismas dos en ese orden con `recommendable [true, false]`; el criterio `T-FIT` de TOY-002 queda `unknown` con `overrides ["R7_foreign_evidence","R1_no_evidence"]`; `abstained: false`.
**ACC-61 (B1):** `stop_reason: no_more_actions`; `totals {searches: 1, fetches: 2, planner_calls: 1, tokens_discovery_nominal: 3300, tokens_judge_nominal: 2200}`; entidades y `ranked` como en ACC-60.
**ACC-62 (B2):** `stop_reason: no_more_actions`; `totals {searches: 2, fetches: 3, planner_calls: 3, tokens_discovery_nominal: 6600, tokens_judge_nominal: 2200}`; queries `["widgets items", "widget two official"]`; gaps del paso 1 = `["g-51f2fbe4"]`; entidades `["tst:code:TOY-001", "tst:code:TOY-002"]` con `official [true, true]`; TOY-002 con `official_basis: curated_list`, `source_doc_ids ["doc-58e0396676158ad5","doc-e70c9c9ac37ea145"]` y `canonical_url` de t3; señales de la búsqueda 1: `new_verified_entities ["tst:code:TOY-002"]`; `ranked` = `[TOY-001, TOY-002]`, ambas `recommendable: true`.
**ACC-63:** en los tres casos `result.json` y cada línea de `steps.jsonl` validan contra `run_result/2` y `log_entry/2`; las entidades validan contra `domains/toy/entity_attributes` y `domains/toy/validity`; ACC-52 pasa; `git diff --name-only` del PR de R-10 solo contiene `research/tests/agent/toy_domain.test.mjs`.

### ACC-64 · El paquete grants no cambia lo que ve el modelo

- `bundle('domains/grants/extraction')`, `bundle('domains/grants/judge_output')` y `bundle('domains/grants/preannotator_output')` son `deepStrictEqual` a `bundle('extraction')`, `bundle('judge_output')` y `bundle('preannotator_output')` de v1.
- Los ids y sha de los prompts del extractor, el judge y el preanotador que usa grants son los de `prompts/manifest.json` (sin cambios).
- ACC-50 con el lector `V2` da los mismos valores.

### ACC-65 · Identificadores declarativos = v1

Con el paquete grants: `identifiersForDocument(pack, {acceptedTexts: [t], url: null, officialHost: null})` devuelve, para cada fila de ACC-07, la misma lista que `identifiersFromText(t)` (sin el identificador `url`). `stableIdOf(pack, ids)` devuelve los dos valores de ACC-07. Para cada página del fixture, el `stable_id` final es el de `E.stable_ids`.

### ACC-66 · Plantillas B0 declarativas = v1

`b0Queries(packGrants, F/profile.json, templates b0_templates@v1, '2026-10-20')` es exactamente `E.b0_queries` (array de `{template_id, query}`, mismo orden).

### ACC-67 · Validez de investors (`computeValidity`)

`today = 2026-10-20`, `recency_days = 548`. Documentos oficiales salvo que se diga lo contrario; «literal» = la cita está en el texto del documento.

| Caso | `about` de los documentos | `status` | `valid_from` | `label` | `conflict` |
|---|---|---|---|---|---|
| 1 | `recent_activity: [{quote: "In August 2026 we led the seed round of Clinic One."}]` | `active` | `2026-08-31` | `last_investment` | `false` |
| 2 | `recent_activity: [{quote: "On 12 March 2024 we led the seed round of Old Co."}]`, `thesis_quote` literal | `possibly_active` | `2024-03-12` | `thesis` | `false` |
| 3 | igual que 1 más `inactive_quote: "We stopped making new investments in 2025."` | `inactive` | `2026-08-31` | `inactive` | `true` |
| 4 | todo `null` o vacío | `unknown` | `null` | `null` | `false` |
| 5 | caso 1 pero el documento **no** es oficial | `unknown` | `null` | `null` | `false` |
| 6 | caso 1 con una cita no literal | `unknown` | `null` | `null` | `false` |
| 7 | `recent_activity: [{quote: "In December 2026 we will open Fund III."}]` (fecha futura) | `unknown` | `null` | `null` | `false` |
| 8 | cita con fecha `2025-04-20` (548 días) | `active` | `2025-04-20` | `last_investment` | `false` |
| 9 | cita con fecha `2025-04-19` (549 días), sin tesis | `unknown` | `2025-04-19` | `null` | `false` |

En todos los casos `valid_until = null`, `computed_by = code` y el resultado valida contra `domains/investors/validity`. Las fechas salen de `parseDates` (`dates.mjs:64`), aceptando `precision ∈ {day, month}`, `!yearless` e `iso ≤ today` (el mes cuenta como su último día: `August 2026 → 2026-08-31`).

### ACC-68 · Identidad y fuente oficial de investors

- (a) `identifier_texts` `"www.BetaHealth.example"` y `"https://betahealth.example/"` dan `domain:betahealth.example`; `"CIK: 0001234567"` da `sec_cik:1234567`.
- (b) `stableIdOf` de `[domain:betahealth.example, sec_cik:1234567, url:x]` = `inv:domain:betahealth.example`.
- (c) `https://betahealth.example/thesis`, `page_type: thesis`, `domain:betahealth.example` desde `identifier_texts` y `thesis_quote` no nulo → `issuer_match`; igual con `page_type: news` → `none`; `https://www.crunchbase.com/organization/beta` → `none`; `https://www.sec.gov/cgi-bin/browse-edgar?CIK=1234567` → `curated_list`.
- (d) Un documento oficial `https://betahealth.example/team` sin `identifier_texts` recibe `domain:betahealth.example` por `official_doc_host`.
- (e) `page_type: portfolio_company_page` o `person_profile` con `about` no nulo → no crea entidad.
- (f) Una noticia sobre «Beta Health Fund» con `identifier_texts: ["betahealth.example"]` literal y después la tesis oficial → una sola entidad `inv:domain:betahealth.example`, oficial.

### ACC-69 · Judge de investors

- `INV-ACTIVE` y `INV-RECENCY` los evalúa `codeEvaluators` con la tabla de `ARCHITECTURE_AGENT.md` §2.10 (`active → met`, `inactive → not_met`, `possibly_active` y `unknown` → `unknown`). La respuesta del LLM para ellos se ignora (`R5_code_criterion`).
- `INV-PORTFOLIO-CONFLICT` en estado `conflict` no cambia `eligibility_class` ni `soft_score`: con todos los `hard` en `met`, la clase es `eligible`.
- `recommendable` es `true` solo si la clase es `eligible` o `eligible_pending` **y** `INV-ACTIVE` y `INV-SECTOR` están en `met`.
- ACC-14p (2 000 entradas aleatorias) se repite con el catálogo de investors: nunca `met` sin `llm_state = met` en criterios `llm`.

### ACC-70 · `gain`, B0 y aislamiento de investors

- `gain`: los cuatro valores de INV-ACC-07 (`3`, `2`, `1`, `0`) con las mismas etiquetas. `isHardNegative`: `true` para `hard_eligibility: ineligible`, `sector_fit: off` o `active_status: inactive`; `false` para la etiqueta por defecto de INV-ACC-07.
- B0 con `investor-world-v0/profile.json`: `template_id` en orden `["sector-vc","stage-sector","geo-sector","thesis","recent-active"]` (los de INV-ACC-08) y ninguna query contiene `alpha`, `legacy` ni `conflict`.
- `grep -rn "domains/grants" research/agent/domains/investors` → 0 líneas; ACC-52 sigue en 0.

### ACC-71 · B2 cambia su segunda búsqueda según lo que encontró (y B1 no)

Fixture `research/tests/agent/fixtures/investor-world-v1/{A,B}/` (A-03). Planner = `createReactivePlannerTransport(rule)` (R-13, en `research/agent/testing/fixtures.mjs`), con esta regla literal en el test:

```js
const rule = ({ input, mode }) => {
  if (mode === 'initial_batch') return { assessment: 'fixture', actions: [{ type: 'search', query: 'latam healthtech seed investors', targets: ['coverage:vc'], rationale: 'fixture' }], stop: false };
  const g = input.gaps.find(x => x.type === 'mention_unresolved');
  return g ? { assessment: 'fixture', actions: [{ type: 'search', query: `${g.detail} venture fund`, targets: [g.gap_id], rationale: 'fixture' }], stop: false }
           : { assessment: 'fixture', actions: [], stop: true };
};
```

Mundos (solo cambia la mención de la noticia y la página de la firma):
- A: `https://news.example/2026/latam-healthtech-rounds` (keywords `[latam, healthtech, seed, investors]`, `page_type: news`, `about {name: "Alpha Seed Fund", identifier_texts: []}`, `mentions [{name: "Beta Health Fund", identifier_text: null}]`) y `https://betahealth.example/thesis` (keywords `[beta, health, fund, venture]`, `page_type: thesis`, `about {name: "Beta Health Fund", identifier_texts: ["betahealth.example"], thesis_quote: <literal>, recent_activity: [{quote: "In August 2026 we led the seed round of Clinic One."}]}`).
- B: la misma noticia con `mentions [{name: "Gamma Bio Capital", …}]` y `https://gammabio.example/thesis` (keywords `[gamma, bio, capital, venture, fund]`, `about {name: "Gamma Bio Capital", identifier_texts: ["gammabio.example"], …}`).

Resultados exactos con el paquete investors (`today 2026-10-20`):
- B2 en A: queries `["latam healthtech seed investors", "Beta Health Fund venture fund"]`; `planner_calls: 3`; `stop_reason: no_more_actions`; entidades `["inv:url:news.example/2026/latam-healthtech-rounds", "inv:domain:betahealth.example"]` con `official [false, true]` y la segunda `official_basis: issuer_match`, `validity.status: active`.
- B2 en B: queries `["latam healthtech seed investors", "Gamma Bio Capital venture fund"]`; entidades `[…/latam-healthtech-rounds, "inv:domain:gammabio.example"]`.
- B1 en A y en B: queries `["latam healthtech seed investors"]` (idénticas en los dos mundos); `planner_calls: 1`.
- La segunda query de B2 **difiere** entre A y B, y la de B1 no: esa es la prueba de adaptación.

### ACC-72 · Benchmark multi-dominio

- `validate --domain grants --config research/bench/domains/grants/config/v0.json --cases research/bench/domains/grants/cases` → código 0. El mismo comando con `--domain investors` → código 1 y mensaje con `domain mismatch`.
- Columnas de la hoja para grants = las de ACC-33. Para investors = `item_key, case_id, profile_summary, name, urls, identity_correct, entity_kind, active_status, sector_fit, stage_fit, geography_fit, check_fit, round_fit, business_model_fit, lead_fit, hard_eligibility, portfolio_conflict, overall_relevance, criteria_to_label, confidence, notes`.
- ACC-30 a ACC-40 pasan con `--domain grants`. `deadline_accuracy` vale `null` en todas las corridas de investors.
- `cmp research/bench/config/v0.json research/bench/domains/grants/config/v0.json` (antes del `git mv`, contra el commit anterior) → bytes idénticos.

### ACC-73 · `B_prod` nunca entra en la decisión

Con 2 corridas sintéticas de referencia añadidas a un benchmark sintético: `metrics_report.decision` es `deepStrictEqual` al de sin referencia; existe `reference_metrics.B_prod`; `report.md` contiene el título `Referencia (no forma parte de la decisión)`; ninguna hoja de `labeling/` contiene `B_prod`.

### ACC-74 · `.env.example` documenta lo que se lee

Test `research/tests/agent/env_example.test.mjs`: cada nombre de **L1** y **L2** aparece en `research/.env.example` como `^#?\s*NOMBRE=`; ninguna línea de una variable que termina en `KEY` o `TOKEN` tiene valor no vacío.
- **L1 (50):** `ADVISOR_AUTO ADVISOR_MODEL ADVISOR_ROLE ENGINE_DATE_REREAD_MAX ENGINE_EXPAND_ROLE ENGINE_EXPAND_SIMILAR ENGINE_LLM_THINKING ENGINE_QUERY_YEAR ENGINE_RESEARCH_CANDIDATES ENGINE_TBS ENGINE_TRACE_MAX ENGINE_TRACE_SKIPPED_MAX EXA_TEXT_CHARS FIRECRAWL_CACHE FIRECRAWL_RATE_BACKOFF_MS FIRECRAWL_SCRAPE_TIMEOUT_MS FIRECRAWL_SEARCH_TIMEOUT_MS GRANT_API_QUERIES GRANT_PAGE_MODEL GRANT_WEB_CREDITS GRANT_WEB_MODEL_QUERIES HUNTER_TIMEOUT_MS INTAKE_LLM_MAX_TOKENS INTAKE_LLM_REASONING_EFFORT INTAKE_LLM_ROLE JINA_SEARCH_CONTENT JINA_TIMEOUT_MS LINKUP_TIMEOUT_MS ORCHESTRATOR_JEV_TIMEOUT_MS ORCHESTRATOR_MIN_REMAINING_MS PAGE_READER_ORDER PLAYWRIGHT_CHROMIUM_EXECUTABLE QUERY_EXPAND_EXA_MAX QUERY_EXPAND_LLM QUERY_EXPAND_MAX QUERY_EXPAND_TIMEOUT_MS REGISTRY_VERIFY RESEARCH_BROWSER RESEARCH_BROWSER_JPEG_QUALITY RESEARCH_BROWSER_TIMEOUT_MS RESEARCH_PUBLIC_ORIGIN SCRAPEGRAPH_API_KEY SEARCH_COMPLEMENT SEARCH_PROVIDER SEARXNG_TIMEOUT_MS SERPER_TIMEOUT_MS TYPESAFE_API_KEY WEB_LINKEDIN_MAX_PAGES WEB_TIMEOUT_MS YOU_API_URL`
- **L2 (3):** `PREANNOTATOR_BASE_URL PREANNOTATOR_MODEL PREANNOTATOR_API_KEY`
- `NODE_TEST_CONTEXT` no se documenta: la pone Node.

### ACC-75 · Estilo y comentarios (§5)

Test `research/tests/agent/style.test.mjs` sobre `research/agent/**/*.mjs` y `research/bench/*.mjs`:
- (a) ninguna línea supera 140 caracteres, salvo líneas que contienen un literal de regex (`/…/flags`) o están dentro de un array literal de datos marcado con el comentario `// datos`;
- (b) cada `export function`, `export async function` y `export const <x> = (` va precedido (ignorando líneas en blanco) por un bloque `/** … */` que contiene `@returns` y, si la función tiene parámetros, `@param`;
- (c) cada archivo empieza con un bloque de comentario de módulo (§5.2);
- (d) `grep -rn "await import(" research/agent` → 0.

---

## 4. Tareas

Formato fijo: objetivo, puede tocar, no tocar, especificación, ACC, comprobación, depende de.

### H0 · Commit del trabajo de inversores (persona)
La persona commitea, en una rama suya, los archivos sin seguimiento de DIAGNOSIS §0 y el cambio de `research/package.json`. Codex no empieza R-01 mientras `git status --short` muestre esos paths.

### R-01 · Tests de caracterización
- **Objetivo:** congelar el comportamiento de grants en world-v1.
- **Puede tocar:** crear `research/tests/agent/helpers/digest.mjs` (Anexo D.1, literal) y `research/tests/agent/characterization.test.mjs` (Anexo D.2 + ACC-51).
- **No tocar:** todo lo demás.
- **ACC:** 50 (columna «hoy»), 51.
- **Comprobación:** antes, `npm --prefix research run test:agent` → 56 pass. Después, ≥ 58 pass y `git diff --name-only` = los 2 archivos.
- **Depende de:** H0.

### R-02 · Links descargados (D2)
- **Puede tocar:** `research/agent/search_agent.mjs`, `research/agent/registry.mjs`, `research/tests/agent/loop.test.mjs`, `research/tests/agent/characterization.test.mjs` (solo el valor esperado de B2).
- **Especificación:** `registry.markFetchedUrl(normalizedUrl)` marca `fetched = true` en todo link con `normalizeUrl(link.url) === normalizedUrl`. `fetchRef` lo llama después de **cada** intento de descarga (con o sin éxito). Al reconstruir `state.resultRefs` desde `registry.links()`, cada copia lleva `fetched: fetchedSet.has(normalizeUrl(link.url))`. `computeGaps` y `buildPlannerInput` siguen leyendo `registry.links()`.
- **ACC:** 53; 50 con B0/B1 iguales y B2 = `4f6e3ef6…`.
- **Cambio declarado:** solo B2, rutas `planner_gaps[2].gaps` y `planner_calls[2].gaps_offered`.

### R-03 · Fidelidad de la configuración
- **Puede tocar:** `research/agent/extractor.mjs`, `research/agent/eligibility_judge.mjs`, `research/agent/llm.mjs`, `research/agent/run.mjs`, `research/agent/search_agent.mjs`, `research/bench/cli.mjs`, `research/bench/preannotate.mjs`, `research/tests/agent/{e2e,llm,characterization}.test.mjs` (en `characterization` solo para pasar `deps.hashes`).
- **Especificación:** `extractDocument` recibe `maxTokens = config.max_tokens.extractor`; el judge usa `config.temperatures.judge` y el preanotador `temperatures.preannotator` y `max_tokens.preannotator`. `createLlm({expectedModelId})` compara `response.model` en cada respuesta no cacheada y en cada acierto de caché (`modelId` guardado); si difiere lanza `ContractError('run_config', [{message: 'expected_model_id mismatch: <esperado> vs <recibido>'}])`. `runCase` acepta `deps.codeSha` y `deps.hashes = {case_sha256, run_config_sha256}`; con `config.status === 'frozen'` ambos son obligatorios (`CONTRACT`); con `draft` y sin ellos usa `'0000000'` y el sha de `JSON.stringify`, como hoy. El CLI los calcula (ACC-58c, d) y crea las tools fixture con `clock: () => 0`.
- **ACC:** 58; 50 sin cambios.

### R-04 · Correcciones del núcleo contra el diseño
- **Puede tocar:** `research/agent/{registry,extractor,signals,search_agent,eligibility_judge,docs,identifiers}.mjs`, `research/tests/agent/{extract,loop,judge,docs,e2e}.test.mjs`.
- **Especificación:** union-find de `ARCHITECTURE_AGENT.md` §2.4 (en v1 sin log `merged_into`; `register` devuelve `merged`); `link_id` con índice entre aceptados; `searchSignals` recibe `seenOfficialDomains: Set` y lo actualiza el llamador; tope de 8 `REQ` en el judge (los de número menor); `creates_entity = ['call','program_page','award_record','news','blog']` como constante del módulo hasta R-09a; menciones y links de páginas con `about = null` se guardan con `stable_id: null` y su gap `link_unfetched` tiene `opportunity_ref: null`; `officialBasisOf` recibe `acceptedEvidence` (evidencia ya verificada) y la usa para `G-ENTITY`; un `LlmError` del extractor se registra en el log `fetch` de ese documento (`errors: [{code, message, ref: doc_id}]`), no se escribe log `extract` y la corrida sigue.
- **ACC:** 54, 55; 50 sin cambios.

### R-05 · Benchmark: coincidencia por identificadores y CLI
- **Puede tocar:** `research/bench/{metrics,pool,sample,report,cli,preannotate,labels}.mjs`, `research/tests/agent/bench.test.mjs`.
- **Especificación:** `matchToPool` de `ARCHITECTURE_BENCHMARK.md` §2.6 y todas las métricas por `item_key`; texto literal de amenazas (ACC-57a); `decide` reaplica la regla; hoja `second-<case>.csv`; `--config` obligatorio en `preannotate` y `metrics`; validar `manual_search`; `source_text` del preanotador según `prompts/README.md`.
- **ACC:** 56, 57; 30–40 siguen pasando (ACC-35 solo adapta entradas).

### R-06 · Código muerto y legibilidad (sin cambiar comportamiento)
- **Puede tocar:** `research/agent/**/*.mjs` (excepto `config/`), `research/bench/*.mjs`, `research/tests/agent/profile.test.mjs` (ACC-23b), nuevo `research/tests/agent/style.test.mjs`.
- **Especificación:** borrar B1 y B3; borrar B2 y mover su lógica a `identifiersForDocument({acceptedTexts, url})` en `identifiers.mjs` (mismo resultado que hoy `registry.mjs:16`), que `registry.mjs` usa; reescribir cada archivo en formato legible con el estándar del §5 (una sentencia por línea, funciones ≤ 60 líneas, docblocks). `search_agent.mjs` se divide en funciones con nombre: `createBudget`, `checkStop`, `fetchAndExtract`, `executeSearch`, `plannerStep`, `runB0`, `runB1`, `runB2` (las tres últimas, en `conditions.mjs`, para cumplir `ARCHITECTURE.md` §2). `import()` dinámico → estático. **ACC-23b:** `intakeToProfile({'company.name': 'AHA', 'company.entity_type': 'nonprofit'}, {as_of: '2026-10-20'})` → `applicant.entity_type.value = 'nonprofit'`, `provenance.source_kind = 'intake'` y valida contra `profile`.
- **ACC:** 75, 23b; 50 sin cambios; todos los tests anteriores pasan sin cambiar sus aserciones.
- **Comprobación:** greps de §2.1 (B1–B4).

### R-07 · `.env.example`
- **Puede tocar:** `research/.env.example`, nuevo `research/tests/agent/env_example.test.mjs`.
- **Especificación:** añadir L1 y L2 como líneas comentadas `# NOMBRE=` agrupadas bajo los encabezados `# --- Producción (no documentadas hasta 07/10/2026) ---` y `# --- Benchmark: preanotador (nombres que fija run_config.preannotator_model) ---`, con una línea de comentario por variable copiada del uso en el código (archivo:línea). Marcar los alias de §2.2. No borrar ni reordenar líneas existentes. Ningún valor.
- **ACC:** 74.

### A-01 · Contratos v2 y schemas de paquetes (arquitecto)
Escribe `docs/contracts/v2/*` (common, domain_pack, criterion, criteria_catalog, target_entity, document, evidence, judgment, planner_input, log_entry, run_result, run_config, case, label, manual_search, metrics_report y los 5 `*_skeleton`), `docs/contracts/domains/grants/*` (copias de v1 con `$id` nuevo + `entity_attributes`, `validity`, `label_attributes`, `anchor_attributes`, `criteria_catalog.grant.v2.json`) y `docs/contracts/domains/investors/*` (perfil = `investor_profile/1` sin commit; extracción nueva de `ARCHITECTURE_AGENT.md` §2.10; catálogo v2 propuesto). Ejemplos válidos en `docs/contracts/v2/examples/`. Registra la decisión «contratos v2» como propuesta.

### A-02 · Prompts (arquitecto)
`prompts/core/planner/v1` (prompt único del planner, placeholders `state_json` y `domain_notes`; mantiene las reglas de `prompts/planner/v1/system.md` que no son de grants); `grants_planner_notes@v1` (el texto de dominio de `prompts/planner/v1/system.md:3,11-17,21`); `prompts/investor/{extractor,judge,preannotator}/v2`, `investor_planner_notes@v1` y `prompts/investor/b0/v2/templates.json` (los `template_id` y textos de v1, con `{{x}}` → `{x}` y una plantilla por variante de `geography`). Las notas de dominio solo pueden describir entidad, familias de fuentes y forma de las consultas.

### A-03 · Fixtures (arquitecto)
`research/tests/agent/fixtures/toy-domain-v1/` con los datos de ACC-60 a 63, y `research/tests/agent/fixtures/investor-world-v1/{A,B}/` con los de ACC-71 (páginas marcadas **FIXTURE**, `world.json`, `llm.json` del extractor y del judge, `profile.json`, `case.json`, `run_config.json` v2).

### A-04 · Guía de etiquetado de investors (arquitecto)
Adapta `docs/benchmark/investors/LABELING_GUIDE.md` y `adjudication-template.csv` a `label/2` y a las columnas de ACC-72.

### R-08 · Cargador y validador de paquetes + datos de grants
- **Puede tocar:** nuevos `research/agent/domain_pack.mjs`, `research/agent/domains/grants/{pack.json,pack.mjs,README.md}`; `git mv research/agent/config/official_domains.v1.json research/agent/domains/grants/official.grants.v1.json` (bytes idénticos); `research/agent/contracts.mjs` (cargar `v2/` y `domains/*/`); `research/agent/run.mjs` y `research/bench/cli.mjs` solo para la ruta movida; nuevo `research/tests/agent/pack.test.mjs`; ruta en `contracts.test.mjs` (ACC-01).
- **Especificación:** `loadDomainPack(idOrPath)` → objeto congelado (`Object.freeze` profundo) con `pack.json`, las funciones de `pack.mjs` y `sha256` = sha de la concatenación ordenada por nombre de `pack.json`, `pack.mjs` y el JSON oficial (regla de `prompts/README.md`). `validateDomainPack` con las reglas de `ARCHITECTURE_AGENT.md` §2.8, en ese orden, y `PackError {code}`. El paquete grants tiene los valores de §2.9.
- **ACC:** 59, 65, 66; 50 sin cambios.
- **Depende de:** R-07, A-01, A-02.

### R-09a · El núcleo usa el paquete (salida todavía v1)
- **Puede tocar:** `research/agent/{identifiers,docs,extractor,registry,validity,gaps,signals,planner,conditions,eligibility_judge,ranking,run,search_agent}.mjs`; `git mv research/agent/profile.mjs research/agent/domains/grants/profile_adapters.mjs`; `git mv research/agent/fixtures.mjs research/agent/testing/fixtures.mjs`; imports en `research/bench/*.mjs` y `research/tests/agent/*.test.mjs` (solo rutas y la forma de llamar a funciones que ahora reciben `pack`).
- **Especificación:** cada pieza de la tabla A del diagnóstico marcada **P** se lee del paquete. `identifiersForDocument` pasa a `identifiersForDocument(pack, {acceptedTexts, url, officialHost})` con el algoritmo de `ARCHITECTURE_AGENT.md` §2.4; con `url: null` no aplica los patterns `doc_url` ni añade `urlIdentifier`; con `officialHost: null` no aplica `official_doc_host`. `runCase` recibe `deps.pack` (por defecto `loadDomainPack('grants')`). La salida sigue siendo v1: el registry convierte la validez del paquete (`valid_*`) a los nombres v1 al escribir la entidad, y `judgment.route` sale de `extras.route`.
- **ACC:** 50 sin cambios; ACC-01 a 23 pasan.

### R-09b · Contratos v2 y planner del núcleo
- **Puede tocar:** los mismos archivos de R-09a, `research/agent/logger.mjs`, `research/agent/prompts.mjs` (raíces por paquete), nuevo `research/agent/domains/grants/legacy.mjs`, `research/tests/agent/*.test.mjs` (lectores v2 y adaptadores).
- **Especificación:** salida en contratos v2 (`ARCHITECTURE_AGENT.md` §4); `GAP_ID_CODE` de §3.2; planner con `prompts/core/planner/v1` y `domain_notes`; `callPlanner` pasa `meta = {promptId: 'planner', call_index, condition, mode: input.mode, input}` (el transport real ignora `meta`; ACC-04g sigue pasando); `legacy.mjs` exporta `runConfigV1toV2(config)` (mapeo campo a campo de §4.2; `prompts` → `{planner: 'v1'}`; `domain` → `{id: 'grants', version: 'v1'}`) y `caseV1toV2(caseObj)` (`anchor` → `anchors: [anchor]` con `attributes`; `null_case.rationale` → `conclusion`), que usan los tests con los fixtures v1 (que no se editan).
- **ACC:** 50 con lector `V2` y mismos valores; 52; 64.

### R-10 · Prueba de extensión con el dominio `toy`
- **Puede tocar:** solo `research/tests/agent/toy_domain.test.mjs`.
- **Regla:** si para pasar ACC-60 a 63 hace falta tocar cualquier otro archivo, el diseño tiene un bug: se describe en el PR y **se detiene**.
- **ACC:** 60, 61, 62, 63.
- **Depende de:** R-09b, A-03.

### R-11 · Benchmark general
- **Puede tocar:** `research/bench/*.mjs`; `git mv` de `research/bench/config/v0.json` → `research/bench/domains/grants/config/v0.json`, `research/bench/cases/` → `research/bench/domains/grants/cases/` y `research/bench/pilot/` → `research/bench/domains/grants/pilot/` (los casos piloto v1 se convierten con `caseV1toV2` y se reescriben); nuevos `research/bench/domains/{grants,investors}/domain.json`; `research/tests/agent/bench.test.mjs`; `research/package.json` (solo scripts).
- **Especificación:** `ARCHITECTURE_BENCHMARK.md` §2 y §3.
- **ACC:** 72; 30–40 con `--domain grants`.
- **Depende de:** R-09b.

### R-12 · Paquete investors
- **Puede tocar:** nuevos `research/agent/domains/investors/{pack.json,pack.mjs,official.investors.v1.json,profile_adapters.mjs,README.md}`, nuevo `research/tests/agent/investors_pack.test.mjs`.
- **Especificación:** `ARCHITECTURE_AGENT.md` §2.10 (`status: proposed` hasta H3). `profile_adapters.mjs` exporta `briefToInvestorProfile(brief, meta)`: mismas reglas que `briefToProfile` (nunca defaults; `source` con el campo del brief) sobre los campos de `investor_profile/1`; todo campo sin origen claro queda `null`.
- **ACC:** 67, 68, 69, 70; 59 aplicada al paquete investors (filas 1–13 análogas).
- **Depende de:** R-09b, A-01, A-02.

### R-13 · Fixture de inversores y prueba de adaptación
- **Puede tocar:** `research/agent/testing/fixtures.mjs` (añadir `createReactivePlannerTransport(rule)`: para el rol planner devuelve `rule({input: meta.input, mode: meta.mode})` serializado como respuesta del modelo (`model: 'fixture-model'`, `usage: {prompt_tokens: 1000, completion_tokens: 100}`); para los demás roles delega en `createFixtureTransport`), nuevo `research/tests/agent/investors_core.test.mjs`.
- **ACC:** 71.
- **Depende de:** R-12, A-03.

### R-14 · Referencia `B_prod` (opcional)
- **Puede tocar:** nuevo `research/bench/reference/prod.mjs`; `research/bench/{runAll,metrics,report,cli}.mjs`; `research/tests/agent/bench.test.mjs`.
- **Especificación:** `ARCHITECTURE_BENCHMARK.md` §5. Importa `runObjective` de producción **sin modificarlo**.
- **ACC:** 73.
- **Depende de:** R-11.

### H-R15 · Confirmar el retiro (persona)
La persona confirma en el Registro de decisiones que el benchmark hermano se retira, con la tabla de correspondencia de R-15 a la vista.

### R-15 · Retirar el benchmark hermano de inversores
- **Puede tocar (borrar):** `research/bench/investors/**`, `research/tests/agent/investors.test.mjs`, `research/tests/agent/fixtures/investor-world-v0/**` (después de copiar `profile.json` a `research/tests/agent/fixtures/investor-world-v1/profile-v0.json` para ACC-70), `docs/contracts/investor/**`, `docs/benchmark/investors/ARCHITECTURE.md`, el script `test:investors` de `research/package.json`.
- **No borrar:** `docs/benchmark/investors/{PROTOCOL.md, LABELING_GUIDE.md, DECISIONS_PENDING.md, APOLLO_WARM_PATHS_EXTENSION.md, adjudication-template.csv}` ni las entradas v1 de `prompts/investor/manifest.json`.
- **Correspondencia (cada INV-ACC queda cubierto o se descarta con motivo):**

| INV-ACC | Pasa a |
|---|---|
| 01 contratos | ACC-01 sobre `domains/investors` + ACC-67 |
| 02 prompts versionados | ACC-59 fila 10 (paquete investors) |
| 02e composición LLM | ACC-04 (cliente único) |
| 03 identidad y dedupe | ACC-68 |
| 04 rechaza portfolio, individuos | ACC-68e |
| 05 actividad | ACC-67 |
| 06 judge | ACC-69 |
| 07 gain y ranking | ACC-70 + ranking del núcleo (ACC-16) |
| 08 plantillas B0 | ACC-70 |
| 09, 10 condiciones, presupuestos, paciencia | ACC-18 a 22 del núcleo + ACC-71 |
| 11 nulo se abstiene | se descarta: la abstención la cubre ACC-15; el fixture nulo nuevo queda para A-03 si H2 lo pide |
| 12–15 pool, hoja, labels, preanotación, métricas | ACC-30 a 40 + ACC-72 |
| 16 regla de decisión propuesta | se descarta: la sustituye `decision_rule@v1` (decisión propuesta, H4) |
| 17 aislamiento | ACC-52 + ACC-70 |

- **Depende de:** R-13, H-R15.

---

## 5. Estándar de comentarios y estilo

### 5.1 Qué se comenta
- **Por qué**, no qué: la decisión y su referencia (`// ARCHITECTURE_AGENT §3.2: el gap_id conserva el código v1 para no cambiar ids`).
- **Contratos:** qué schema valida la entrada y la salida.
- **Invariantes:** «nunca convierte `unknown` en `met`», «no lee nada del judge», «orden de registro = rank del resultado».
- **Constantes con origen:** de dónde sale cada número o regex (`// 548 días: investors.test.mjs:71; pendiente H3`).
- **Orden significativo** cuando cambiar el orden cambia el resultado.

### 5.2 Encabezado de módulo (obligatorio)
3 a 6 líneas: responsabilidad, qué **no** hace, contratos que usa y, en el núcleo, la frase «No conoce ningún dominio: todo lo específico llega por el DomainPack».

### 5.3 Docblock (obligatorio en cada función exportada del núcleo y del harness)
```js
/**
 * Registra un documento extraído y lo fusiona por identificadores (union-find).
 * Contrato: devuelve {stable_id, isNew, newOfficial, merged}; valida evidence/2.
 * Invariante: una entidad es nueva solo si ninguna de sus claves se había visto.
 * Puro respecto de red, disco y reloj.
 * @param {{doc: object, extractionResult: object, ctx: {step:number, searchIndex:number, queryId:string}}} input
 * @returns {{stable_id: string|null, isNew: boolean, newOfficial: boolean, merged: string[]}}
 */
```
Si la función tiene efectos, la línea «Puro…» se sustituye por «Efectos: …». Los errores se documentan con su `code`.

### 5.4 Qué no se comenta
Lo obvio (`// incrementa i`), historia (va en git), `TODO` sin dueño ni tarea, código comentado.

### 5.5 Idioma y formato
- Comentarios en **español** en `research/agent/**`, `research/bench/**` y los tests nuevos. Identificadores en inglés, como hoy.
- Una sentencia por línea, 2 espacios, comillas simples, punto y coma; máximo 140 columnas (ACC-75); funciones de 60 líneas como máximo, salvo una excepción justificada en el docblock.
- Sin código minificado. Sin `import()` dinámico en el núcleo.

---

## 6. Pasos humanos y del arquitecto (no se simulan)

| Paso | Quién | Antes de | Qué |
|---|---|---|---|
| H0 | persona | R-01 | commit del trabajo de inversores sin commit |
| H-ENV | persona | cuando quiera | `APOLLO_API_KEY` y copias `research/.env.bak-*`/`.env.tmp` |
| A-01…A-04 | arquitecto | R-08, R-10, R-12, R-13 | contratos, prompts, fixtures, guía |
| **H3 (grants)** | Gisel + Rohit/Mónica | `run-all` de grants | aprobar `criteria_catalog.grant@v2` y `official_domains@v1` (`status: approved`) |
| **H3 (investors)** | Gisel (+ quien conozca VC) | `run-all` de investors | aprobar las 9 decisiones de `ARCHITECTURE_AGENT.md` §2.10, el catálogo `investor@v2`, la lista de hosts no oficiales y `recency_days` |
| H1, H2, H6, H7 por dominio | personas B, curator, adjudicadores | según protocolo | perfiles, anclas, casos nulos, búsqueda manual, adjudicación y segundo revisor (`ARCHITECTURE_BENCHMARK.md` §4) |
| H4, H5, H9 por dominio | Gisel | `run-all` | regla, N, presupuestos, τ, congelación y autorización de gasto |
| H8 | Gisel | decisión final | lectura de fallos |
| H-R15 | persona | R-15 | confirmar el retiro del benchmark hermano |

---

## Anexo C · Variables de entorno (sin valores)

Columnas: variable · secreto · estado en `research/.env` (`set`/`empty`/`commented`/`-`) · estado en `research/.env.example` · primer lector (archivo:línea) · quién la usa · default en el lector · veredicto · nota. «agente/bench (indirecto)» = la lee una función de producción que el agente importa (por ejemplo `fleetConfig`, `PROVIDER_FN`, `crawl4aiRead`, `jinaRead`). Ninguna variable leída por producción se propone borrar.

| Variable | Secreto | .env | .env.example | Lector | Quién | Default | Veredicto | Nota |
|---|---|---|---|---|---|---|---|---|
| `ACTIVE_WINDOW_MONTHS` | no | - | set | `research/server/research/loop.mjs:59` | producción | sí | conservar |  |
| `ADVISOR_AUTO` | no | - | - | `research/server/analysis/advisorRoutes.mjs:167` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `ADVISOR_MODEL` | no | - | - | `research/server/analysis/advisor.mjs:246` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `ADVISOR_ROLE` | no | - | - | `research/server/analysis/advisor.mjs:244` | producción, scripts | sí | conservar | No está en `.env.example`: documentar. |
| `AGENTIC_FOLLOWUP` | no | - | set | `research/server/research/pipeline.mjs:262` | producción, scripts | no | conservar |  |
| `AGENTIC_LOOP` | no | - | set | `research/server/research/pipeline.mjs:309` | producción, scripts | no | conservar |  |
| `AGENTIC_READ` | no | - | set | `research/server/research/pipeline.mjs:302` | producción, scripts | no | conservar |  |
| `ANTHROPIC_API_KEY` | sí | - | empty | `backend/src/warmpath/llm.py:20` | backend, scripts | no | conservar |  |
| `APIFY_ACTOR_ID` | no | set | set | `research/server/research/apify.mjs:103` | producción | no | conservar |  |
| `APIFY_COMPANY_SEARCH_ACTOR_ID` | no | - | set | `research/server/research/apify.mjs:60` | producción | sí | conservar |  |
| `APIFY_DISCOVERY_MAX_COMPANIES` | no | - | set | `research/server/research/apify.mjs:57` | producción | no | conservar |  |
| `APIFY_DISCOVERY_MAX_PEOPLE` | no | - | set | `research/server/research/apify.mjs:91` | producción | no | conservar |  |
| `APIFY_INTERACTIONS_ACTOR_ID` | no | - | set | `research/server/research/apify.mjs:305` | producción | sí | conservar |  |
| `APIFY_INTERACTION_MAX_COMMENTS` | no | - | set | `research/server/research/apify.mjs:298` | producción | no | conservar |  |
| `APIFY_INTERACTION_MAX_ITEMS` | no | - | set | `research/server/research/apify.mjs:300` | producción | no | conservar |  |
| `APIFY_INTERACTION_MAX_POSTS` | no | - | set | `research/server/research/apify.mjs:297` | producción | no | conservar |  |
| `APIFY_INTERACTION_MAX_REACTIONS` | no | - | set | `research/server/research/apify.mjs:299` | producción | no | conservar |  |
| `APIFY_INTERACTION_MONTHS` | no | - | set | `research/server/research/apify.mjs:301` | producción | no | conservar |  |
| `APIFY_JOB_TITLES` | no | set | set | `research/server/research/apify.mjs:452` | producción | sí | conservar |  |
| `APIFY_MAX_COMPANIES` | no | set | set | `research/server/research/apify.mjs:43` | producción | no | conservar |  |
| `APIFY_MAX_ITEMS` | no | set | set | `research/server/research/apify.mjs:104` | producción | no | conservar |  |
| `APIFY_MUTUALS_ACTOR_ID` | no | - | set | `research/server/research/apify.mjs:388` | producción | sí | conservar |  |
| `APIFY_NETWORK_MAX_MUTUALS` | no | - | set | `research/server/research/apify.mjs:389` | producción | no | conservar |  |
| `APIFY_NETWORK_MAX_MUTUAL_TARGETS` | no | - | set | `research/server/research/apify.mjs:385` | producción | no | conservar |  |
| `APIFY_NETWORK_MAX_PEOPLE` | no | - | set | `research/server/research/apify.mjs:378` | producción | no | conservar |  |
| `APIFY_NETWORK_SEARCH_ACTOR_ID` | no | - | set | `research/server/research/apify.mjs:380` | producción | sí | conservar |  |
| `APIFY_PROFILE_ACTOR_ID` | no | - | set | `research/server/research/apify.mjs:171` | producción | sí | conservar |  |
| `APIFY_PROFILE_COMMENTS_ACTOR_ID` | no | - | set | `research/server/research/apify.mjs:306` | producción | sí | conservar |  |
| `APIFY_PROFILE_REACTIONS_ACTOR_ID` | no | - | set | `research/server/research/apify.mjs:307` | producción | sí | conservar |  |
| `APIFY_PROFILE_SEARCH_ACTOR_ID` | no | - | set | `research/server/research/apify.mjs:94` | producción | sí | conservar |  |
| `APIFY_TARGET_COMPANIES` | no | empty | empty | `research/server/research/apify.mjs:34` | producción | sí | conservar |  |
| `APIFY_TIMEOUT_MS` | no | set | set | `research/server/research/apify.mjs:106` | producción | no | conservar |  |
| `APIFY_TOKEN` | sí | set | empty | `research/server/research/apify.mjs:102` | producción | no | conservar |  |
| `APOLLO_API_KEY` | sí | set | - | `—` | — | — | confirmar con una persona | Solo en `research/.env`; ningún código la lee. Reservada para la extensión Apollo (docs/benchmark/investors/APOLLO_WARM_PATHS_EXTENSION.md). |
| `BASELINE_LLM_MODEL` | no | - | empty | `research/scripts/baseline-llm.mjs:3` | scripts | — | conservar | Solo scripts de investigación. |
| `CONFIRM_SNIPPETS` | no | - | empty | `research/server/research/pipeline.mjs:368` | producción | no | conservar |  |
| `CONFIRM_SNIPPETS_MAX` | no | set | set | `research/server/research/pipeline.mjs:371` | producción | sí | conservar |  |
| `CONFIRM_SNIPPETS_MS` | no | - | set | `research/server/research/pipeline.mjs:370` | producción | sí | conservar |  |
| `COST_EXA_PER_CALL` | no | - | set | `research/server/research/providers.mjs:44` | producción | — | conservar | Leída dinámicamente: `providers.mjs:44` (`env[`COST_${known}_PER_CALL`]`). |
| `COST_FIRECRAWL_PER_CALL` | no | - | set | `research/server/research/providers.mjs:44` | producción | — | conservar | Leída dinámicamente: `providers.mjs:44` (`env[`COST_${known}_PER_CALL`]`). |
| `COST_SCRAPEGRAPH_PER_CALL` | no | - | set | `research/server/research/providers.mjs:44` | producción | — | conservar | Leída dinámicamente: `providers.mjs:44` (`env[`COST_${known}_PER_CALL`]`). |
| `COST_SERPER_PER_CALL` | no | - | set | `research/server/research/searchApis.mjs:126` | producción | sí | conservar |  |
| `CRAWL4AI_MARKDOWN` | no | - | commented | `research/server/research/crawl4ai.mjs:54` | producción, agente/bench (indirecto) | no | conservar | Comentada en `.env.example`. |
| `CRAWL4AI_TIMEOUT_MS` | no | - | commented | `research/server/research/crawl4ai.mjs:34` | producción, agente/bench (indirecto) | sí | conservar | Comentada en `.env.example`. |
| `CRAWL4AI_TOKEN` | sí | - | commented | `research/server/research/crawl4ai.mjs:39` | producción, agente/bench (indirecto) | no | conservar | Comentada en `.env.example`. |
| `CRAWL4AI_URL` | no | - | empty | `research/server/research/crawl4ai.mjs:17` | producción, agente/bench (indirecto) | no | conservar |  |
| `ELIGIBILITY_PROFILE_PATH` | no | - | set | `research/server/analysis/routes.mjs:32` | producción | sí | conservar |  |
| `ENGINE_DATE_REREAD_MAX` | no | - | - | `research/server/research/engine.mjs:237` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `ENGINE_EXPAND` | no | - | commented | `research/server/research/engine.mjs:228` | producción | no | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_AI` | no | - | commented | `research/server/research/lateral.mjs:82` | producción | no | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_DIVE` | no | - | commented | `research/server/research/expansion.mjs:11` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_EDGAR` | no | - | commented | `research/server/research/lateral.mjs:81` | producción | no | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_LINKS` | no | - | commented | `research/server/research/expansion.mjs:10` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_OPENALEX` | no | - | commented | `research/server/research/lateral.mjs:80` | producción | no | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_PAGES` | no | - | commented | `research/server/research/expansion.mjs:11` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_QUERIES` | no | - | commented | `research/server/research/lateral.mjs:75` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_ROLE` | no | - | - | `research/server/research/lateral.mjs:64` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `ENGINE_EXPAND_SEEDS` | no | - | commented | `research/server/research/expansion.mjs:10` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_EXPAND_SIMILAR` | no | - | - | `research/server/research/expansion.mjs:39` | producción | no | conservar | No está en `.env.example`: documentar. |
| `ENGINE_EXPAND_SIMILAR_SEEDS` | no | - | commented | `research/server/research/expansion.mjs:11` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_EXTRACT` | no | - | commented | `research/server/research/engine.mjs:240` | producción, scripts | no | conservar | Comentada en `.env.example`. |
| `ENGINE_EXTRACT_MAX` | no | - | set | `research/server/research/engine.mjs:242` | producción, scripts | sí | conservar |  |
| `ENGINE_EXTRACT_POLICY` | no | - | set | `research/server/research/engine.mjs:254` | producción, scripts | no | conservar |  |
| `ENGINE_LLM_API_KEY` | sí | set | empty | `research/server/analysis/fleet.mjs:33` | producción, agente/bench (indirecto) | sí | conservar |  |
| `ENGINE_LLM_JSON_MODE` | no | - | empty | `research/server/analysis/fleet.mjs:33` | producción, agente/bench (indirecto), scripts | no | conservar |  |
| `ENGINE_LLM_MAX_TOKENS` | no | - | empty | `research/server/analysis/fleet.mjs:33` | producción, agente/bench (indirecto), scripts | sí | conservar |  |
| `ENGINE_LLM_MODEL` | no | set | empty | `research/server/analysis/fleet.mjs:31` | producción, agente/bench (indirecto), scripts | sí | conservar |  |
| `ENGINE_LLM_REASONING_EFFORT` | no | set | empty | `research/server/analysis/fleet.mjs:33` | producción, agente/bench (indirecto), scripts | sí | conservar |  |
| `ENGINE_LLM_THINKING` | no | - | - | `research/server/analysis/fleet.mjs:33` | producción, agente/bench (indirecto) | no | conservar | No está en `.env.example`: documentar. |
| `ENGINE_LLM_TIMEOUT_MS` | no | - | set | `research/server/analysis/fleet.mjs:114` | producción, agente/bench (indirecto), scripts | no | conservar |  |
| `ENGINE_LLM_URL` | no | set | empty | `research/server/analysis/fleet.mjs:31` | producción, agente/bench (indirecto), scripts | no | conservar |  |
| `ENGINE_MAX_PAGES` | no | - | set | `research/server/research/engine.mjs:216` | producción, scripts | sí | conservar |  |
| `ENGINE_MAX_QUERIES` | no | set | set | `research/server/research/engine.mjs:216` | producción, scripts | sí | conservar |  |
| `ENGINE_PORTAL_LINKS` | no | - | commented | `research/server/research/engine.mjs:293` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_PORTAL_SEEDS` | no | - | commented | `research/server/research/engine.mjs:293` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_QUERY_YEAR` | no | - | - | `research/server/research/engine.mjs:82` | producción | no | conservar | No está en `.env.example`: documentar. |
| `ENGINE_READ_CONCURRENCY` | no | - | set | `research/server/research/engine.mjs:216` | producción | sí | conservar |  |
| `ENGINE_RECENCY` | no | - | empty | `research/server/research/engine.mjs:233` | producción | sí | conservar |  |
| `ENGINE_RESEARCH_CANDIDATES` | no | - | - | `research/server/research/researcher.mjs:43` | producción | no | conservar | No está en `.env.example`: documentar. |
| `ENGINE_RESEARCH_MS` | no | - | set | `research/server/research/researcher.mjs:42` | producción | no | conservar |  |
| `ENGINE_RESEARCH_OPENS` | no | - | set | `research/server/research/researcher.mjs:40` | producción | no | conservar |  |
| `ENGINE_RESEARCH_PER_STEP` | no | - | set | `research/server/research/researcher.mjs:41` | producción | no | conservar |  |
| `ENGINE_RESEARCH_ROLE` | no | - | commented | `research/server/research/engine.mjs:251` | producción | sí | conservar | Comentada en `.env.example`. |
| `ENGINE_RESEARCH_SEARCHES` | no | - | set | `research/server/research/researcher.mjs:39` | producción | no | conservar |  |
| `ENGINE_RESEARCH_STEPS` | no | set | set | `research/server/research/researcher.mjs:38` | producción | no | conservar |  |
| `ENGINE_RESULTS_PER_PROVIDER` | no | - | set | `research/server/research/searchApis.mjs:60` | producción, agente/bench (indirecto) | sí | conservar |  |
| `ENGINE_ROUNDS` | no | - | set | `research/server/research/engine.mjs:216` | producción, scripts | sí | conservar |  |
| `ENGINE_SEARCH_PROVIDERS` | no | set | empty | `research/server/research/searchApis.mjs:32` | producción, scripts | sí | conservar |  |
| `ENGINE_SEARCH_TIMEOUT_MS` | no | - | set | `research/server/research/searchApis.mjs:38` | producción, agente/bench (indirecto) | sí | conservar |  |
| `ENGINE_TBS` | no | - | - | `research/server/research/engine.mjs:231` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `ENGINE_TRACE_MAX` | no | - | - | `research/server/research/engine.mjs:236` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `ENGINE_TRACE_SKIPPED_MAX` | no | - | - | `research/server/research/engine.mjs:269` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `ENGINE_V2` | no | set | empty | `research/server/research/engine.mjs:546` | producción, scripts | sí | conservar |  |
| `EVAL_RESULTS_DIR` | no | - | set | `research/server/analysis/routes.mjs:110` | producción | sí | conservar |  |
| `EXA_API_KEY` | sí | set | empty | `research/server/index.mjs:174` | producción, agente/bench (indirecto) | no | conservar |  |
| `EXA_NUM_RESULTS` | no | set | set | `research/server/research/providers.mjs:883` | producción | sí | conservar |  |
| `EXA_SEARCH_TYPE` | no | - | set | `research/server/research/searchApis.mjs:82` | producción, agente/bench (indirecto) | sí | conservar |  |
| `EXA_TEXT_CHARS` | no | - | - | `research/server/research/searchApis.mjs:82` | producción, agente/bench (indirecto) | sí | conservar | No está en `.env.example`: documentar. |
| `FIRECRAWL_API_KEY` | sí | set | empty | `research/server/analysis/agent/tools.mjs:24` | producción, scripts | no | conservar |  |
| `FIRECRAWL_CACHE` | no | - | - | `research/server/research/firecrawlLedger.mjs:57` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `FIRECRAWL_CACHE_DB` | no | - | commented | `research/server/research/firecrawlLedger.mjs:139` | producción | no | conservar | Comentada en `.env.example`. |
| `FIRECRAWL_CACHE_TTL_HOURS` | no | - | set | `research/server/research/firecrawlLedger.mjs:58` | producción | no | conservar |  |
| `FIRECRAWL_DAILY_CREDITS` | no | set | set | `research/server/research/firecrawlLedger.mjs:50` | producción, scripts | sí | conservar |  |
| `FIRECRAWL_DISABLED` | no | - | commented | `research/server/research/webscrape.mjs:21` | producción | sí | conservar | Comentada en `.env.example`. |
| `FIRECRAWL_EXTRACT_MAIN_ONLY` | no | - | set | `research/server/research/webscrape.mjs:183` | producción | no | conservar |  |
| `FIRECRAWL_EXTRACT_TIMEOUT_MS` | no | - | set | `research/server/research/webscrape.mjs:231` | producción | no | conservar |  |
| `FIRECRAWL_RATE_BACKOFF_MS` | no | - | - | `research/server/research/webscrape.mjs:71` | producción | no | conservar | No está en `.env.example`: documentar. |
| `FIRECRAWL_RUN_CREDITS` | no | - | commented | `research/server/research/firecrawlLedger.mjs:62` | producción | sí | conservar | Comentada en `.env.example`. |
| `FIRECRAWL_SCRAPE_TIMEOUT_MS` | no | - | - | `research/server/research/webscrape.mjs:197` | producción | no | conservar | No está en `.env.example`: documentar. |
| `FIRECRAWL_SEARCH_MARKDOWN` | no | - | commented | `research/server/research/searchApis.mjs:132` | producción | no | conservar | Comentada en `.env.example`. |
| `FIRECRAWL_SEARCH_TIMEOUT_MS` | no | - | - | `research/server/research/webscrape.mjs:196` | producción | no | conservar | No está en `.env.example`: documentar. |
| `FOLLOWUP_MAX_ORGS` | no | - | set | `research/server/research/followup.mjs:64` | producción | sí | conservar |  |
| `FOLLOWUP_MAX_PAGES` | no | - | set | `research/server/research/followup.mjs:65` | producción | sí | conservar |  |
| `FUND_VEHICLES_PATH` | no | - | set | `research/server/analysis/routes.mjs:42` | producción, scripts | sí | conservar |  |
| `GRANT_API_QUERIES` | no | - | - | `research/server/research/pipeline.mjs:158` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `GRANT_INTEL` | no | - | commented | `research/server/research/grantSources.mjs:79` | producción | no | conservar | Comentada en `.env.example`. |
| `GRANT_PAGE_MODEL` | no | - | - | `research/server/research/pipeline.mjs:367` | producción | no | conservar | No está en `.env.example`: documentar. |
| `GRANT_WEB_CREDITS` | no | - | - | `research/server/research/webscrape.mjs:357` | producción | no | conservar | No está en `.env.example`: documentar. |
| `GRANT_WEB_MAX_SEARCHES` | no | - | set | `research/server/research/webscrape.mjs:353` | producción | no | conservar |  |
| `GRANT_WEB_MODEL_QUERIES` | no | - | - | `research/server/research/webscrape.mjs:355` | producción | no | conservar | No está en `.env.example`: documentar. |
| `GRANT_WEB_READ` | no | - | empty | `research/server/research/webscrape.mjs:404` | producción | no | conservar |  |
| `GRANT_WEB_READ_MAX` | no | - | set | `research/server/research/webscrape.mjs:405` | producción | no | conservar |  |
| `GRANT_WEB_RESULTS_PER_QUERY` | no | - | set | `research/server/research/webscrape.mjs:364` | producción | no | conservar |  |
| `HUNTER_API_KEY` | sí | set | empty | `research/server/research/hunter.mjs:15` | producción | sí | conservar |  |
| `HUNTER_MAX_CALLS` | no | - | set | `research/server/research/hunter.mjs:57` | producción | no | conservar |  |
| `HUNTER_MAX_DOMAINS` | no | - | set | `research/server/research/hunter.mjs:117` | producción | no | conservar |  |
| `HUNTER_MIN_SCORE` | no | - | set | `research/server/research/hunter.mjs:116` | producción | no | conservar |  |
| `HUNTER_PEOPLE_PER_DOMAIN` | no | - | set | `research/server/research/hunter.mjs:118` | producción | no | conservar |  |
| `HUNTER_TIMEOUT_MS` | no | - | - | `research/server/research/hunter.mjs:64` | producción | no | conservar | No está en `.env.example`: documentar. |
| `INTAKE_LLM_API_KEY` | sí | set | empty | `research/server/analysis/fleet.mjs:28` | producción, agente/bench (indirecto) | no | conservar |  |
| `INTAKE_LLM_BASE_URL` | no | set | empty | `research/server/analysis/fleet.mjs:28` | producción, agente/bench (indirecto), scripts | no | conservar |  |
| `INTAKE_LLM_DOC_CHARS` | no | - | set | `research/server/research/intake.mjs:441` | producción | sí | conservar |  |
| `INTAKE_LLM_MAX_TOKENS` | no | set | - | `research/server/analysis/fleet.mjs:28` | producción, agente/bench (indirecto) | no | conservar | No está en `.env.example`: documentar. |
| `INTAKE_LLM_MODEL` | no | set | set | `research/server/analysis/fleet.mjs:28` | producción, agente/bench (indirecto) | sí | conservar |  |
| `INTAKE_LLM_REASONING_EFFORT` | no | set | - | `research/server/analysis/fleet.mjs:28` | producción, agente/bench (indirecto) | no | conservar | No está en `.env.example`: documentar. |
| `INTAKE_LLM_ROLE` | no | - | - | `research/server/research/intake.mjs:336` | producción | no | conservar | No está en `.env.example`: documentar. |
| `INTAKE_LLM_THINK` | no | set | set | `research/server/research/intake.mjs:342` | producción | sí | conservar |  |
| `INTAKE_LLM_TIMEOUT_MS` | no | - | set | `research/server/research/intake.mjs:382` | producción | sí | conservar |  |
| `JEV_API_KEY` | sí | - | empty | `research/server/index.mjs:178` | producción | sí | conservar |  |
| `JEV_API_URL` | no | - | set | `research/server/research/jev.mjs:21` | producción | sí | conservar |  |
| `JEV_MAX_CANDIDATES` | no | - | set | `research/server/research/jev.mjs:151` | producción | sí | conservar |  |
| `JEV_MODEL` | no | - | set | `research/server/index.mjs:179` | producción | sí | conservar |  |
| `JEV_PROVIDER` | no | - | commented | `research/server/research/jev.mjs:19` | producción | sí | conservar | Comentada en `.env.example`. |
| `JEV_TIMEOUT_MS` | no | - | set | `research/server/research/jev.mjs:41` | producción | sí | conservar |  |
| `JINA_API_KEY` | sí | set | empty | `research/server/research/searchApis.mjs:14` | producción, agente/bench (indirecto), scripts | no | conservar |  |
| `JINA_SEARCH_CONTENT` | no | - | - | `research/server/research/searchApis.mjs:110` | producción, agente/bench (indirecto) | no | conservar | No está en `.env.example`: documentar. |
| `JINA_TIMEOUT_MS` | no | - | - | `research/server/research/searchApis.mjs:110` | producción, agente/bench (indirecto) | sí | conservar | No está en `.env.example`: documentar. |
| `LINKUP_API_KEY` | sí | set | empty | `research/server/research/searchApis.mjs:14` | producción, agente/bench (indirecto) | no | conservar |  |
| `LINKUP_DEPTH` | no | - | set | `research/server/research/searchApis.mjs:71` | producción, agente/bench (indirecto) | sí | conservar |  |
| `LINKUP_TIMEOUT_MS` | no | - | - | `research/server/research/searchApis.mjs:69` | producción, agente/bench (indirecto) | sí | conservar | No está en `.env.example`: documentar. |
| `LOOP_BUDGET_MS` | no | - | set | `research/server/research/loop.mjs:50` | producción | sí | conservar |  |
| `LOOP_LLM_PLANNER` | no | - | set | `research/server/research/loop.mjs:33` | producción, scripts | sí | conservar |  |
| `LOOP_MAX_COST_USD` | no | - | set | `research/server/research/loop.mjs:49` | producción | no | conservar |  |
| `LOOP_MAX_ROUNDS` | no | - | set | `research/server/research/loop.mjs:47` | producción | sí | conservar |  |
| `LOOP_MAX_SEARCHES` | no | - | set | `research/server/research/loop.mjs:48` | producción | sí | conservar |  |
| `LOOP_RESULTS_PER_SEARCH` | no | - | set | `research/server/research/providers.mjs:961` | producción | sí | conservar |  |
| `NODE_TEST_CONTEXT` | no | - | - | `research/server/research/firecrawlLedger.mjs:139` | producción | no | conservar | La pone Node al correr tests; no se documenta. |
| `OPENALEX_API_KEY` | sí | empty | empty | `research/server/index.mjs:167` | producción | no | conservar |  |
| `OPENALEX_MAILTO` | no | empty | empty | `research/server/research/lateral.mjs:20` | producción, backend | no | conservar |  |
| `OPENJEV_API_KEY` | sí | set | empty | `research/server/research/jev.mjs:20` | producción | sí | conservar |  |
| `OPENJEV_API_URL` | no | - | empty | `research/server/research/jev.mjs:20` | producción | sí | conservar |  |
| `OPENJEV_MODEL` | no | - | set | `research/server/research/jev.mjs:20` | producción | sí | conservar |  |
| `ORCHESTRATOR` | no | - | empty | `research/server/research/pipeline.mjs:397` | producción | sí | conservar |  |
| `ORCHESTRATOR_AI` | no | - | commented | `research/server/research/orchestrator.mjs:126` | producción | sí | conservar | Comentada en `.env.example`. |
| `ORCHESTRATOR_AI_QUERIES` | no | - | commented | `research/server/research/orchestrator.mjs:158` | producción | sí | conservar | Comentada en `.env.example`. |
| `ORCHESTRATOR_AI_ROLE` | no | - | commented | `research/server/research/orchestrator.mjs:128` | producción | sí | conservar | Comentada en `.env.example`. |
| `ORCHESTRATOR_ATTEMPT_MS` | no | - | set | `research/server/research/orchestrator.mjs:374` | producción | no | conservar |  |
| `ORCHESTRATOR_JEV_TIMEOUT_MS` | no | - | - | `research/server/research/orchestrator.mjs:188` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `ORCHESTRATOR_MAX_ATTEMPTS` | no | - | set | `research/server/research/orchestrator.mjs:358` | producción | no | conservar |  |
| `ORCHESTRATOR_MIN_EMAIL_RATE` | no | - | set | `research/server/research/orchestrator.mjs:61` | producción | no | conservar |  |
| `ORCHESTRATOR_MIN_REMAINING_MS` | no | - | - | `research/server/research/orchestrator.mjs:359` | producción | no | conservar | No está en `.env.example`: documentar. |
| `ORCHESTRATOR_MIN_TOP` | no | - | set | `research/server/research/orchestrator.mjs:61` | producción | no | conservar |  |
| `ORCHESTRATOR_RESERVE_MS` | no | - | set | `research/server/research/pipeline.mjs:402` | producción | sí | conservar |  |
| `PAGE_READER_ORDER` | no | - | - | `research/server/research/pipeline.mjs:357` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | no | - | - | `research/server/research/browser.mjs:63` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `QUERY_EXPAND_EXA_MAX` | no | - | - | `research/server/research/providers.mjs:887` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `QUERY_EXPAND_LLM` | no | - | - | `research/server/research/expand.mjs:54` | producción | no | conservar | No está en `.env.example`: documentar. |
| `QUERY_EXPAND_MAX` | no | set | - | `research/server/research/expand.mjs:81` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `QUERY_EXPAND_TIMEOUT_MS` | no | - | - | `research/server/research/expand.mjs:65` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `READ_MAX_DOCS` | no | - | set | `research/server/research/read.mjs:63` | producción | sí | conservar |  |
| `REGISTRY_VERIFY` | no | - | - | `research/server/research/registryVerify.mjs:46` | producción | no | conservar | No está en `.env.example`: documentar. |
| `REGISTRY_VERIFY_MAX` | no | - | commented | `research/server/research/registryVerify.mjs:44` | producción | sí | conservar | Comentada en `.env.example`. |
| `RESEARCH_BROWSER` | no | - | - | `research/server/index.mjs:30` | producción, scripts | no | conservar | No está en `.env.example`: documentar. |
| `RESEARCH_BROWSER_JPEG_QUALITY` | no | - | - | `research/server/research/browser.mjs:39` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `RESEARCH_BROWSER_TIMEOUT_MS` | no | - | - | `research/server/research/browser.mjs:38` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `RESEARCH_DB` | no | set | set | `research/server/index.mjs:21` | producción, scripts | sí | conservar |  |
| `RESEARCH_MAX_RUNS_PER_DAY` | no | - | set | `research/server/index.mjs:403` | producción | sí | conservar |  |
| `RESEARCH_PORT` | no | set | set | `research/server/index.mjs:611` | producción, scripts | sí | conservar |  |
| `RESEARCH_PUBLIC_ORIGIN` | no | - | - | `research/server/index.mjs:96` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `RESEARCH_RUN_TIMEOUT_MS` | no | set | set | `research/server/research/loop.mjs:50` | producción, scripts | sí | conservar |  |
| `RESEARCH_TIMEOUT_MS` | no | set | set | `research/server/research/providers.mjs:61` | producción | sí | conservar |  |
| `RESEARCH_USER_AGENT` | no | set | set | `research/server/analysis/agent/tools.mjs:29` | producción | sí | conservar |  |
| `SCRAPEGRAPH_API_KEY` | sí | - | - | `research/server/research/intake.mjs:582` | producción | no | conservar | No está en `.env.example`: documentar. |
| `SEARCH_COMPLEMENT` | no | - | - | `research/server/research/searchApis.mjs:26` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `SEARCH_PROVIDER` | no | - | - | `research/server/research/searchApis.mjs:19` | producción | sí | conservar | No está en `.env.example`: documentar. |
| `SEARXNG_ENGINES` | no | - | empty | `research/server/research/localSearch.mjs:12` | producción, agente/bench (indirecto) | sí | conservar |  |
| `SEARXNG_TIMEOUT_MS` | no | - | - | `research/server/research/localSearch.mjs:18` | producción, agente/bench (indirecto) | sí | conservar | No está en `.env.example`: documentar. |
| `SEARXNG_URL` | no | - | empty | `research/server/research/localSearch.mjs:9` | producción, agente/bench (indirecto) | sí | conservar |  |
| `SEC_USER_AGENT` | no | - | commented | `research/server/research/lateral.mjs:35` | producción, backend | sí | conservar | Comentada en `.env.example`. |
| `SERPER_API_KEY` | sí | set | empty | `research/server/index.mjs:173` | producción, agente/bench (indirecto) | no | conservar |  |
| `SERPER_GL` | no | - | commented | `research/server/research/searchApis.mjs:121` | producción, agente/bench (indirecto) | no | conservar | Comentada en `.env.example`. |
| `SERPER_TIMEOUT_MS` | no | - | - | `research/server/research/searchApis.mjs:119` | producción, agente/bench (indirecto) | sí | conservar | No está en `.env.example`: documentar. |
| `SGAI_API_KEY` | sí | set | empty | `research/server/research/intake.mjs:582` | producción | sí | conservar |  |
| `TAVILY_API_KEY` | sí | set | empty | `research/server/research/searchApis.mjs:14` | producción, agente/bench (indirecto) | no | conservar |  |
| `TAVILY_DEPTH` | no | - | set | `research/server/research/searchApis.mjs:102` | producción, agente/bench (indirecto) | sí | conservar |  |
| `TYPESAFE_API_KEY` | sí | - | - | `research/server/index.mjs:178` | producción | no | conservar | No está en `.env.example`: documentar. |
| `VLLM_API_KEY` | sí | - | empty | `research/server/analysis/fleet.mjs:38` | producción, agente/bench (indirecto), scripts | sí | conservar |  |
| `VLLM_ASR_MODEL` | no | - | empty | `research/server/analysis/voice.mjs:50` | producción, scripts | no | conservar |  |
| `VLLM_ASR_URL` | no | - | empty | `research/server/analysis/voice.mjs:50` | producción, scripts | sí | conservar |  |
| `VLLM_BASE` | no | - | empty | `research/server/analysis/fleet.mjs:20` | producción, agente/bench (indirecto), scripts | no | conservar |  |
| `VLLM_CHAT_MODEL` | no | set | empty | `research/server/analysis/advisorRoutes.mjs:36` | producción, agente/bench (indirecto), scripts | no | conservar |  |
| `VLLM_CHAT_URL` | no | set | empty | `research/server/analysis/fleet.mjs:10` | producción, agente/bench (indirecto), scripts | no | conservar |  |
| `VLLM_EMBED_MODEL` | no | - | empty | `research/server/analysis/agent/tools.mjs:6` | producción, scripts | no | conservar |  |
| `VLLM_EMBED_URL` | no | - | empty | `research/server/analysis/fleet.mjs:13` | producción | no | conservar |  |
| `VLLM_EXTRACT_ROLE` | no | - | set | `research/server/analysis/fleet.mjs:37` | producción, scripts | sí | conservar |  |
| `VLLM_REASONING_MODEL` | no | - | empty | `research/server/analysis/fleet.mjs:12` | producción, scripts | no | conservar |  |
| `VLLM_REASONING_URL` | no | - | empty | `research/server/analysis/fleet.mjs:12` | producción | no | conservar |  |
| `VLLM_RERANK_MODEL` | no | - | empty | `research/server/analysis/agent/tools.mjs:6` | producción, scripts | no | conservar |  |
| `VLLM_RERANK_URL` | no | - | empty | `research/server/analysis/fleet.mjs:14` | producción | no | conservar |  |
| `VLLM_SMALL_MODEL` | no | - | empty | `research/server/analysis/fleet.mjs:11` | producción, scripts | no | conservar |  |
| `VLLM_SMALL_URL` | no | - | empty | `research/server/analysis/fleet.mjs:11` | producción | no | conservar |  |
| `VLLM_TIMEOUT_MS` | no | - | set | `research/server/analysis/fleet.mjs:38` | producción, agente/bench (indirecto) | sí | conservar |  |
| `WEB_BREAKER_MS` | no | - | set | `research/server/research/webscrape.mjs:114` | producción | no | conservar |  |
| `WEB_LINKEDIN_MAX_PAGES` | no | - | - | `research/server/research/webscrape.mjs:691` | producción | no | conservar | No está en `.env.example`: documentar. |
| `WEB_MAX_PAGES` | no | set | set | `research/server/research/webscrape.mjs:566` | producción | no | conservar |  |
| `WEB_MAX_PEOPLE` | no | set | set | `research/server/research/webscrape.mjs:567` | producción | no | conservar |  |
| `WEB_RELATION_MAX_PAGES` | no | set | set | `research/server/research/webscrape.mjs:650` | producción | no | conservar |  |
| `WEB_RETRIES` | no | - | set | `research/server/research/webscrape.mjs:84` | producción | no | conservar |  |
| `WEB_TIMEOUT_MS` | no | - | - | `research/server/research/webscrape.mjs:89` | producción | no | conservar | No está en `.env.example`: documentar. |
| `YOU_API_KEY` | sí | set | empty | `research/server/research/searchApis.mjs:14` | producción, agente/bench (indirecto) | no | conservar |  |
| `YOU_API_URL` | no | - | - | `research/server/research/searchApis.mjs:92` | producción, agente/bench (indirecto) | sí | conservar | No está en `.env.example`: documentar. |

Variables fuera de `research/.env*` (también se conservan):

| Variable | Dónde se declara | Lector | Quién | Veredicto |
|---|---|---|---|---|
| `PREANNOTATOR_BASE_URL`, `PREANNOTATOR_MODEL`, `PREANNOTATOR_API_KEY` (secreto) | `research/bench/config/v0.json` (`preannotator_model.*_env`) | `research/bench/cli.mjs:63` | benchmark | conservar; documentar (L2) |
| `WARMPATH_HOST`, `WARMPATH_CORS`, `PORT` | `deploy/outreach-api.service:11-13` | `backend/src/warmpath/api.py` | backend | conservar |
| `WARMPATH_CONFIG`, `WARMPATH_DB`, `WARMPATH_OUT`, `WARMPATH_LLM_MODEL`, `WARMPATH_USER_AGENT` | `backend/.env` (vía `EnvironmentFile`) | `backend/src/warmpath/**` | backend | conservar |
| `VITE_API_URL` | build del frontend | `frontend/src` (`import.meta.env`) | frontend | conservar |
| `OUTREACH_*`, `CRAWL4AI_IMAGE`, `CRAWL4AI_PORT`, `SEARXNG_IMAGE`, `SEARXNG_PORT`, `AWS_HOST`, `AWS_USER`, `LIGHTSAIL_KEY`, `FIRECRAWL_OFF`, `APP_DIR`, `APP_USER` | parámetros `${X:-…}` de `deploy/*.sh` | los mismos scripts | despliegue | conservar (no son variables de `.env`) |
| `G355_*`, `ENGINE_GPUS`, `ENGINE_IMAGE`, `ENGINE_PORT`, `ENGINE_TP`, `ENGINE_MAX_LEN`, `HF_HOME`, `HF_TOKEN` (secreto), `BENCH_REF_*` y similares | parámetros de `research/scripts/*.sh` y `*.mjs` | los mismos scripts | scripts de investigación | conservar |

---

## Anexo D · Helper y harness de caracterización

### D.1 `research/tests/agent/helpers/digest.mjs` (copiar literal)

```js
/**
 * Digest de comportamiento de una corrida: lo que el agente decidió, sin metadatos de versión ni horas.
 * Contrato: entrada = {result, logs, plannerInputs} de runCase; salida = objeto canónico cuyo sha256
 * congela el comportamiento de grants (REFACTOR-PLAN ACC-50). V1 y V2 leen los nombres de cada contrato
 * y producen el mismo objeto.
 */
import { createHash } from 'node:crypto';

const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;

/** @param {unknown} v @returns {string} sha256 hex del JSON con claves ordenadas */
export const digestSha = v => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');

/** Lector de contratos v1. @returns {object} */
export const V1 = {
  totals: t => ({ searches: t.searches, fetches: t.fetches, fetch_errors: t.fetch_errors, unique_docs: t.unique_docs, verified_entities: t.official_opportunities, planner_calls: t.planner_calls, tokens_discovery_nominal: t.tokens_discovery_nominal, tokens_judge_nominal: t.tokens_judge_nominal }),
  validity: v => ({ status: v.status, valid_from: v.opens_on, valid_until: v.closes_on, label: v.deadline_label, quote: v.deadline_quote, doc_id: v.deadline_doc_id, conflict: v.conflict }),
  attributes: e => ({ issuer: e.issuer, amount_text: e.amount_text, instrument: e.instrument }),
  extras: j => ({ route: j.route, route_rationale: j.route_rationale }),
  signals: s => ({ new_unique_docs: s.new_unique_docs, duplicates: s.duplicates, new_verified_entities: s.new_official_opportunities, validity_parsed: s.deadlines_parsed, criteria_unknown: s.criteria_unknown, searches_without_new_verified: s.searches_without_new_official }),
  newEntity: d => d.new_opportunity,
};

/** Lector de contratos v2 (ARCHITECTURE_AGENT §4.2). @returns {object} */
export const V2 = {
  totals: t => ({ searches: t.searches, fetches: t.fetches, fetch_errors: t.fetch_errors, unique_docs: t.unique_docs, verified_entities: t.verified_entities, planner_calls: t.planner_calls, tokens_discovery_nominal: t.tokens_discovery_nominal, tokens_judge_nominal: t.tokens_judge_nominal }),
  validity: v => ({ status: v.status, valid_from: v.valid_from, valid_until: v.valid_until, label: v.label, quote: v.quote, doc_id: v.doc_id, conflict: v.conflict }),
  attributes: e => e.attributes,
  extras: j => j.extras,
  signals: s => ({ new_unique_docs: s.new_unique_docs, duplicates: s.duplicates, new_verified_entities: s.new_verified_entities, validity_parsed: s.validity_parsed, criteria_unknown: s.criteria_unknown, searches_without_new_verified: s.searches_without_new_verified }),
  newEntity: d => d.new_entity,
};

/**
 * @param {{result: object, logs: object[], plannerInputs: object[]}} run
 * @param {typeof V1} R lector del contrato
 * @returns {object} digest canónico
 */
export function behaviorDigest({ result, logs, plannerInputs }, R = V1) {
  const of = k => logs.filter(l => l.kind === k);
  return {
    stop_reason: result.stop_reason,
    abstained: result.abstained,
    totals: R.totals(result.totals),
    ranked: result.ranked.map(r => [r.stable_id, r.eligibility_class, r.recommendable, r.official, r.sort_key]),
    entities: result.entities.map(e => ({ stable_id: e.stable_id, name: e.name, identifiers: e.identifiers.map(i => `${i.scheme}:${i.value}`), official: e.official, official_basis: e.official_basis, validity: R.validity(e.validity), attributes: R.attributes(e), source_doc_ids: e.source_doc_ids, first_seen: e.first_seen })),
    evidence: result.evidence.map(e => [e.evidence_id, e.stable_id, e.criterion_id, e.doc_id, e.official, e.binding]),
    judgments: result.judgments.map(j => ({ stable_id: j.stable_id, extras: R.extras(j), aggregate: j.aggregate, criteria: j.criteria.map(c => [c.criterion_id, c.state, c.llm_state, c.evidence_ids, c.overrides]) })),
    searches: of('search').map(l => ({ query: l.data.query, origin: l.data.origin, results: l.data.results.map(r => r.result_id), signals: R.signals(l.data.signals) })),
    fetches: of('fetch').map(l => [l.data.ref, l.data.trigger, l.data.document.doc_id, l.data.document.ok, l.data.document.official, l.data.document.official_basis]),
    extracts: of('extract').map(l => [l.data.doc_id, l.data.page_type, l.data.about_stable_id, R.newEntity(l.data), l.data.evidence_ids, l.data.quotes_rejected, l.data.identifiers_rejected]),
    planner_calls: of('planner_call').map(l => ({ mode: l.data.mode, accepted: l.data.actions_accepted, rejected: l.data.actions_rejected, gaps_offered: l.data.gaps_offered })),
    planner_gaps: plannerInputs.map(i => ({ step: i.step, gaps: i.gaps.map(g => g.gap_id) })),
  };
}
```

(La excepción de longitud de línea de ACC-75 no aplica a `research/tests/**`.)

### D.2 Harness (dentro de `characterization.test.mjs`)

```js
const F = resolve(import.meta.dirname, 'fixtures/world-v1');
// caseObj, profile, config, catalog, domainsCfg: igual que e2e.test.mjs:2
async function runForDigest(condition) {
  const cache = createBenchCache({ path: ':memory:', namespace: `char-${condition}` });
  const plannerInputs = [];
  const outDir = mkdtempSync(resolve(tmpdir(), 'char-'));
  const result = await runCase({
    caseObj, profile, condition, seed: 101, config, outDir,
    deps: {
      transport: createFixtureTransport(F, { condition, profileId: profile.profile_id }),
      search: createSearchTool({ provider: 'fixture', transport: createFixtureSearch(F), cache, resultsPerQuery: 10, recency: 'none', clock: () => 0 }),
      fetch: createFetchTool({ transport: createFixtureFetch(F), cache, clock: () => 0 }),
      cache, catalog, domainsCfg,
      clock: () => '2026-10-20T00:00:00.000Z',
      onPlannerInput: input => plannerInputs.push(structuredClone(input)),
    },
  });
  const logs = readFileSync(resolve(outDir, 'steps.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  cache.close();
  return { result, logs, plannerInputs };
}
```

Desde R-03 se añade `deps.hashes`; desde R-09a, `deps.pack`; desde R-09b, `config` = `runConfigV1toV2(config)` y `caseObj` = `caseV1toV2(caseObj)`, y el lector pasa a `V2`. Los valores esperados no cambian salvo lo declarado en ACC-53.
