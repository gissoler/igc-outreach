# Capa de análisis de IGC Outreach: implementada (27-sep-2026)

**Qué se hizo.** Se construyó el código de los módulos 1, 2, 3, 5 y 6 del Prompt 2, en el orden de la estrategia v3: primero el pilar A (deals y momento), luego B/C (resultados propios y de la red). El Módulo 4 (escucha social) no se construyó. También se agregó la pestaña **Análisis** en la app.

**Qué NO se pudo correr desde aquí.** La red de esta sesión bloquea la flota vLLM, Firecrawl, ScrapeGraph, la SEC, Grants.gov, NIH y Wayback, tanto desde el Mac (VM de Cowork) como desde la nube; solo pasan pypi y npm. Por decisión de Gisel, todo lo que usa la flota lo corre ella (ver §4, el mapa). Por eso las evaluaciones que dependen de la flota o de la red quedan como **scripts listos, sin cifras**.

Respaldo previo: `workspace_notes/respaldo_2026-09-27/` (research/server, research/tests, frontend/src y backend/src).

---

## 1. Resumen por módulo

### Módulo 1 · Corpus de deals y extracción propia
- **Tabla `deals` + `deal_investors`** en SQLite (índice por fondo y fecha), embeddings en caché y `extractions`, que guarda todas las extracciones como conjunto de entrenamiento.
- **Verificación literal por campo** (`server/analysis/deals.mjs`): la cita tiene que aparecer literal en la página, y cada campo tiene que aparecer en la cita. Quien lidera solo cuenta si la cita dice "led by / liderada por"; si no, pasa a co-inversionista. Los montos solo se convierten a USD si la moneda es USD, sin tasas de cambio inventadas. Se añadió `description` (qué hace la startup), también literal.
- **Extracción:** qwen-30b con `response_format: json_schema`. Si no hay flota, se usa un extractor por reglas, que también sirve como línea base.
- **Resolución de fondos:** port a Node de `normalize.py` y `resolve.py` (mismos umbrales), más alias (a16z ↔ Andreessen Horowitz) y una cola de revisión. "Magma Partners" y "Magma Capital" van a revisión y no se fusionan.
- **Ingesta:** Firecrawl con `tbs` por trimestre y `sources: web + news`. Las consultas se arman por sector × etapa × región, en inglés y en español.
- **Evaluación y LoRA:** exportación de una muestra de 100 para revisión manual, con cálculo de precisión por campo e IC de Wilson. También hay exportación train/test (división estable por URL), `backend/ml/train_lora.py` y la comparación `compare` con la regla de "dentro de 3 puntos".
- **Sin cifras de precisión todavía:** no se pudo correr qwen-30b.

### Módulo 2 · Tesis revelada, momento y backtest
- **Tesis revelada** (`revealed.mjs`): toma los deals de cada fondo en 24 meses, les aplica un decaimiento exp(−Δt/18 meses) y pesa más los deals donde el fondo lideró. Usa kNN con baai, con TF-IDF como respaldo; los k más cercanos pesan 1, ½ y ¼. Después reordena con mixbread. La explicación siempre sigue el formato "Lideró X (sector, etapa, fecha) [cita]".
- **Momento** (`momentum.mjs`): vehículo nuevo en Form D, SPVs, ritmo de 6 meses, último deal en el sector e inactividad mayor a 18 meses. Cada señal va con enlace a EDGAR o a la nota.
- **Form D real:** `python -m warmpath.ingest.formd_vehicles` sobre el 2026Q2 que ya estaba en disco da **2.983 vehículos "Venture Capital Fund"**, de los cuales **2.541 no son enmienda**. Muchos son SPVs de plataformas ("a Series of …"); se separan de los fondos. Un vehículo solo se asocia a un fondo si el nombre coincide sin ambigüedad: "True Ventures" no se asocia a "True Equity III".
- **Backtest** (`backtest.mjs`): corte en T = anuncio − 1 día y se excluye la propia startup. Mide hit@10 y MRR (0 fuera del top 50) con bootstrap pareado. Reporta la cobertura y los subconjuntos todas, cubiertas, no contaminadas, semilla y posteriores al corte del modelo. Las líneas base son B1 (el `fit` actual de la app, aplicado al mismo universo) y B0 (LLM solo; script con prueba de memorización).
- **Conjunto:** `backend/eval/backtest_rounds.json` tiene **39 rondas reales con URL y cita**, de las que **32 están incluidas**: 12 de LatAm y 20 de EE. UU.; 11 de salud mental o conductual y 5 de neuro, demencia o cuidadores.

### Módulo 3 · Voz del decisor, brief de reunión y objeciones
- **Índice** (`voice.mjs`): fragmentos con fuente, fecha y minuto (si viene de ASR). La búsqueda es híbrida (BM25 + vectores, fusionados con RRF) y luego pasa por el reranker. Ingesta por RSS, URL de prensa o blog, y podcasts con ASR propio (`/v1/audio/transcriptions`).
- **Novedad (27-sep):** `ingest-linkedin` suma posts/artículos públicos de LinkedIn (solo `linkedin.com/posts/...` o `/pulse/...` indexados por Firecrawl, nunca login/cookie) y una nueva pregunta del brief, "Qué temas comparte y a qué audiencia le habla", para entender el ángulo de cada inversionista antes de la reunión.
- **Brief:** qué ha dicho que busca, qué le preocupa y cómo decide, más sus deals parecidos y 3 objeciones. **Solo sobrevive lo que cita literal un fragmento recuperado**; lo demás se descarta y se cuenta, así la fidelidad se mide en cada generación. Las respuestas a las objeciones usan solo los hechos del perfil que Ram ingresa, cada uno con su fuente.
- **Simulador:** hace de la persona usando solo lo recuperado; si no hay evidencia, dice "No tengo evidencia de que … haya dicho algo sobre esto".
- **Límite de fuentes:** YouTube se usa **solo para metadatos**, sin subtítulos ajenos, según las políticas verificadas en la estrategia. No se usa LinkedIn. Los podcasts no tienen diarización, así que se marcan "verificar quién habla".

### Módulo 4 · Escucha social: no construido
La estrategia v3 la descarta. TikTok Research API no admite uso comercial, Reddit exige aprobación escrita, Instagram permite 30 hashtags por semana con revisión, y YouTube prohíbe extraer contenido. Además, la regla del proyecto es "no usar fuentes sin permiso comercial". Si se retoma, las únicas vías limpias son HN API, comentarios de YouTube vía Data API (con borrado a 30 días) y Reddit si aprueba la solicitud.

### Módulo 5 · Elegibilidad de grants (Rohit)
- **Reglas** (`eligibility.mjs`) desde tres fuentes: los campos oficiales de Grants.gov (`applicantTypes`, techo, cierre), patrones de las frases estándar de los NOFO de NIH (foreign institutions, foreign components, cost sharing, empleo principal del PI, 51 % de propiedad) y la flota (qwen-30b), siempre con cita literal.
- **Evaluación:** contra el perfil de IGC, regla por regla, con ✔ / ✖ / ? y la cita. **Un "?" nunca se vuelve ✔**. Las preguntas pendientes se muestran como "Preguntas para Rohit".
- **Perfil editable en la app:** solo trae precargado lo documentado en el Project (con fines de lucro, pública, Maryland); lo demás queda en "No sé".
- **Plazos:** alertas a 60, 30 y 7 días y calendario **.ics** con alarmas. No había resumen semanal por correo, así que no se agregó a uno.
- **Evaluación manual:** `scripts/grants-eval.mjs fetch` y luego `score` sobre 30 convocatorias. La tabla mide la exactitud del veredicto y los "falsos ✔".

### Módulo 6 · Aprender del uso (pilares B y C)
- **`outreach_events`:** a quién, por dónde, con qué argumento, con qué variante y resultado por etapas. Pasados 14 días sin cambio, cuenta como "sin respuesta". Se puede importar la hoja histórica en CSV. **La app no envía mensajes.**
- **Tablero:** siempre "k de n · rango a–b %", con intervalo Beta de Jeffreys al 90 %. Por debajo de ~50 acercamientos es descriptivo.
- **Red (C):** solo con participación voluntaria y **al menos 3 fundadores distintos por celda**. Muestra rutas y argumentos de las reuniones sin revelar quién contactó a quién.
- **Thompson sampling:** con menos de 50 resultados no optimiza y recomienda explorar la variante menos probada.
- **Learning-to-rank:** cada aprobación o rechazo en la evaluación se guarda como juicio en `judgments`. `backend/ml/train_ltr.py` (LightGBM lambdarank) se niega a entrenar con menos de 200 juicios.

### App (demo para Ram y Rohit)
Pestaña **Análisis** con cinco vistas: Quién invierte ahora · Acercamientos · Grants · Preparar reunión · Backtest. El score 0–100 no aparece.

---

## 2. Tabla de evaluación

| Módulo | Métrica pedida | Umbral | Resultado hoy | Estado |
|---|---|---|---|---|
| 1 | Precisión por campo (100 revisados a mano) | — | Sin datos: la extracción con qwen-30b no pudo correr | Pendiente (§4, pasos 2–4) |
| 1 | LoRA qwen-4b vs qwen-30b (P/R por campo, test aparte) | ≤ 3 puntos | Sin datos | Pendiente (pasos 5–6) |
| 2 | hit@10 / MRR del líder real vs B0 LLM | S2 > B0 | **Corrida real con un corpus mínimo** (abajo). B0 sin correr | **No pasa / no concluyente** |
| 3 | Fidelidad en 50 respuestas (juez qwen-30b + revisión manual) | ≥ 95 % | Sin datos (hacen falta flota y fuentes) | Pendiente (paso 8) |
| 5 | Exactitud del veredicto en 30 convocatorias | — | Sin datos (Grants.gov bloqueado aquí) | Pendiente (paso 9) |
| 6 | Mostrar lo aprendido con rangos | — | Implementado y probado | ✔ |
| Todos | Tests | pasan | **104/104** (Node; eran 71) · `tsc` y `vite build` OK · capturas de las 5 vistas revisadas | ✔ |

**Backtest real sobre un corpus mínimo.** La base contiene solo las 39 rondas del conjunto, cargadas como deals citados. Se corrió sin flota (similitud léxica) y con corte temporal estricto.

| Subconjunto | n | App actual (hit@10 / MRR) | Tesis revelada | Revelada + momento |
|---|---|---|---|---|
| Todas | 32 | 15,6 % / 0,113 | 12,5 % / 0,049 | 12,5 % / 0,049 |
| Líder presente en la base | 8 | 62,5 % / 0,453 | 50,0 % / 0,197 | 50,0 % / 0,194 |
| Posteriores a dic-2025 | 6 | 33,3 % / 0,171 | 33,3 % / 0,061 | 33,3 % / 0,061 |

Lectura:

- La **cobertura es del 25 %**: solo 8 de 32 líderes tienen algún deal en la base antes de su ronda. El problema es **de datos, no de modelo**.
- Con tan pocos deals, la línea base de la app gana porque desempata por número de deals, lo que en la práctica es un prior de popularidad.
- Diferencia S2 − app en hit@10: −3,1 puntos (IC 95 %: −9,4 a 0,0).
- **Según el criterio del Prompt 2, esto no autoriza a decir que la tesis revelada supera a nadie.** Hay que repetirlo con la base ingerida (miles de deals) y con la flota antes de seguir.

---

## 3. Variables nuevas en `research/.env.example`

`VLLM_BASE`, `VLLM_API_KEY`, `VLLM_TIMEOUT_MS`, `VLLM_{CHAT,SMALL,REASONING,EMBED,RERANK}_MODEL`, `VLLM_{CHAT,SMALL,REASONING,EMBED,RERANK}_URL`, `VLLM_EXTRACT_ROLE`, `VLLM_ASR_URL`, `VLLM_ASR_MODEL`, `FUND_VEHICLES_PATH`, `EVAL_RESULTS_DIR`, `ELIGIBILITY_PROFILE_PATH`, `ANTHROPIC_API_KEY`, `BASELINE_LLM_MODEL`.

---

## 4. Mapa de lo que Gisel tiene que correr (en orden)

Todo se corre desde `REPOSITORIO/research` en la **Terminal del Mac**, no en Cowork, porque ahí sí hay red. Los pasos que tocan la GPU se hacen en la máquina de la flota.

| # | Dónde | Comando | Qué produce · criterio |
|---|---|---|---|
| 1 | Mac | `node --env-file-if-exists=.env scripts/fleet-check.mjs` | Ids reales de cada puerto y las líneas para pegar en `.env` (`VLLM_*_MODEL`). |
| 2 | Mac | `node --env-file-if-exists=.env scripts/deals.mjs ingest --from 2023-01-01 --to 2026-09-30` | Corpus de deals con qwen-30b. Usa créditos de Firecrawl: prueba primero con `--per 3 --sectors "mental health" --regions LATAM`. |
| 3 | Mac | `… scripts/deals.mjs stats` | Tasa de verificación, motivos de rechazo y estado por campo. Objetivo: 500–2.000 deals verificados. |
| 4 | Mac + a mano | `… deals.mjs review-export` → llenar `backend/eval/deals_review.csv` (columnas `ok_<campo>` = si/no) → `… deals.mjs review-score` | **Tabla de precisión por campo** con IC 95 %. |
| 5 | Mac → GPU | `… deals.mjs gold-export` y `… deals.mjs trainset`; copiar `backend/ml/data/train.jsonl` a la GPU y correr `python train_lora.py --base <id de qwen-4b>` | Adaptador `deals-lora`. |
| 6 | GPU → Mac | `vllm serve <qwen-4b> --port 8001 --enable-lora --lora-modules deals-lora=/ruta` y luego `… deals.mjs compare --a chat --b deals-lora` | P/R por campo. Si queda dentro de 3 puntos de F1, poner `VLLM_EXTRACT_ROLE=deals-lora`. |
| 7 | Mac | `node scripts/backtest-verify.mjs` → `node scripts/backtest-profiles.mjs` → `ANTHROPIC_API_KEY=… BASELINE_LLM_MODEL=… node scripts/baseline-llm.mjs` → `node --env-file-if-exists=.env scripts/backtest.mjs --cutoff <corte del modelo>` | Citas del conjunto verificadas literal, perfiles ex ante de Wayback, línea base LLM con prueba de memorización y **tabla final**. **Si S2 no supera a B0, detenerse.** Conviene añadir 8–18 rondas de salud mental para llegar a ≥ 15 y ~40 en total. |
| 8 | GPU + Mac | Desplegar un modelo de voz a texto (p. ej. Whisper) con vLLM y poner `VLLM_ASR_URL`/`MODEL`. Indexar fuentes con `scripts/voice.mjs ingest-rss / ingest-url / ingest-linkedin` y medir con `… voice.mjs eval --person "…" --n 50` | **Fidelidad del juez**, más `backend/eval/results/voice_faithfulness.csv` para revisar a mano (umbral ≥ 95 %). |
| 9 | Mac + Rohit | `node scripts/grants-eval.mjs fetch --keyword "Alzheimer" --n 30` → Rohit llena `backend/eval/grants_labels.csv` → `… grants-eval.mjs score` | Exactitud del veredicto y "falsos ✔". |
| 10 | Mac | Cada trimestre: descargar Form D (`warmpath formd-download 2026q3`), descomprimir y correr `PYTHONPATH=src python3 -m warmpath.ingest.formd_vehicles data/raw/formd/<q>_d_x … --out ../research/data/fund_vehicles.json` | Señal "vehículo nuevo" al día. |
| 11 | Mac | Cuando haya ≥ 200 juicios: `node scripts/ltr-export.mjs` y luego `python backend/ml/train_ltr.py` | Modelo de learning-to-rank. |

---

## 5. Lo que no se pudo verificar

- **Nombres reales de los modelos en la flota:** no confirmados. Tampoco si existe un modelo de voz a texto.
- **Llamadas reales a APIs externas:** ninguna se hizo desde el código (vLLM, Firecrawl, SEC, Grants.gov, Anthropic, Wayback). Los clientes siguen la documentación oficial: vLLM (`docs/models/pooling_models/scoring.md` para rerank; `structured_outputs.md` para json_schema; `lora.md`) y Firecrawl v2 `/search` (`tbs`, `sources`). Los tests de rerank usan la respuesta de ejemplo copiada de la documentación de vLLM.
- **Citas del conjunto del backtest:** se tomaron con una herramienta de lectura web que pasa por un modelo intermedio, así que todas tienen `quote_verified=false` hasta correr `backtest-verify.mjs`. Algunas son de roundups (StartUp Health) y no de la fuente primaria.
- **Rondas con dudas:** Slingshot AI ("reportedly", etapa no informada), NewDays (extensión de seed; la fecha del primer tramo es anterior) y Sofía, Biologix y Genial Care (etapa no especificada).
- **Formato del enlace a EDGAR** (`/Archives/edgar/data/<CIK>/<accession>/`): se construye a partir del dataset, pero no se abrió hoy.
- **Umbrales del momento** (τ = 18 meses, pesos, inactividad > 18 meses): son supuestos que hay que calibrar con el backtest.
- **Propiedad ≥ 51 % en SBIR para una empresa pública, y empleo principal del PI:** quedan como "?". No es asesoría legal.
- **Archivo temporal:** `workspace_notes/_verificacion_ui.tgz` se usó para las capturas y se puede borrar.

## 6. Archivos nuevos

- `research/server/analysis/`: `fleet`, `entities`, `deals`, `dealIngest`, `extractEval`, `lexical`, `momentum`, `revealed`, `backtest`, `stats`, `outreach`, `eligibility`, `voice`, `routes`, `analysisStore` (todos `.mjs`).
- `research/scripts/`: `fleet-check`, `deals`, `backtest`, `backtest-verify`, `backtest-profiles`, `baseline-llm`, `grants-eval`, `voice`, `ltr-export`.
- `research/tests/analysis.*.test.mjs` (6 archivos).
- `backend/src/warmpath/ingest/formd_vehicles.py`, `backend/ml/train_lora.py`, `backend/ml/train_ltr.py`, `backend/eval/backtest_rounds.json` y `backend/eval/results/backtest_2026-09-28.{json,md}`.
- `frontend/src/analysisApi.ts`, `frontend/src/app/Analysis.tsx`, más cambios en `App.tsx`, `Shell.tsx` y `app.css`.
- Cambios en archivos existentes: `store.mjs` (tablas nuevas), `webscrape.mjs` (`tbs` y noticias en `firecrawlSearch`) e `index.mjs` (rutas y registro de juicios).
