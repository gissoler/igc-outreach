# TASK-03 · URLs, identificadores, oficialidad y tools

## Objetivo
Funciones deterministas de identidad y oficialidad, y las tools `search` y `fetch` con un único proveedor y caché.

## Archivos
- Crear `research/agent/docs.mjs`, `research/agent/identifiers.mjs`, `research/agent/tools/search.mjs` y `research/agent/tools/fetch.mjs`.
- Ampliar `research/agent/fixtures.mjs` con `createFixtureSearch(F)` y `createFixtureFetch(F)`.
- Crear `research/tests/agent/docs.test.mjs`.

## Contratos que usa
`document`, `official_domains`, `common.stableId` y `common.error`.

## Especificación
- **`docs.mjs`:**
  - `normalizeUrl`, `docIdOf`, `registrableDomain` y `officialBasisOf({url, extraction}, domainsCfg)`, exactamente como en ARCHITECTURE §5.5–5.6. Para `curated_list`, además, cuenta como coincidencia que `host === domain`.
  - Reutiliza `hostKind` de `server/research/verify.mjs` e `isPublicUrl` de `server/research/localSearch.mjs`.
  - `normalizeUrl` siempre produce `https:`, quita `www.`, el fragmento y los parámetros `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid` y `ref`; ordena el resto de parámetros por nombre; colapsa `//` en el path y quita la `/` final salvo en la raíz.
- **`identifiers.mjs`:**
  - `identifiersFromText(s)`: la tabla de ARCHITECTURE §5.5, aplicada en orden y deduplicada.
  - `urlIdentifier(url)`.
  - `stableIdOf(ids)`: prioridad `nih` > `nsf` > `eu` > `grantsgov` > `url`; dentro de `nih`, los valores con prefijo `NOT-` van al final; después, orden lexicográfico.
  - `identifierKeys(x)` → `Set` de `${scheme}:${value}`. Acepta una entidad, un ancla de case (los `identifiers` con scheme `url` y un URL completo como valor se convierten con `urlIdentifier`) o un ítem de manual_search.
  - **Identificadores de un `about`:** para cada `identifier_text` literal, `identifiersFromText(text)`; más `identifiersFromText(doc.url)`; más `urlIdentifier(doc.url)`.
- **`tools/search.mjs`:** `createSearchTool({provider, env, transport, cache, resultsPerQuery, recency})`.
  - Proveedores reales: `PROVIDER_FN[provider]` de `searchApis.mjs`, con `limit = resultsPerQuery` y `recency` (`'year'` o `''`).
  - Proveedor `fixture`: `createFixtureSearch(F)`, con la regla de `world.json`.
  - Devuelve `{results:[{rank, url, title, snippet, published}], latency, error|null}`.
  - Caché `search` con la clave de ARCHITECTURE §5.1.
- **`tools/fetch.mjs`:** `createFetchTool({env, transport, cache})`.
  - Cadena: `fetchPage` → `crawl4aiRead` (si está configurado y hay < 400 caracteres) → `jinaRead` (si hay < 400).
  - Antes de nada, comprueba `isPublicUrl` (si falla: `FETCH_BLOCKED`).
  - Errores: `FETCH_HTTP`, `FETCH_TIMEOUT` y `FETCH_EMPTY` (< 200 caracteres).
  - Caché `fetch` por `normalizeUrl`. El proveedor fixture usa `createFixtureFetch(F)`.

## Criterios de aceptación
ACC-06 y ACC-07.

## No tocar
`server/research/searchApis.mjs`, `verify.mjs` y `localSearch.mjs` (solo se importan). No uses `multiSearch` ni Firecrawl.
