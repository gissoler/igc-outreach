# V13 · T0 · Línea base y auditoría (13/10/2026)

Sin cambios de código en esta tarea.

## Línea base de pruebas

Comando: `node --test tests/*.test.mjs` en `research/` (Node v22.23.2, entorno Linux del asistente, no el Mac).
- Total 428 · pasan 426 · fallan 1 · omitidas 1 · canceladas 0 · 30,4 s.
- Falla: `apollo.test.mjs:99` «B0/B1/B2 code cannot import Apollo or capital strategy context». Cita `bench/investors/run-experiment.v6.mjs` (archivo congelado) como importador de Apollo que no está en la lista de excepciones de la prueba. Existía antes de V13; no se toca (el archivo está congelado y la prueba valida una garantía de V6).
- Omitida: «real Chromium (when installed)» (no hay Chromium en este entorno).

Comando adicional: `node --test tests/agent/*.test.mjs` (script `test:agent`).
- Total 191 · pasan 190 · fallan 1 · omitidas 0.
- Falla: `e2e.test.mjs:237` «ACC-58 CLI fixture timing is deterministic»: `spawnSync /Library/Developer/CommandLineTools/usr/bin/git ENOENT` (la prueba busca el git del Mac; el entorno es Linux). Es del entorno, no del código.

Estas dos fallas son la referencia: «igual o mejor» (criterio 4) significa 426/428 y 190/191 o más.

Rama remota: `git ls-remote` y `git fetch` fallan sin credenciales de GitHub en este entorno. Ramas conocidas localmente: `main` (20 commits por delante de `origin/main`), `origin/main`, `origin/mejoras-busqueda-2026-09-30`. La rama `arquitectura/agente-general-2026-10-07` no aparece en ninguna referencia local. No se pudo comprobar en el remoto; queda sin confirmar.

## (a) ¿Grants e inversionistas comparten camino?

Producto (`research/server/research/`):
- Un solo motor: `engine.mjs`, función `runObjective(objective, brief, opts)`. `OBJECTIVES` define cinco objetivos: grant, sponsorship, investment, debt, partnering. Grants e inversionistas pasan por la misma búsqueda (`multiSearch`/SearXNG/Firecrawl), la misma lectura (`chat(... role: 'engine')`, `readPrompt`) y la misma función `verifyFinding`.
- La divergencia está dentro de `verifyFinding` (engine.mjs:138): si `objective === 'investment'` llama a `investorFinding` → `verifyInvestor` (investor.mjs); los demás llaman a `verifyOpportunity` (verify.mjs:73).
- `pipeline.mjs` (líneas 6, 120–195) llama a `runEngine`/`runObjective` para ambos y arma `engineLeads`.
- Un solo rol de modelo: `engine` (`ENGINE_LLM_*`). Lee y planifica. No hay rol `compiler` ni `judge` en `server/analysis/fleet.mjs` (`ROLE_ENV` tiene chat, small, reasoning, embed, rerank; `engine` se arma aparte desde `ENGINE_LLM_*`).

Banco de pruebas y agente (no comparten código con el producto en la lectura):
- `research/agent/` (search_agent, planner, extractor, eligibility_judge, validity, registry, contratos JSON) es el agente iterativo del banco. Importa del producto solo utilidades: `core.mjs` (norm), `verify.mjs` (hostKind), `localSearch.mjs`, `crawl4ai.mjs`, `searchApis.mjs`, `dates.mjs` (`deadlineDecision`, desde `agent/validity.mjs`). El producto no importa nada de `agent/`.
- `research/bench/investors/` tiene su propio motor (`engine.mjs` congelado, `engine.v2/.v7/.v8/.v9.mjs`), extractor y juez propios. Ningún módulo de `server/` los importa.
- Conclusión: grants e inversionistas comparten motor, búsqueda y lectura en el producto; difieren solo en el verificador. El agente de `agent/` y el banco de `bench/investors/` son una segunda línea separada.

## (b) Dónde se decide hoy cada criterio y por quién

Grants (`verifyOpportunity`, verify.mjs):
- Fecha de cierre y estado: código. `deadlineDecision(text, ...)` de `dates.mjs` (361 líneas de patrones) decide `status` y `deadline`. El modelo aporta `status`, `deadline` y la cita; el código solo los contrasta (`deadline_conflict`, `deadline_not_in_quote`, `open_claim_unsupported`). Con `deadline_conflict` el caso va a «a verificar» (blocker `Model and page disagree on the deadline`), pero `deadline` y `daysLeft` mostrados son los del código.
- Segunda lectura de fechas: extractor Firecrawl JSON (`extractedFacts`), solo para candidatas, tope `ENGINE_EXTRACT_MAX` (5). Si discrepa del lector de patrones, `extractor_conflict` → `status: unknown`.
- Tipo de página: código (`pageType.mjs`, `classifyPage`) con pistas del modelo (`kind`, `page_type`).
- Elegibilidad de solicitante (tipo de entidad, país, ánimo de lucro): `applicant.mjs` `checkApplicant` (reglas de texto). El modelo con cita literal puede subir `unclear` a `yes` (`eligibility_from_model`) o bajar a `no`. `yes` del modelo contra `no` del código = `unclear` (`eligibility_conflict`).
- Región: dentro de `checkApplicant` (códigos de país/región, EU, LATAM); `country_restricted` como bandera.
- Etapa: `checkApplicant` solo detecta requisitos tardíos (`stage_requirement` → `unclear`).
- Encaje temático (`scope_fit`): modelo juzga; código comprueba citas y añade dos reglas de texto propias (ensayos clínicos no permitidos, vocabulario biomédico ausente).
- No dilutivo: modelo + regex `DILUTIVE_RX`.
- Oficial: modelo + tipo de host.
- Decisión final (`tier` main/verify/drop): código, a partir de los anteriores.

Inversionistas (`verifyInvestor`, investor.mjs): tesis, etapa, geografía, vía de contacto y actividad reciente los decide el código con frases de la página; el modelo aporta nombre, tipo e identidad. Un `eligible: no` del modelo con cita literal se respeta; un `yes` no se usa (`model_eligibility_not_used`). No hay fecha de cierre.

Agente del banco (`research/agent/`): `eligibility_judge.mjs` aplica un catálogo de criterios con juicios del modelo y criterios deterministas (`codeEval`: G-STATUS, P-TIMELINE, P-ROUTE) sobre `validity.mjs`, que reutiliza `deadlineDecision`. Es otra ruta; el producto no la ejecuta.

## Defecto que motiva V13 (de la evidencia del 13/10)

El rol de cada fecha lo asigna hoy el código (`dates.mjs`), no el modelo. En los dos avisos previos de NIA/NIAGADS el modelo etiquetó bien (Estimated Post / Application Due / Award / Project Start) y el lector de patrones corrió las etiquetas una columna (regla de tablas aplanadas, `TABLE_HEAD_RX`, dates.mjs ~línea 248). La fecha del código es la que se muestra.

## (c) Propuesta del 07/10 (núcleo + paquete de dominio)

- No se encuentra en las ramas locales ni en `origin/*` conocidas.
- En el repo existe una separación parecida en `research/agent/`: `eligibility_judge.mjs` dice «No conoce ningún dominio: todo lo específico llega por el DomainPack», `contracts.mjs`, `registry.mjs`. Es lo único del núcleo/paquete presente en `main`.
- Sin acceso al remoto no se puede afirmar que la rama exista o no allí. Pendiente: que Gisel o GPT confirmen con `git ls-remote origin`.

## Implicación para el diseño de V13

- El punto de integración único es `engine.mjs` después de `chat(... readPrompt ...)` y antes/junto a `verifyFinding` (línea 390), común a grants e inversionistas. El catálogo de criterios cambia por objetivo.
- `dates.mjs` y el resto de `verify.mjs` quedan intactos; el estado nuevo se calcula en un módulo aparte y se aplica solo con `ENGINE_JUDGE=1`.
