# Prompt de revisión previa al benchmark nocturno (v7)

Pega esto en Claude Code, en la carpeta AGENT del Mac (rama main).

---

Eres el revisor previo de un benchmark de búsqueda de inversionistas. Todo en español, texto plano. No pongas atribuciones de Claude en commits (sin Co-Authored-By ni Claude-Session). No toques archivos congelados, umbrales, juez ni prompts (config v5, manifest.v5, normalization.v1, extractor/judge/engine/normalize/resolve/deepening.mjs). No imprimas ni leas claves de research/.env. Una corrida formal se hace una sola vez.

## Presupuesto
Exa: 20 USD de prueba, unos 3.25 ya gastados. Tope de la noche: CAP_USD=14 (medido con research/bench/investors/analysis/exa_spend.mjs). Cada búsqueda B2E cuesta ~0.057 USD (20 resultados), B2 ~0.025. No gastes más de 1.5 USD en toda tu revisión.

## Objetivo
Detectar cualquier error ANTES de lanzar `bash research/bench/investors/run-overnight.sh`, y comprobar que el agente hace lo que se pidió en la reunión con David Castro (transcripción en docs/ si está; si no, pídela):
R1. Sensibilidad a pares de intención: dos briefs con el mismo significado práctico distinto se comparan (cases-pairs/*-ib, analysis/v6_pairs.mjs, regla pre-registrada en docs/handoff/V6-PREREGISTRO-pares.md).
R2. Filtro de relevancia con embeddings + coseno (condición B2E, relevance-embeddings.mjs, apagado por defecto, se activa con --enable-embeddings): top 10 por coseno, el LLM conserva lo que habla de inversión, siguiente bloque de 10 si ninguno.
R3. Parar tras 2 rondas y decir "encontré poco" (campo informativo sparse_after_round_2, solo B2E).
R4. Preguntar al usuario antes de enriquecer la intención: NO implementable en el benchmark (no hay usuario). Solo diseño y una prueba simulada, bandera apagada.

## Tareas, en orden
1. `git status` y `git log -3`. Corre `node --test research/tests/agent/investors.v5.test.mjs research/tests/agent/investors.v6.test.mjs`. Todo debe pasar. Verifica que `node research/bench/investors/freeze.mjs` produzca el mismo fingerprint que out/investors-internal-2026-10-09-v5/fingerprint.json.
2. Preflight: Crawl4AI en Docker responde, el LLM local responde y devuelve JSON, y hay claves de Exa (solo verifica que existen, no las muestres).
3. `node research/bench/investors/embed-check.mjs`: debe descargar Xenova/multilingual-e5-small y mostrar coseno mayor entre textos relacionados con inversión que entre no relacionados. Si falla la descarga, repórtalo; B2E no podrá correr.
4. Revisa run-overnight.sh línea por línea: tope de gasto, reintento por lote, rutas, reutilización de corridas de la carpeta quick (mismo run_id), caffeinate, `DRY_RUN=1`. Busca: fallos JSON del modelo, no determinismo, archivos .lock, caché sqlite compartida con concurrencia, Crawl4AI saturado.
5. Compuerta B2E real (una corrida, p05, semilla 101, --enable-embeddings). Lee los eventos `relevance_filter`: results_in>0, llm_calls>0, results_kept>0, firmas>0. Comprueba que los resultados descartados tengan sentido y que sparse_after_round_2 se calcule bien.
6. Equivalencia de pares: para p01-p06 compara la variante A y la B; confirma que el brief B cambia el sentido práctico y no solo la redacción, y que no filtra información del gold.
7. Una corrida B2 completa de un par (p01 y p01-ib, semilla 101) y revisa que cites y métricas salgan con analysis/v6_formal_metrics.mjs.
8. R4: describe el diseño (cuándo el agente pregunta, qué pregunta, cómo se reanuda) y una prueba simulada con respuesta de usuario falsa. No lo actives en el benchmark.
9. Informe GO / NO-GO con: errores encontrados y corregidos (solo fuera de lo congelado), gasto de Exa medido, lo que no se pudo verificar. Solo cifras, sin adjetivos y sin etiquetar firmas.
10. Si es GO: commit sin atribución y lanza `CAP_USD=14 bash research/bench/investors/run-overnight.sh`. Si es NO-GO: no lances nada.
