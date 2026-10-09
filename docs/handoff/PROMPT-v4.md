# Prompt para ChatGPT / Codex — Consolidar el proyecto y dejar funcionando el agente iterativo de inversionistas (v4)

> Copia todo lo que está debajo de la línea y pégalo como instrucción a Codex. Debe ejecutarse en tu Mac, dentro de `/Users/gcaicedo/Documents/PROJECTS/AGENT`, con acceso a la carpeta del benchmark en Product Brain.

---

Eres el implementador. Trabajas en `/Users/gcaicedo/Documents/PROJECTS/AGENT` (repo git `gissoler/igc-outreach`, rama `main`).

La especificación técnica que debes implementar **literalmente** está en:

```
/Users/gcaicedo/Documents/Product Brain/Outreach/Fuentes/Benchmark investors - execution 2026-10-08/FIX_SPEC.md
```

Léela completa antes de empezar. Este prompt la complementa en tres puntos:

1. Cómo consolidar el proyecto en una sola versión. Reemplaza y amplía FIX-00 del spec.
2. Dos ajustes técnicos extra. Están en la Fase 2 como FIX-11b y FIX-17.
3. Cómo ejecutar, verificar y reportar.

Si algo de este prompt contradice el spec, manda este prompt. Si algo no está escrito ni aquí ni en el spec, **no lo inventes**: detente y escríbelo en `docs/handoff/QUESTIONS-v4.md`.

Variables usadas en todo el documento:

```
REPO = /Users/gcaicedo/Documents/PROJECTS/AGENT
EVID = /Users/gcaicedo/Documents/Product Brain/Outreach/Fuentes/Benchmark investors - execution 2026-10-08
SNAP = $EVID/workspace/AGENT-snapshot
```

## Objetivo, en una frase

Dejar **una sola versión del proyecto**, `REPO` en `main`, con todo el trabajo de la semana. Sobre ella, dejar el **agente iterativo de búsqueda de inversionistas** (B2, `research/bench/investors`) emitiendo recomendaciones correctas, con cita literal y gain ≥ 2, verificado con los criterios de aceptación de la Fase 4.

## Reglas que no se negocian

1. **No se relaja ninguna verificación para que una métrica pase.** Los umbrales de la Fase 4 no se cambian. Si no se cumplen, se reporta el fallo con datos (Fase 5).
2. **No se usan los 15 casos del gold para depurar.** Solo se depura con D1, D2 y D3 (Fase 3). Los 15 casos se corren **una sola vez**, al final.
3. **Inmutables.** Están en la §4 del spec: configs v0–v3, `b3-extension`, `prompts/investor/manifest.json` y los prompts existentes, casos y perfiles del gold, etiquetas v3, `decide.mjs`, `ranking.mjs`, `criteria_catalog.investor.v1.json` y los schemas existentes. Lo nuevo se versiona con sufijo `.v2`/`v4` y se activa desde **config v4**.
4. **Etiquetas.** No etiquetes firmas ni actúes como adjudicador: el sistema que construyes no se califica a sí mismo. Solo generas hojas ciegas (Fase 4.3).
5. **Secretos.** Nunca imprimas, copies ni comitees `.env`, `.env.*` (salvo `.env.example`), claves ni cabeceras. En logs, muestra solo nombres de variables.
6. **Pruebas sin red** (`HTTPS_PROXY=http://127.0.0.1:9`), salvo las corridas reales de las Fases 3 y 4.
7. **Commits:** uno por FIX, con título `V4-<FIX-id>: <qué>`. No reescribas historia ni uses `push --force`.
8. **Producción** (`research/server/**`, salvo FIX-11b), `frontend/**`, `backend/**` y `deploy/**`: no se tocan, salvo el commit de consolidación de la Fase 0.

---

## Fase 0 — Consolidar en una sola versión (sustituye a FIX-00)

**Situación verificada el 2026-10-08:**

* `REPO` está en `main` (`ad5ac6f`) con 8 archivos modificados y 9 rutas sin seguimiento: el trabajo de *capital strategy* y Apollo, `IMPLEMENTATION_REPORT.md`, `docs/CAPITAL_STRATEGY_*`, `docs/APOLLO_RUNBOOK.md`, `research/capital/**`, `research/scripts/apollo-preflight.mjs`, `research/tests/apollo.test.mjs`, `research/tests/capitalStrategy.test.mjs`, `research/artifacts/`, y cambios en `research/server/research/pipeline.mjs` y `frontend/src/*`.
* El código que ejecutó el benchmark v3 **solo existe en `SNAP`**. `SNAP` es una copia del árbol de `REPO`, incluidos los cambios sin commit, más estos cambios del benchmark:
  * Difieren: `research/bench/investors/{cli,engine,external,extractor}.mjs`, `research/server/research/searchApis.mjs`, `docs/contracts/investor/investor_run_config.schema.json`, `prompts/investor/manifest.json`, `research/tests/agent/investors.test.mjs` y `research/tests/agent/fixtures/investor-world-v0/world.mjs`.
  * Solo en `SNAP`: `research/bench/investors/{run-experiment,search-failover,preflight-chain,import-gold,extractor-quality-check}.mjs`, `research/bench/investors/smoke/`, `research/bench/investors/cases/**` (15 casos, manifest y perfiles), `research/bench/investors/config/{v1-2026-10-08,v2-2026-10-08,v3-2026-10-08,b3-extension-2026-10-08}.json` y `prompts/investor/extractor/v2/`.
* Los scripts de análisis y etiquetado del v3 viven solo en `EVID/analysis/*.mjs` (`run_metrics`, `build_pool`, `expand_labels`, `make_sheets`, `audit_runs`).
* Ramas: `mejoras-busqueda-2026-09-30` y `respaldo-antes-de-limpiar-trailers` muestran 14 commits "por delante" de `main`, pero son los mismos cambios reescritos. Cada uno tiene equivalente en `main` por mensaje: `6f4d3e2`, `0b94f82`, `16d81ac`, `af33cd8`, `ccb691d`, `2eedf68`, `a587af1`, `5123be6`, `2e01f76`, `6f14939`, `dd6503a`, `9e998a4`, `e758547` y `a948fde`. Las demás ramas locales tienen 0 commits por delante de `main`.
* Hay un worktree huérfano en `/private/tmp/agent-r02-before` (prunable).
* Hay copias de `.env` con secretos dentro del repo: `research/.env.bak-*`, `research/.env.tmp` y `research/.backup-2026-09-29/`. Están ignoradas por git.

**Pasos, en este orden:**

0.1 **Línea base.** Ejecuta `npm --prefix research test` y `npm --prefix research run test:agent` con `HTTPS_PROXY=http://127.0.0.1:9`. Guarda pass/fail/skip en `docs/handoff/V4-BASELINE.md`. La referencia documentada es 415 pass, 1 fail preexistente (`UW-Madison I-Corps…`) y 1 skip para `test`; si difiere, anótalo y sigue.

0.2 **Commit del trabajo sin commit.** Rama `consolidacion/2026-10-08` desde `main`.
* `git add` de los 8 modificados y las 9 rutas sin seguimiento. Excluye `research/artifacts/` si contiene datos de cuenta; revisa `apollo-preflight.json` y comitéalo solo si no hay claves, emails ni IDs de cuenta.
* Commit `V4-C0: incorpora capital strategy + Apollo (trabajo sin commit del 2026-10-08)`.

0.3 **Sincronizar desde `SNAP`.**
* Ejecuta:

  ```
  diff -rq "$REPO" "$SNAP" -x node_modules -x .git -x out -x '*.sqlite*' -x .DS_Store -x dist -x tsconfig.tsbuildinfo -x '.env*' -x .backup-2026-09-29 -x artifacts
  ```

* La salida debe ser **exactamente** la lista de "Difieren" y "Solo en SNAP" de arriba, más los `*.sqlite-shm/-wal` ya excluidos. Si aparece cualquier otra ruta, detente y regístrala en `QUESTIONS-v4.md`.
* Copia esos archivos de `SNAP` a `REPO`, byte a byte.
* Verifica estos sha256 después de copiar:

  | Archivo | sha256 |
  |---|---|
  | `research/bench/investors/extractor.mjs` | `d00dbafa8d41f945397ad812d854541d426cf0fdd52d0b25948c60ee3db08471` |
  | `research/bench/investors/ranking.mjs` | `45e9c0e71c25ee162c04e048330e6e90b18576696d8aaf2c7d30698c51146a03` |
  | `research/bench/investors/config/v3-2026-10-08.json` | `b6afc77992ea81e85da9ca0a5641f4827d546427604e731bcfb288a6d58ab4cd` |
  | `research/bench/investors/config/v2-2026-10-08.json` | `997115777a05f0a3a869b9bd73b304b7773652a37ea25924be162f93b68d7c4e` |

* Commit `V4-C1: incorpora el código del benchmark investors v3 (desde el snapshot de ejecución)`.

0.4 **Gold y análisis v3 dentro del repo** (sin datos pesados).
* Copia `SNAP/research/bench/investors/out/investors-internal-2026-10-08-v3/labels/adjudicator.jsonl` y `.../pool/*.json` a `research/bench/investors/gold/v3/labels/` y `research/bench/investors/gold/v3/pool/`. Verifica `sha256(adjudicator.jsonl) = eaa34f0ffd44c7112b7804c710261d46cd3de51307e82cc2b5d2107d29eafb13`.
* Copia `EVID/analysis/{run_metrics,build_pool,expand_labels,make_sheets,audit_runs}.mjs` a `research/bench/investors/analysis/`.
* Añade `research/bench/investors/out/` a `.gitignore`. Las salidas de corrida no se versionan: el v3 queda como evidencia en `EVID`.
* Commit `V4-C2: gold v3 y scripts de análisis versionados`.

0.5 **Regresión.**
* Repite 0.1. Exige ≥ los mismos pass de la línea base. `npm --prefix research run test:investors` debe dar 20/20.
* Implementa la prueba FIX-00.T2 del spec (`replay-v3.mjs`, igualdad exacta de `judgments` y `ranked` en 10 corridas v3 leídas desde `EVID`).

0.6 **Una sola versión.**
* `git checkout main && git merge --no-ff consolidacion/2026-10-08`.
* Crea tags de archivo **antes** de borrar ramas: `archive/<nombre-rama>` para cada rama local distinta de `main`.
* Borra las ramas locales: `arquitectura/agente-general-2026-10-07`, `impl/agente-busqueda-v0`, `implementacion/agente-general-2026-10-07`, `mejoras-busqueda-2026-09-30`, `respaldo-antes-de-limpiar-trailers`, `spec/agente-busqueda-v0` y `trabajo/inversores-pre-refactor-2026-10-07`.
* `git worktree prune`.
* Mueve, **sin borrar**, `research/.env.bak-*`, `research/.env.tmp` y `research/.backup-2026-09-29/` a `/Users/gcaicedo/Documents/PROJECTS/_respaldos_env_2026-10-08/`, fuera del repo.
* `git push origin main` y `git push origin --tags`. La rama remota `origin/mejoras-busqueda-2026-09-30` **no se borra** en esta fase; anótala en el reporte para que la usuaria decida.

0.7 **Marcar el snapshot como evidencia congelada.**
* Crea `EVID/workspace/SNAPSHOT_ES_EVIDENCIA.md` con este texto: "Este árbol es evidencia congelada del benchmark v3. El código vivo es `REPO` main @ <commit de 0.6>. No editar ni ejecutar desde aquí."
* No borres ni modifiques nada más dentro de `EVID`.

0.8 **Decisión de arquitectura.**
* Crea `docs/handoff/DECISION-2026-10-08-agente-inversionistas.md` con este texto: "El agente iterativo de inversionistas vigente es `research/bench/investors` (engine v2 con config v4). La migración al DomainPack (`REFACTOR-PLAN.md` R-08…R-15, incluida la retirada R-15 de esta carpeta) queda **en pausa** hasta cumplir los criterios de la Fase 4. Grants sigue en `research/agent`. Producción (`research/server`) no usa todavía ninguno de los dos motores."
* Añade al inicio de `REFACTOR-PLAN.md` una línea que enlace a esta decisión. No modifiques nada más de ese archivo.
* Copia `FIX_SPEC.md` y este prompt a `docs/handoff/` (`FIX_SPEC-investors-v4.md`, `PROMPT-v4.md`).
* Commit `V4-C3: decisión de arquitectura y specs en el repo`.

**Puerta de salida de la Fase 0:**
* `git branch` muestra solo `main`.
* `git status` está limpio.
* Tests ≥ línea base.
* `test:investors` da 20/20.
* `replay-v3` da igualdad exacta.

---

## Fase 1 — Observabilidad primero

Implementa **FIX-13** del spec. Sin esto no se puede medir nada de lo demás.

---

## Fase 2 — Correcciones (spec §2, en el orden de §3)

**Orden:** FIX-01 → FIX-02 → FIX-03 → FIX-04 → FIX-06 → FIX-07 → FIX-08 → FIX-09 → FIX-05 → FIX-10 → FIX-11 → FIX-11b → FIX-12 → FIX-14 → FIX-15 → FIX-17.

Cada FIX lleva sus pruebas de aceptación del spec, escritas antes del código y verdes al final. FIX-16 **no** se implementa.

Recordatorio clave del diagnóstico: FIX-01…04 (extractor) y FIX-06…09 (juez) van **juntos** en v4. Arreglar solo el extractor convierte los gain 1 en gain 0, porque el tipo `venture_capital` nunca coincide con `generalist_vc` y la firma queda inelegible.

### FIX-11b (añadido) — El lector no pierde páginas que el buscador ya leyó

* **Archivos:** `research/bench/investors/search-failover.mjs` y `research/bench/investors/engine.mjs`.
* **Cambio 1 — Exa trae texto en v4.** Si `config.search.exa_contents_chars` existe (v4: `4000`), el failover deja de forzar `EXA_INCLUDE_CONTENTS:'0'` y pasa `EXA_TEXT_CHARS = exa_contents_chars`. Cada resultado conserva `text` (máximo 4.000 caracteres, de `row.markdown || row.description`).
* **Cambio 2 — Respaldo cuando el fetch sale vacío.** Si el fetch de una URL devuelve `FETCH_EMPTY` y el resultado de búsqueda trae `text.length ≥ 400`, el motor usa ese texto como `document.text`, con `via: 'search_contents'`. Lo registra en `fetch_end`. Cuenta como fetch.
* **Cambio 3 — Jina sin errores silenciosos.** En `jinaRead` (`research/server/research/searchApis.mjs:157-165`) el `catch` ya no puede tragarse el error sin registrarlo. Añade un parámetro opcional `onError` que el lector del benchmark use para emitir `fetch_end.error = {code: 'JINA_<status>', message}`. En v3, Jina solo rescató 27 páginas teniendo clave configurada, y la causa no quedó registrada. Producción no cambia de comportamiento si no pasa `onError`.
* **Prueba:** fetch simulado vacío + resultado con 1.000 caracteres → la extracción usa ese texto y el evento lleva `via:'search_contents'`. Sin `exa_contents_chars`, el comportamiento es idéntico a v3.

### FIX-17 (añadido) — Un comando que entregue valor: perfil → informe

* **Archivo nuevo:** `research/bench/investors/find.mjs`.
* **Uso:** `node research/bench/investors/find.mjs --config <v4> --profile <perfil.json> --condition B2 --seed 101 --out <dir>`. Ejecuta `runInvestorDiscovery` con las dependencias reales, como `run-experiment.mjs`.
* **Salidas en `<dir>`:**
  * `result.json`;
  * `report.md`: una tabla por firma con rank, gain, nombre, dominio oficial, actividad, sector/etapa/geografía/tipo con estado y **cita literal y URL** de cada criterio no `unknown`, y motivo de exclusión de las firmas con gain 0;
  * `abstention_reason` si se abstiene.
* **Restricción:** no inventa campos. Solo imprime lo que hay en `judgments` y `sources[].field_evidence`.
* **Prueba:** con dependencias simuladas, el informe contiene una fila por entidad y cada criterio no `unknown` tiene una cita que aparece literal en el texto de la fuente.

---

## Fase 3 — Depuración fuera del gold (D1–D3)

3.1 **Crear los casos.** Crea `research/bench/investors/cases-debug/` con D1, D2 y D3 según la §5.2 del spec, con el mismo schema `investor_case/1` y `investor_profile/1`:
* D1: edtech B2B, Chile y Perú, seed USD 1,5M.
* D2: foodtech de fermentación, Suecia y Finlandia, Serie A EUR 8M.
* D3: nulo, reciclaje de fosfatos en Nauru, Serie A USD 20M.

**Debes construir el perfil sin buscar inversores.** D1 y D2 no llevan ancla (`anchors: []`, `kind: "debug"`). D3 lleva `null_case` con 3 consultas manuales y la conclusión de la búsqueda manual de 20 minutos. Si `validateInvestorWorkspace` no acepta `kind: "debug"`, crea `investor_case.v2.schema.json` (no edites v1).

3.2 **Preflight del lector (FIX-11).** Si `CRAWL4AI_URL` no está definido y Jina no pasa 3/3, intenta levantar Crawl4AI localmente con Docker según `research/server/research/crawl4ai.mjs`. Si no es posible, **detente y repórtalo**. No sigas sin lector.

3.3 **Smoke.** B1 y B2 × D1–D3 × semilla 101 = 6 corridas, con config v4. Salida en `research/bench/investors/out/debug-v4-<fecha>/`.

3.4 **Criterios del smoke** (todos):

| Criterio | Umbral |
|---|---|
| Firmas aceptadas con INV-SECTOR, INV-STAGE, INV-GEO e INV-TYPE ≠ `unknown` | ≥ 60 % |
| Criterios no `unknown` con cita literal verificada (script que compruebe la subcadena en el texto en caché) | 100 % |
| D1 y D2 | ≥ 1 recomendación con gain ≥ 2 en B2 |
| D3 | 0 recomendaciones con gain ≥ 2; `abstention_reason ∈ {no_candidates, all_hard_not_met}` |
| `FETCH_EMPTY` | ≤ 10 % |
| `rejected_non_investors/fetches` | ≤ 0,75 |

Si algo falla, itera **solo** con D1–D3. Cada iteración es un commit `V4-DBG-n` con la causa medida. Máximo 3 iteraciones; si a la tercera no se cumple, pasa directamente a la Fase 5 con el diagnóstico.

3.5 **Revisión manual de calidad.** Abre `report.md` de D1/B2 y D2/B2. Para las 5 primeras firmas de cada uno, comprueba a mano en la URL citada que la cita existe y que el estado del criterio es correcto. Anota el resultado en `docs/handoff/V4-SMOKE.md`. Si alguna firma recomendada no es un inversor institucional o tiene un criterio duro equivocado, es un fallo: vuelve a 3.4.

3.6 **Congelar.**
* `config/v4-<fecha>.json` pasa a `"status": "frozen"`.
* Registra los sha256 en `research/bench/investors/out/<bench_id>/fingerprint.json` según la §4 del spec.
* Añade a `docs/benchmark/investors/DECISIONS_PENDING.md` una entrada nueva con los tres valores que requieren aprobación humana: la regla `plausible` de FIX-07, las tablas `normalization.v1` de FIX-06 y `recency_days = 540` de FIX-09.
* **Detente y pide aprobación a la usuaria** antes de la Fase 4. Es la única pausa obligatoria.

---

## Fase 4 — Re-ejecución formal (una sola vez)

4.1 **Corridas.** B1 y B2 × 15 casos (p01–p12, n04, r13, r14) × semillas 101, 202 y 303 = **90 corridas** con config v4 congelada.

```
node research/bench/investors/run-experiment.mjs --config <v4> --cases research/bench/investors/cases --out research/bench/investors/out/<bench_id> --conditions B1,B2 --concurrency 3
```

* Topes: 1.620 búsquedas, 4.860 fetches y 300k tokens por corrida. Apollo: 0.
* Si una corrida falla por red, reintenta sin cambiar nada: el runner reutiliza los `result.json` válidos. Registra cada reintento.

4.2 **Métricas que no necesitan etiquetas nuevas** (FIX-15). Calcula y reporta:

| Criterio | Umbral de aceptación |
|---|---|
| INV-SECTOR, INV-STAGE, INV-GEO e INV-TYPE ≠ `unknown` en las firmas aceptadas | ≥ 60 % |
| Al menos uno de esos cuatro ≠ `unknown` | ≥ 85 % |
| Criterios no `unknown` con cita literal verificada | 100 % |
| Casos positivos con ≥ 1 gain ≥ 2 en B2, en ≥ 2 de 3 semillas | ≥ 10 de 12 |
| Recomendaciones con gain ≥ 2 en las 18 corridas nulas | 0 |
| Corridas nulas con `abstention_reason` ∈ {`no_candidates`, `all_hard_not_met`} | ≥ 80 % |
| Corridas nulas con `abstention_reason = insufficient_evidence` | ≤ 20 % |
| `rejected_non_investors/fetches` | ≤ 0,75 |
| `FETCH_EMPTY` | ≤ 0,10 |

4.3 **Etiquetado de firmas nuevas.**
* Construye el pool v4: unión del top-20 de las 90 corridas, menos lo ya etiquetado en `gold/v3`.
* Genera las hojas ciegas con `analysis/make_sheets.mjs`: sin condición, semilla, rank ni salida del juez.
* **No etiquetes.** Deja las hojas en `EVID/../Benchmark investors - execution <fecha>-v4/labeling/` y escribe en el reporte cuántas firmas faltan por etiquetar. El etiquetado lo hace el mismo adjudicador del v3, fuera de esta tarea.

4.4 **Métricas que necesitan etiquetas** (`gain2_label_agreement` ≥ 0,70, `hard_false_positive_rate` ≤ 0,10, pooled_recall@20, nDCG@10, regla congelada B2 vs B1): calcúlalas **solo** cuando existan las etiquetas nuevas, con `analysis/run_metrics.mjs` adaptado a v4. La regla de decisión se aplica sin cambios.

---

## Fase 5 — Reporte final

Crea `EVID/../Benchmark investors - execution <fecha>-v4/REPORT.md` y una copia en `docs/handoff/V4-REPORT.md` con estas secciones:

1. Estado de la consolidación: commit final, ramas y tags, qué se movió y adónde.
2. Tabla de FIX: implementado, commit y pruebas.
3. Resultados del smoke D1–D3 y la revisión manual de 3.5.
4. Tabla de criterios de 4.2: valor, umbral y cumple / no cumple.
5. Pendientes que dependen de etiquetas (4.4).
6. Coste real: búsquedas, fetches, tokens y latencia.
7. Para cada criterio no cumplido: causa medida con `run_id` y evento. **Sin** proponer bajar umbrales.

No declares éxito si algún criterio de 4.2 no se cumple. No resumas con adjetivos: usa números.
