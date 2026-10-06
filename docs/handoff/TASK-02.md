# TASK-02 · Cliente LLM, caché y fixture transport

## Objetivo
Llamadas al modelo reproducibles y medibles (seed, tokens, latencia y versiones), con caché compartida y costo nominal.

## Archivos
- Crear `research/agent/llm.mjs`, `research/agent/cache.mjs` y `research/agent/fixtures.mjs` (solo para tests y el proveedor `fixture`).
- Modificar `research/server/analysis/fleet.mjs`, **solo** así: `chatJSON` acepta además `seed`, `maxTokens` (por llamada, gana sobre la config) y `messages` (array completo, opcional), y devuelve además `latency_ms`. Exportar `postChat(target, body, opts)` (el `post` actual aplicado a `/chat/completions`). Los llamadores existentes no cambian.
- Crear `research/tests/agent/llm.test.mjs`.

## Contratos que usa
`common.tokens`, `common.latency`, `common.promptRef`, `common.versions`.

## Especificación

`cache.mjs` → `createBenchCache({path, namespace})`:
- Usa `node:sqlite` (`DatabaseSync`), tabla `entries(namespace TEXT, kind TEXT, key TEXT, value_json TEXT, meta_json TEXT, created_at TEXT, PRIMARY KEY(namespace, kind, key))`.
- `get(kind, key)` → `{value, meta}` o `null`.
- `put(kind, key, value, meta)` hace upsert.
- `close()`.
- `path = ':memory:'` está permitido.

`llm.mjs` → `createLlm({env, role, transport, cache, family, clock = Date.now})` → `{call(req)}`, con `req = {promptRef, system, user, schemaName, temperature, seed, maxTokens, meta}`:
- **Body del transport:** `{messages:[{role:'system', content:system}, {role:'user', content:user}], temperature, seed, max_tokens:maxTokens, response_format:{type:'json_schema', json_schema:{name:schemaName, schema:bundle(schemaName)}}}`.
- **Transport:** `async ({body, meta}) → {content, model, usage|null}`.
  - El transport real es `fleetTransport(env, role)`: usa `postChat` y **no** reenvía `meta`.
  - El de tests es `createFixtureTransport(F, {condition, profileId})`, en `fixtures.mjs`.
- **Clave de caché `llm`:** `sha256([promptRef.id, promptRef.sha256, modelKey, sha256(system), sha256(user), temperature, seed].join('|'))`.
  - `modelKey` = `fleetConfig(env).roles[role].model`; en el fixture, `'fixture-model'`.
  - En un acierto se devuelve `{json, modelId, tokens:{…, total:0, nominal_total:meta.tokens, cached:true}, latency:{actual_ms, nominal_ms:meta.latency_ms}}`.
- **Parseo:** `parseJsonContent` (reutilizado de `fleet.mjs`) + `validate(schemaName, json)`.
  - Si falla, 1 reintento con los mensajes `[system, user, {role:'assistant', content:<respuesta inválida>}, {role:'user', content:"Your previous reply was not valid JSON for the schema. Reply only with valid JSON."}]`.
  - Si falla de nuevo, `LlmError('LLM_BAD_JSON' | 'LLM_SCHEMA')`.
  - Los tokens de ambos intentos se suman.
- **Tokens:** sin `usage`, `prompt = ceil((system.length + user.length)/4)`, `completion = ceil(content.length/4)` y `estimated:true`.
- **Errores:** HTTP → `LLM_HTTP`; timeout/abort → `LLM_TIMEOUT`.

`fixtures.mjs`:
- `createFixtureTransport(F, {condition, profileId})` responde desde `F/llm.json` según `meta`:
  - extractor → por `normalizeUrl(meta.url)`;
  - eligibility_judge → por `${profileId}|${meta.stable_id}`;
  - planner → por `planner[condition][meta.call_index]`;
  - preannotator → por `meta.stable_id`.
- Devuelve `{content: JSON.stringify(resp), model:'fixture-model', usage:{prompt_tokens:1000, completion_tokens:100}}` y suma 10 ms a un reloj falso compartido.
- Expone `calls[]` (lista de `{promptId, meta}`) para inspección.
- Si una respuesta no existe, lanza `Error('fixture: no response for …')`.

## Criterios de aceptación
ACC-04 y ACC-05. Además, los tests existentes de `fleet` siguen pasando.

## Tests que deben pasar
`npm --prefix research run test:agent`; `npm --prefix research test` sin regresiones.

## No tocar
El comportamiento actual de `chatJSON` para sus llamadores. Nada en `research/server/research/**`.
