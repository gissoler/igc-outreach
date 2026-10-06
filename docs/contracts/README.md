# Contratos v1 (fuente de verdad)

Los JSON Schema (draft 2020-12) de esta carpeta definen los datos que cruzan los límites entre módulos, el LLM, el disco y las personas. **Mandan sobre cualquier documento.** Si un documento los contradice, se corrige el documento.

| Schema | Qué es | Lo produce | Lo consume |
|---|---|---|---|
| `common` | tipos compartidos | — | todos |
| `profile` | quién busca y qué necesita (`null` = desconocido) | persona / `profile.mjs` | judge, planner, B0 |
| `criterion`, `criteria_catalog` + `criteria_catalog.grant.v1.json` | criterios duros y blandos | arquitecto (lo aprueba H3) | extractor, judge |
| `document` | URL descargada | `tools/fetch` | registry, log |
| `extraction` | salida cruda del extractor (no confiable) | LLM | `extractor.mjs` |
| `evidence` | cita verificada → criterio | registry | judge, resultado |
| `target_entity` | oportunidad (más adelante, inversor o usuario) con identidad estable y validez | registry | ranking, resultado, pool |
| `planner_input` / `planner_output` | estado que ve el planner y sus acciones | código / LLM | `planner.mjs` |
| `judge_output` / `judgment` | juicio crudo y juicio tras las reglas R1–R7 | LLM / `eligibility_judge.mjs` | ranking, métricas |
| `run_config` | configuración congelada del benchmark | persona (H5) | todo |
| `log_entry` | una línea de `steps.jsonl` | `logger.mjs` | análisis, revisión |
| `run_result` | `result.json` de una corrida | `run.mjs` | pool, métricas |
| `case`, `manual_search` | casos del benchmark | personas (H1, H2) | harness |
| `preannotator_output`, `label` | preanotación y adjudicación | LLM / personas | métricas |
| `metrics_report` | métricas, comparaciones y decisión | `metrics.mjs` / `decide.mjs` | personas |
| `official_domains` | dominios de financiadores oficiales | arquitecto + H3 | `docs.mjs` |

## Validación (configuración exacta)
`new Ajv2020({allErrors:true, strict:true, strictTypes:false, strictRequired:false, allowUnionTypes:true})` + `ajv-formats`. Los `$id` tienen la forma `https://outreach.local/contracts/<name>.schema.json`.

Los ejemplos válidos están en `examples/` y se prueban en ACC-01.

## Reglas
1. `additionalProperties:false` en todos los objetos de datos. Nada de campos «extra».
2. Los valores desconocidos son `null`, nunca un default.
3. Las fechas de lógica son `YYYY-MM-DD` y salen de `run_config.today`. `isoDateTime` se usa solo para `ts`, `fetched_at`, `retrieved_at` y `labeled_at`.
4. Un cambio de contrato crea `vN+1`: un schema con `schema_version` nuevo y una entrada en el Registro de decisiones con estado «propuesta». Los datos y logs viejos no se migran en sitio.
5. **Hashes:**
   - `profile_sha256` y `case_sha256` = sha256 de los **bytes** del archivo;
   - `run_config_sha256` = sha256 de los bytes del archivo de config;
   - `input_sha256` del planner = sha256 de `JSON.stringify(input)`.

## Identificadores
Ver `docs/ARCHITECTURE.md` §5.5. El patrón de `stableId` reserva `inv:` y `usr:` para la extensión a inversores y usuarios.
