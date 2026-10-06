# TASK-08 · Adaptadores de perfil

## Objetivo
Pasar los briefs y los estados de intake existentes al contrato `profile/1` **sin inventar valores**.

## Archivos
- Crear `research/agent/profile.mjs` y `research/tests/agent/profile.test.mjs`.

## Especificación
`briefToProfile(brief, {as_of, source_name, profile_id})`. Cada campo lleva `source: "legacy_brief: <source_name>#<campo del brief>"` o `"not provided"`:

| campo del perfil | origen en el brief | regla |
|---|---|---|
| `applicant.name` | `company` o `venture` | — |
| `applicant.entity_type` | `entityType` | `nonprofit`/`ngo`/`foundation` → `nonprofit`; `university`/`academic` → `academic`; `for-profit`/`company`/`startup` → `for_profit`; si no existe, `null` |
| `applicant.country` | `country` | ISO-2 si es un nombre o código reconocible (tabla `COUNTRY_NAMES` invertida + códigos ISO-2); `geography` **no** se usa para esto; si no, `null` |
| `applicant.region` | `state` | si no, `null` |
| `project.title` | `product` | — |
| `project.summary` | `description` o `oneLiner` | — |
| `project.sector` | `industry` | separado por `,` o `;`; si no hay separador, `[industry]` |
| `project.work_type` | — | siempre `null` |
| `project.stage` | `stage` | si es uno de los enums, ese valor; si no, `null` |
| `funding.amount_needed_usd` | `amount` | número |
| `funding.instruments_accepted` | `fundingTypes` | `['grant']` → `['grant','prize','cooperative_agreement']`; otros → `null` |
| `funding.routes_accepted` | — | siempre `null` |
| resto de campos | — | `null` |

`provenance = {source_kind:'legacy_brief', sources:[{title:source_name, locator:<path>, retrieved_at:as_of}], built_by:'code', builder_saw_anchor:false}`.

`intakeToProfile(intakeState, meta)` mapea `intake.FIELDS` igual (las rutas `company.*` y `product.*` se traducen con la misma tabla). `company.entity_type` usa el enum de intake.

## Criterios de aceptación
ACC-23, más una validación de esquema para los 8 briefs de `research/eval/briefs/*.json`.

## No tocar
Los briefs de `research/eval/briefs/` ni `intake.mjs`.
