# PROMPT v14 · para CODEX (ejecución) · agente primero, trazas completas y limpieza de código

Quién hace qué: Claude analizó y escribió este plan. Codex lo ejecuta. Claude no escribe código en esta ronda.
Reglas vigentes: todo en español, texto plano, solo cifras, sin adjetivos. No leer ni imprimir claves de `research/.env`. Exa solo con script de un comando, con dry run y tope de 5 USD (`analysis/exa_spend.mjs --usd-per-call 0.0089`). Commits SIN Co-Authored-By ni Claude-Session, un commit por tarea. No tocar la flota compartida de g355 (puertos 8000–8005). No editar `research/scripts/g355-*`, `run-mac.sh`, `tunnel-g355.sh` (los lleva GPT). `research/data/prod-research.sqlite`: solo lectura, solo `jobs` y `sources`, no se commitea.
Archivos congelados (config v5, manifest.v5, normalization.v1, extractor.mjs, judge.mjs, engine.mjs del banco, normalize.mjs, resolve.mjs, deepening.mjs, prompts v5, run-experiment*.mjs, gold/, cases/, todo .v7/.v8): no se editan ni se borran sin que Gisel lo apruebe por escrito en la Fase 0.

## Por qué (decisión de Gisel, 13/10)

1. El 90 % del trabajo de búsqueda lo hace el agente, como lo hacen Claude o Gemini: planifica, busca, abre páginas, lee, decide, sigue enlaces, sabe cuándo parar. El código ofrece herramientas, límites de presupuesto y registro. No decide qué es una página, ni qué fecha es de cierre, ni si un financiador sirve.
2. Las fechas nunca debieron estar en el código: el formato cambia, y a veces la fecha no está en la página y hay que dar más clics. Lo mismo vale para tipo de página, tipo de solicitante, región y etapa.
3. Una noticia de que una empresa del sector levantó dinero o ganó un grant es una pista: el agente debe razonar «quién la financió, quiénes más financian esto, qué sectores vecinos aplican» y usar Apollo o búsqueda por financiador. Hoy esas páginas se descartan (lista fija de agregadores en `verify.mjs`) o se tiran como `not_a_call:news`.
4. Menos código, no más. Cada condición añadida por un caso es deuda.

## Medido hoy (13/10, no se asume nada más)

- `research/server/research/*.mjs` + `judge/`: 10.783 líneas. `research/server/` completo: 14.526 líneas en 75 archivos. `research/agent/`: 2.974 líneas. `research/bench/`: 8.361 líneas en 110 archivos. `research/tests/`: 9.604 líneas en 85 archivos. `research/scripts/`: 1.008 líneas en 21 archivos.
- Candidatos a decisión por patrones, por tamaño: `dates.mjs` 361, `applicant.mjs` 213, `pageType.mjs` 89, `verify.mjs` 272 (listas `AGGREGATORS`, `AGGREGATORS_EXTRA`, `SOCIAL`), `investor.mjs` 119, `grantMatch.mjs` 215. Que sean candidatos no prueba que sean código muerto: hay que medirlo (Fase 0).
- Hay tres líneas de motor: producto (`server/research/engine.mjs`, `runObjective`, un solo motor para los cinco objetivos), agente iterativo (`research/agent/`, usado por el banco) y `bench/investors/`. Grants e inversionistas comparten motor, búsqueda y lectura en el producto; solo cambia el verificador (`verifyFinding`).
- Corrida `eval/runs/2026-10-13-23-09-v13-jefe-2` (brief IGC, objetivo grant, modelo 30B): 80 páginas leídas, 80 llamadas al compilador y 80 al juez, 539 s, 0 verificadas, 53 páginas descartadas como agregador sin leer, expansión con 0 semillas (solo parte de páginas ya verificadas), error de OpenAlex `today.getUTCFullYear is not a function` (la fecha llega como texto).
- Causa de 45 de 80 razonamientos del juez que hablan de publicidad: el brief que veían no incluía `oneLiner`. Corregido en el commit 8d56031.
- V13 (compilador + juez + auditor) ya existe en `research/server/research/judge/` detrás de `ENGINE_JUDGE=1`. Roles y puertos: juez gpt-oss-120b en 127.0.0.1:8016, compilador Qwen3-30B en 127.0.0.1:8017 (el 235B se apagó). Ver `docs/handoff/V13-DESPLIEGUE.md` y `V13-CAMBIOS.md`.
- Literatura consultada (solo lo que encontré, sin trabajos sobre este flujo exacto): rastreo dirigido que sigue enlaces según la página de origen (Chakrabarti 2002, falsos positivos −30 % a −90 %); recomendación de inversionistas a partir de eventos de inversión (arXiv 1912.02962, 34.469 eventos); juicio por criterio con etiqueta «sin información suficiente» (TrialGPT, 87,3 % en 1.015 pares); separación detectar fecha con modelo y normalizarla anclada a la fecha del documento (TimeNorm 78,99 frente a HeidelTime 74,64). No es respaldo para borrar toda comprobación: es lo que hay.

## Diseño objetivo (propuesta; Codex lo confirma o lo refuta con medición en la Fase 1)

Bucle del agente, igual para grants e inversionistas, con el brief y la fecha de hoy:
1. El modelo planifica consultas y herramientas. Herramientas expuestas: `search(query)`, `open(url)` (texto de la página y sus enlaces), `apollo(...)` y búsqueda por financiador/empresa, `registry` (OpenAlex, EDGAR), `note(lead)`, `finish()`.
2. En cada página el modelo devuelve su razonamiento corto, qué es la página (convocatoria, aviso previo, noticia/evento de inversión, directorio, programa), las fechas con su rol y cita, la elegibilidad por criterio con cita, y qué hace después (seguir enlace, abrir otra ruta del sitio, convertir en pista, descartar). Si falta la fecha, el modelo decide dar más clics; el código no lo hace por él.
3. Una noticia de ronda o grant concedido produce una pista (empresa, financiador, monto, cita) y el agente decide si buscar a ese financiador, sus coinversores o sectores adyacentes donde el producto pueda acomodarse. Las pistas no se muestran como convocatorias ni como inversionistas verificados.
4. El juez (120B) valida solo a los finalistas que el agente propone, no a cada página leída. Hoy son 80 llamadas por corrida; el objetivo es medir cuántas bastan.
5. Lo que el código conserva, cada uno con su razón: (a) pasar al modelo la fecha de hoy; (b) restar días con una línea de código, porque el modelo falló la resta (devolvió `upcoming` con cierre 2026-10-06 siendo hoy 2026-10-12); (c) comprobar que la cita esté literal en la página, contra invención; (d) validar el JSON de cada llamada y tolerar fallos sin terminar la corrida; (e) topes de llamadas, páginas, tiempo y créditos (Exa, Apollo, Firecrawl); (f) registrar todo. Cualquier otra regla que Codex quiera conservar se justifica con un caso medido y se anota en `V14-DECISIONES.md`.
6. Falla cerrado: lo que el modelo no pudo respaldar con cita no entra a la lista principal.

## Tareas

F0 · Inventario y medición, sin cambiar código. Gráfica de llamadas desde los puntos de entrada reales (`server/research/pipeline.mjs`, `scripts/engine-run.mjs`, servidor HTTP, `research/agent/` y sus scripts) para listar cada archivo y función alcanzable y cada una inalcanzable. Por archivo: líneas, quién lo importa, si lo ejecuta alguna prueba, si decide un criterio por patrones. Salida: `docs/handoff/V14-INVENTARIO.md` con tabla y tres listas: borrar, reemplazar por el agente, conservar. Más la lista de archivos congelados que estorbarían, para que Gisel apruebe o no moverlos a `research/_archivo/` con `git mv`. Línea base: `node --test tests/*.test.mjs` y `tests/agent/*.test.mjs` (referencia V13: 485 pruebas, 483 pasan, 1 falla Apollo, 1 omitida; agente 191, 190 pasan, 1 falla ACC-58 por la ruta de git del Mac). Parar aquí y esperar el visto bueno de Gisel.
F1 · Corrida de traza única (ver abajo). Es la prueba que Gisel pidió. Se hace antes de rediseñar, con el motor actual y `ENGINE_JUDGE=1`, para tener la referencia con trazas completas.
F2 · Agente primero. Implementar el bucle del diseño objetivo detrás de la bandera `ENGINE_AGENT=1`, apagada por defecto, reutilizando `fleet.mjs` y los contratos v13 donde sirvan. Un solo módulo de bucle, herramientas con interfaz mínima. Sin patrones de fechas, de tipo de página, de región ni de solicitante. Repetir F1 con la bandera y comparar.
F3 · Limpieza. Con el resultado de F2 y la aprobación de Gisel, quitar lo inalcanzable y lo reemplazado. Un commit por archivo o grupo, con la suite igual o mejor que la línea base antes y después de cada commit. Los congelados solo se mueven si Gisel lo aprobó.
F4 · Informe `docs/handoff/V14-CAMBIOS.md` (líneas antes y después por directorio, cifras de F1 y F2, qué no se midió) y nota corta para el vault Outreach (carpeta `Outreach/Código/`, número siguiente al 18).

## F1 y F2: la prueba de traza única

Dos casos, no 18 startups:
- Grant: `eval/briefs/jefe-igc-mint-ad-2026-10-12.json`, `--objectives grant`, `--today 2026-10-12`, `--no-cache`.
- Inversionistas: el mismo brief con `--objectives investment`. Si Gisel prefiere otro brief para inversionistas, lo pone en `eval/briefs/` antes de correr; Codex no inventa uno.
Un solo script (extender `scripts/engine-run.mjs` o crear `scripts/trace-run.mjs`; no un tercero) que escriba en la carpeta de la corrida:
- `events.jsonl`: una línea por evento, con marca de tiempo, tipo y duración. Eventos: cada llamada a modelo (rol, modelo, versión de prompt, tokens de entrada y salida, ms, salida completa o su ruta), cada llamada a herramienta (nombre, argumentos, número de resultados, ms, coste en USD o créditos), cada página (URL, cómo se obtuvo, caracteres), cada decisión del agente (qué dijo, razonamiento, qué hizo después), cada descarte (motivo y quién lo decidió: modelo o código, con la regla), cada pista y qué se hizo con ella.
- `pages/`: texto de cada página leída que alimentó una decisión (para poder repetir sin red), tope de tamaño total anotado.
- `report.md`: resumen con las tablas actuales más tres nuevas: razonamiento por página (como `scripts/judge-report.mjs`), pistas y qué se hizo con ellas, y coste y tiempo por herramienta y por modelo.
- `summary.json`: totales (páginas, llamadas por rol, ms por rol, USD por proveedor, verificadas, pistas, descartes por motivo y por quién decidió).
Debe poder responder, sin abrir código: por qué se descartó la página X, quién lo decidió, qué hizo el agente después de una noticia de inversión, cuántos clics extra dio para encontrar una fecha, cuánto costó y tardó cada paso, y qué vio finalmente el usuario.
Presupuesto de la corrida: Exa dentro de los 5 USD con dry run previo. Apollo con un tope en créditos que Gisel fija antes (pregunta abierta 2).
Criterios de aceptación de F1/F2 (cifras, comparadas con la corrida `…23-09-v13-jefe-2`: 80 páginas, 160 llamadas, 539 s, 0 verificadas):
1. El log contiene, para el 100 % de las páginas descartadas, el motivo y quién lo decidió.
2. Ningún aviso previo (`forecast`) sale como abierto ni con días restantes.
3. Ninguna decisión se apoya en una cita que no esté en la página.
4. Las noticias de inversión o de grant concedido generan pistas; se reporta cuántas y qué hizo el agente con cada una.
5. Con `ENGINE_AGENT=1` se reportan llamadas al juez, llamadas al compilador, segundos y verificadas, junto a la línea de arriba. Si el agente no supera a la línea base en verificadas correctas, se dice.
6. Un JSON inválido o un modelo caído no termina la corrida ni mete nada a la lista principal.
No hay criterio de «verificadas ≥ N»: no existe referencia manual. Ver pregunta 3.

## Preguntas abiertas para Gisel (Codex no decide estas)

1. ¿Se aprueba mover archivos congelados a `research/_archivo/` si F0 muestra que estorban? Sí o no, archivo por archivo.
2. Tope de créditos de Apollo para las dos corridas de F1/F2.
3. Para medir verificadas correctas hace falta una referencia hecha a mano: etiquetar entre 50 y 100 páginas (brief IGC) con veredicto por criterio, como TrialGPT con 1.015 pares. ¿Quién etiqueta y cuándo? Sin eso, las cifras de «verificadas» no distinguen aciertos de errores.
4. ¿Las pistas se muestran en una lista aparte («pistas de financiadores») o solo alimentan la búsqueda?
5. Producto: el campo `product` del brief de prueba dice «mint ad» y no menciona Alzheimer; solo `oneLiner` lo explica. ¿Qué debe pedir el intake para que `product` quede claro?

## Entregables

`V14-INVENTARIO.md` (F0), `events.jsonl` + `report.md` + `summary.json` + `pages/` en las dos carpetas de corrida, `V14-DECISIONES.md` (cada regla de código que se conserve, con su caso), `V14-CAMBIOS.md`. No afirmar nada que no esté medido. Una decisión de producto sin respaldo se deja como pregunta.
