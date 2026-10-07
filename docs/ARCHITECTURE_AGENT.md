# Arquitectura del agente general (núcleo + paquetes de dominio)

Estado: **propuesta** (07/10/2026). Autor: arquitecto. Sustituye a `docs/ARCHITECTURE.md` solo en lo que este documento dice explícitamente (§4). Todo lo demás de `ARCHITECTURE.md` sigue vigente. Diagnóstico de partida: `docs/handoff/DIAGNOSIS-2026-10-07.md`. Plan de implementación: `docs/handoff/REFACTOR-PLAN.md`.

**Alcance honesto.** Esto sigue siendo un *harness exploratorio para comparar búsqueda estática y adaptativa sobre entidades ancla conocidas*. Este documento hace que el **mismo** agente iterativo sirva para grants, inversores y, más adelante, usuarios. No valida el producto, no mide recall exhaustivo y no reemplaza todavía el pipeline de producción (§6).

Vocabulario de este documento:
- **Núcleo:** `research/agent/**` salvo `research/agent/domains/**`.
- **Paquete de dominio (DomainPack):** `research/agent/domains/<id>/**` y sus schemas en `docs/contracts/domains/<id>/**`.
- **Entidad:** lo que el agente busca (una convocatoria, una firma inversora, una cuenta de usuario). En v1 se llamaba «oportunidad».
- **Fuente oficial:** documento que el código, aplicando la regla del paquete, acepta como fuente propia o autorizada de la entidad.
- **Entidad verificada:** entidad con identidad estable y al menos una fuente oficial (`official = true`).

---

## 1. Diagrama y límites

```
                 run_config/2 (congelado; incluye domain.id y domain.version)
                              │
              ┌───────────────┴────────────────┐
              │   loadDomainPack(domain.id)     │──► validateDomainPack ──► error PACK_INVALID / PACK_UNAPPROVED
              └───────────────┬────────────────┘
                              │ pack (datos + 5 funciones puras)
 case/2 + profile ─► ┌────────┴──────────────────────── NÚCLEO (research/agent) ───────────────────────────────┐
                     │ conditions: B0 (plantillas del pack) · B1 (planner 1 vez) · B2 (planner adaptativo)   │
                     │ search_agent: search → fetch (política por defecto) → extract → registry → signals    │
                     │      │            │                 │             │            │                      │
                     │      │            │       pack.extractor   pack.identifiers  ├─► patience/stop        │
                     │      │            │       pack.page_types  pack.official     └─► gaps ─► planner (B2)  │
                     │      │            │                        pack.validity.compute                     │
                     │ logger ─► steps.jsonl (log_entry/2 validado)                                            │
                     └───────────────────────────┬────────────────────────────────────────────────────────────┘
                                                 │ discovery terminada (stop_reason)
                     ┌───────────────────────────▼──────────────── judge (después) ───────────────────────────┐
                     │ LLM (prompt del pack) → judge_output del pack → R1–R7 + code_evaluators del pack        │
                     │ → aggregate → recommendable (regla declarativa del pack)                                │
                     └───────────────────────────┬────────────────────────────────────────────────────────────┘
                                                 ▼
                          ranking (tupla fija; scope_criterion del pack) → run_result/2
                                                 ▼
                   research/bench (harness único): pool → preanotación → muestra ciega → humano → métricas → decisión
```

Flechas que **no existen**: judge → planner, judge → signals, judge → parada, pack → condición. Un paquete nunca ve la condición (B0/B1/B2) ni la semilla.

### 1.1 Qué no puede hacer el núcleo

1. Nombrar un dominio. Ningún archivo del núcleo contiene, fuera de comentarios, las cadenas de la lista `CORE_FORBIDDEN_TOKENS` de `REFACTOR-PLAN.md` ACC-52 (por ejemplo `grant`, `investor`, `opportunit`, `nih`, `nsf`, `deadline`, `G-SCOPE`, `INV-`, `route`). Un test estático lo comprueba.
2. Ramificarse por `pack.id`. Todo comportamiento que depende del dominio entra por un **campo** o una **función** del contrato del §2. No hay `if (pack.id === …)`.
3. Leer el resultado del judge antes de que termine el discovery (invariante v1, `ARCHITECTURE.md:41`).
4. Ejecutar código del paquete con efectos: las 5 funciones del paquete (§2.3) son puras, reciben todo por argumento y no importan nada de `research/server/**` salvo `dates.mjs` y `verify.mjs`, que también son puras.
5. Cambiar por condición: modelo, buscador, topes, N, temperaturas del extractor y del judge, política de descarga por defecto ni el paquete. El paquete es el mismo objeto para B0, B1 y B2 de una corrida y se registra en `versions.domain`.
6. Inventar defaults de perfil. Un campo de perfil `null` es desconocido en todos los dominios (decisión A10 de `ARCHITECTURE.md:371`).

---

## 2. Contrato del DomainPack

### 2.1 Archivos de un paquete

```
research/agent/domains/<id>/
  pack.json                  # datos declarativos (valida contra docs/contracts/v2/domain_pack.schema.json)
  pack.mjs                   # exporta exactamente las 5 funciones del §2.3, nada más
  official.<id>.v<N>.json    # regla de fuente oficial (valida contra official_domains.schema.json, sin cambios)
  README.md                  # una página: qué es la entidad, qué decidió H3, qué está pendiente
docs/contracts/domains/<id>/
  profile.schema.json  entity_attributes.schema.json  validity.schema.json
  extraction.schema.json  judge_output.schema.json  preannotator_output.schema.json
  label_attributes.schema.json  anchor_attributes.schema.json
  criteria_catalog.<id>.v<N>.json
prompts/<root del paquete>/  manifest.json + extractor, judge, preannotator, planner_notes, b0_templates
```

Los `$id` de los schemas del paquete son `https://outreach.local/contracts/domains/<id>/<name>.schema.json`. `contracts.mjs` los carga recorriendo `docs/contracts/domains/*/` al importarse.

### 2.2 `pack.json` (campos exactos)

Todos los campos son obligatorios salvo los marcados «opcional». Tipos en notación JSON Schema.

| Campo | Tipo | Quién lo lee | Significado |
|---|---|---|---|
| `schema_version` | `"domain_pack/1"` | `validateDomainPack` | versión del contrato |
| `id` | string `^[a-z][a-z0-9_]{1,30}$` | todos | identificador; es `run_config.domain.id` |
| `version` | string `^v\d+$` | `run.mjs` (versions) | versión del paquete |
| `status` | `"proposed"` \| `"approved"` | `runAll` | `run-all` exige `approved` (lo pone una persona en H3) |
| `entity_type` | string `^[a-z][a-z0-9_]*$` | `registry` | se copia a `target_entity.entity_type` |
| `stable_id_prefix` | string `^[a-z]{2,8}$` | `identifiers` | prefijo de `stable_id` (`opp`, `inv`, `usr`) |
| `case_id_prefix` | string `^[a-z][a-z0-9-]*-$` | `bench/validate` | prefijo obligatorio de `case_id` (`case-`, `inv-case-`) |
| `schemas` | objeto con las 8 claves `profile, entity_attributes, validity, extraction, judge_output, preannotator_output, label_attributes, anchor_attributes`, cada una un nombre de contrato `domains/<id>/<name>` | `contracts.mjs`, `llm.mjs`, `registry`, `bench` | contratos del paquete |
| `prompts.root` | string, ruta relativa al repo | `prompts.mjs` | carpeta con `manifest.json` |
| `prompts.extractor` / `.judge` / `.preannotator` / `.planner_notes` / `.b0_templates` | `{id, version}` | `run.mjs`, `bench` | entradas del manifest de esa carpeta. El planner **no** está aquí: es del núcleo (§3.4) |
| `prompts.judge_entity_placeholder` | string `^[a-z_]+$` | `eligibility_judge` | nombre del placeholder con la vista de la entidad en el prompt del judge (`opportunity_json` en grants por compatibilidad; `entity_json` por defecto en paquetes nuevos) |
| `prompts.preannotator_item_placeholder` | string | `bench/preannotate` | ídem para el preanotador (`item_json`) |
| `catalog` | `{path, id, version}` | `run.mjs`, judge, gaps | catálogo de criterios (`criteria_catalog/2`) |
| `identifiers.schemes` | array (orden = orden de aplicación) de `{scheme, priority, patterns:[{apply_to, regex, flags, value, transform}], demote_value_prefixes}` | `identifiers.mjs` | ver §2.4 |
| `identifiers.url_priority` | integer | `identifiers.mjs` | prioridad del esquema `url`, que el núcleo añade siempre |
| `official.config` | ruta al JSON de dominios | `docs.mjs` | sufijos y lista curada (formato `official_domains/1`, sin cambios) |
| `official.version` | string `^[a-z_]+@v\d+$` | `run.mjs` | se guarda en `versions.official_rule_version` |
| `official.self_match` | `{domain_from, page_types, requires_any}` | `docs.mjs` | regla «el documento es de la propia entidad» (§2.5) |
| `official.never_official_hosts` | array de regex (string) | `docs.mjs` | hosts que nunca son oficiales (se pueden descargar) |
| `page_types.values` | array de string | `contracts`, `registry` | enum de `page_type` del extractor |
| `page_types.creates_entity` | subconjunto de `values` | `registry` | solo estas páginas crean o amplían una entidad |
| `page_types.primary` | subconjunto de `values` | judge (R4b), validez | páginas que fijan los términos de la entidad (`call` en grants) |
| `extractor.focus_terms` | string (cuerpo de regex, flags fijos `gi`) | `extractor.mjs` | ventanas de `excerptForExtraction` |
| `extractor.req_label` | string \| null | `extractor.mjs` | etiqueta de `REQ`; `null` desactiva los requisitos extraídos |
| `validity.dateless_parsed_statuses` | array de string | `signals.mjs` | estados que cuentan como «validez leída» aunque `valid_until` sea `null` |
| `validity.recency_days` | integer \| null (opcional) | `pack.mjs` | parámetro de la función de validez (investors) |
| `judge.extras` | array de nombres de campo de `judge_output` | judge | campos del judge, además de `criteria`, que se copian a `judgment.extras` |
| `judge.recommendable` | `{classes, required_met, extras_not_in}` | judge | regla declarativa (§2.6) |
| `ranking.scope_criterion` | criterion_id | `ranking.mjs` | criterio cuyo estado da `scope_rank` |
| `planner.entity_subtitle_attribute` | ruta con puntos dentro de `attributes` \| null | `planner.mjs` | texto corto junto al nombre en `planner_input.entities[].subtitle` |
| `b0.vars` | objeto `{nombre: VarSpec}` | `conditions.mjs` | ver §2.7 |
| `labels.columns` | array de nombres de `label_attributes` | `bench/sample`, `bench/labels` | columnas intermedias de la hoja ciega, en orden |
| `labels.validity_status_field` | string | `bench/metrics` | campo del label que se compara con `validity.status` (`status_accuracy`) |
| `labels.validity_date_field` | string \| null | `bench/metrics` | campo comparado con `validity.valid_until` (`deadline_accuracy`); `null` → la métrica vale `null` |
| `labels.anchor_name_field` | string | `bench/pool` | campo de `anchor_attributes` que da el nombre visible |

### 2.3 `pack.mjs` (funciones exactas)

Cada función tiene docblock, es pura, no lee red, disco ni reloj, y recibe `today` como string ISO.

| Función | Firma | Quién la llama | Devuelve (validado por) |
|---|---|---|---|
| `computeValidity` | `({entity, docs, textOf, aboutOf, today, params})` → `validity` | `registry.register` y `registry.finalize` | `domains/<id>/validity` y `v2/validity_skeleton` |
| `entityView` | `({entity, validity})` → objeto | `eligibility_judge` (placeholder `judge_entity_placeholder`) y `bench/preannotate` | objeto JSON; el núcleo solo lo pasa a `render` |
| `codeEvaluators` | objeto `{criterion_id: ({validity, today, profile, extras}) → state}` | `applyRules` (R5) | un valor de `criterionState` |
| `gain` | `(labelAttributes) → 0..3` | `bench/metrics`, `bench/sample` | entero |
| `isHardNegative` | `(labelAttributes) → boolean` | `bench/metrics` (`hard_false_positive_rate`) | booleano |

`docs` es la lista de `document/2` de la entidad en orden de registro; `textOf(doc_id)` y `aboutOf(doc_id)` devuelven el texto completo y el `about` extraído de ese documento; `params = pack.validity`.

### 2.4 Identificadores y fusión (núcleo + datos del paquete)

Algoritmo del núcleo (`identifiers.mjs`), igual a v1 con los datos fuera:

1. **Textos de identificador aceptados:** cada `about.identifier_texts[i]` que cumple `literalIn(t, text) || doc.url.includes(t)` (v1, `extractor.mjs:22`).
2. Para cada texto aceptado, en orden, se aplican **todos** los `patterns` con `apply_to` que contiene `"identifier_texts"`, recorriendo `schemes` en el orden del array y sus `patterns` en orden.
3. Después, con el mismo recorrido, los patterns con `apply_to` que contiene `"doc_url"`, sobre la cadena `doc.url`.
4. Si el documento es oficial, los patterns con `apply_to` que contiene `"official_doc_host"`, sobre el host del documento sin `www.`.
5. Siempre `urlIdentifier(doc.url)` (v1, `identifiers.mjs:13`).
6. Se deduplica por `${scheme}:${value}` conservando la primera aparición.

Un pattern: `regex` y `flags` se pasan a `new RegExp`; `value` es una plantilla con `${1}`…`${9}`; `transform ∈ {"none","upper","lower","registrable_domain"}` se aplica al valor final.

`stableIdOf(ids)`: orden ascendente por `priority` del esquema (`url` usa `identifiers.url_priority`); a igual esquema, primero los valores que **no** empiezan por ningún `demote_value_prefixes`; luego orden lexicográfico. Resultado `${stable_id_prefix}:${scheme}:${value}`.

**Fusión (union-find real).** Corrige D8. Al registrar un documento con claves `K`:
- Sea `M` la lista de entidades existentes que comparten alguna clave con `K`, ordenada por `first_seen.order`.
- Si `M` está vacía, se crea una entidad nueva.
- Si `M` tiene una sola entidad, el documento se fusiona con ella (v1).
- Si tiene dos o más, el documento se fusiona con `M[0]` y cada `M[j]` (j ≥ 1) se absorbe en `M[0]`: se unen `identifiers` (primero los de `M[0]`), `source_doc_ids`, `query_ids` y evidencia (sin duplicar `evidence_id`). `official` pasa a `true` si alguna lo era y `official_basis` es el de la primera fuente oficial por `first_seen.order`. Los `REQ-xx` de `M[j]` se renumeran a continuación de los de `M[0]`, en su orden original; el mismo `norm(quote)` reutiliza el número existente. `M[j]` desaparece de `entities()` y se escribe un log `extract` con `merged_into`.
- La entidad es **nueva** si ninguna clave de `K` se había visto. Es **nueva verificada** si es oficial y (era nueva o no era oficial antes de este documento) (v1).

### 2.5 Regla de fuente oficial (núcleo + datos)

`officialBasisOf({url, extraction, acceptedEvidence, identifiers}, pack.official)` (generaliza `docs.mjs:22-33`):
1. `none` si `!isPublicUrl(url)`, si `hostKind(url) !== 'other'` o si el host casa con alguna regex de `never_official_hosts`.
2. `suffix` si el host termina en un sufijo de la configuración (v1).
3. `curated_list` si el host o su dominio registrable está en `domains` (v1).
4. `issuer_match` si se cumplen las tres:
   - el dominio declarado coincide con `registrableDomain(host)`. Según `self_match.domain_from`: `{"about_field": "<campo>"}` toma `registrableDomain(about[<campo>])`; `{"identifier_scheme": "<scheme>"}` toma el valor de algún identificador de ese esquema que vino de `identifier_texts`;
   - `page_type ∈ self_match.page_types`;
   - se cumple algún requisito de `requires_any`: `{"about_field_non_null": "<campo>"}` o `{"evidence_criterion": "<id>"}`. Este último cuenta solo evidencia **verificada** (`acceptedEvidence`), como dice `ARCHITECTURE.md:184`. El código actual usa la cruda (DIAGNOSIS §E); en el fixture world-v1 el cambio no altera ningún valor.
5. `none` en otro caso.

### 2.6 Criterios, cinco estados y `recommendable`

- El catálogo usa `criteria_catalog/2` (§4.3). `kind ∈ {hard, soft, signal}`: `signal` se juzga y se reporta, pero no entra en `eligibility_class` ni en `soft_score` (lo pide el catálogo de inversores para `INV-PORTFOLIO-CONFLICT`).
- Los cinco estados y las reglas R1–R7 **no cambian** (`ARCHITECTURE.md:219-234`). R4b usa «documento oficial con `page_type ∈ pack.page_types.primary`» en lugar de `call`. R5 usa `pack.codeEvaluators[criterion_id]`. Si un criterio `evaluator = code` no tiene función, `validateDomainPack` falla.
- `aggregate`: igual a v1. `recommendable = eligibility_class ∈ recommendable.classes` **y** todos los `required_met` en estado `met` **y**, para cada `campo → lista` de `extras_not_in`, `extras[campo] ∉ lista` (`null` se escribe como `null` en la lista).
- Abstención: `abstained = !ranked.some(r => r.recommendable)` (v1).

### 2.7 Variables de B0 (`b0.vars`)

`VarSpec` es uno de:
- `{"path": "<campo de perfil>"}`: el valor, o `null`.
- `{"path": …, "index": n}`: `value?.[n] ?? null`.
- `{"path": …, "map": {"<valor>": "<texto>" | null}}`: `map[value] ?? null`.
- `{"path": …, "table": "<clave del archivo de plantillas>", "fallback": "raw" | "null"}`: `value == null ? null : (tabla[value] ?? (fallback === 'raw' ? value : null))`.
- `{"special": "today_year"}`: los 4 primeros caracteres de `today`.

Plantillas: archivo del paquete con `{templates: [{template_id, text, requires?}], <tablas>}`. Placeholders `{nombre}`. Una plantilla se omite si alguna variable que usa es `null` o si no cumple `requires` (`{"<campo>": [valores permitidos]}`). Deduplicación por `norm()` conservando la primera (v1, `ARCHITECTURE.md:99-108`).

### 2.8 Validación del paquete (`validateDomainPack(pack, {status})`)

Lanza `PackError` con `code` y la primera regla incumplida, en este orden:
1. `PACK_INVALID`: `pack.json` no valida contra `docs/contracts/v2/domain_pack.schema.json`.
2. `PACK_INVALID`: `pack.mjs` no exporta exactamente `computeValidity`, `entityView`, `codeEvaluators`, `gain`, `isHardNegative`, o alguna no es función (`codeEvaluators` es un objeto de funciones).
3. `PACK_INVALID`: alguno de los 8 schemas o el catálogo no existe, o el catálogo no valida contra `criteria_catalog/2`.
4. `PACK_INVALID`: los criterios con `evaluator = code` no coinciden exactamente con las claves de `codeEvaluators`.
5. `PACK_INVALID`: `ranking.scope_criterion` o algún `judge.recommendable.required_met` no está en el catálogo.
6. `PACK_INVALID`: algún `profile_fields` del catálogo no es una propiedad de `schemas.profile.properties.fields.properties`.
7. `PACK_INVALID`: `page_types.creates_entity` o `page_types.primary` no son subconjuntos de `page_types.values`, o `page_types.values` no coincide con el enum de `page_type` del schema de extracción.
8. `PACK_INVALID`: `labels.columns`, `labels.validity_status_field` o `labels.validity_date_field` no son propiedades de `label_attributes`.
9. `PACK_INVALID`: dos esquemas con la misma `priority`, o una `priority` igual a `url_priority`.
10. `PACK_INVALID`: un regex no compila o alguna `prompts.*` no existe en el manifest de `prompts.root` (el sha se verifica al cargar, como v1).
11. `PACK_UNAPPROVED`: `status === 'frozen'` y (`pack.status !== 'approved'` o el catálogo no está `approved`).

### 2.9 Paquete `grants` (valores exactos)

El paquete grants reproduce v1 **sin cambiar ningún valor del fixture** salvo los que `REFACTOR-PLAN.md` §3 declara.

| Campo | Valor |
|---|---|
| `id`, `version`, `status` | `grants`, `v1`, `proposed` (pasa a `approved` en H3) |
| `entity_type`, `stable_id_prefix`, `case_id_prefix` | `grant_opportunity`, `opp`, `case-` |
| `schemas.*` | copias **byte a byte** de los v1 (`profile`, `extraction`, `judge_output`, `preannotator_output`), con `$id` nuevo. `entity_attributes = {issuer:{name, domain}, amount_text, instrument}`; `validity` restringe `status` a `common#/$defs/validityStatus` de v1; `label_attributes = {status, deadline, scope, hard_eligibility, route}`; `anchor_attributes = {issuer, closes_on, verified_open_on, winners_published, expected_route, why_it_fits}` |
| `prompts.root` | `prompts` (el manifest actual, sin mover archivos). Ids: extractor `extractor@v1`, judge `eligibility_judge@v1`, preannotator `preannotator@v1`, b0 `b0_templates@v1`, planner_notes `grants_planner_notes@v1` (nuevo, A-02) |
| `prompts.judge_entity_placeholder` / `preannotator_item_placeholder` | `opportunity_json` / `item_json` |
| `catalog` | `docs/contracts/domains/grants/criteria_catalog.grant.v2.json`: el v1 con `schema_version: criteria_catalog/2` y sin `applies_to`; mismos ids, textos y orden |
| `identifiers.schemes` (orden) | `nih` (priority 0; patrón de `identifiers.mjs:6`, `flags: gi`, `value: ${1}-${2}-${3}-${4}`, `transform: upper`, `demote_value_prefixes: ["NOT-"]`), `nsf` (1; los dos patrones de `identifiers.mjs:7-8`), `grantsgov` (3; los dos de `identifiers.mjs:9`), `eu` (2; `identifiers.mjs:10`, `flags: g`). Todos con `apply_to: ["identifier_texts","doc_url"]`. `url_priority: 4` |
| `official` | `config: official.grants.v1.json` (el actual `research/agent/config/official_domains.v1.json`, movido), `version: official_domains@v1`, `self_match: {domain_from: {about_field: "issuer_domain"}, page_types: ["call","program_page"], requires_any: [{about_field_non_null: "how_to_apply_quote"}, {evidence_criterion: "G-ENTITY"}]}`, `never_official_hosts: []` |
| `page_types` | `values` = enum v1 (`common.schema.json:32`); `creates_entity: ["call","program_page","award_record","news","blog"]`; `primary: ["call"]` |
| `extractor` | `focus_terms` = el cuerpo de la regex de `extractor.mjs:6`; `req_label: "Any other binding requirement of this call"` |
| `validity` | `dateless_parsed_statuses: ["rolling"]`; `computeValidity` = la lógica de `validity.mjs:4-10` con salida renombrada (`opens_on→valid_from`, `closes_on→valid_until`, `deadline_label→label`, `deadline_quote→quote`, `deadline_doc_id→doc_id`) |
| `judge` | `extras: ["route","route_rationale"]`; `recommendable: {classes: ["eligible","eligible_pending"], required_met: ["G-SCOPE","G-STATUS"], extras_not_in: {route: [null, "not_actionable"]}}`; `codeEvaluators`: `G-STATUS`, `P-TIMELINE`, `P-ROUTE` copiados de `eligibility_judge.mjs:6` (P-TIMELINE conserva el 21 del catálogo) |
| `ranking.scope_criterion` | `G-SCOPE` |
| `planner.entity_subtitle_attribute` | `issuer.name` |
| `b0.vars` | `sector {path: project.sector, index: 0}`, `sector2 {… index: 1}`, `work {path: project.work_type, map: …}` y `entity {path: applicant.entity_type, map: …}` con las tablas de `conditions.mjs:2`, `country {path: applicant.country, table: COUNTRY_NAMES, fallback: raw}`, `region {path: applicant.region}`, `year {special: today_year}` |
| `labels` | `columns: ["status","deadline","identity_correct","scope","hard_eligibility","route"]` (`identity_correct` es del núcleo pero conserva su posición v1), `validity_status_field: status`, `validity_date_field: deadline`, `anchor_name_field: name`; `gain` e `isHardNegative` = `bench/metrics.mjs:8,14` |

### 2.10 Paquete `investors` (propuesta; H3 decide)

Sustituye al benchmark hermano `research/bench/investors/` (DIAGNOSIS §F). Entidad: **firma o plataforma inversora institucional**. No personas, contactos ni warm paths (`docs/benchmark/investors/PROTOCOL.md:9`).

| Campo | Valor propuesto | Origen o estado |
|---|---|---|
| `entity_type`, `stable_id_prefix`, `case_id_prefix` | `investor_firm`, `inv`, `inv-case-` | `investor_case.schema.json` (sin commit) |
| `identifiers.schemes` | `domain` (priority 0): pattern `apply_to: ["identifier_texts"]`, `regex: ^(?:https?://)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/?$`, `flags: i`, `value: ${1}`, `transform: registrable_domain`; y pattern `apply_to: ["official_doc_host"]`, `regex: ^(.+)$`, `transform: registrable_domain`. `sec_cik` (priority 1): `apply_to: ["identifier_texts"]`, `regex: \bCIK[:#\s]*0*(\d{1,10})\b`, `flags: i`, `value: ${1}`. `url_priority: 2` | `identity.mjs:19-42` usaba `domain`, `regulatory`, `url`. **H3** confirma `sec_cik` como único registro regulatorio |
| `official.self_match` | `domain_from: {identifier_scheme: "domain"}`, `page_types: ["firm_home","thesis","team","portfolio","news_release"]`, `requires_any: [{about_field_non_null: "thesis_quote"}, {evidence_criterion: "INV-ACTIVE"}]` | diseño propio; **H3** |
| `official.config` | `official.investors.v1.json`: `suffixes: []`, `domains`: reguladores (`sec.gov`, `adviserinfo.sec.gov`). `never_official_hosts`: regex de directorios (`crunchbase\.com$`, `pitchbook\.com$`, `dealroom\.co$`, `tracxn\.com$`, `signal\.nfx\.com$`, `openvc\.app$`, `angellist\.com$`, `wellfound\.com$`) | lista de plataformas de `investor.mjs:16`; **H3** aprueba la lista |
| `page_types.values` | `firm_home, thesis, team, portfolio, news_release, portfolio_company_page, person_profile, news, blog, directory, other` | diseño propio |
| `page_types.creates_entity` | `firm_home, thesis, team, portfolio, news_release, news, blog, directory` | excluye empresas del portfolio y perfiles personales (INV-ACC-04 del benchmark hermano) |
| `page_types.primary` | `thesis, firm_home` | **H3** |
| `extraction.about` | `{name, identifier_texts[≤6], investor_type, parent_firm, thesis_quote, recent_activity:[{quote}] (≤8), inactive_quote, contact_quote}`; `evidence[].criterion_id` = ids `INV-*` o `REQ` | sustituye a `investor_extraction.schema.json`, que no tenía citas por criterio |
| `extractor.req_label` | `null` (sin requisitos extraídos en v1 del paquete) | **H3** |
| `validity` | `computeValidity`: (1) si algún documento oficial tiene `about.inactive_quote` literal → `inactive` (quote y doc de ese documento); (2) si no, `valid_from` = la fecha máxima ≤ `today` de `datesIn(quote)` (`dates.mjs:127`) sobre las `recent_activity[].quote` literales de documentos oficiales, y si `daysBetween(valid_from, today) ≤ recency_days` → `active`; (3) si no, si hay `thesis_quote` literal en un documento oficial → `possibly_active`; (4) si no, `unknown`. `valid_until = null` siempre. `conflict = true` si se cumplen (1) y (2) a la vez; gana `inactive`. `dateless_parsed_statuses: ["active","possibly_active","inactive"]`; `recency_days: 548` | 548 días aparece en `investors.test.mjs:71`; la ventana sigue pendiente (`DECISIONS_PENDING.md:3`): **H3** |
| `catalog` | `criteria_catalog.investor@v2`: los 12 criterios de v1 con `evaluator`, `applicability` y `profile_fields`. `INV-ACTIVE` (hard) e `INV-RECENCY` (soft) pasan a `evaluator: code`; `INV-PORTFOLIO-CONFLICT` queda `kind: signal`; el resto `llm` | **H3** (A-01 escribe la propuesta) |
| `codeEvaluators` | `INV-ACTIVE`: `active→met`, `inactive→not_met`, otro→`unknown`. `INV-RECENCY`: `active→met`, `inactive→not_met`, otro→`unknown` | diseño propio |
| `judge` | `extras: []`; `recommendable: {classes: ["eligible","eligible_pending"], required_met: ["INV-ACTIVE","INV-SECTOR"], extras_not_in: {}}` | **H3** |
| `ranking.scope_criterion` | `INV-SECTOR` | **H3** |
| `labels` | `columns`: `identity_correct, entity_kind, active_status, sector_fit, stage_fit, geography_fit, check_fit, round_fit, business_model_fit, lead_fit, hard_eligibility, portfolio_conflict, overall_relevance`; `validity_status_field: active_status`; `validity_date_field: null`; `gain` = `investors/ranking.mjs:1-7`; `isHardNegative` = `investors/metrics.mjs:17` | portado sin cambios |
| `b0.vars` | `sector {path: sector}`, `stage {path: funding_stage}`, `geography {path: target_markets, index: 0}`, `comparable {path: comparable_companies, index: 0}`, `subsector {path: subsectors, index: 0}`, `business_model {path: business_model, index: 0}`, `year {special: today_year}` | `investors/conditions.mjs:5-8`. La alternativa de `geography` (`operating_regions`, `incorporation_country`) no se expresa con un VarSpec: las plantillas v2 llevan una plantilla por variante con su `requires` |

---

## 3. Señales, gaps y parada genéricas

### 3.1 Señales por búsqueda (código, independientes del judge)

| Señal v2 | Nombre v1 | Definición exacta |
|---|---|---|
| `new_unique_docs` | igual | resultados cuya `normalizeUrl` no se había visto en resultados ni links de la corrida |
| `duplicates` | igual | resultados cuya `normalizeUrl` ya se había visto |
| `new_verified_entities` | `new_official_opportunities` | `stable_id` (en ese momento) de las entidades que pasaron a ser verificadas (nuevas oficiales o no oficiales que se volvieron oficiales) por documentos de esta búsqueda |
| `new_official_domains` | igual | `registrableDomain` de documentos oficiales cuyo dominio registrable **no** aparecía en ningún documento oficial anterior de la corrida (corrige D10) |
| `fetch_errors` | igual | descargas de esta búsqueda con `ok = false` o `text_chars < 200` |
| `validity_parsed` | `deadlines_parsed` | de `new_verified_entities`, cuántas tienen `valid_until ≠ null` o `status ∈ pack.validity.dateless_parsed_statuses` |
| `criteria_unknown` | igual | nº de gaps `criterion_missing` sin el tope de 40 |
| `searches_without_new_verified` | `searches_without_new_official` | contador de paciencia tras esta búsqueda |

### 3.2 Gaps

| Tipo v2 | Código v1 que alimenta `gap_id` | Se genera cuando |
|---|---|---|
| `official_source_missing` | `official_source_missing` | entidad con `official = false` |
| `criterion_missing` | `criterion_missing` | entidad oficial × criterio `hard`, `evaluator = llm`, `applicability = always`, sin evidencia verificada |
| `validity_unparsed` | `deadline_unparsed` | entidad oficial con `valid_until = null` y `status = 'unknown'` |
| `link_unfetched` | `link_unfetched` | link oficial cuya `normalizeUrl` no se ha intentado descargar en la corrida (corrige D2) |
| `mention_unresolved` | `mention_unresolved` | igual que v1, con menciones de **cualquier** página leída, también con `about = null` (DIAGNOSIS §E) |

`gap_id = 'g-' + sha256(GAP_ID_CODE[type] + '|' + stable_id + '|' + criterion_id + '|' + detail_key).slice(0,8)`, con `GAP_ID_CODE` = la columna «código v1». Es una constante del núcleo, no del paquete: así los ids del fixture v1 (`g-e8e0f6f2`, `g-ad338336`…) no cambian. Orden y tope de 40 iguales a v1 (`ARCHITECTURE.md:277`).

### 3.3 Parada

Idéntica a `ARCHITECTURE.md:280-296`, con la paciencia contada sobre `new_verified_entities`. **N** (`run_config.patience_n`) se fija antes de correr, es el mismo para B0, B1 y B2 y no lo cambia el paquete. Cada dominio tiene su propio `run_config` y su propio N, que aprueba H4 por dominio.

Justificación. Por qué no usar el judge para parar: un juez LLM tiende a sobre-etiquetar positivos (Alaofi et al., 2501.17969) y la autocorrección solo es fiable con feedback externo fiable (Kamoi et al., 2406.01297; Huang et al., 2310.01798). La regla concreta («N búsquedas seguidas sin una entidad verificada nueva») es **decisión de diseño propio**.

### 3.4 Planner (núcleo)

- Un solo prompt de planner para todos los dominios: `prompts/core/planner/v1` (A-02). Recibe dos placeholders: `state_json` (`planner_input/2`) y `domain_notes` (texto del archivo `planner_notes` del paquete). Así B1 sigue siendo «B2 sin adaptación» con el mismo prompt (`ARCHITECTURE.md:123`), y todos los dominios comparten las reglas de seguridad (sin URLs, `<page_data>`, acciones validadas).
- `planner_notes` (texto del paquete, versionado en su manifest) solo describe: qué es la entidad, qué familias de fuentes cubrir y cómo se escriben las consultas en ese dominio. No puede cambiar reglas, límites ni formato de salida; A-02 lo revisa con la lista de §3.4 de `REFACTOR-PLAN.md`.
- `planner_output` no cambia (v1). La validación de acciones (`ARCHITECTURE.md:140-144`) no cambia.

---

## 4. Qué se conserva, qué se renombra y qué cambia de contrato

### 4.1 Se conserva sin cambios (sigue mandando `ARCHITECTURE.md`)

§3 flujo de una corrida; §4 condiciones B0/B1/B2 (con plantillas y variables desde el paquete); §5.1 búsqueda con un solo motor; §5.2 descarga; §5.3 validación de acciones; §5.4 pasos 1–3 de la extracción (con regex de foco y etiqueta REQ desde el paquete); §6.3 reglas R1–R7 y su orden; §6.4 agregado; §7.3 razones y orden de parada; §8 tupla de ranking; §9 caché y costo nominal; §10 cliente LLM; §11 log; §12 seguridad; §14 tabla de decisiones A1–A10.

### 4.2 Se renombra

| v1 | v2 | Dónde |
|---|---|---|
| oportunidad (`opportunity`) | entidad (`entity`) | textos, `planner_input.opportunities → entities`, `from_opportunity → from_entity`, `opportunity_ref → entity_ref`, refs `o1… → e1…` |
| `new_official_opportunities` | `new_verified_entities` | `log_entry.signals`, `planner_input.queries_run[]` |
| `searches_without_new_official` | `searches_without_new_verified` | `log_entry.signals`, `planner_input.patience` |
| `deadlines_parsed` | `validity_parsed` | `log_entry.signals` |
| gap `deadline_unparsed` | `validity_unparsed` | gaps (el `gap_id` conserva el código v1, §3.2) |
| `official_domain` (siempre `false`, D13) | `official_host` = `officialHostBasis(url) !== 'none'` (pasos 1–3 de §2.5, sin extracción) | `planner_input.results_unfetched[]` |
| `validity.opens_on/closes_on/deadline_label/deadline_quote/deadline_doc_id` | `valid_from/valid_until/label/quote/doc_id` | `target_entity` |
| `issuer`, `amount_text`, `instrument` | `attributes.issuer`, `attributes.amount_text`, `attributes.instrument` | `target_entity` |
| `route`, `route_rationale` | `extras.route`, `extras.route_rationale` | `judgment` |
| `totals.official_opportunities` | `totals.verified_entities` | `run_result`, `run_end` |
| `run_end.opportunities` | `run_end.entities` | `log_entry` |
| `extract.new_opportunity` | `extract.new_entity` (+ `merged_into` opcional) | `log_entry` |
| `judge.max_opportunities`, `max_evidence_per_opportunity` | `judge.max_entities`, `max_evidence_per_entity` | `run_config` |
| `run_config.catalog` / `official_domains` | `run_config.domain {id, version}`; catálogo y regla oficial los da el paquete | `run_config` |
| `promptRef {id, version, sha256}` | `{domain, role, id, version, sha256}`; `domain = "core"` para el planner | `common` |

### 4.3 Cambia de contrato (v2; v1 no se edita en sitio)

Regla de `docs/contracts/README.md:33`: todo cambio crea `vN+1` y una entrada «propuesta» en el Registro de decisiones. Los v2 viven en `docs/contracts/v2/` y los escribe el arquitecto (A-01). Los datos y logs v1 no se migran; el harness lee v1 solo a través del adaptador `grants/legacy.mjs` (`REFACTOR-PLAN.md` R-08).

| Contrato | Cambio |
|---|---|
| `common/2` | `caseId`: `^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$`. `runId`: `^[a-z0-9-]+__[a-z0-9-]+__B[012]__s\d+$`. `stableId`: `^[a-z]{2,8}:[a-z0-9_]+:\S+$`. `criterionId`: `^(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\|REQ-\d{2})$`. Salen `targetType`, `route`, `validityStatus`, `pageType` e `instrument` (pasan al paquete grants). `promptRef/2` y `versions/2` (`contracts_version: "2"`, `domain: {id, version, sha256}`, `catalog_version: ^criteria_catalog\.[a-z_]+@v\d+$`, `official_rule_version: ^[a-z_]+@v\d+$`). `errorCode` añade `PACK_INVALID`, `PACK_UNAPPROVED` |
| `domain_pack/1` (nuevo) | §2.2 |
| `criterion/2`, `criteria_catalog/2` | `kind` añade `signal`; `profile_fields: ^[a-z][a-z0-9_.]*$`; sale `applies_to`; `catalog_id: ^criteria_catalog\.[a-z_]+$`; `target_type` → `domain` |
| `target_entity/2` | §4.2; `attributes` = objeto validado por `domains/<id>/entity_attributes`; `validity` validado por `domains/<id>/validity` y por `v2/validity_skeleton` |
| `document/2`, `evidence/2` | sin cambios de campos; `stable_id`, `criterion_id` y `extractor` usan los tipos de `common/2` |
| `extraction` | sin contrato del núcleo: el paquete aporta el schema completo que ve el LLM (grants = v1 byte a byte) y el núcleo valida además `v2/extraction_skeleton` |
| `judge_output` | ídem (`v2/judge_output_skeleton`: `criteria[{criterion_id, state, evidence_ids, rationale}]`) |
| `judgment/2` | `route/route_rationale` → `extras`; resto igual |
| `planner_input/2` | §4.2; `entities[] = {ref, name, subtitle, official, status, valid_until, coverage, sources}` |
| `planner_output` | sin cambios (se reutiliza v1) |
| `log_entry/2`, `run_result/2`, `run_config/2` | §4.2; `run_start` añade `domain {id, version, sha256}` |
| `profile` | el del paquete; el núcleo solo lee `v2/profile_skeleton = {profile_id, as_of, fields: {*: {value}}}` |
| `case/2`, `label/2`, `manual_search/2`, `preannotator_output`, `metrics_report/2` | ver `docs/ARCHITECTURE_BENCHMARK.md` §2 |

**Patrón «skeleton».** Los schemas `v2/*_skeleton` son los únicos con `additionalProperties: true`: describen los campos que el núcleo lee y nunca se usan solos. Todo objeto que viene de un paquete se valida **dos veces**: con el schema completo del paquete (cerrado) y con el skeleton. Así el `response_format` que ve el modelo en grants es el mismo de v1 y el núcleo no conoce los campos del dominio. Es una excepción explícita a la regla 1 de `docs/contracts/README.md` y se registra como propuesta.

---

## 5. Añadir un dominio (por ejemplo, usuarios) sin tocar el núcleo

### 5.1 Archivos que se crean (y ninguno más)

1. `research/agent/domains/users/pack.json`, `pack.mjs`, `official.users.v1.json`, `README.md`.
2. `docs/contracts/domains/users/`: los 8 schemas de §2.1 y `criteria_catalog.users.v1.json`.
3. `prompts/users/manifest.json` y `extractor/v1`, `judge/v1`, `preannotator/v1`, `planner_notes/v1`, `b0/v1/templates.json`.
4. `research/bench/domains/users/`: `config/<bench_id>.json`, `cases/`, `LABELING_GUIDE.md` (ver `ARCHITECTURE_BENCHMARK.md` §3).
5. Tests y fixture del dominio en `research/tests/agent/fixtures/users-world-v1/` y `research/tests/agent/users.test.mjs`.

No se edita ningún archivo de `research/agent/*.mjs`, `research/agent/tools/**`, `research/bench/*.mjs`, `docs/contracts/v2/**` ni `prompts/core/**`. El registro de dominios es el sistema de archivos: `loadDomainPack(id)` busca `research/agent/domains/<id>/pack.json`, o la ruta explícita `{path}` que usan los tests.

### 5.2 Prueba de aceptación con un dominio ficticio mínimo

El fixture `research/tests/agent/fixtures/toy-domain-v1/` (lo escribe el arquitecto en A-03) define un dominio `toy` completo dentro de la carpeta de tests y lo carga con `loadDomainPack({path})`. Los valores exactos están en `REFACTOR-PLAN.md`, ACC-60 a ACC-63. Resumen:

- Entidad `toy_item`, prefijo `tst`, esquema `code` (`\bTOY-(\d{3})\b`), catálogo de 2 criterios (`T-FIT` hard/llm, `T-OPEN` hard/code) y validez «`open` si un documento oficial contiene literalmente `Status: open`».
- B0, B1 y B2 corren de punta a punta con el transport de fixtures; `result.json` y `steps.jsonl` validan contra los contratos v2 y contra los schemas del paquete `toy`.
- **Prueba de pureza (ACC-52):** ningún archivo del núcleo contiene las palabras del dominio `toy` ni de grants o inversores. La ruta del paquete solo aparece en el test.

---

## 6. Cómo entra B2 al producto (cuando gane; no se hace ahora)

**Condición de entrada, por dominio:** `decision.outcome = ADOPT_B2` en el benchmark de ese dominio (regla `decision_rule@v1`), firma humana en el Registro de decisiones y mediana de `seconds_discovery_nominal + seconds_judge_nominal` de B2 por debajo de `RESEARCH_RUN_TIMEOUT_MS / 1000`.

**Puntos de integración (existentes):**
1. La vista `/buscar` del frontend (`frontend/src/App.tsx:26,40`) envía `POST /api/research/jobs` (`research/server/index.mjs:392`). No cambia.
2. `runResearch` (`research/server/research/pipeline.mjs:44`) arma una lista de fuentes; la del motor v2 es `ENGINE_SOURCE → runEngine` (`pipeline.mjs:149-151`). Ahí se añade una fuente nueva, `AGENT_CORE_SOURCE`, detrás de una bandera nueva `RESEARCH_AGENT_CORE_DOMAINS` (lista: `grants,investors`; vacía por defecto). Para cada `fundingType` del brief con un dominio en la lista (`grant → grants`, `investment → investors`), esa fuente:
   - convierte el brief en perfil con el adaptador del paquete (`briefToProfile` para grants, `research/agent/profile.mjs:9`; uno equivalente para investors);
   - corre `runCase` con condición `B2` y un `run_config` de producto (`research/agent/domains/<id>/product.run_config.json`, `status: "product"`, no válido para el benchmark);
   - traduce cada `LogEntry` a un evento `live()` con un adaptador puro (`logEntryToLiveEvent`) para la barra de progreso;
   - convierte `result.ranked` en leads con `resultToLeads(result, pack)`, que llama a `candidate()` (`research/server/research/core.mjs:201`) con la evidencia citada.
3. Después, la coincidencia con la red (`pipeline.mjs:433-439`) corre sin cambios sobre esos leads: es lo que añade los warm paths.

**Qué se retira del flujo viejo cuando un dominio entra (decisión posterior, no ahora):** para ese objetivo, `runObjective` y sus piezas (`engine.mjs` `planQueries`, `followUpQueries`, `readPrompt`, `verifyFinding`; en investors también `investorFinding` y `investor.mjs` `verifyInvestor`), el investigador (`researcher.mjs`), la reflexión del orquestador (`orchestrator.mjs` `reflect`/`aiReflect`), `loop.mjs`, `sufficiency.mjs` y la expansión (`expansion.mjs`, `lateral.mjs`). Con eso dejan de leerse sus variables (`ENGINE_*`, `ORCHESTRATOR_*`, `LOOP_*`, `AGENTIC_*`). La lista exacta de variables se revisa en ese momento con el Anexo C de `REFACTOR-PLAN.md`; hoy **todas** se conservan.

---

## 7. Respaldo de las decisiones

| Decisión | Respaldo |
|---|---|
| Juicio criterio a criterio con evidencia citada, en todos los dominios | TrialGPT (2307.15051) usa evaluación por criterio con explicación y localización de evidencia en *patient–trial matching*. No demuestra transferencia a grants ni a inversores: es una hipótesis de diseño |
| Señales y parada sin el judge | Kamoi et al. (2406.01297); Huang et al. (2310.01798); Alaofi et al. (2501.17969). La regla de N es **diseño propio** |
| Preanotador de otra familia y calibrado contra humanos | Thomas et al. (2309.10621); Alaofi et al. (2501.17969). «Otra familia» es **diseño propio** |
| Evaluación end-to-end con buscador fijo | FRAMES (2409.12941), solo en lo de recuperación fija y evaluación end-to-end; el oracle sigue fuera |
| Núcleo + paquete declarativo, skeletons, `GAP_ID_CODE`, regla de oficialidad parametrizada | **decisión de diseño propio** |
