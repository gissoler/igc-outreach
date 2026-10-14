# V14 · C3 · Benchmark pre-registrado (13/10/2026)

Se escribe antes de correr nada. Lo que no esté aquí no se usa para decidir. Los cambios posteriores van en una adenda con fecha y motivo, nunca reescribiendo esta página.

## 1. Casos

| Caso | Brief | Comando base (en `research/`) |
|---|---|---|
| grant | `eval/briefs/jefe-igc-mint-ad-2026-10-12.json` | `node --env-file-if-exists=.env scripts/engine-run.mjs --brief eval/briefs/jefe-igc-mint-ad-2026-10-12.json --objectives grant --today 2026-10-12 --no-cache --trace --out eval/runs/v14-<fase>-grant` |
| investment | el mismo brief (Gisel no dio otro; C0) | igual con `--objectives investment` y `--out eval/runs/v14-<fase>-investment` |

Variables en la línea de comandos (sin leer `.env`): `ENGINE_LLM_URL=http://127.0.0.1:8017/v1 ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507`, las de compilador y juez de `V13-DESPLIEGUE.md` (líneas 124–133) y `ENGINE_JUDGE=1`. F2 añade `ENGINE_AGENT=1 ENGINE_AGENT_LLM_URL=http://127.0.0.1:8016/v1 ENGINE_AGENT_LLM_MODEL=openai/gpt-oss-120b ENGINE_JUDGE_BLIND=1` y los topes de `V14-ARQUITECTURA.md` §2. Apollo solo en F2, tope 25 créditos por caso. Una corrida por caso y fase (decisión 4 de Gisel). Con una corrida no hay varianza medida: diferencias de 1–2 páginas no se interpretan.

`--trace` lo añade F1 (`scripts/engine-run.mjs`). `NODE_V8_COVERAGE=eval/runs/v14-<fase>-<caso>/coverage` en las cuatro corridas.

## 2. Qué escribe cada corrida

```
eval/runs/v14-<fase>-<caso>/
  events.jsonl      una línea por evento, esquema eval/v14/events.schema.json (trace/1)
  summary.json      cifras, plantilla eval/v14/summary.plantilla.json (summary/1)
  report.md         generado desde summary.json y events.jsonl
  pages/<sha256>.txt  texto exacto que vio el modelo de cada página abierta (la primera vez que se abre)
  coverage/         salida de NODE_V8_COVERAGE
  result.json       el de hoy, sin cambios (compatibilidad con drops.mjs y judge-report.mjs)
```

Eventos (detalle en el esquema): `run_start` (brief completo y su sha256, hoy, banderas, modelos por rol, versión de prompt por rol, commit, topes), `understand` y `brief_patch` (solo F2), `model_call` (rol, modelo, versión de prompt, tokens de entrada y salida, ms, válido o no, reintento, página), `tool_call` (herramienta, argumentos, número de resultados, ms, USD, créditos, error, `from_lead`, `rejected_ref`), `page` (ref, URL, host, título, vía de lectura, caracteres, sha256, ruta en `pages/`, herramienta y consulta o ref que la trajo, leída o no), `decision` (página, quién: `agent`, `judge`, `auditor`, `reader`, `compiler` o `code:<archivo>#<función>`, tipo de página, fechas con rol y cita, criterios con veredicto y cita, días restantes, siguiente acción), `drop` (URL, motivo, quién lo decidió, leída o no), `lead` y `lead_followup`, `ask_user`, `budget`, `finish`, `run_end`.

En F1 el motor actual no tiene agente: `decision.by` y `drop.decided_by` se llenan con el archivo y la función que hoy deciden (tabla (b) de `V14-DIAGNOSTICO.md`). El registro no cambia decisiones: una prueba compara `findings` con y sin registro sobre los fixtures existentes.

## 3. Preguntas que el registro debe responder sin abrir código

Cada una con la consulta que la responde (`jq` o `node eval/v14/ask.mjs <dir> <n>`, script de F1).

1. ¿Qué páginas vio el sistema y de qué herramienta o consulta salió cada una? (`page.found_by`)
2. ¿Cuáles leyó, cuáles no y por qué no? (`page.read`, `drop` con `read: false`)
3. Para cada descarte: motivo y quién decidió. (`drop.reason`, `drop.decided_by`)
4. Para cada fecha mostrada: rol, cita, página y días contra hoy. (`decision.dates`, `decision.days_left`)
5. Para cada criterio de cada finalista: veredicto y cita del agente o lector, del juez y del auditor. (`decision` por página y `by`)
6. Llamadas, tokens y ms por rol; llamadas, ms, USD y créditos por herramienta. (`summary.model_calls`, `summary.tools`)
7. Qué pistas aparecieron, qué se hizo con cada una y qué produjo. (`lead`, `lead_followup`, `tool_call.from_lead`)
8. Qué entendió, supuso y preguntó el agente sobre el brief, y qué cambió en el brief de trabajo. (`understand`, `ask_user`, `brief_patch`)
9. Por qué paró. (`finish.reason`, `budget`)
10. Qué texto exacto vio el modelo de una página. (`pages/<sha256>.txt`)
11. Qué modelo y versión de prompt produjo cada decisión. (`model_call` enlazado por `page_ref`)
12. Qué archivos y funciones del código se ejecutaron. (`coverage/`, resumen en `summary.coverage`)

Criterio de aceptación de F1: las 12 tienen respuesta en las dos corridas, con la consulta escrita en `report.md`.

## 4. Métricas y línea base

Línea base = F1 (motor actual, `ENGINE_JUDGE=1`, mismo commit que F2 salvo la bandera). Las corridas del 13/10 son referencia histórica, no línea base: ninguna tiene el juez con `oneLiner`.

| Métrica | Fuente | 23-09-v13-jefe-2 (referencia) | F1 | F2 |
|---|---|---|---|---|
| Segundos por caso | `summary.seconds` | 539 | | |
| Páginas vistas / leídas | `summary.pages` | 80 en el tope (más 583 fuera del tope y 83 redes) / 77 | | |
| Llamadas por rol (y JSON inválido) | `summary.model_calls` | compilador 80 (2), juez 80 (2) | | |
| Tokens por rol | `summary.model_calls` | no registrado | | |
| USD Exa / créditos Apollo | `summary.tools` | 0,224 / 0 | | |
| Verificadas main / verify | `summary.findings` | 0 / 0 | | |
| Descartes por motivo × quién | `summary.drops` | tabla (c) del diagnóstico | | |
| Pistas: total / con seguimiento / con finalista | `summary.leads` | 16 leídas + 5 sin leer, 0 seguimiento (contadas a mano desde `result.json`) | | |
| Búsquedas repetidas (texto normalizado) | `summary.searches` | no registrado | | |
| Pasos del agente / inválidos / `rejected_ref` | `summary.agent` | — | — | |
| Preguntas y supuestos del paso 0 | `summary.agent` | — | — | |
| Finalistas / llamadas del juez / cambios en la segunda llamada ciega | `summary.judge` | — | | |
| Con referencia manual: VP, FP, FN y acierto por criterio | `summary.gold` | — | | |

Inversionistas: no hay referencia histórica con este brief; F1 es la primera cifra.

## 5. Referencia manual (Gisel, esta semana)

Archivos:
- `research/eval/gold-etiquetado-igc.csv`: 100 filas a ciegas (sin la decisión del sistema), en orden mezclado fijo. Origen: 79 páginas leídas en 23-09-v13-jefe-2, 10 verificadas en 19-37-repro-jefe, 11 agregadores sin leer con señal de financiación en el título. Columnas fijas: `id`, `url`, `titulo`, `host`, `texto_chars`, `texto_en_cache_firecrawl`, `citas_guardadas`.
- `research/eval/v14/gold-sistema-igc.csv`: las mismas 100 filas por `id` con lo que decidió el sistema. No se abre mientras se etiqueta.
- Texto guardado: solo 10 de las 100 páginas tienen el texto en `data/firecrawl-cache.sqlite`. Las corridas del 13/10 no guardaron el texto; para las otras 90 hay citas y resumen del lector, y hay que abrir la URL. Las páginas pueden haber cambiado desde el 12/10: si la página dice otra cosa que la cita, anotarlo en `et_nota`.

Columnas a llenar (valores permitidos):

| Columna | Valores |
|---|---|
| `et_es_convocatoria` | si, no, no_se |
| `et_tipo_pagina` | call, forecast_notice, program_page, funder_about, deal_news, awardee_list, cohort_announcement, directory, news, blog, report, event, other |
| `et_fecha_cierre` | AAAA-MM-DD, rolling, sin_fecha |
| `et_cita_fecha` | texto literal de la página o vacío |
| `et_estado_hoy` (hoy = 2026-10-12) | abierta, cerrada, proxima, sin_fecha |
| `et_elegible_entidad`, `et_region`, `et_etapa`, `et_encaje`, `et_oficial`, `et_no_dilutivo` | si, no, no_se (para IGC: empresa con fines de lucro, Maryland, EE. UU.) |
| `et_es_pista` | si, no |
| `et_financiador_pista` | nombre o vacío |
| `et_veredicto` | aplicar, vigilar, descartar |
| `et_nota`, `et_quien`, `et_fecha_etiquetado` | libre, iniciales, AAAA-MM-DD |

Una pregunta aparte para Gisel, una sola vez: «¿Qué es el producto de IGC en una frase?». Su respuesta se guarda en `eval/v14/respuesta-producto-igc.txt` y sirve para puntuar el paso 0 (sí o no: ¿la frase del agente describe lo mismo?).

Cómo se usa:
1. Se mide cuando hay ≥ 50 filas con `et_veredicto` lleno. Con menos, `summary.gold` queda en `null` y F3 no empieza.
2. Positivo = `et_veredicto` aplicar o vigilar. Sistema positivo = la URL está en `findings` (main o verify). VP, FP y FN se cuentan solo sobre URLs etiquetadas.
3. URLs que F1 o F2 verifiquen y no estén etiquetadas: van a `eval/v14/gold-adenda-igc.csv` (tope 30, mismas columnas, a ciegas) para una segunda ronda de Gisel antes de comparar. Sin esa ronda se informan como «sin referencia», no como acierto ni como error.
4. Acierto por criterio: para cada página etiquetada que el sistema leyó, se compara el veredicto del criterio con la columna `et_*`; `no_se` en la referencia no cuenta. Se informa por decisor (código, lector, juez, agente).
5. Fechas: acierto = misma `et_fecha_cierre` o mismo `et_estado_hoy`.
6. Pistas: acierto de `lead` del agente frente a `et_es_pista`.
7. Script: `eval/v14/score.mjs` (F4), entrada `gold-etiquetado-igc.csv` + `gold-sistema-igc.csv` + carpeta de la corrida; salida `summary.gold` y una tabla en `report.md`.

## 6. Criterios de aceptación (cifras)

No hay umbral de «verificadas ≥ N» mientras no exista la referencia manual.

F1 se acepta si: (a) las 12 preguntas tienen respuesta en las dos corridas; (b) el 100 % de las líneas de `events.jsonl` valida contra `trace/1`; (c) el 100 % de los `drop` tiene `decided_by`; (d) la prueba de igualdad de `findings` con y sin registro pasa; (e) suite igual o mejor que la línea base (485/483/1/1 y 191/190/1).

F2 se acepta, y F3 puede empezar, si se cumplen todas:
1. Pasos inválidos del agente tras el reintento ≤ 10 % en cada caso.
2. Segundos ≤ 2 × los de F1 en cada caso.
3. Exa ≤ 0,50 USD por caso (suma de `costUsd` de exa que calcula el motor); Apollo ≤ 25 créditos por caso; V14 completo ≤ 5 USD de Exa.
4. 0 `rejected_ref` con una URL escrita por el modelo.
5. En el caso grant, ≥ 1 pista con seguimiento (`lead_followup`).
6. Con ≥ 50 filas etiquetadas: FP(F2) ≤ FP(F1) y VP(F2) ≥ VP(F1) sobre las URLs etiquetadas (incluida la adenda).
7. Suite igual o mejor que la línea base, con la bandera apagada y con la bandera encendida.

Si falta 6 porque la referencia no está, F2 se informa y F3 espera. Para inversionistas no hay referencia en V14: se informan 1–5 y 7; el código de inversionistas (`investor.mjs`) no entra en F3.

Se informan sin decidir con ellos: segunda llamada ciega del juez (cuántos de 10 cambian), preguntas y supuestos del paso 0 y su puntuación contra `respuesta-producto-igc.txt`, búsquedas repetidas, cobertura.

## Adenda 1 (13/10/2026, 19:30 hora de Bogotá) · referencia de 10 casos

Motivo: Gisel puede calificar como máximo 10 casos y pidió Excel en lugar de CSV. Se escribe antes de correr F1. Reemplaza el §5 y el criterio 6 del §6.

- Archivo: `research/eval/calificar-igc-10.xlsx`, hoja «Calificar», 10 filas con listas desplegables, sin la decisión del sistema. Las URLs y los ids están en `research/eval/v14/gold-sistema-igc-10.csv`. Los CSV de 100 filas se retiran.
- Los 10 casos: 3 pistas que hoy se tiran (Constantiam en dealroom, ganadoras MBIA/TEDCO, cohorte Techstars DC), 5 páginas que el juez descartó en 23-09 (SBIR ACL, BRAIN RM1, PRIMED-AI, Kissick, NIH tema 97) y 2 verificadas en 19-37 (STTR PA-27-102, Part the Cloud).
- Columnas: «¿Sirve para IGC?» (Sí, aplicaría · La vigilaría · No sirve · No sé), «Si no sirve, ¿por qué?» (Ya cerró · No acepta empresas con fines de lucro · No es para EE. UU. / Maryland · Tema distinto · Etapa distinta · No es una convocatoria · Otro), «¿Es una pista?» (Sí · No), fecha de cierre vista y nota. Más la frase del producto (celda D4).
- Positivo = «Sí, aplicaría» o «La vigilaría». «No sé» no cuenta.
- Criterio 6 nuevo: sobre los 10 casos, F2 no acierta menos casos que F1 (acierto = el sistema lo verifica si es positivo y lo descarta si es «No sirve»; pistas: el sistema la marca como pista si Gisel dijo «Sí»). Con 10 casos, una diferencia de 1 caso no se interpreta como mejora; se informa caso por caso.
- Se mide cuando están las 10 filas llenas. Sin ellas, criterio 6 «pendiente» y F3 no empieza.
- Lo que F1 o F2 verifiquen fuera de los 10 se informa como «sin referencia». No hay segunda ronda de etiquetado.

## Adenda 2 (13/10/2026, 21:40 hora de Bogotá) · primera corrida F2 fallida y prompt v14.2

Hecho: la primera corrida F2 de grant (`eval/runs/v14-f2-grant`, prompt `agent.v14.1`) terminó en 192 s con 1 búsqueda, 1 página abierta (un archivo de pago de thegrantportal.com con 433 caracteres) y `finish` en el paso 3. 0 verificadas, 0 pistas. Es un defecto del prompt de paso (decía «Stop when further work only repeats prior work» y no mostraba presupuesto ni páginas ya juzgadas), no una medición del enfoque.

Cambios, hechos después de ver esa corrida y antes de repetirla (no se esconde el orden):
1. Prompt `agent.v14.2`: se quita esa frase; se dice que una página sola, o un agregador o archivo de pago, nunca basta; el estado incluye `budget_left` (pasos, búsquedas, aperturas, segundos) y `judged_pages` (ref, tema, tipo, candidata, últimas 30) y `candidates`.
2. Código: el primer `finish` con 0 candidatas, menos de 5 aperturas y menos de la mitad de los pasos usados se rechaza una vez (`tool_call` con `error: refused_early`) y el bucle sigue. Es un tope de presupuesto del bucle, no una regla de contenido.
3. Prompt de comprensión: las `options` de una duda son las respuestas posibles, no etiquetas de impacto (el modelo las confundió en v14.1).
4. `summary.json`: `fase` pasa a «F2» con `ENGINE_AGENT=1`; `searches.total` cuenta consultas distintas y `repeated_normalized` solo repeticiones de la misma consulta al mismo proveedor (antes contaba una consulta enviada a 5 proveedores como 4 repetidas).

Se informan las dos corridas F2 de grant: v14.1 (fallida) y v14.2. Los criterios del §6 se evalúan sobre v14.2. Una sola corrección de este tipo está permitida; si v14.2 también falla por un defecto del bucle, se informa y se para, sin segunda iteración.

## Adenda 3 (13/10/2026, 22:30 hora de Bogotá) · modo paralelo v14.3 y tope de tiempo

Motivo: la corrida F2 v14.2 de grant tardó unos 20 minutos (tope de 1.200 s por defecto del bucle). Gisel pidió entrega en 5 minutos, 10 como máximo, con toda la capacidad del motor. En esa corrida cada decisión del modelo grande tardó entre 77 y 87 s, una apertura de página entre 4 y 7 s y una búsqueda entre 1 y 6 s (`events.jsonl`, últimos 25 eventos; no se midió el total de la corrida).

Cambios, detrás de `ENGINE_AGENT=1` y de `ENGINE_AGENT_PARALLEL=1` (apagado por defecto; sin él el bucle es el de v14.2):
1. Un paso puede abrir hasta 8 refs (`open` con `args.refs`) y lanzar hasta 4 búsquedas (`search` con `args.queries`) a la vez.
2. Cada página abierta la evalúa el modelo rápido (rol `engine`, Qwen3-30B, contrato `agent.assess/1`) en paralelo; el agente recibe un resumen por página (ref, qué es, tipo, candidata, fechas verificadas, 20 enlaces) y no el texto.
3. Juez de finalistas y segunda llamada ciega, en paralelo (hasta 8 a la vez).
4. Tiempo: objetivo 300 s; si el paso anterior añadió una candidata, sigue hasta 540 s; se reservan 60 s para los jueces. Cada llamada del bucle se corta al llegar el tope. Se devuelve lo que haya (`stop_reason: time`).
5. Sin cambios: `literalIn`, `verifyDate`, `auditPage`, presupuestos de búsquedas y aperturas, tope de Exa, rechazo del primer `finish` prematuro.
6. `runObjective` ya no lanza el agente cuando recibe `opts.queries` (llamadas extra del pipeline); esas usan el motor anterior.

La corrida F2 de inversionistas con v14.2 (secuencial) ya estaba en marcha con el commit 33c5769 cuando se escribió esto. Los criterios del §6 se evalúan sobre las corridas v14.2. La corrida v14.3 se informa aparte, con la misma medición y los mismos criterios, y con la etiqueta «v14.3, no pre-registrada antes de v14.2».
