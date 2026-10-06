# Prompts versionados

Los escribe el arquitecto. **Codex los carga y no los modifica.** Si un prompt parece estar mal, Codex abre una nota en el PR en lugar de editarlo. Cualquier cambio se publica como una versión nueva (`v2/`); nunca se edita `v1`.

## Estructura
```
prompts/
  manifest.json                     # id, versión, archivos y sha256 (lo verifica prompts.mjs)
  planner/v1/{system.md,user.md}
  extractor/v1/{system.md,user.md}
  eligibility_judge/v1/{system.md,user.md}
  preannotator/v1/{system.md,user.md}
  b0/v1/templates.json
```

## sha256 de una versión
`sha256( concat_{f in files ordered by name asc} ( f + "\n" + utf8(content(f)) + "\n" ) )`, donde `f` es el nombre de archivo relativo a `prompts/`, por ejemplo `planner/v1/system.md`. `loadPrompt` lo recalcula y lanza `PromptIntegrityError` si no coincide con `manifest.json`.

## Render
- Solo se usan placeholders `{{name}}`. Un string se inserta tal cual; cualquier otro valor se inserta como `JSON.stringify(value, null, 1)`.
- Se lanza un error si falta una variable, si sobra una variable no usada o si queda algún `{{` en el resultado.
- Antes de insertar texto de páginas, se eliminan de él las apariciones literales de `<page_data>` y `</page_data>`.

## Placeholders (contenido exacto)

| Prompt | Placeholder | Contenido |
|---|---|---|
| planner | `state_json` | objeto `planner_input` validado (`planner_input.schema.json`) |
| extractor | `today` | `run_config.today` |
| extractor | `criteria_json` | `[{criterion_id,label}]` del catálogo, en orden, más `{"criterion_id":"REQ","label":"Any other binding requirement of this call"}` |
| extractor | `url` | `document.url` |
| extractor | `title` | `document.title` |
| extractor | `page_text` | `excerptForExtraction(text, extract_max_chars)` |
| eligibility_judge | `today` | `run_config.today` |
| eligibility_judge | `profile_json` | objeto `{path: value}` con **todos** los campos del perfil; `null` se escribe como `"UNKNOWN"` |
| eligibility_judge | `opportunity_json` | `{name, issuer:{name,domain}, official, validity:{status,opens_on,closes_on,deadline_label}, instrument, amount_text}` |
| eligibility_judge | `criteria_json` | `[{criterion_id,label,kind,applicability,guidance,requirement_text?}]`: criterios `llm` del catálogo, luego los `REQ-xx` de la entidad |
| eligibility_judge | `evidence_json` | `[{evidence_id,criterion_id,official,url,retrieved_at,quote:"<page_data>…</page_data>"}]` (ARCHITECTURE §6.2) |
| preannotator | `today`, `profile_json`, `criteria_json` | igual que en el judge |
| preannotator | `item_json` | `{name, issuer, identifiers:[{scheme,value}], urls:[...]}` (sin condición, rank ni juicio) |
| preannotator | `source_text` | hasta 3 documentos fuente del ítem (primero los oficiales), cada uno con `excerptForExtraction(text, 8000)`, separados por `\n=== <url> ===\n` |

## Response formats
planner → `planner_output`; extractor → `extraction`; eligibility_judge → `judge_output`; preannotator → `preannotator_output`. Todos se envían como `bundle(name)` y su respuesta se valida con `validate(name, json)`.
