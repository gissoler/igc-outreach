# V14 · C2 · Arquitectura del bucle del agente (13/10/2026)

Hipótesis que prueba el benchmark (no es un resultado): con el bucle del agente detrás de `ENGINE_AGENT=1`, el mismo brief produce al menos tantas oportunidades correctas como la línea F1, sigue pistas que hoy se tiran y no aumenta los errores frente a la referencia manual. Nada de este documento afirma que el bucle sea mejor; las cifras que lo refutarían están en §10.

## 1. Qué hace el código y qué hace el modelo

| Lo hace el modelo (agente) | Lo hace el código |
|---|---|
| Interpretar el brief, escribir supuestos y dudas | Fecha de hoy (`Date`, normalizada una vez; arregla el fallo de `lateral.mjs:21`) |
| Planificar y elegir la siguiente herramienta | Topes: pasos, búsquedas, aperturas, segundos, tokens, créditos de Apollo, USD de Exa |
| Tipo de página, fechas con rol y cita, cada criterio con veredicto y cita | Cita literal en la página (`literalIn`, `verify.mjs:25`); si falla, el campo pasa a `unknown` y se registra |
| Decidir si una página es pista y qué buscar a partir de ella | Resta de días y estado desde rol + fecha (`stateFrom`/`auditPage`, `judge/audit.v13.mjs`) |
| Decidir cuándo parar | Validación del JSON de cada paso (ajv) y un reintento |
| — | Solo se abren URLs que salieron de una herramienta (resultado, enlace de página abierta, fila de registro) |
| — | Bloqueo de redes sociales (lo que hoy hace `hostKind === 'social'`) |
| — | Registro completo (`events.jsonl`, `pages/`, `summary.json`) |
| Juez (otro paso, solo finalistas): cada criterio con cita | Auditor: aplica cita literal y resta; un «no» con cita del juez descarta |

Sale de la decisión cuando `ENGINE_AGENT=1` (el código sigue en el repo y se usa con la bandera apagada): lista `AGGREGATORS`/`AGGREGATORS_EXTRA`/`DIRECTORY_PATH` como descarte (pasa a ser un dato `host_hint` que el agente ve), `classifyPage`, `deadlineDecision`, `checkApplicant`, regla de vocabulario biomédico (`verify.mjs:200–206`), `DILUTIVE_RX`, filtros `kind`/`money` del objetivo (`engine.mjs:150–161`), `verifyInvestor`, `planQueries`, `followUpQueries`, `researcher.mjs`, `expansion.mjs`, segunda lectura con extractor Firecrawl.

## 2. El bucle (grants e inversionistas, mismo código)

```
estado = { brief, entendimiento, catálogo de criterios del objetivo, presupuesto restante,
           notas (últimas 12), candidatos (tabla corta), pistas (tabla corta), historial (1 línea por paso) }
paso 0: entender el brief (§3)
repetir mientras no haya finish ni tope:
   prompt = estado + última observación (resultados numerados o extracto de página con enlaces numerados)
   salida = modelo(rol agent) → JSON agent.step/1 (§5)
   código: validar JSON (1 reintento con el error); comprobar citas; registrar
   código: ejecutar la herramienta pedida si hay presupuesto; si no, devolver «tope alcanzado» como observación
al terminar: finalistas → juez (§6) → auditor → findings; pistas → leads
```

Rol nuevo `agent` en `fleetConfig` (`ENGINE_AGENT_LLM_URL`, `ENGINE_AGENT_LLM_MODEL`; sin los dos el rol no está listo y el motor sigue con el camino actual, mismo criterio que `compiler` y `judge` en V13). Configuración del benchmark: agente `openai/gpt-oss-120b` en 127.0.0.1:8016; juez el mismo modelo con contexto nuevo y `ENGINE_JUDGE_BLIND=1` (no ve el razonamiento del agente, sí los hechos con cita). Se registra `sameModel: true`. Motivo: el 235B está apagado y el 30B dio 20/80 JSON inválidos en 22-44. Riesgo de independencia en §10.

Topes por objetivo en el benchmark (código, `ENGINE_AGENT_*`): 40 pasos, 20 búsquedas, 30 aperturas, 1.200 s, 25 créditos de Apollo (50 en total para los dos casos), Exa ≤ 0,50 USD por caso y ≤ 5 USD en todo V14 (`--exa-usd-cap` de F1.3). Las cifras de F1 (32 consultas, 80 lecturas, 539–632 s) son la referencia de coste.

## 3. Paso 0: entender el brief y preguntar antes de gastar (respuesta 5 de C0)

Gisel no fija campos del intake: el brief cambia con la conversación, como en Gemini o ChatGPT deep research. Lo encontrado:

| Fuente | Qué hace | Cifra |
|---|---|---|
| ChatGPT deep research (help.openai.com, artículo 10500283) | «Before research begins, ChatGPT may ask clarifying questions»; propone un plan que el usuario revisa y cambia antes de empezar | sin cifra |
| Gemini Deep Research (PCWorld, 2024) | pide aprobar el esquema del plan antes de empezar | sin cifra |
| Zhang y Choi, «Clarify When Necessary» (arXiv 2311.09469, NAACL Findings 2025) | tres decisiones: cuándo preguntar, qué preguntar, cómo usar la respuesta; decide cuándo con la incertidumbre sobre la intención del usuario (`intent-sim`) | preguntando en el 10 % de los casos, duplica la ganancia frente a elegir al azar qué preguntar |
| Aliannejadi et al., Qulac (SIGIR 2019, arXiv 1907.06554) | una pregunta aclaratoria en búsqueda | con oráculo, P@1 de 0,1933 a 0,4986 |
| Zhang et al., Ask-before-Plan (EMNLP Findings 2024, arXiv 2406.12639) | agente de aclaración separado antes de ejecutar y planificar | el resumen no da cifras |

No encontré trabajos sobre intake de briefs de financiación.

Diseño:
- Salida del paso 0 (`agent.understand/1`): `product_one_line`, `who_pays`, `sector`, `neighbor_sectors[]`, `stage`, `geography`, `assumptions[]`, `doubts[]` con `{question, options[], impact: changes_search|changes_criteria|none}`.
- Se pregunta solo lo que tiene `impact` distinto de `none`, como máximo 3 preguntas cerradas y antes de la primera búsqueda (ahí preguntar es más barato). Lo demás va como supuesto escrito.
- Durante el bucle, `ask_user` está permitido cuando un hecho con cita contradice el brief (p. ej. el brief dice `stage: marketed` y la página pide preclínico).
- El brief de trabajo cambia con eventos `brief_patch` (campo, valor, motivo, origen: respuesta o supuesto). El brief guardado del usuario no cambia sin su respuesta.
- Sin usuario (benchmark, corridas nocturnas): `ask_user` devuelve `{answered: false}`. El agente sigue con el supuesto y la pregunta queda en el registro. En el producto, la UI que muestra las preguntas no entra en V14.
- En el brief de IGC hay dos contradicciones que un lector humano ve: `product: mint ad` frente a un `oneLiner` de riesgo de Alzheimer, y `stage: marketed` frente a `round: seed`. El benchmark comprueba si el paso 0 las detecta, sin escribir ninguna regla para ellas.

## 4. Herramientas

Todas devuelven JSON. Cada llamada se registra con argumentos, resultado resumido, ms y coste.

| Herramienta | Argumentos | Devuelve | Implementación (reutiliza) |
|---|---|---|---|
| `search` | `query`, `recency?` (`month`/`year`), `n?` ≤ 10 | `results[{ref:"s3.2", url, title, snippet, providers, host_hint}]`, `cost_usd` | `multiSearch` (`searchApis.mjs:191`); `host_hint` = `hostKind(url)`, solo informativo |
| `open` | `ref` (de un resultado, un enlace o una fila) | `{ref, url, title, chars, text (≤ 12.000 caracteres entre <page_data>), links[{ref:"p4.l7", text, url}] ≤ 60, via}`; texto completo a `pages/` | cadena de lectura actual del motor (`fetchPage`, `crawl4aiRead`, `firecrawlRead`) |
| `apollo` | `op: organization` + `name` o `domain`; `op: people` + `domain`, `titles[]` | filas de Apollo, `credits_estimated` | `createApolloClient` + `ApolloBudget({ perRun: 25, perDay: 50 })` (`capital/apollo.mjs`) |
| `entity_funding` | `entity`, `direction: received` o `gave`, `topic?` | filas `{funder, recipient, amount, date, source, url}` | adaptadores nuevos por entidad a RePORTER, NSF Awards, SBIR Awards, EDGAR Form D; hoy existen solo por tema (`grantSources.mjs`, `lateral.mjs`) |
| `registry` | `source: grants_gov` o `reporter` o `nsf` o `sbir`, `query` | filas con URL oficial | `grantsGovSearch`, `reporterIntel`, `nsfIntel`, `sbir` (`grantSources.mjs`) |
| `note` | `text`, `kind: assumption|hypothesis|plan|lead` | `{ok}` | solo registro |
| `ask_user` | `questions[{q, options[]}]` ≤ 3 | `{answered, answers?}` | sin usuario: `answered: false` |
| `finish` | `reason`, `finalists[ref]` | — | dispara el juez |

Regla de seguridad que no cambia: el modelo nunca escribe una URL; solo pasa `ref`. Una acción con un `ref` desconocido se rechaza y se cuenta (`rejected_ref`).

## 5. Contrato JSON de cada paso (`agent.step/1`)

```json
{
  "thought": "≤ 400 caracteres: qué sé, qué falta, por qué esta acción",
  "assessment": null,
  "notes": ["≤ 3 notas nuevas"],
  "action": { "tool": "search|open|apollo|entity_funding|registry|note|ask_user|finish", "args": {}, "from_lead": "L2 o null" }
}
```

Cuando la última observación fue una página, `assessment` es obligatorio:

```json
{
  "ref": "p12",
  "page_type": "call|forecast_notice|program_page|funder_about|investor_about|portfolio|deal_news|awardee_list|cohort_announcement|directory|news|blog|report|event|other",
  "about": "nombre del programa, fondo u organización",
  "dates": [{ "role": "application_deadline|loi_deadline|opens|award|project_start|posted|other", "date": "AAAA-MM-DD o null", "estimated": false, "quote": "literal" }],
  "date_missing_next": "qué abrir para encontrar la fecha si no está, o null",
  "criteria": { "<id>": { "verdict": "yes|no|unknown", "quote": "literal o null", "reason": "una frase" } },
  "candidate": true,
  "lead": { "kind": "funding_news|awardee_list|cohort|portfolio|other", "funder": "…", "recipient": "…", "amount": "… o null", "quote": "literal", "next": ["qué buscar a partir de esta pista"] }
}
```

Catálogo de criterios (`<id>`): grant y sponsorship = `deadline`, `eligibility`, `region`, `entity_type`, `stage`, `topic_fit`, `non_dilutive`, `official`. Investment = `region`, `entity_type`, `stage`, `topic_fit`, `recent_activity`, `contact_route`. Los seis primeros ya existen en `judge/prompts.v13.mjs` (`CRITERIA`); se añaden `non_dilutive`, `official`, `recent_activity`, `contact_route` con su texto de ayuda, sin reglas de código.

El código: `date` debe estar en `quote` y `quote` en la página (`verifyDate`, `audit.v13.mjs:18`); un `yes` sin cita literal pasa a `unknown`; un `lead` sin cita literal no se guarda. Ninguna regla nueva de texto.

## 6. Juez

- Solo finalistas: páginas con `candidate: true` y ningún criterio en «no» con cita literal. Una llamada por finalista con `judgePrompt` (v13.1) y el catálogo de §5; las afirmaciones del agente entran como `compiler_claims` salvo `ENGINE_JUDGE_BLIND=1`.
- Auditor: `auditPage` (`audit.v13.mjs:65`) con `compilation` = assessment del agente normalizado y `judgment` = juez. Estado y días por código.
- Cuántas llamadas bastan: no medido. F2 hace una segunda llamada ciega a los primeros 10 finalistas y registra cuántos veredictos cambian. Si cambian ≤ 1 de 10, basta una llamada; si cambian más, el informe lo dice y se queda en una llamada hasta que Gisel decida.
- Juez fuera de servicio o JSON inválido dos veces: el finalista queda «a verificar» (no «verificado»), como en V13 (`failClosed`).

## 7. Salida

- `findings`: finalistas que pasan juez + auditor, con el mismo formato que hoy (`engineLeads` no cambia).
- `leads` (pistas, respuesta 4 de C0): `{id, kind, funder, recipient, amount, quote, url, found_at_step, followups[step], produced[ref]}`. Se muestran aparte y alimentan la búsqueda vía `from_lead`.
- `audit.agent`: pasos, llamadas por herramienta, tokens, segundos, créditos, USD, motivo de parada, preguntas, supuestos.

## 8. Mapa de migración

| Pieza nueva | Reemplaza (con `ENGINE_AGENT=1`) | Archivo nuevo o cambio |
|---|---|---|
| Bucle | `runObjective`: `planQueries`, rondas, `followUpQueries`, `researcher.mjs`, `expansion.mjs` (`engine.mjs:219–560`) | `server/research/agentic/loop.mjs` (nuevo, tope 350 líneas); en `engine.mjs` una rama `if (env.ENGINE_AGENT === '1') return runAgentObjective(...)` |
| Herramientas | llamadas sueltas a `multiSearch`, lectores, Apollo en `pipeline.mjs`, `grantSources.mjs`, `lateral.mjs` | `server/research/agentic/tools.mjs` (nuevo, tope 250) |
| Contratos y prompts | `readPrompt`, `CALL_KEYS` (`engine.mjs:108–111`), `compilerPrompt` | `server/research/agentic/contracts.v14.mjs` (tope 120), `prompts.v14.mjs` (tope 150) |
| Juicio por página | `verifyFinding`, `verifyOpportunity`, `verifyInvestor`, `classifyPage`, `checkApplicant`, `deadlineDecision` | ninguno: el assessment del agente + juez + `auditPage` |
| Pistas | descarte `not_a_call:news`, `not_a_call:cohort`, `wrong_kind:deal_news`, agregador sin leer | `leads` en la salida |
| Registro | `traces` truncadas a 160 | `server/research/trace.mjs` (F1, tope 150), lo usan el motor actual y el bucle |
| Fecha de hoy | `today` como texto o `Date` según el llamador | `dayOf`/`asDate` en `core.mjs`, usado por `lateral.mjs` |

Total nuevo previsto: ≤ 1.020 líneas.

Qué queda sin uso en el camino del motor con la bandera encendida, y quién más lo importa (medido con `graph.mjs`, sin contar pruebas):

| Archivo | Líneas | Otros importadores |
|---|---|---|
| `pageType.mjs` | 89 | `investor.mjs`, `researcher.mjs`, `verify.mjs` |
| `investor.mjs` | 119 | `engine.mjs` |
| `researcher.mjs` | 117 | `engine.mjs` |
| `expansion.mjs` | 47 | `engine.mjs` |
| `lateral.mjs` | 85 | `expansion.mjs` |
| `applicant.mjs` | 213 | `server/analysis/eligibility.mjs`, `core.mjs`, `engine.mjs`, `investor.mjs`, `runAudit.mjs`, `verify.mjs` |
| `dates.mjs` | 361 | 8 de `server/`, `agent/validity.mjs`, `eval/regression/mentiva-grants.mjs` |
| `verify.mjs` | 272 | 13 de `server/`, 4 de `agent/`, 2 scripts, 2 de `eval/` (usan `hostOf`, `literalIn`, `hostKind`) |
| `grantMatch.mjs` | 215 | `core.mjs`, `scripts/grants-recheck.mjs` |

Se reutilizan y no salen: `judge/` (327), `readOpportunity.mjs` (`pageExcerpt`), `engineLeads` y `runEngine` de `engine.mjs`. Cuántas líneas se pueden quitar de verdad no está medido: depende de que `pipeline.mjs`, `orchestrator.mjs` y `agent/` dejen de importarlas. F3 solo propone quitar un archivo cuando `graph.mjs` muestra 0 importadores fuera de pruebas, y siempre con la firma de §F3.0 del plan.

## 9. Alternativas descartadas

| Alternativa | Motivo, con cifra |
|---|---|
| Seguir con V13 (compilador + juez por página dentro del flujo fijo) | 0 verificadas en 22-44 y 23-09; el código siguió decidiendo el tipo de página en 29/77 y 80/160 páginas no se leyeron; no sigue enlaces ni pistas |
| Usar `agent/` del banco tal cual | sus criterios de fecha y ruta siguen en código (`codeEval`, `validity.mjs` usa `deadlineDecision`); depende del formato de casos del banco; 3.186 líneas. Se toman la idea de presupuesto y el registro por pasos |
| Ampliar `researcher.mjs` | todo lo que abre pasa por `verifyFinding`: decide el código; en 23-09 paró con 0 acciones |
| Solo quitar la lista `AGGREGATORS` | se leerían 41–43 páginas más por corrida, pero `pageType.mjs` descarta noticias y cohortes; no resuelve seguir la pista |
| Una sola llamada larga con todas las páginas | sin enlaces ni búsquedas nuevas; 80 páginas × 12.000 caracteres no caben en el contexto del modelo servido |
| Ajustar un modelo con ejemplos | no hay referencia etiquetada todavía (0 filas) |

## 10. Riesgos y la cifra que los refutaría

| Riesgo | Se mide en | Cifra que indica el problema |
|---|---|---|
| El agente repite búsquedas o da vueltas | `events.jsonl` | > 20 % de búsquedas repetidas (texto normalizado) o > 8 pasos seguidos sin página nueva |
| JSON inválido del agente | `summary.json` | > 10 % de pasos inválidos tras el reintento |
| Coste y tiempo | `summary.json` | segundos > 2 × F1, o Exa > 0,50 USD por caso, o Apollo > 25 créditos por caso |
| El agente acepta convocatorias cerradas o no elegibles | referencia manual | más falsos positivos entre verificadas que F1 sobre las mismas URLs etiquetadas |
| El agente descarta convocatorias válidas | referencia manual | menos verdaderos positivos que F1 sobre las URLs etiquetadas |
| Juez sin independencia (mismo modelo) | segunda llamada ciega y referencia | acuerdo agente-juez 100 % con ≥ 1 error del juez frente a la referencia |
| Inyección desde la página | `rejected_ref` | cualquier `rejected_ref` con un URL en los argumentos |
| Las pistas no producen nada | `leads[].produced` | 0 finalistas con `from_lead` en los dos casos |
| El paso 0 no detecta las contradicciones del brief | `agent.understand/1` | ninguna duda sobre `product` ni sobre `stage` en el caso IGC |
