# Arquitectura del benchmark general

Estado: **propuesta** (07/10/2026). Complementa `docs/BENCHMARK_PROTOCOL.md` (`protocol@v1`, que **no se edita**) y lo extiende a varios dominios. Donde este documento no dice nada, manda `protocol@v1`. Diseño del agente: `docs/ARCHITECTURE_AGENT.md`. Tareas: `docs/handoff/REFACTOR-PLAN.md`.

**Alcance honesto.** Un *harness exploratorio para comparar búsqueda estática y adaptativa sobre entidades ancla conocidas*. El resultado de cada dominio es una regla de negocio interna (`business_rule_exploratory`), no una estimación de recall ni de calidad del producto.

---

## 1. Qué es fijo y qué es del dominio

### 1.1 Fijo para todos los dominios (núcleo del harness)

| Pieza | Valor o regla | Dónde |
|---|---|---|
| Pregunta | ¿B2 recupera mejores candidatos que B0 y que B1 con límites comparables? | `BENCHMARK_PROTOCOL.md:11` |
| Condiciones | B0 (plantillas estáticas del dominio), B1 (planner una vez, `initial_batch`), B2 (planner `initial_batch` + `adaptive_step`), con el **mismo prompt de planner del núcleo** | `ARCHITECTURE.md` §4; `ARCHITECTURE_AGENT.md` §3.4 |
| Mismas condiciones | B0, B1 y B2 comparten modelo, buscador, topes, N, temperaturas del extractor y del judge, política de descarga por defecto, paquete y caché | `AGENTS.md` regla 6 |
| Orden de ejecución | `conditionOrder(seed)` con mulberry32 + Fisher–Yates | ACC-30 |
| Seeds | 3 por caso, fijados en `run_config` | `run_config/2.seeds` |
| Caché | un SQLite por benchmark, compartido por condiciones y seeds; costo nominal | `ARCHITECTURE.md` §9 |
| Log | `steps.jsonl` validado contra `log_entry/2` | `ARCHITECTURE_AGENT.md` §4 |
| Pool | unión del top-20 de las 9 corridas, las anclas y la búsqueda manual; fusión por `identifierKeys` (union-find) | `BENCHMARK_PROTOCOL.md` §4.1 |
| Preanotación | LLM de **otra familia**, nunca gold; temperatura 0, seed 0 | `BENCHMARK_PROTOCOL.md` §4.2 |
| Adjudicación ciega | estratos S1–S6, tamaños, segundo revisor (~30 ítems), regla de κ < 0,6 | `BENCHMARK_PROTOCOL.md` §4.3 |
| Positivo | `gain ≥ 2` (la función `gain` es del dominio, el umbral no) | §1.2 |
| Métricas y nombres | `hit_at_20`, `pooled_recall_at_20`, `ndcg_at_10`, elegibilidad por criterio (matriz 5×5, P/R/F1 de `met` y `not_met`, macro-F1, `unknown_rate`), `hard_false_positive_rate`, `identity_accuracy`, `status_accuracy`, `deadline_accuracy`, abstenciones «x/y», curva costo, latencia, dispersión | `BENCHMARK_PROTOCOL.md` §5 |
| Coincidencia sistema ↔ pool | **por intersección de `identifierKeys`**, nunca por `stable_id` (corrige D1, §2.6) | `BENCHMARK_PROTOCOL.md:116` |
| Análisis | media por caso sobre seeds; diferencias pareadas; τ (0,05 / 0,03 / 0); prueba de signos unilateral; bootstrap 10 000 con seed `20261006` | `BENCHMARK_PROTOCOL.md` §6 |
| Regla de decisión | `decision_rule@v1` (D1–D7 y precedencia), igual para todos los dominios | `BENCHMARK_PROTOCOL.md` §7 |
| Amenazas a la validez | texto fijo de `BENCHMARK_PROTOCOL.md` §10, copiado literal en el reporte | TASK-11 |

La regla de decisión «propuesta» del benchmark hermano de inversores (`research/bench/investors/config/v0.json`, `decision_rule.min_recall_gain`…) **queda sustituida** por `decision_rule@v1`. Esto se registra como decisión «propuesta» en el vault. La persona decide en H4 si la acepta.

### 1.2 Del dominio (lo aporta el paquete o la carpeta del dominio)

| Pieza | Grants | Investors | Dónde vive |
|---|---|---|---|
| Perfil | `profile/1` (sin cambios) | `investor_profile/1` (sin commit, se adopta) | `docs/contracts/domains/<id>/profile.schema.json` |
| Atributos del ancla | `issuer, closes_on, verified_open_on, winners_published, expected_route, why_it_fits` | `canonical_name, official_url, active_status, verified_on, compatibility_evidence, found_after_profile_freeze, selected_from_system_results, historical_investment_control` | `anchor_attributes.schema.json` |
| Atributos del label | `status, deadline, scope, hard_eligibility, route` | `entity_kind, active_status, sector_fit, stage_fit, geography_fit, check_fit, round_fit, business_model_fit, lead_fit, hard_eligibility, portfolio_conflict, overall_relevance` | `label_attributes.schema.json` |
| `gain(label)` | `BENCHMARK_PROTOCOL.md` §4.4 | `docs/benchmark/investors/PROTOCOL.md:44-49` | `pack.mjs` |
| `isHardNegative(label)` | `ineligible`, `scope = off` o `status ∈ {closed, awarded, not_a_call}` | `ineligible`, `sector_fit = off` o `active_status = inactive` | `pack.mjs` |
| Campos de `status_accuracy` / `deadline_accuracy` | `status` / `deadline` | `active_status` / ninguno (`deadline_accuracy = null`) | `pack.json` `labels.*` |
| Plantillas B0 | `prompts/b0/v1/templates.json` | `prompts/investor/b0/v2/templates.json` (A-02) | manifest del paquete |
| Criterios | `criteria_catalog.grant@v2` (= v1 renombrado) | `criteria_catalog.investor@v2` (A-01, H3) | `docs/contracts/domains/<id>/` |
| Anclas | convocatoria abierta, verificada, sin ganadores | firma activa o posiblemente activa, verificada, encontrada después del freeze | case + guía |
| Casos nulos | búsqueda manual sin oportunidad abierta y elegible | búsqueda manual sin inversor activo con `gain ≥ 2` | case + guía |
| Ganancias del nDCG | `gain` del dominio, 0–3 | ídem | `pack.mjs` |
| N, presupuestos, τ | H4 por dominio (`run_config` de ese benchmark) | ídem | `research/bench/domains/<id>/config/` |
| Guía de etiquetado | `docs/benchmark/LABELING_GUIDE.md` | `docs/benchmark/investors/LABELING_GUIDE.md` (A-04 la adapta a `label/2`) | `domain.json.labeling_guide` |

---

## 2. Generalización de los schemas del benchmark

Todos viven en `docs/contracts/v2/` (A-01). La parte del dominio se valida con el schema del paquete. Los nombres de métricas no cambian.

### 2.1 `case/2`

| Campo | Tipo | Núcleo / paquete | Nota |
|---|---|---|---|
| `schema_version` | `"case/2"` | núcleo | |
| `domain` | string | núcleo | `= pack.id` |
| `case_id` | `common/2.caseId`, empieza por `pack.case_id_prefix` | núcleo (+ prefijo del paquete) | |
| `kind` | `anchor` \| `null` | núcleo | |
| `as_of`, `profile_path`, `profile_sha256` | como v1 | núcleo | `profile_sha256` = sha256 de los bytes |
| `construction` | `{curator, profile_builder, profile_builder_saw_anchor: false, selection_order: "profile_first", profile_frozen_at, anchor_chosen_at \| null, profile_source_kind}` | núcleo | une v1 e investors (`builder_saw_investors` → `profile_builder_saw_anchor`) |
| `anchors` | array 0–2 de `{name, official_url, identifiers:[{scheme, value}], attributes}` | núcleo; `attributes` del paquete | v1 tenía un solo `anchor`; `kind = anchor` exige ≥ 1, `kind = null` exige 0 |
| `null_case` | `{scope, manual_search_minutes, manual_queries, conclusion}` \| null | núcleo | une v1 (`rationale` → `conclusion`) e investors |

### 2.2 `label/2`

`{schema_version, domain, label_id, case_id, stable_id, role, annotator, labeled_at, identity_correct, criteria:[{criterion_id, state, evidence_url, quote, note}], confidence, notes, attributes}`. Todo es núcleo salvo `attributes` (paquete). `role ∈ {preannotator, adjudicator, second_reviewer}`. El preanotador produce `preannotator_output` del paquete y el harness lo envuelve en `label/2` (v1, `research/bench/preannotate.mjs:3`).

### 2.3 `manual_search/2`

`{schema_version, domain, case_id, minutes, queries:[string], items:[{name, url, identifiers:[{scheme, value}]}]}`. Sin parte de dominio. **Se valida al leer** (v1 no lo hacía: DIAGNOSIS B10).

### 2.4 `run_result/2`

Como v1, con los renombres de `ARCHITECTURE_AGENT.md` §4.2: `domain`, `versions/2`, `entities: target_entity/2[]`, `judgments: judgment/2[]`, `totals.verified_entities`. `ranked[]` no cambia (`rank, stable_id, eligibility_class, recommendable, official, sort_key`). Opcional: `reference: {system: "B_prod", …}` solo en corridas de referencia (§5).

### 2.5 `metrics_report/2`

Como v1 más `domain`, `pack {id, version, sha256}` y, opcional, `reference_metrics` (§5). `per_run[]` conserva todos sus nombres, incluidos `status_accuracy` y `deadline_accuracy` (este vale `null` si el paquete no declara `validity_date_field`). `decision` no cambia y nunca usa `reference_metrics`.

### 2.6 Coincidencia con el pool (corrige D1)

`matchToPool(entity, pool)` devuelve el `item_key` del **primer** ítem del pool (en orden del archivo) tal que `identifierKeys(entity) ∩ identifierKeys(item) ≠ ∅`, o `null`. Todas las métricas se calculan sobre `item_key`:
- `top_k(r)` = lista de `item_key` (sin `null` y sin repetir, en orden) de los primeros `k` elementos de `result.ranked`;
- los labels se indexan por `item_key` (el label guarda el `stable_id` canónico del pool, que se traduce a `item_key` con el pool);
- `hit_at_20` usa el `item_key` del ancla (el ítem con `from.anchor = true`).

Ejemplo de ACC-32 (dos corridas, `opp:nih:RFA-AG-27-010` y `opp:url:grants.nih.gov/...rfa-ag-27-010.html`, fusionadas en un ítem positivo): con la regla nueva **las dos** corridas tienen `pooled_recall_at_20 = 1` sobre ese ítem; con la de v1 la segunda tiene 0 (REFACTOR-PLAN ACC-56).

---

## 3. Carpetas por dominio y un único CLI

```
research/bench/
  cli.mjs  runAll.mjs  pool.mjs  preannotate.mjs  sample.mjs  labels.mjs  metrics.mjs  stats.mjs  decide.mjs  report.mjs
  domains/
    grants/
      domain.json                  # {domain, protocol: "docs/BENCHMARK_PROTOCOL.md", labeling_guide: "docs/benchmark/LABELING_GUIDE.md"}
      config/v0.json               # movido desde research/bench/config/v0.json, bytes idénticos (H5 lo congela)
      cases/  cases/manual/  cases/profiles/  cases/manifest.json
      pilot/                       # movido desde research/bench/pilot/
    investors/
      domain.json                  # {…, protocol: "docs/benchmark/investors/PROTOCOL.md" + este documento, labeling_guide: …}
      config/v0.json
      cases/ …
  out/<domain>/<bench_id>/{cache.sqlite, runs/, pool/, labels/, labeling/, metrics_report.json, report.md, curve.csv}
```

**CLI único** (los subcomandos de v1, todos con `--domain`):

```
node research/bench/cli.mjs validate     --domain <id> --config <path> --cases <dir>
node research/bench/cli.mjs run          --domain <id> --config <path> --case <path> --condition B0|B1|B2 --seed <n> [--out <dir>]
node research/bench/cli.mjs run-all      --domain <id> --config <path> [--conditions B0,B1,B2] [--reference B_prod]
node research/bench/cli.mjs pool         --domain <id> --bench <bench_id>
node research/bench/cli.mjs preannotate  --domain <id> --bench <bench_id> --config <path>
node research/bench/cli.mjs sample       --domain <id> --bench <bench_id> [--seed 7]
node research/bench/cli.mjs import-labels --domain <id> --bench <bench_id> --file <csv|json> --role adjudicator|second_reviewer --annotator <id>
node research/bench/cli.mjs metrics      --domain <id> --bench <bench_id> --config <path>
node research/bench/cli.mjs decide       --domain <id> --bench <bench_id>
```

Reglas del CLI:
- `--domain` es obligatorio. El CLI carga el paquete con `loadDomainPack(domain)` y exige `config.domain.id === domain`; si no, sale con código 1.
- Las rutas por defecto se derivan de `domains/<id>/` y de `out/<id>/<bench_id>/`; ninguna ruta de `config/v0.json` está escrita a mano (corrige D12).
- `sample` escribe además `labeling/second-<case_id>.csv` con la muestra del segundo revisor del protocolo §4.3 (DIAGNOSIS §E).
- `decide` vuelve a aplicar `decide()` sobre los agregados de `metrics_report.json` y reescribe `decision` y `report.md` (corrige B13).
- `research/bench/investors/cli.mjs` se retira en R-15, cuando el dominio investors pase sus ACC con el CLI único.

---

## 4. Pasos humanos por dominio

No se automatizan ni se simulan. «Repite» = el mismo paso con los mismos criterios en cada dominio; «cambia» = lo que hay que decidir de nuevo.

| Id | Paso | ¿Repite o cambia por dominio? | Qué cambia en investors |
|---|---|---|---|
| H0 | Commit del trabajo sin commit antes de refactorizar (nuevo) | una vez | el trabajo de inversores sin commit (DIAGNOSIS §0) lo commitea la persona en su propia rama |
| H1 | Perfiles reales a ciegas y congelados | repite | fuentes: documentos de la startup; `profile_builder_saw_anchor = false` |
| H2 | Anclas, casos nulos, búsqueda manual de 20–30 min, manifiesto | **cambia** | definición de ancla y de caso nulo (§1.2) y diversidad: sector, etapa, región y modelo de negocio (`docs/benchmark/investors/PROTOCOL.md:26`) |
| H3 | Aprobar catálogo, regla de fuente oficial y paquete (`status: approved`) | **cambia** | las 9 decisiones marcadas **H3** en `ARCHITECTURE_AGENT.md` §2.10 (identificadores, `self_match`, hosts no oficiales, `primary`, `recency_days`, conflicto inactivo/activo, evaluadores en código, `required_met`, `scope_criterion`) y los ítems 1, 11 y 12 de `DECISIONS_PENDING.md` |
| H4 | Aprobar regla de decisión, N, presupuestos y τ | repite el procedimiento, cambian los valores | N y presupuestos propios del dominio; aceptar que `decision_rule@v1` sustituye a la regla propuesta del hermano |
| H5 | Congelar `run_config` del dominio (familias, fecha, proveedor) | repite | — |
| H9 | Autorizar el envío de perfiles a buscador, modelo y preanotador, y el gasto | repite | perfiles de startups: consentimiento de cada una (`PROTOCOL.md:66`) |
| H6 | Adjudicar las hojas ciegas | repite | columnas de `label_attributes` de investors |
| H7 | Segundo revisor (~30 ítems) | repite | — |
| H8 | Leer fallos (al menos 1 caso perdido por condición) | repite | taxonomía de fallos de la guía de investors (A-04) |
| H-ENV | Decidir el destino de `APOLLO_API_KEY` y de las copias `research/.env.bak-*`/`.env.tmp` | una vez | — |

---

## 5. El sistema viejo como referencia opcional (`B_prod`)

El experimento principal es **solo** B0 vs B1 vs B2. El flujo de producción no es una condición:
- No comparte buscador (`multiSearch` con varios proveedores), herramientas ni topes (DIAGNOSIS §F), así que no cumple «mismas condiciones».
- Se activa solo con `run-all --reference B_prod` y con `run_config.reference_systems: ["B_prod"]` congelado en H5.
- El adaptador `research/bench/reference/prod.mjs` (R-14) llama a `runObjective` de `engine.mjs` con el brief que corresponde al perfil, **una vez por caso** (sin seeds), y convierte sus hallazgos en `run_result/2` con `reference: {system: "B_prod", code_sha}` y sin `judgments`.
- Sus top-20 **sí** entran al pool (más positivos posibles y el mismo trato ciego en la hoja), marcados en `from.reference`, que nunca aparece en la hoja.
- Sus métricas van a `metrics_report.reference_metrics` (las mismas definiciones) y a una sección aparte del reporte titulada «Referencia (no forma parte de la decisión)». `decide()` no las lee. Las métricas de juicio por criterio no se calculan para `B_prod`.
- Amenaza que se declara en el reporte: añadir `B_prod` al pool amplía `P_c` para todas las condiciones por igual, pero sus ítems pueden ser de tipo distinto (por ejemplo, páginas de agregadores).
