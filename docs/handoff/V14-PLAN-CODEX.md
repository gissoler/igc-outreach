# V14 · C4 · Plan para Codex (13/10/2026)

Entradas: `V14-DIAGNOSTICO.md`, `V14-ARQUITECTURA.md`, `V14-BENCHMARK.md`, `V14-C0-RESPUESTAS.md`, `V14-F3-LISTA.md`. Si una tarea choca con el código real, parar y escribir la discrepancia en `V14-DISCREPANCIAS.md`.

Valores fijados por Gisel (C0): Apollo 50 créditos en total (25 por caso, solo F2). Congelados: se mueven solo las filas firmadas en `V14-F3-LISTA.md`. Referencia manual: Gisel, 10 casos en `research/eval/calificar-igc-10.xlsx` (adenda 1 de `V14-BENCHMARK.md`). Pistas: se listan aparte y alimentan la búsqueda. Brief de inversionistas: el mismo de IGC.

Comunes a todas las tareas:
- Antes: `git status` limpio salvo `research/scripts/g355-*` y `tunnel-g355.sh`; `cd research && node --test tests/*.test.mjs` (485/483/1/1) y `node --test tests/agent/*.test.mjs` (191/190/1).
- Después: la misma suite igual o mejor; más las pruebas nuevas de la tarea, todas en verde.
- Commit: `git add` por ruta; mensaje `V14 <tarea>: <qué> (<cifras>)`; sin Co-Authored-By ni Claude-Session.
- Deshacer: `git revert <commit>` salvo que la tarea diga otra cosa.
- Nada nuevo por patrones de fecha, tipo de página, región, solicitante o etapa.

## F1 · Trazas con el motor actual

### F1.1 · Módulo de registro
- Crear `research/server/research/trace.mjs` (≤ 150 líneas): `createTrace({ dir, runId, objective, clock })` → `{ event(type, data), page({ url, title, text, via, found_by, read }) → { ref, sha256, path }, summary(), close() }`. Valida cada evento con ajv contra `research/eval/v14/events.schema.json` (leído con `readFileSync`, solo si hay traza). Escribe `events.jsonl` y `pages/<sha256>.txt` (una vez por sha). `createTrace(null)` devuelve un objeto que no hace nada.
- Crear `research/tests/v14.trace.test.mjs`: (1) un evento válido de cada tipo se escribe; (2) un `drop` sin `decided_by` lanza error; (3) el mismo texto dos veces escribe un solo archivo en `pages/`; (4) la traza nula no escribe nada.
- Verificación: `node --test tests/v14.trace.test.mjs` → 4/4.
- Aceptación: 4/4 y suite base sin cambios.

### F1.2 · El motor emite eventos
- Cambiar `research/server/research/engine.mjs`: `opts.trace` (por defecto la traza nula). Puntos:
  - `runObjective`, al entrar: `run_start` lo emite `engine-run.mjs` (F1.3); aquí, envolver `chat` para emitir `model_call` con `role` (de los argumentos), `model`, `prompt_version` (`name`/`version` del prompt), `tokens` desde `usage` (`chatJSON` ya lo devuelve, `fleet.mjs:127`; si es `null`, `{prompt: 0, completion: 0, estimated: true}`), `ms_call`, `ok`, `invalid`.
  - Cada búsqueda por proveedor: `tool_call` `search` con `provider`, `args.query`, `results_n`, `ms_call`, `cost_usd`.
  - Cada página leída o no: `page` (texto completo a `pages/`), con `found_by: { tool: 'search', query, providers }` o `{ tool: 'expand', seed }` o `{ tool: 'researcher', step }`.
  - En `finalize` y `keepTrace` (`engine.mjs:322–340`): `decision` y, si hay descarte, `drop` con `decided_by` según esta tabla, sin cambiar ninguna decisión:

| `drop` / estado | `decided_by` |
|---|---|
| `aggregator` sin leer | `code:verify.mjs#hostKind` |
| `social_host` | `code:verify.mjs#hostKind` |
| `over_page_budget` | `code:budget` |
| lectura inválida del compilador o del juez | `invalid:compiler` o `invalid:judge` |
| `closed` con `judge.dropReason === 'closed'` | `judge+auditor` |
| `closed` sin juez | `code:dates.mjs#deadlineDecision` |
| `not_eligible` o `scope_mismatch` con `judge.dropReason` igual | `judge` |
| `not_eligible` con `flags` `model_not_eligible` y sin juez | `reader` |
| `not_eligible` restante | `code:applicant.mjs#checkApplicant` |
| `scope_mismatch` con `scopeFit.source === 'code'` | `code:verify.mjs#scopeVocabulary` |
| `scope_mismatch` restante | `reader` |
| `not_a_call:*` | `code:pageType.mjs#classifyPage` |
| `wrong_kind:*`, `wrong_money:*` | `reader+code:engine.mjs#verifyFinding` |
| `not_relevant`, `not_a_call` | `reader` |
| `unreliable_read`, `no_identity_quote` | `code:engine.mjs#verifyFinding` |
| `not_official`, `equity_or_loan` | `reader+code:verify.mjs#verifyOpportunity` |
| cualquier otro | `unknown:<motivo>` (se cuenta; si aparece, es discrepancia) |

  - Pistas en F1 (solo registro): `lead` cuando el lector o el compilador dijeron `kind: deal_news` o `page_type` `news`/`cohort_announcement`, o el descarte es `not_a_call:news|cohort`, con `funder`/`recipient` `null` y `quote` = `quotes.identity`. No cambia decisiones.
  - Expansión, investigador, seguimiento: `model_call` con su rol (`lateral`, `researcher`, `followup`) y `tool_call` `expand`.
- Crear `research/tests/v14.engine-trace.test.mjs` con los fixtures de `tests/engine.test.mjs` (búsqueda y `chat` inyectados): (1) `findings` y `audits[].dropped` idénticos (`deepStrictEqual`) con y sin traza; (2) todo `drop` tiene `decided_by` y ninguno empieza por `unknown:`; (3) todas las líneas validan contra `trace/1`; (4) número de `page` = páginas vistas del `audit`.
- Verificación: `node --test tests/v14.engine-trace.test.mjs tests/engine.test.mjs tests/v13.engine.test.mjs`.
- Aceptación: 4/4 nuevas; las existentes sin cambios.

### F1.3 · `engine-run.mjs --trace`
- Cambiar `research/scripts/engine-run.mjs`: con `--trace`, crear la traza en `outDir`, emitir `run_start` (brief completo, sha256 del brief, `today`, banderas `ENGINE_*` presentes en el entorno con su valor salvo claves, modelos y versión de prompt por rol, `git rev-parse HEAD`, topes) y `run_end`; escribir `summary.json` (forma de `eval/v14/summary.plantilla.json`) y añadir a `report.md` una sección «Registro» con las 12 preguntas y la consulta que responde cada una. Sin `--trace`, salida idéntica a hoy.
- Añadir `--dry-run` (imprime el máximo de llamadas a Exa = `ENGINE_MAX_QUERIES` × `ENGINE_ROUNDS` más las del investigador, × 0,0089 USD, y sale sin llamar a nada) y `--exa-usd-cap <USD>` (cuando la suma de `costUsd` de exa en la corrida llega al tope, exa se apaga para el resto de la corrida igual que hoy se apaga Jina con 402; los otros proveedores siguen). `bench/investors/analysis/exa_spend.mjs` lee el formato del banco (`attempts[].cached`) y no sirve para estas carpetas.
- No arreglar aquí el `today` en texto (eso es F2.0): F1 mide el motor tal como está.
- Prueba: `research/tests/v14.engine-run.test.mjs` corre el script con un brief de fixture y búsqueda/modelo falsos inyectados por variable (`ENGINE_TEST_FIXTURE=1` si ya existe un mecanismo; si no existe, probar la función `writeSummary` exportada) y comprueba que existen `events.jsonl`, `summary.json`, `pages/`.
- Verificación: `node --test tests/v14.engine-run.test.mjs`.
- Aceptación: verde; `git diff` del `report.md` de un fixture sin `--trace` = vacío.

### F1.4 · Consultas del registro
- Crear `research/eval/v14/ask.mjs` (≤ 150 líneas): `node eval/v14/ask.mjs <dir> <1..12>` imprime la respuesta a la pregunta n de `V14-BENCHMARK.md` §3. La 12 lee `coverage/` (formato V8) y cuenta archivos y funciones con `count > 0`.
- Prueba: `research/tests/v14.ask.test.mjs` con un `events.jsonl` de 20 líneas escrito por la prueba: las 12 preguntas devuelven texto no vacío.
- Aceptación: 12/12.

### F1.5 · Corridas F1
- Comprobar endpoints: `bash research/scripts/tunnel-g355.sh dual-status` (si no, `dual-bg`).
- Comandos (en `research/`; variables de juez y compilador de `V13-DESPLIEGUE.md` líneas 124–133):
```
ENGINE_JUDGE=1 ENGINE_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 \
COMPILER_LLM_URL=http://127.0.0.1:8017/v1 COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507 COMPILER_LLM_JSON_MODE=1 COMPILER_LLM_TIMEOUT_MS=240000 \
JUDGE_LLM_URL=http://127.0.0.1:8016/v1 JUDGE_LLM_MODEL=openai/gpt-oss-120b JUDGE_LLM_REASONING_EFFORT=medium JUDGE_LLM_JSON_MODE=1 JUDGE_LLM_TIMEOUT_MS=240000 \
NODE_V8_COVERAGE=eval/runs/v14-f1-grant/coverage \
node --env-file-if-exists=.env scripts/engine-run.mjs --brief eval/briefs/jefe-igc-mint-ad-2026-10-12.json --objectives grant --today 2026-10-12 --no-cache --trace --out eval/runs/v14-f1-grant
```
  y lo mismo con `--objectives investment`, `--out eval/runs/v14-f1-investment` y su `coverage`.
- Gasto: antes de cada corrida, el mismo comando con `--dry-run`; luego la corrida con `--exa-usd-cap` = 5 USD menos lo gastado en V14 hasta ese momento (suma de `summary.tools.search.cost_usd` de exa de las carpetas `v14-*`). Referencia: 23-09 gastó 0,224 USD en 32 llamadas.
- Revisar: `node eval/v14/ask.mjs <dir> n` para n = 1..12 en las dos carpetas.
- Escribir `docs/handoff/V14-F1-CIFRAS.md`: tabla §4 de `V14-BENCHMARK.md` columna F1, las 12 respuestas (resumidas), y `node eval/v14/drops.mjs eval/runs/v14-f1-grant/result.json`.
- Aceptación: criterios F1 (a)–(e) de `V14-BENCHMARK.md` §6. Si el registro no responde una pregunta, se corrige el registro (F1.2–F1.4), no el motor.
- Commit: solo `V14-F1-CIFRAS.md` (`eval/runs/` está en `.gitignore`).

## F2 · Bucle del agente tras `ENGINE_AGENT=1`

### F2.0 · Fecha de hoy
- Cambiar `research/server/research/core.mjs`: exportar `asDate(today)` (acepta `Date`, `'AAAA-MM-DD'` o vacío → `Date` UTC a medianoche). Cambiar `research/server/research/lateral.mjs:18–38` para usar `asDate(today)` en `openAlexFunders` y `edgarPeers`.
- Prueba: `research/tests/v14.today.test.mjs`: `openAlexFunders` y `edgarPeers` con `today: '2026-10-12'` y `fetcher` falso no lanzan error y piden `publication_year:>2023` y `startdt=2025-10-12`.
- Aceptación: verde. Es un arreglo, cambia resultados de la expansión; se anota en `V14-CAMBIOS.md`. F1 no se repite.

### F2.1 · Rol `agent`
- Cambiar `research/server/analysis/fleet.mjs`: añadir `['agent', 'ENGINE_AGENT']` al bucle de roles de V13 (mismo comportamiento: sin URL y modelo, no listo; sin sustitución salvo `ENGINE_AGENT_LLM_FALLBACK`). Cambiar `research/.env.example`: líneas `ENGINE_AGENT=0`, `ENGINE_AGENT_LLM_URL=`, `ENGINE_AGENT_LLM_MODEL=`, `ENGINE_AGENT_LLM_REASONING_EFFORT=medium`, `ENGINE_AGENT_LLM_JSON_MODE=1`, `ENGINE_AGENT_LLM_TIMEOUT_MS=240000`, y los topes `ENGINE_AGENT_STEPS=40`, `ENGINE_AGENT_SEARCHES=20`, `ENGINE_AGENT_OPENS=30`, `ENGINE_AGENT_SECONDS=1200`, `ENGINE_AGENT_APOLLO_CREDITS=25`, `ENGINE_AGENT_JUDGE_SECOND=10`.
- Prueba: añadir a `research/tests/v13.fleet.test.mjs` 2 casos (listo con URL y modelo; no listo sin ellos).
- Aceptación: verde.

### F2.2 · Contratos y prompts
- Crear `research/server/research/agentic/contracts.v14.mjs` (≤ 120): esquemas ajv `agent.understand/1` y `agent.step/1` tal como en `V14-ARQUITECTURA.md` §3 y §5; `validateStep(raw)` → `{ ok, value, errors }`.
- Crear `research/server/research/agentic/prompts.v14.mjs` (≤ 150): `AGENT_PROMPT_VERSION = 'agent.v14.1'`, `understandPrompt({ brief, objective, today })`, `stepPrompt({ state, observation })`. El catálogo de criterios = `CRITERIA` de `judge/prompts.v13.mjs` más `non_dilutive`, `official` (grant, sponsorship) y `recent_activity`, `contact_route` (investment), con una frase de ayuda cada uno en el estilo de `CRITERION_HELP`. El texto de página va dentro de `<page_data>` con `fence`. El prompt dice: el agente nunca escribe URLs, solo `ref`; las fechas pueden no estar en la página y hay que abrir enlaces; una noticia de financiación es pista (quién financió, quién más financia eso, sectores vecinos); parar cuando seguir solo repite.
- Prueba: `research/tests/v14.contracts.test.mjs`: 3 pasos válidos de ejemplo pasan; 5 inválidos fallan (sin `action`, `tool` desconocida, `assessment` ausente tras página, `verdict` fuera de enum, más de 3 preguntas en `ask_user`).
- Aceptación: 8/8.

### F2.3 · Herramientas
- Crear `research/server/research/agentic/tools.mjs` (≤ 250): `createTools({ env, fetcher, signal, trace, limits, apollo, readers })` con `search`, `open`, `apollo`, `entity_funding`, `registry`, `note`, `ask_user`, `finish` (interfaz de `V14-ARQUITECTURA.md` §4). Un registro de `ref` → URL; `open` con `ref` desconocido devuelve `{ error: 'rejected_ref' }` y emite `tool_call` con `rejected_ref: true`. Redes sociales bloqueadas con `hostKind(url) === 'social'`. `host_hint` informativo. `apollo` usa `createApolloClient` + `ApolloBudget({ perRun: limits.apolloCredits, perDay: 50 })`. `entity_funding`: RePORTER (`org_names`), NSF Awards (`awardeeName`), SBIR Awards (`firm`), EDGAR Form D (`q`), cada uno con `fetcher` inyectable. `ask_user` sin usuario devuelve `{ answered: false }`.
- Prueba: `research/tests/v14.tools.test.mjs` con `fetcher` falso: (1) `search` numera resultados `s<n>.<i>`; (2) `open` de un ref de resultado guarda en `pages/` y devuelve enlaces `p<n>.l<i>`; (3) `open` de un ref inventado → `rejected_ref`; (4) URL de red social → bloqueada; (5) tope de búsquedas → `{ error: 'budget' }`; (6) Apollo pasa de 25 créditos → `APOLLO_RUN_CAP`; (7) `ask_user` → `answered: false`.
- Aceptación: 7/7.

### F2.4 · Bucle
- Crear `research/server/research/agentic/loop.mjs` (≤ 350): `runAgentObjective(objective, brief, opts)` → `{ findings, leads, audit, queries }`. Paso 0 (`understand`, `brief_patch`, `ask_user` si `impact !== 'none'`, ≤ 3). Bucle de `V14-ARQUITECTURA.md` §2 con un reintento por JSON inválido. Por cada `assessment`: comprobar citas con `literalIn` y fechas con `verifyDate` (`judge/audit.v13.mjs:18`); un `yes` sin cita literal → `unknown`; emitir `decision` con `by: 'agent'`. `lead` con cita literal → tabla de pistas y evento `lead`; acciones con `from_lead` → `lead_followup`. Al `finish` o tope: finalistas (§6) → `judgePrompt` con el catálogo del objetivo → `auditPage` → `findings` con la forma que espera `engineLeads`; segunda llamada ciega del juez a los primeros `ENGINE_AGENT_JUDGE_SECOND` finalistas, contando cambios.
- Prueba: `research/tests/v14.loop.test.mjs` con un modelo guionado (respuestas fijas por paso) y las herramientas falsas de F2.3: (1) sigue una pista: `lead` en el paso 2 y `search` con `from_lead` en el 3; (2) para por tope de pasos con `finish.reason = 'budget'`; (3) dos JSON inválidos seguidos → paso contado como inválido y el bucle sigue; (4) `yes` con cita que no está en la página → `unknown`; (5) un finalista pasa juez y auditor y sale en `findings` con `deadline` y `daysLeft` calculados por código; (6) un «no» con cita del juez descarta con `decided_by: 'judge'`; (7) `engineLeads(findings)` no lanza error.
- Aceptación: 7/7.

### F2.5 · Rama en el motor
- Cambiar `research/server/research/engine.mjs`: al inicio de `runObjective`, `if (env.ENGINE_AGENT === '1' && fleetConfig(env).roles.agent.ready) return runAgentObjective(objective, brief, { ...opts, env })`; si la bandera está y el rol no, seguir con el motor actual y dejar `audit.agent = { on: true, ready: false, notice }`. `runEngine` une `leads` de todos los objetivos. Cambiar `scripts/engine-run.mjs`: escribir `leads` en `result.json` y una sección «Pistas» en `report.md`.
- Prueba: `research/tests/v14.engine-agent.test.mjs`: (1) sin bandera, salida idéntica a la de `tests/engine.test.mjs` (mismo fixture, `deepStrictEqual`); (2) con bandera y rol, devuelve `leads` y `audit.agent`; (3) con bandera y sin rol, motor actual y `notice`.
- Aceptación: 3/3; suite completa con `ENGINE_AGENT` sin definir y con `ENGINE_AGENT=1` (sin rol listo) igual a la base.

### F2.6 · Corridas F2
- Mismos comandos de F1.5 con `--out eval/runs/v14-f2-<caso>` y además `ENGINE_AGENT=1 ENGINE_AGENT_LLM_URL=http://127.0.0.1:8016/v1 ENGINE_AGENT_LLM_MODEL=openai/gpt-oss-120b ENGINE_AGENT_LLM_REASONING_EFFORT=medium ENGINE_AGENT_LLM_JSON_MODE=1 ENGINE_JUDGE_BLIND=1 ENGINE_AGENT_APOLLO_CREDITS=25`, y `APOLLO_ENABLED=1` solo si `npm run preflight:apollo` responde; si no, `apollo` devuelve `not_configured` y se anota.
- Gasto Exa: `--dry-run` antes y `--exa-usd-cap` con lo que quede de los 5 USD tras F1. Créditos Apollo: `creditUsage` antes y después, más `creditsEstimated` del registro.
- Escribir `docs/handoff/V14-F2-CIFRAS.md`: tabla §4 columnas F1 y F2 para los dos casos; páginas, llamadas por rol, segundos, USD y créditos por herramienta, verificadas, pistas, descartes por motivo y por quién; las 12 respuestas; el resultado de cada criterio F2 de `V14-BENCHMARK.md` §6 (cumple o no, con la cifra).
- Si las 10 filas del Excel están llenas: correr F4.1 (`score.mjs`) para F1 y F2 antes de decidir. Si no: criterio 6 «pendiente», F3 no empieza.
- Aceptación: el informe está completo. Si algún criterio no se cumple, se dice y F3 no empieza.

## F3 · Limpieza (solo si F2 cumple los 7 criterios y solo lo firmado)

### F3.0 · Firma
- Gisel firma filas de `V14-F3-LISTA.md`. Sin firma, F3 no empieza. Codex no edita esa lista.

### F3.1 · Mover lo firmado
- Por cada fila con `si` (un commit por archivo, o por carpeta si todas sus filas tienen `si`): `git mv research/<ruta> research/_archivo/<ruta>`; si la fila es B, mover también las pruebas o `.sh` que la nombran en el mismo commit y anotar la huella afectada.
- Verificación: suite antes y después; `node eval/v14/graph.mjs` otra vez: los archivos alcanzados por las entradas de producto no cambian.
- Aceptación: suite igual o mejor; 0 archivos de producto perdidos en la gráfica.
- Deshacer: `git mv` de vuelta (o `git revert`).

### F3.2 · Código reemplazado de `server/research/`
- Después de F2, correr `graph.mjs` con la bandera en el código y listar en `V14-CAMBIOS.md` los archivos de la tabla de `V14-ARQUITECTURA.md` §8 que tengan 0 importadores fuera de pruebas. No se mueven en V14: se añaden como filas nuevas a una lista `V14-F3-LISTA-2.md` para otra firma.

## F4 · Informe

### F4.1 · Puntuación contra la referencia
- Crear `research/eval/v14/score.mjs` (≤ 150): entradas `eval/v14/gold-respuestas-igc-10.csv` (respuestas de Gisel ya exportadas del Excel; los valores no siempre son los de la lista: «si»/«Sí», «Meh» y texto largo se normalizan a mano, «Meh» y vacío = no sé), `eval/v14/gold-sistema-igc-10.csv` y la carpeta de una corrida; salida `summary.gold` (aciertos de 10, caso por caso, pistas) y una tabla para `report.md`, según la adenda 1.
- Prueba: `research/tests/v14.score.test.mjs` con 4 casos inventados por la prueba: aciertos esperados.
- Aceptación: verde.

### F4.2 · `V14-CAMBIOS.md` y nota del vault
- `docs/handoff/V14-CAMBIOS.md`: `wc -l` por directorio antes y después (`server/`, `server/research/`, `agent/`, `bench/`, `tests/`, `scripts/`, `capital/`, `eval/v14/`); cifras F1 y F2; tareas hechas y no hechas; discrepancias; lo no medido.
- Nota corta en el vault Outreach (`Outreach/Código/20 - …`; la 19 la escribe Claude en C5).
- Commit: `V14-CAMBIOS.md`.

## Orden y dependencias

F1.1 → F1.2 → F1.3 → F1.4 → F1.5 → F2.0 → F2.1 → F2.2 → F2.3 → F2.4 → F2.5 → F2.6 → (F4.1 si las 10 filas están llenas) → F3.0 → F3.1 → F3.2 → F4.2. Líneas nuevas previstas en `server/`: ≤ 1.020 (trace 150, contracts 120, prompts 150, tools 250, loop 350) más los cambios en `engine.mjs`, `engine-run.mjs`, `fleet.mjs`, `core.mjs`, `lateral.mjs`.

## Lo que no decide Codex

Si aparece algo que el plan no cubre (otro motivo de descarte, un endpoint caído, una prueba que falla por otra causa, un criterio que pide una regla de texto), se escribe en `V14-DISCREPANCIAS.md` y se espera.
