# Diagnóstico del agente iterativo y del benchmark (Fase 1)

Fecha: 07/10/2026 · Autor: arquitecto (Claude) · Estado: **diagnóstico**, solo lectura. No cambia código.

Alcance honesto: el sistema evaluado es un *harness exploratorio para comparar búsqueda estática y adaptativa sobre entidades ancla conocidas*. Nada de lo de abajo mide calidad de producto.

## 0. Estado del repositorio al leer

| Hecho | Evidencia |
|---|---|
| Rama `main`, HEAD `ed9fa6a` («Benchmark: buscador único SearXNG») | `git log -n 15 --oneline` |
| Cambio sin commit: `research/package.json` añade el script `test:investors` | `git diff research/package.json` |
| Sin seguimiento (trabajo de inversores sin commit): `docs/benchmark/investors/`, `docs/contracts/investor/`, `prompts/investor/`, `research/bench/case-prep/`, `research/bench/investors/`, `research/tests/agent/fixtures/investor-world-v0/`, `research/tests/agent/investors.test.mjs` | `git status --short` |
| `npm --prefix research run test:agent`: 56 pass, 0 fail (incluye los 20 tests de inversores sin commit) | corrida local con `HTTPS_PROXY=http://127.0.0.1:9` |
| `npm --prefix research test`: 415 pass, 1 fail (`UW-Madison I-Corps…`, el fallo preexistente), 1 skip | misma corrida |
| `research/bench/config/v0.json` sigue en `status: draft` y familias `TO-SET-AT-FREEZE`: H4/H5 no se han hecho, así que crear prompts y contratos v2 está permitido por el protocolo | `docs/BENCHMARK_PROTOCOL.md:40` («No se tocan después de congelar `run_config`») |
| El piloto real (TASK-13) corrió: 6 corridas, todas `budget_searches`, 0 `recommendable` en las 6 | `research/bench/out/pilot-v2/runs/*/result.json` (ignorado por git) |
| Hay copias locales de `.env` con secretos fuera de git: `research/.env.bak-20260930-1614`, `.env.bak-confirm40`, `.env.bak-expand6`, `.env.bak-intake-30b`, `.env.bak-motor`, `.env.tmp` | `ls research/.env*`; ignoradas por `research/.gitignore:2` |

No modifiqué ni preparé nada de lo anterior.

## Lectura del vault (restricciones y vacíos)

- Aprobado y vinculante: «el modelo extrae, el código decide» (`10 - Registro de decisiones`, 29/09); «el motor debe servir para todo el producto, con un objetivo intercambiable» (29/09); «sin vigencia y elegibilidad verificadas no entra en la lista principal» (30/09); «un `?` nunca se convierte en `✔`» (citado en `docs/ARCHITECTURE.md:363`); envío automático fuera (28/09).
- Hipótesis (no aprobadas): todo el `15 - Plan de implementación del motor agentic` (estado «propuesta»).
- **Vacío:** el registro del vault termina el 30/09. `docs/BENCHMARK_PROTOCOL.md:3` y `docs/ARCHITECTURE.md:366,386` citan decisiones «aprobadas» del 01/10 y del 05/10 (oracle fuera de la v0, juicio no por palabras, award ≠ convocatoria abierta) que **no están** en el Registro de decisiones. Lo anoto en «Contradicciones y vacíos».

---

## A. Acoplamiento a grants en el núcleo

Destino: **N** = queda en el núcleo con nombre genérico; **P** = pasa al paquete de dominio (DomainPack); **X** = desaparece.

| # | Qué es específico de grants | Dónde | Destino |
|---|---|---|---|
| A1 | Esquemas de identificador `nih`, `nsf`, `grantsgov`, `eu` (regex en código) | `research/agent/identifiers.mjs:6-10` | **P** (datos declarativos `identifiers.schemes`) |
| A2 | Prioridad de esquemas y regla «`NOT-` al final» | `identifiers.mjs:15-16` | **P** (`priority`, `value_prefix_rank`) |
| A3 | Prefijo `opp:` del `stable_id` | `identifiers.mjs:17`; `docs/contracts/common.schema.json:21` (patrón con `opp`, `inv`, `usr` y esquemas fijos) | **P** (`stable_id_prefix`); el núcleo acepta cualquier prefijo `[a-z]{2,8}` |
| A4 | `entity_type: 'grant_opportunity'`, `issuer`, `amount_text`, `instrument` en la entidad | `registry.mjs:18`; `target_entity.schema.json:11-19,32,44,180` | `entity_type` **P**; `issuer/amount_text/instrument` **P** (`attributes`) |
| A5 | Validez = deadline: `deadlineDecision`, `closes_on`, `opens_on`, `deadline_*`, `award_record → awarded` | `validity.mjs:1,6-9`; `target_entity.schema.json:113,134` | Función de validez **P**; campos genéricos **N** (`valid_from`, `valid_until`, `label`, `quote`, `doc_id`) |
| A6 | Regla de oficialidad con `G-ENTITY` y `page_type ∈ {call, program_page}` | `docs.mjs:30-31` | Algoritmo **N**, parámetros **P** (`official.self_match`) |
| A7 | Lista de dominios de financiadores | `research/agent/config/official_domains.v1.json` | **P** (`domains/grants/official_domains.v1.json`) |
| A8 | Regex de foco del extractor (eligib…, deadline, cost share…) | `extractor.mjs:6` | **P** (`extractor.focus_terms`) |
| A9 | Etiqueta `REQ`: «Any other binding requirement of this call» | `extractor.mjs:16` | **P** (`extractor.req_label`); el mecanismo REQ-xx queda **N** |
| A10 | Tipos de página que crean entidad (`call, program_page, award_record, news, blog`) | `ARCHITECTURE.md:159` (el código no lo aplica: `registry.mjs:15`, ver §E) | **P** (`page_types.creates_entity`) |
| A11 | Gaps `official_source_missing`, `deadline_unparsed` y uso de `closes_on` | `gaps.mjs:4,6` | **N** con nombre genérico (`validity_unparsed`); el `gap_id` conserva la semilla v1 para no cambiar ids |
| A12 | Señales `new_official_opportunities`, `deadlines_parsed`, `searches_without_new_official` | `signals.mjs:6`; `log_entry.schema.json:42-50` | **N** renombradas (`new_verified_entities`, `validity_parsed`, `searches_without_new_verified`) |
| A13 | `planner_input.opportunities`, `official_domain`, `from_opportunity` | `planner.mjs:8`; `planner_input.schema.json:8,18,36,44` | **N** renombradas (`entities`, `official_host`, `from_entity`) |
| A14 | Variables B0 (`work`, `entity`→«small business», `COUNTRY_NAMES`) en código | `conditions.mjs:2` | **P** (`b0.vars` declarativo); el renderizado queda **N** |
| A15 | Evaluadores en código `G-STATUS`, `P-TIMELINE` (21 días), `P-ROUTE` | `eligibility_judge.mjs:6` | **P** (`judge.code_evaluators`) |
| A16 | `recommendable` exige `G-SCOPE`, `G-STATUS` y `route` | `eligibility_judge.mjs:9` | **P** (`judge.recommendable` declarativo) |
| A17 | `opportunity_json` del judge (`instrument`, `amount_text`, `deadline_label`) | `eligibility_judge.mjs:10` | **P** (`judge.entityView`) |
| A18 | `route` en `judge_output`/`judgment` y su enum | `common.schema.json:30`; `judgment.schema.json` | **P** (`judge.extras`) |
| A19 | `scope_rank` de `G-SCOPE` y desempate por `closes_on` | `ranking.mjs:1-2` | Algoritmo **N**; `scope_criterion` **P**; `valid_until` **N** |
| A20 | Ids de prompt `eligibility_judge`, `b0_templates`; `catalog_version` `criteria_catalog.grant`; `official_domains_version` | `run.mjs:3`; `common.schema.json:71,84,91`; `run_config.schema.json:74` | **N** genérico (`promptRef` con `domain` y `role`) |
| A21 | `criterionId` `(G\|P)-…` | `common.schema.json:26` | **N** patrón genérico; el pack lo restringe |
| A22 | Enums `validityStatus`, `pageType`, `instrument`, `route` en `common` | `common.schema.json:30-33` | **P** |
| A23 | Perfil `profile/1` con rutas `applicant.*`, `project.*`, `team.pi.*`, `funding.*` | `profile.schema.json`; `profile.mjs:2` | **P** (el núcleo solo lee `profile_id` y `fields[*].value`) |
| A24 | Case: `anchor` único con `closes_on`, `winners_published`, `expected_route`; `caseId` `^case-` | `case.schema.json:16,89,104`; `common.schema.json:13-14` | Envoltura **N** (`anchors[]` con identificadores); atributos **P** |
| A25 | Label: `status`, `deadline`, `scope`, `route` | `label.schema.json:8,17-22` | Envoltura **N** (`identity_correct`, `criteria`, `confidence`, `notes`); atributos **P** |
| A26 | `gain()` con `status`/`route` y `hard_false_positive` con `scope`/`closed` | `research/bench/metrics.mjs:8,14` | **P** (`labels.gain`, `labels.isHardNegative`) |
| A27 | Métricas `status_accuracy` y `deadline_accuracy` | `metrics.mjs:13`; `metrics_report.schema.json:20,27` | **N**, con nombre conservado; el pack declara qué campo del label es «status» y cuál «deadline» (o `null`) |
| A28 | Columnas de la hoja ciega y su import | `research/bench/sample.mjs:2`; `labels.mjs:4` | Prefijo/sufijo **N**; columnas intermedias **P** |
| A29 | Ruta fija al catálogo de grants y a los dominios oficiales en el CLI | `research/bench/cli.mjs:23` | **N** (resueltas desde el pack) |
| A30 | Textos de prompt grant: planner, extractor, judge, preannotator, plantillas B0 | `prompts/planner/v1/system.md:1-25`, `prompts/*/v1` | Planner → **N** (prompt núcleo + `planner_notes` **P**); el resto **P** (sin cambios para grants) |
| A31 | `run_end.opportunities`, `totals.official_opportunities`, `judge.max_opportunities` | `log_entry.schema.json:125-129`; `run_result.schema.json:39-42`; `run_config.schema.json:55-56` | **N** renombrados (`entities`, `verified_entities`, `max_entities`) |
| A32 | Listas de agregadores de `hostKind` afinadas a grants | `research/server/research/verify.mjs:30-37` (producción) | Se sigue importando sin cambios (**N**); el pack añade `host_rules.never_official` |

## B. Código, contratos y artefactos sin uso

«Sin uso en agente/bench» = nadie en `research/agent/**` ni `research/bench/**` lo llama; «sin uso en el repo» = tampoco producción, frontend ni scripts. Comprobado con un recorrido de todos los `export` y grep de palabra completa sobre `research/**/*.mjs` y `frontend/src/**`.

| # | Elemento | Prueba | Alcance | Propuesta |
|---|---|---|---|---|
| B1 | `loadJson` | `research/agent/contracts.mjs:21`; 0 referencias fuera del archivo | repo | borrar |
| B2 | `identifiersForAbout` | `research/agent/identifiers.mjs:23`; 0 referencias. `registry.mjs:16` duplica su lógica | repo | borrar y dejar una sola implementación (la del registry pasa a llamarla en R-07) |
| B3 | `BudgetStop` | `research/agent/errors.mjs:20`; solo su definición | repo | borrar |
| B4 | `intakeToProfile` | `research/agent/profile.mjs:10`; 0 referencias, sin test | repo | **conservar** y añadir test: es el adaptador de la integración con el producto (ARCHITECTURE_AGENT §6) |
| B5 | `loadInvestorJson` | `research/bench/investors/contracts.mjs:35`; 0 referencias | repo | se retira con `bench/investors` (R-15) |
| B6 | `classifyActivity` | `research/bench/investors/activity.mjs:3`; solo `investors.test.mjs:71-74`. El motor no lo usa: `active_status` sale de la extracción (`extractor.mjs:10`) | solo tests | su regla pasa a la validez del pack investors; el archivo se retira |
| B7 | `assertUnknownNeverMet` | `research/bench/investors/judge.mjs:47`; solo `investors.test.mjs:86`; el judge nunca la llama | solo tests | tautología; se retira |
| B8 | `preannotateInvestorItems` | `research/bench/investors/preannotate.mjs:3`; solo tests. El CLI copia un JSONL fijo (`cli.mjs:78`) | solo tests | se retira (la preanotación pasa al harness único) |
| B9 | Prompts `investor/judge/v1` y `investor/preannotator/v1` | solo se cargan para verificar el sha (`research/bench/investors/cli.mjs:29`); nunca se envían al modelo | repo | quedan como históricos; los sustituye `v2` (A-02) |
| B10 | Contrato `manual_search` | nadie llama `validate('manual_search', …)`; `research/bench/pool.mjs:4` lee el JSON sin validar | repo | **usar**: validar al leer (R-05) |
| B11 | Campos de `run_config` ignorados: `max_tokens.extractor` (el extractor fija 8000), `temperatures.judge`, `temperatures.preannotator`, `max_tokens.preannotator`, `agent_model.expected_model_id` | `extractor.mjs:18`; `eligibility_judge.mjs:10`; `research/bench/preannotate.mjs:3`; grep sin lectores de `expected_model_id` | repo | **usar** (R-03) |
| B12 | `versions.code_sha` siempre `'0000000'` | `research/agent/run.mjs:3` | repo | rellenar con el sha real inyectado (R-03) |
| B13 | Subcomando `decide`: no vuelve a aplicar la regla, solo reescribe el reporte | `research/bench/cli.mjs:93` | repo | arreglar (R-05) |
| B14 | `docs/benchmark/investors/*` y `research/bench/investors/*` (benchmark hermano) | quedan sustituidos por el paquete investors + harness único | repo (sin commit) | retirar **solo después** de que el pack investors pase sus ACC y la persona lo confirme (R-15, H0) |
| B15 | `research/bench/out/fixture/` y `research/bench/out/pilot/` (salidas antiguas en disco) | ignorados por `.gitignore:40` | fuera de git | no se tocan; la persona decide |

No encontré tests ni fixtures del agente sin uso: los 11 archivos de `research/tests/agent/` se ejecutan con `test:agent`.

## C. Variables de entorno

La tabla completa (231 filas, una por variable, sin valores) está en `docs/handoff/REFACTOR-PLAN.md`, Anexo C. Resumen comprobado:

- **Ninguna variable que lea producción se propone borrar.** 229 de las 231 tienen un lector en `research/server/**` o `backend/**`; `BASELINE_LLM_MODEL` solo la lee un script (`research/scripts/baseline-llm.mjs:3`). 43 las usa además el agente o el benchmark de forma indirecta (a través de `fleetConfig`, `PROVIDER_FN`, `crawl4aiRead` o `jinaRead`).
- **Sin lector en todo el repo:** solo `APOLLO_API_KEY` (presente en `research/.env`, ausente de `.env.example`). Veredicto: **confirmar con una persona** (está reservada para la extensión Apollo).
- **Parecían muertas y no lo están:** `COST_EXA_PER_CALL`, `COST_FIRECRAWL_PER_CALL`, `COST_SCRAPEGRAPH_PER_CALL` se leen dinámicamente en `research/server/research/providers.mjs:44`; `VLLM_*` y las claves de buscadores se leen por tablas (`research/server/analysis/fleet.mjs:9-14`, `research/server/research/searchApis.mjs:14`).
- **Leídas por producción y ausentes de `.env.example` (documentar):** `SEARCH_PROVIDER`, `SEARCH_COMPLEMENT`, `SEARXNG_TIMEOUT_MS`, `SERPER_TIMEOUT_MS`, `JINA_TIMEOUT_MS`, `INTAKE_LLM_MAX_TOKENS`, `INTAKE_LLM_REASONING_EFFORT`, `QUERY_EXPAND_*`, `ENGINE_LLM_THINKING`, `RESEARCH_BROWSER*` y 30 más (lista en el Anexo C).
- **Duplicados (dos nombres, mismo uso):** `SGAI_API_KEY` ≡ `SCRAPEGRAPH_API_KEY` (`webscrape.mjs:23`); `JEV_API_KEY` ≡ `TYPESAFE_API_KEY` (`jev.mjs:21`); `INTAKE_LLM_*` actúa como respaldo del rol `chat`, que a su vez es el respaldo del rol `engine` (`fleet.mjs:28-34`). Se conservan, porque producción lee los dos nombres.
- **El agente y el benchmark leen el modelo de forma distinta:**
  - El agente usa el rol `engine` de `fleetConfig` (`research/agent/llm.mjs:10,21`). Si faltan `ENGINE_LLM_URL/MODEL`, cae en silencio al rol `chat` y luego a `INTAKE_LLM_*` (`fleet.mjs:28-34`), y como `expected_model_id` no se comprueba (B11), una corrida puede usar otro modelo sin avisar.
  - El preanotador de grants reescribe `ENGINE_LLM_URL/MODEL/API_KEY` con las variables que nombra `run_config.preannotator_model` (`PREANNOTATOR_BASE_URL`, `PREANNOTATOR_MODEL`, `PREANNOTATOR_API_KEY`; `research/bench/cli.mjs:63`). Esas tres no están en `.env.example`.
  - El benchmark de inversores usa siempre el rol `engine`, no tiene preanotador por entorno y su caché no incluye el modelo en la clave (`research/bench/investors/external.mjs:12`).
- **Variables del buscador que no aplican al agente:** `ENGINE_SEARCH_PROVIDERS`, `ENGINE_RESULTS_PER_PROVIDER`, `SEARCH_COMPLEMENT`, `FIRECRAWL_*`, `ENGINE_ROUNDS` y `ENGINE_MAX_*` solo afectan a `multiSearch` y al motor de producción. El agente usa un solo proveedor desde `run_config.search.provider` (`tools/search.mjs:8`).
- **Variables del buscador que sí cambian los resultados del agente sin quedar en `run_config`:** `SERPER_GL` (`searchApis.mjs:121`) y `SEARXNG_ENGINES` (`localSearch.mjs:12`). Es una amenaza a la reproducibilidad (propuesta en R-03).
- **Secretos:** todos los `*_API_KEY`, `*_TOKEN` y `APIFY_TOKEN` están marcados en el Anexo C. Ningún valor se imprimió. Las 6 copias `research/.env.bak-*`/`.env.tmp` contienen secretos en claro: la persona debe decidir si borrarlas (H-ENV).

## D. Calidad de código (15 hallazgos, por impacto)

| # | Hallazgo | Evidencia | Efecto |
|---|---|---|---|
| D1 | **Las métricas comparan por `stable_id` en vez de por intersección de identificadores**, contra el protocolo | `research/bench/metrics.mjs:11-14,19`; protocolo §5 (`BENCHMARK_PROTOCOL.md:116`) | Una corrida que encontró la convocatoria por URL (`opp:url:…`) no recibe crédito si el pool la fusionó en `opp:nih:…`: `pooled_recall@20`, nDCG, exactitudes y HFP salen subestimados. `hitAt20` sí usa identificadores (`metrics.mjs:10`) |
| D2 | **Los links oficiales descargados siguen apareciendo como no descargados** para gaps y planner | `search_agent.mjs:14` marca `fetched` en una copia (`rr`), y tras cada extracción `state.resultRefs` se reconstruye desde `registry.links()` con `fetched:false`. Comprobado: en B2 del fixture, el paso 2 vuelve a ofrecer `l000-00` y el gap `g-e8e0f6f2` | El planner B2 recibe huecos falsos y gasta acciones |
| D3 | Código minificado en una línea: sin estructura, sin comentarios, sin revisión posible | `search_agent.mjs:11-21`, `run.mjs:1-3`, `registry.mjs:8-27`, `gaps.mjs:6-10`, `planner.mjs:8-10`, `bench/metrics.mjs:24-29`, `bench/sample.mjs:4`, `bench/runAll.mjs:1-5` | Mantener o auditar el bucle es caro y propenso a errores |
| D4 | Infraestructura duplicada entre `research/agent` y `research/bench/investors` | contratos+`bundle` (`investors/contracts.mjs:9-48` vs `agent/contracts.mjs:11-64`), prompts (`investors/prompts.mjs` vs `agent/prompts.mjs`), cliente LLM (`investors/external.mjs:9-19` vs `agent/llm.mjs:19-54`), CSV (`investors/labels.mjs:4-8` vs `bench/labels.mjs:3`), métricas (`investors/metrics.mjs:5-7` vs `bench/metrics.mjs:10-12`) | Dos bucles con reglas distintas: lo contrario del objetivo |
| D5 | El cliente LLM de inversores no tiene reintento, códigos de error ni modelo en la clave de caché | `investors/external.mjs:12-17` | Un cambio de modelo reutiliza respuestas de otro |
| D6 | Reloj real en las tools: con fixtures, `seconds_discovery_nominal` depende de la máquina | `tools/search.mjs:7`, `tools/fetch.mjs:7` (`clock = Date.now`); `bench/cli.mjs:29-30` no inyecta reloj. Dos corridas B0 seguidas dieron `seconds_discovery_nominal` distintos | `budget_time` puede dispararse o no según la máquina; los tests no lo detectan |
| D7 | Un JSON inválido del extractor en **una** página termina toda la corrida en `fatal_error` | `search_agent.mjs:14` llama `extractDocument` sin `try`; `llm.mjs:52` lanza tras el reintento | Una página difícil anula la corrida completa (y cuenta como 0 en métricas) |
| D8 | El registry no une dos entidades existentes cuando un documento comparte claves con ambas | `registry.mjs:11` devuelve la primera coincidencia; ARCHITECTURE §5.5 dice union-find | Entidades duplicadas en el ranking |
| D9 | `link_id` usa el índice entre todos los links, no entre los aceptados | `extractor.mjs:24`; ARCHITECTURE §5.4 paso 3 | Ids con huecos; contradice el diseño |
| D10 | `new_official_domains` cuenta todos los dominios oficiales de la búsqueda, no los nuevos | `signals.mjs:6`; ARCHITECTURE §7.1 | Señal inflada |
| D11 | Configuración congelada que no se respeta (B11) y hashes calculados sobre `JSON.stringify` en vez de bytes | `run.mjs:3` (`case_sha256: sha(caseObj)`, `run_config_sha256: sha(config)`); `docs/contracts/README.md:34-37` | El reporte no prueba qué archivo se usó |
| D12 | El CLI ignora `--config` en `preannotate` y `metrics` | `bench/cli.mjs:60,90` (ruta fija a `config/v0.json`) | El piloto y un segundo benchmark no se pueden evaluar |
| D13 | `planner_input.results_unfetched[].official_domain` es siempre `false` | `search_agent.mjs:15` (`official_domain:false`) | Campo engañoso para el planner |
| D14 | `import()` dinámico dentro del bucle de búsqueda | `search_agent.mjs:15` (`await import('../server/research/core.mjs')`) | Ruido; debe ser un import estático |
| D15 | Nombre engañoso: la «recall» por estado de criterio se llama `pooled_recall` | `bench/metrics.mjs:18` | Confunde con la métrica primaria |

## E. Brecha entre `ARCHITECTURE.md` y el código

**Lo que el diseño dice y el código no hace**

| Diseño | Código |
|---|---|
| §2: `runB0/runB1/runB2(ctx)` en `conditions.mjs` | No existen; las tres condiciones son ramas de `runDiscovery` (`search_agent.mjs:18-20`) |
| §2: `searchSignals(before, after, searchCtx)` y `updatePatience` | `searchSignals({…})` y `createPatience(n)` (`signals.mjs:2-3`) |
| §5.4: `link_id` con el índice entre links aceptados | índice entre todos (D9) |
| §5.5: merge con union-find | primera coincidencia (D8) |
| §5.4 paso 4: se crea entidad solo si `page_type ∈ {call, program_page, award_record, news, blog}` | se crea con cualquier `page_type` si `about ≠ null` (`registry.mjs:15`) |
| §5.6: `issuer_match` exige evidencia **verificada** de `G-ENTITY` | usa la evidencia cruda del extractor, sin verificar (`docs.mjs:30`) |
| §7.2: `mention_unresolved` sale de las menciones de las páginas leídas | las menciones y los links de una página con `about = null` (listas, noticias de varios programas) se pierden: `registry.mjs:15` retorna antes de guardarlos (`registry.mjs:22`) |
| §6.2: «más los REQ-xx de la entidad (máximo 8)» | sin tope (`eligibility_judge.mjs:10`) |
| §7.1: `new_official_domains` «descargados por primera vez» | todos (D10) |
| §10: `expected_model_id` aborta si no coincide | no implementado (B11) |
| §11: cada log lleva la versión del modelo | en corridas reales todos los logs de discovery dicen `model_id: 'pending'`; solo se actualiza al final (`run.mjs:3`, `logger.setVersions`) |
| Protocolo §5: coincidencia por `identifierKeys` | por `stable_id` (D1) |
| Protocolo §4.3: muestra del segundo revisor (10 S3 + 10 S5 + 10 S4∪S6) | no hay hoja de segundo revisor (`bench/sample.mjs` no la genera) |
| Protocolo §8: `decide` aplica la regla | solo reescribe el reporte (B13) |
| TASK-11: amenazas «texto fijo, copiado de §10» | parafraseadas (`bench/report.mjs:2`) |
| `prompts/README.md`: `source_text` del preanotador = hasta 3 fuentes, oficiales primero, `excerptForExtraction(…, 8000)` separadas por `=== <url> ===` | se unen con `\n` y se cortan a 24 000 (`bench/preannotate.mjs:3`; `bench/cli.mjs:68`); `issuer` siempre `''` |
| ACC-18/19/20: comparar `searches_log`, `b0_queries`, `planner_rejected`, `gaps_offered_at_call_1` y la ausencia de claves del judge en los logs | `e2e.test.mjs:4` no comprueba ninguno de esos puntos. Los comprobé a mano y **hoy coinciden** con `expected.json` |

**Lo que el código hace y el diseño no dice**

- La variante de reintento del fixture busca la respuesta por `world.json` además de por URL (`fixtures.mjs:13-15`).
- `tools/search.mjs:6` descarta fechas de publicación que no sean ISO.
- `run.mjs` reescribe `result.json` y **vuelve a lanzar** la excepción tras un `fatal_error` (TASK-07 lo pide; ARCHITECTURE §3 no).
- Un segundo benchmark completo de inversores, con contratos, prompts y CLI propios, que el diseño (§16: «search_agent, planner, judge… no cambian») no contempla.

## F. Comparación de las tres implementaciones

| Pieza | Agente completo (`research/agent`) | `research/bench/investors/engine.mjs` | Flujo de inversores del producto (`engine.mjs` objetivo `investment` + `investor.mjs`) |
|---|---|---|---|
| Búsqueda, proveedor único | Sí: `run_config.search.provider` vía `PROVIDER_FN`, nunca `multiSearch` (`tools/search.mjs:8`) | Inyectada; en vivo SearXNG fijo (`investors/cli.mjs:57`) | No: `multiSearch` con varios proveedores y consenso (`engine.mjs:256-260`) |
| Fetch y topes | Cadena fija directa → Crawl4AI → Jina; top-3 por búsqueda con `host_kind=other`; `budgets.fetches` (`search_agent.mjs:15`) | Primeros N resultados, sin filtro de host (`engine.mjs:22`) | `ENGINE_MAX_PAGES`, orden de lectores configurable, Firecrawl (`engine.mjs:216`) |
| Extracción con cita literal | Sí, `literalIn` contra el texto completo (`extractor.mjs:20`) | No: la extracción llega hecha o del LLM sin verificar (`investors/extractor.mjs:4-20`; `external.mjs:29-33`) | Parcial: el código busca frases con regex (`investor.mjs:62-101`) y marca `fake_quote` |
| Identidad estable | Union por identificadores (`registry.mjs:11-19`, con D8) | `inv:domain`, `inv:regulatory` o `inv:url` (`identity.mjs:35-42`), con el dominio que declara el LLM sin verificar | No hay `stable_id`; dedupe heurístico (`core.mjs:233`) |
| Fuente oficial | Regla en código (`docs.mjs:22-33`) | `source_kind` que declara el LLM | `out.official` del modelo + chequeo de host (`investor.mjs:109`) |
| Señales independientes del judge | Sí (`signals.mjs`) | Contador de entidades nuevas de cualquier tipo (`engine.mjs:32`) | No: el orquestador decide con métricas de prioritarios ya verificados (`orchestrator.mjs:37-87`), circular |
| Huecos | 5 tipos (`gaps.mjs`) | No hay | Preguntas de reflexión y `sufficiency.mjs` |
| Replanificación | Planner `adaptive_step` con gaps (`search_agent.mjs:20`) | Planner con un resumen de entidades (`engine.mjs:49`) | `followUpQueries`, investigador y rondas del orquestador |
| Parada por N y presupuesto | Paciencia N (nuevas oficiales) + 5 presupuestos (`search_agent.mjs:13`) | Paciencia N (nuevas, no oficiales) + presupuestos (`engine.mjs:13-14,32-34`) | Rondas, timeouts y `ORCHESTRATOR_MAX_ATTEMPTS` |
| Judge de 5 estados | LLM + reglas R1–R7 en código (`eligibility_judge.mjs:7`) | Código puro, 5 estados, sin evidencia citada (`investors/judge.mjs:6-45`) | No: niveles `main/verify/drop` (`investor.mjs:113`) |
| Ranking determinista | Tupla `sortKey` (`ranking.mjs:2`) | `gain` de etiqueta aplicada al juicio del sistema + desempates (`investors/ranking.mjs:9-15`) | Score de `evaluate` (`core.mjs:271`) |
| Log por paso | `steps.jsonl` validado (`logger.mjs:5`) | No | Trazas de auditoría sin contrato |
| Caché | SQLite con costo nominal (`cache.mjs`) | SQLite sin modelo en la clave (`external.mjs:12`) | Memoria por corrida + ledger de Firecrawl |
| Abstención | Sí: nada `recommendable` (`run.mjs:3`) | Sí: ningún `gain ≥ 2` (`engine.mjs:56`) | No |

**Lectura:** el agente completo es la única implementación que cumple las invariantes. El motor de inversores del benchmark repite el bucle sin verificación y con otra semántica de paciencia; el flujo del producto es solo referencia.

## Supuestos explícitos

1. Las decisiones del 01/10 y del 05/10 citadas en `docs/` se tratan como aprobadas, aunque falten en el vault (ver vacío arriba).
2. El trabajo de inversores sin commit es de la persona y debe quedar en un commit propio antes de cualquier tarea de refactor (paso H0). Este trabajo no lo toca.
3. Como el benchmark de grants no está congelado, se permiten contratos v2, un prompt de planner nuevo y la corrección de bugs que cambian valores del fixture, siempre que cada cambio de valor esté declarado de antemano (REFACTOR-PLAN §3).
4. «Sin uso» se comprobó por grep de palabra completa y lectura de tablas de nombres; una lectura por cadena construida en tiempo de ejecución que no siga los patrones encontrados (`ROLE_ENV`, `PROVIDER_KEYS`, `COST_${…}`) no se detectaría.

No encontré nada irreversible ni ambiguo que exija preguntar antes de escribir los documentos.
