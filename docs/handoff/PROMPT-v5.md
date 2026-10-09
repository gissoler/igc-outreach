# Prompt — v5: menos fetches inútiles y ronda extra de profundización, luego las 90 corridas

Eres el implementador en `/Users/gcaicedo/Documents/PROJECTS/AGENT` (rama `main`). Responde en español. Lee primero `docs/handoff/V4-SMOKE.md` (iteración 4), `FIX_SPEC-investors-v4.md` §4–§5.3, `PROMPT-v4.md` y `DECISIONS_PENDING.md` (13–17).

## Problema medido (smoke DBG-4, semilla 101, D1–D3)
* Rechazadas/fetches = 0,789 (límite 0,75): ~79 de cada 100 páginas abiertas no son inversores (noticias, listas, directorios).
* Criterios SECTOR+STAGE+GEO+TYPE ≠ unknown a la vez: 20,0 % (meta 60 %). Por criterio: sector 57,1 · etapa 62,9 · geografía 71,4 · tipo 94,3.
* D2/B2 sin gain ≥ 2: Industrifonden (sector unknown) y Purple Orange (geografía unknown) quedan `weak`. D3/B2 se abstiene por `insufficient_evidence` (5 firmas sin geografía).
* El enriquecimiento actual (v4) hace 1 búsqueda por firma, máx. 4 por corrida, y abre una página propia: encontró algo útil en 4 de 10 intentos.

## Reglas inviolables
No relajar extractor ni juez. No cambiar gold, etiquetas, `decide.mjs`, `ranking.mjs`, configs v0–v4, prompts congelados ni umbrales. No depurar con los 15 casos oficiales: solo D1–D3. No inventar datos: un criterio solo deja de ser `unknown` con cita literal verificable en texto que el sistema leyó. No etiquetar firmas. Sin claves en logs/commits. NO push, no borrar archivos. Commits sin `Co-Authored-By` ni `Claude-Session`, uno por cambio, título `V5-<n>: …`. Todo lo nuevo va en **config v5** (`config/v5-2026-10-09.json`, copia de v4 con `status: draft`) y prompts/schemas con sufijo nuevo; v4 no se edita. Si algo no está aquí ni en el spec, anótalo en `docs/handoff/QUESTIONS-v5.md` y no lo inventes.

## Cambio 1 — Buscador Exa según su guía de buenas prácticas (https://exa.ai/docs/search/best-practices)
Hoy `search-failover.mjs` fuerza `EXA_SEARCH_TYPE: 'instant'` (el modo de menor calidad, pensado para latencia). Con config v5:
1. `type: "auto"` (no `instant`) para Exa, con `contents.highlights` y `contents.text.maxCharacters` = 4000. Mantén el respaldo de `FIX-11b` (texto del buscador si el fetch sale vacío).
2. Consultas del planner y de las plantillas B0 en **lenguaje natural describiendo la página buscada** ("venture capital firm investing in seed-stage edtech startups in Chile and Peru"), no bolsas de palabras. Si hace falta un prompt de planner nuevo, créalo como `planner/v3` sin tocar v1/v2.
3. Usa `includeDomains` solo como restricción dura (en la Ronda de profundización, abajo). No uses `site:` en la consulta.
4. No mezcles `livecrawl` con `maxAgeHours`; usa solo los nombres de parámetro vigentes de la guía. Verifica contra la documentación y la respuesta real que `category` u otros filtros existen antes de usarlos; si no puedes verificarlo, no los uses y anótalo.
5. Cambia `exaSearchApi` solo bajo flags de entorno/config nuevos; producción no cambia si no se pasan.

## Cambio 2 — Triage previo al fetch (bajar rechazadas/fetches sin cambiar la métrica)
Antes de gastar un fetch, puntúa cada resultado con lo que ya trae el buscador (URL, título, highlights/texto): descarta o baja de prioridad rutas y títulos típicos de noticia, lista, ranking, directorio, perfil de agregador o blog (`/news/`, `/blog/`, `/press/`, "top 10", "best…", "list of…", "directory") salvo que el host sea ya una firma conocida. Sube de prioridad hosts de firma y páginas `about`, `strategy`, `investment-focus`, `portfolio`. Reglas: es heurística determinista y registrada en el evento `search_end` (qué se descartó y por qué); un resultado descartado **no** cuenta como fetch ni como rechazada, pero la definición de la métrica `rejected_non_investors/fetches` NO cambia y se reporta igual. Prueba con dependencias simuladas: una lista "Top 20 VCs in Chile" no se abre; el sitio de una firma sí.

## Cambio 3 — Ronda extra de profundización ("rascar") por firma con datos faltantes
Sustituye el enriquecimiento de v4 por esta ronda, activada por `config.deepening.enabled`:
1. **Disparo:** toda firma aceptada con `INV-SECTOR`, `INV-STAGE`, `INV-GEO` o `INV-TYPE` en `unknown` (o actividad `unknown`), ordenadas por potencial (primero las que tienen sector `on|partial` y tipo conocido), hasta `deepening.max_firms_per_run`.
2. **Descubrimiento de páginas propias:** (a) búsqueda Exa con `includeDomains:[official_domain]` y consulta natural que pregunte justo lo que falta ("<firma> investment criteria: stages, sectors and geographies they invest in"); (b) enlaces internos de la portada y rutas habituales (`/about`, `/strategy`, `/investment-focus`, `/focus`, `/team`, `/portfolio`, `/approach`, equivalentes en es/pt) y `sitemap.xml` si el lector lo devuelve; todo dentro del dominio oficial.
3. **Lectura y reextracción:** abre hasta `deepening.max_fetches_per_firm` páginas propias, pásalas por el extractor v3 existente y **fusiona** por campo: un campo `unknown` pasa a conocido solo con cita literal verificada (misma verificación de `v4_check`); un campo ya conocido no se sobrescribe; si hay contradicción, se registra y gana la fuente propia más reciente.
4. **Parada:** cuando los cuatro criterios núcleo están conocidos, o se agota el tope por firma. Si tras la ronda un campo sigue sin dato publicado, queda `unknown` (nunca `not_met` inventado).
5. **Presupuesto:** la ronda tiene su propio tope declarado en config v5 (`deepening.max_firms_per_run`: 8, `max_queries_per_firm`: 2, `max_fetches_per_firm`: 4), además de los topes de descubrimiento de v4 (18 búsquedas, 54 fetches, 300k tokens). Cuenta y reporta aparte: búsquedas, fetches, tokens y firmas profundizadas. **Esto cambia el presupuesto frente a v3/v4: regístralo como entrada 18 en `DECISIONS_PENDING.md` (sin aprobación) y no la presentes como aprobada.**
6. Eventos nuevos `deepening_start/_end` con firma, campos faltantes antes/después y URLs. Añade `deepening` a `v2_stats` (schema `.v3` nuevo, sin editar el v2).
7. Pruebas con dependencias simuladas: firma con sector desconocido en portada y sector en `/strategy` → el campo se llena con cita literal de esa página; página sin el dato → sigue `unknown`; el tope por firma se respeta; sin `deepening.enabled` el comportamiento es idéntico a v4.

## Fase de depuración (solo D1–D3, máximo 3 iteraciones `V5-DBG-n`)
Corre el smoke (B1 y B2 × D1–D3 × semilla 101) con `ITER=v5dbg1 SKIP_P15=1 bash research/bench/investors/run-v4-debug.sh` apuntando a config v5 (copia el script como `run-v5-debug.sh`; no edites el de v4). Preflight del lector primero (`preflight-reader.mjs`; Docker/Crawl4AI en el Mac). Criterios de aceptación del smoke, sin cambiar umbrales:

| Criterio | Umbral |
|---|---|
| 4 criterios núcleo ≠ unknown en firmas aceptadas | ≥ 60 % |
| Al menos uno ≠ unknown | ≥ 85 % |
| Citas literales verificadas | 100 % |
| D1 y D2 con ≥ 1 gain ≥ 2 en B2 | sí, ambos |
| D3: 0 gain ≥ 2 y `abstention_reason` ∈ {no_candidates, all_hard_not_met} | sí |
| FETCH_EMPTY | ≤ 10 % |
| rechazadas/fetches | ≤ 0,75 |
| Revisión manual de las 5 primeras firmas de D1/B2, D2/B2 y todo gain ≥ 2 de D3 | sin fallos de identidad ni de criterio duro |

Documenta cada iteración en `docs/handoff/V4-SMOKE.md` (sección V5) con la causa medida. **Si tras 3 iteraciones el smoke no cumple, detente: no corras las 90, escribe el diagnóstico con números y pásalo a la Fase 5.** No bajes umbrales ni cambies reglas para que pase.

## Congelar y pausa obligatoria
Si el smoke cumple: pasa v5 a `status: frozen`, genera `out/<bench_id>/fingerprint.json` (sha256 de config v5, manifiesto, prompts, esquemas, `normalization.v1.json`, `extractor/judge/engine/normalize/resolve/deepening`.mjs, casos y gold) y corre los tests (`test:investors`, el v4 y el nuevo de v5; ACC-58 falla solo por la ruta de git de macOS). **Detente y pide aprobación de la entrada 18 (presupuesto de profundización) antes de las 90 corridas.** Es la única pausa.

## Corridas formales (tras aprobación)
15 casos (p01–p12, n04, r13, r14) × B1 y B2 × semillas 101/202/303 = 90 corridas, una sola vez:
`node --env-file=.env --env-file-if-exists=.env.crawl4ai research/bench/investors/run-experiment.mjs --config research/bench/investors/config/v5-2026-10-09.json --cases research/bench/investors/cases --out research/bench/investors/out/<bench_id> --conditions B1,B2 --seeds 101,202,303 --concurrency 3`
Si una corrida falla por infraestructura, repórtalo y relánzala tal cual, sin tocar código. Apollo/B3: 0.

## Después
1. Métricas sin etiquetas (FIX-15, `analysis/v4_check.mjs` adaptado a v5): núcleo, ≥1 conocido, citas, casos positivos con gain ≥ 2 en ≥ 2 de 3 semillas (meta ≥ 10/12), nulos (0 gain ≥ 2, abstención válida ≥ 80 %, `insufficient_evidence` ≤ 20 %), rechazadas/fetch, FETCH_EMPTY, tokens y tiempo (incluye la ronda de profundización por separado).
2. Pool v4/v5 = unión de top-20 menos `gold/v3`; hojas ciegas con `analysis/make_sheets.mjs` (sin condición, semilla, rank ni salida del juez). **No etiquetes.** Informa cuántas firmas faltan.
3. `REPORT.md` en la carpeta EVID-v4 y copia en `docs/handoff/V4-REPORT.md`: consolidación, tabla de cambios, smoke y revisión manual, criterios con valor/umbral/cumple, métricas pendientes de etiquetas, costo real, y causa medida (con `run_id` y evento) de cada criterio que no cumpla. La decisión de `decide.mjs` (B2−B1 recall@20 ≥ 0,05 con p ≤ 0,05, nDCG ≤ 0,03, falsos positivos duros ≤ 0,10) solo se calcula cuando existan las etiquetas nuevas. Sin adjetivos, solo números; no declares éxito si algo no cumple y di explícitamente lo que no pudiste verificar.

Reporta cada fase en 5 líneas y detente si una falla su criterio de aceptación.
