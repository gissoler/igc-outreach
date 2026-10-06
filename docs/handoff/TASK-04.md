# TASK-04 · Extractor, registry y validez

## Objetivo
Convertir un documento descargado en evidencia verificada e identidad estable, y calcular su validez con código.

## Archivos
- Crear `research/agent/extractor.mjs`, `research/agent/registry.mjs` y `research/agent/validity.mjs`.
- Crear `research/tests/agent/extract.test.mjs`.

## Contratos que usa
`extraction`, `evidence`, `target_entity`, `document`, el catálogo y `log_entry#/$defs/extract`.

## Especificación
- **`excerptForExtraction(text, max)`:** ARCHITECTURE §5.4, paso 1.
- **`extractDocument({doc, text, llm, prompt, catalog, today, step, fetchSeq, maxChars})`:**
  - Renderiza `prompts/extractor/v1`. Los placeholders se describen en `prompts/README.md`, y `title` y `page_text` pasan por `sanitizePageText`.
  - Llama al LLM con `{temperature: config.temperatures.extractor, seed: 0, schemaName: 'extraction', meta: {url: doc.url}}`.
  - Verifica según ARCHITECTURE §5.4, paso 3. `literalIn` se reutiliza de `verify.mjs`, siempre contra el **texto completo**.
  - Devuelve `{extraction, evidenceDrafts, aboutIdentifiers, officialLinks:[{link_id, url}], mentions, rejected:{quotes, identifiers}, tokens, latency}`.
  - Las `evidenceDrafts` todavía no tienen `REQ-xx` ni `stable_id`: los asigna el registry.
- **`registry.mjs`** → `createRegistry({today, catalog})`:
  - `register({doc, extractionResult, ctx:{step, searchIndex, queryId}})`:
    - Crea o fusiona la entidad según ARCHITECTURE §5.4, paso 4, y §5.5 (union-find por clave).
    - Numera los `REQ-xx` por entidad: el mismo `norm(quote)` reutiliza su número.
    - Crea `Evidence` con `evidence_id = 'ev-' + sha256(`${doc_id}|${criterion_id}|${quote.trim()}`).slice(0,16)`.
    - Devuelve `{stable_id, isNew, newOfficial}`, donde `newOfficial = official && (isNew || pasó a ser oficial ahora)`.
  - `entities()` en orden de registro, cada una con `first_seen.order`.
  - `evidenceFor(stable_id)`, `docs()`, `links()` y `mentions()`.
  - `finalize()` recalcula los `stable_id` (§5.5) y la validez de todas las entidades.
- **`validity.mjs`** → `computeValidity(entity, docsById, textOf, today)`: ARCHITECTURE §5.7, usando `deadlineDecision` de `server/research/dates.mjs` sin cambios.

## Criterios de aceptación
ACC-08, ACC-09 y ACC-10.

## No tocar
`dates.mjs` y `verify.mjs` (solo se importan). El extractor **no** recibe el perfil.
