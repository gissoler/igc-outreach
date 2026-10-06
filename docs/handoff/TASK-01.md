# TASK-01 · Contratos, prompts y andamiaje

## Objetivo
Cargar y validar los contratos y los prompts versionados para que el resto de módulos los use. Todavía no hay lógica de búsqueda.

## Archivos
- Crear `research/agent/contracts.mjs`, `research/agent/prompts.mjs` y `research/agent/errors.mjs`.
- Crear `research/tests/agent/contracts.test.mjs`.
- Modificar `research/package.json`:
  - en `dependencies`, añadir `"ajv": "^8.17.1"` y `"ajv-formats": "^3.0.1"`;
  - en `scripts`, añadir `"test:agent": "node --test tests/agent/*.test.mjs"`.
- Modificar `.gitignore` (raíz): añadir `research/bench/out/`.

## Contratos que usa
Todos los de `docs/contracts/`, más `prompts/manifest.json`.

## Especificación
`errors.mjs` exporta estas clases, todas con `code` y `message`:
- `ContractError(name, errors)` con `code='CONTRACT'`;
- `PromptIntegrityError(id, version, expected, actual)`;
- `LlmError(code, message)`;
- `BudgetStop(reason)`.

`contracts.mjs`:
- Crea **una** instancia `new Ajv2020({allErrors:true, strict:true, strictTypes:false, strictRequired:false, allowUnionTypes:true})` + `addFormats`. Al importarse, carga todos los `docs/contracts/*.schema.json`. La ruta se resuelve con `new URL('../../docs/contracts/', import.meta.url)`.
- `validate(name, obj)`: compila `https://outreach.local/contracts/${name}.schema.json` (con memo) y devuelve `obj` o lanza `ContractError(name, ajv.errors)`.
- `bundle(name)`: devuelve un clon profundo del schema con todo `$ref` externo (`common.schema.json#/$defs/x`, `document.schema.json`, …) **inlinado de forma recursiva**. Los `$ref` internos `#/$defs/...` se inlinan también. El resultado no contiene `$id`, `$schema` ni ningún `$ref`. Si hay un ciclo, se lanza un error. No debería haberlos.
- `loadJson(relPathFromRepoRoot)`: helper para leer JSON del repo.

`prompts.mjs`:
- `loadPrompt(id, version, {root} = {})`:
  - `root` por defecto es `<repo>/prompts`;
  - lee `manifest.json`, busca `{id, version}` y recalcula el sha (regla de `prompts/README.md`). Si no coincide, lanza `PromptIntegrityError`;
  - devuelve `{id, version, sha256, system, user}`, o `{id, version, sha256, templates}` para `b0_templates` (el JSON parseado).
- `render(template, vars)`: reglas de `prompts/README.md` §Render.
- `sanitizePageText(s)`: elimina `<page_data>` y `</page_data>` y colapsa los espacios.

## Criterios de aceptación
- ACC-01, ACC-01n, ACC-02 y ACC-03 pasan.
- `npm --prefix research install` deja `package-lock.json` actualizado y sin otros cambios de dependencias.

## Tests que deben pasar
- `npm --prefix research run test:agent`
- `npm --prefix research test`: mismo resultado que en `main` (415 pass, 1 fail preexistente en `searchQuality.test.mjs:37`, 1 skip).

## No tocar
`docs/contracts/**`, `prompts/**`, `research/tests/agent/fixtures/**`, `research/server/**` y los tests existentes.
