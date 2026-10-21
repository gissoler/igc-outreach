# PROMPT v12 · Crawl4AI y modelo del motor (para correr mañana)

Reglas que siguen vigentes (las mismas de PROMPT-v11): todo en español, texto plano, solo cifras, sin adjetivos, sin etiquetar fondos.
No leer ni imprimir claves de `research/.env`. No editar archivos congelados (config v5, manifest.v5, normalization.v1,
extractor.mjs, judge.mjs, engine.mjs, normalize.mjs, resolve.mjs, deepening.mjs, prompts v5, run-experiment*.mjs, gold/, cases/,
todo .v7 y .v8). Carpetas de resultados v5–v9 de solo lectura. El nombre o dominio del oro nunca aparece en código, consultas,
prompts ni config. No se cambian umbrales, juez, etiquetas ni la regla de aceptación. Commits SIN Co-Authored-By ni Claude-Session.
Exa solo se gasta con script de un comando, con dry run y tope (5 USD, `analysis/exa_spend.mjs --usd-per-call 0.0089`).

## PARTE A · ¿Crawl4AI es el problema?

Contexto medido (v9): buscando por nombre, Exa devuelve el dominio del oro primero en 12/12 casos. Se acepta en 10/12.
Los 2 que fallan son p04 y p09, siempre con `missing_literal_quote` en la página de inicio.
En la prueba "solo el modelo" no se usa Crawl4AI y el oro se nombra en 0/6 (p01–p06). Por eso Crawl4AI solo puede explicar p04 y p09
y la calidad del texto de las páginas de listas.

Tareas (sin gastar Exa; solo caché y Crawl4AI local):
1. Para p04 y p09, sacar de la caché de fetch (`research/bench/investors/out/...` y la caché diagnóstica `exa_v8`) las páginas del sitio oficial
   del oro que se probaron. Por cada una, cifras: largo del texto en caracteres, número de enlaces, si contiene la palabra "invest" o
   equivalente, código HTTP, y si el HTML crudo (curl desde el Mac) trae más texto que la salida de Crawl4AI.
2. Volver a leer esas mismas URLs con Crawl4AI en modos distintos: sin JS, con JS y espera (`wait_for`/`delay_before_return_html`),
   y con la página de portafolio o "about" enlazada desde el inicio. Comparar largo de texto y si la cita literal aparece.
3. En las 12 páginas de listas donde el oro está en 10 de 12 casos: comparar cuántos nombres extrae el extractor de listas con Crawl4AI
   frente al HTML crudo. Cifra: nombres por página y si el oro está en cada versión.
4. Conclusión con cifras: casos recuperables solo cambiando la lectura (de los 2 de p04/p09), y casos que no cambian.
   No tocar el motor congelado: si hace falta un cambio, crear un archivo `.v12` nuevo y su prueba (V12-n) en
   `research/tests/agent/investors.v12.test.mjs`, y que freeze.mjs reproduzca v5 (89), v7 (110), v8 (111) y v9 (122).

Salida: `docs/benchmark/investors/V12-CRAWL.md` con una tabla por URL.

## PARTE B · Cambiar el modelo del motor (apagar gpt-oss, usar otro de Hugging Face)

Cómo está desplegado hoy (según el repo):
- Servidor: g355, IP 147.185.41.229 (alias SSH `voltage-park`). Los modelos se sirven con vLLM, uno por puerto.
- Flota ya existente: 8000 Qwen3-30B-A3B-Instruct-2507, 8001 qwen-4b, 8002 deepseek-8b, 8003 baai, 8004 mixbread.
  El runbook menciona además Qwen/Qwen3.6-27B-FP8 en el puerto 8005.
- gpt-oss-120b del motor está en el puerto 8016 (variables `ENGINE_LLM_URL`, `ENGINE_LLM_MODEL`, `INTAKE_LLM_*` en `research/.env`).
  Lo levanta `research/scripts/g355-serve-engine-model.sh` (vLLM, GPU vacías, escribe `~/.outreach-engine.env` en g355).
- Apagar solo lo propio: `ssh voltage-park 'bash ~/outreach-engine-serve/g355-serve-engine-model.sh stop'`.
  El script solo mata procesos de este usuario que él mismo arrancó (archivos `.pid` en `~/.outreach-engine/`). No toca la flota.
- Otro modelo: `ENGINE_MODEL=<id de Hugging Face> ENGINE_TP=<n> bash research/scripts/run-mac.sh` o el script directo en g355.
  Con `ENGINE_REMOTE_PORT=<puerto>` se usa un modelo que ya corre, sin levantar ni apagar nada.
- Para el motor v9 solo hay que cambiar en `research/.env`: `ENGINE_LLM_URL`, `ENGINE_LLM_MODEL`, `ENGINE_LLM_API_KEY` (si aplica),
  `ENGINE_LLM_REASONING_EFFORT` (solo gpt-oss) y `ENGINE_LLM_JSON_MODE`. Hacer copia previa del .env antes (sin imprimirlo).

Tareas:
1. Solo lectura en g355: `ssh voltage-park 'bash -s' < research/scripts/g355-inventory.sh` y
   `ssh voltage-park 'ls -d ~/.cache/huggingface/hub/models--* /data/*/.cache/huggingface/hub/models--* 2>/dev/null'`
   para listar qué pesos ya están descargados, qué GPU están vacías y cuánto disco hay. Reportar cifras (GB, GPU libres).
2. Elegir candidatos entre lo que ya está descargado o corre. Un modelo más pequeño que gpt-oss-120b (30B, 27B) sabe menos de fondos
   regionales: probarlo solo como control. Candidatos más grandes posibles con el script: Qwen/Qwen3-235B-A22B-Instruct-2507-FP8
   (4 GPU vacías, ~250 GB). Si el servidor tiene salida a Hugging Face, pueden probarse otros abiertos grandes.
3. Para cada candidato: servirlo (o usar el puerto que ya corra), y correr `research/bench/investors/analysis/v9/names_check.mjs`
   vía `go-v9.sh` (no gasta Exa). Medir: oro nombrado en p01–p06 solo con el modelo, y leyendo listas (`fleet_lists`); y en p07–p12.
4. Regla: si el oro se nombra en ≥4/6 de p01–p06, `go-v9.sh` lanza solo la corrida formal (18 corridas, tope 5 USD). Si no, dejar
   la tabla por modelo y apagar lo propio con `stop`. Una sola corrida formal.
5. Al terminar: apagar el modelo propio, confirmar con `g355-health.sh` que lo ajeno no cambió, documentar en
   `docs/handoff/V12-CAMBIOS.md` y en la nota del proyecto Código/18, y commit sin atribuciones.

Salida: tabla modelo × (oro nombrado p01–p06 solo, con listas, p07–p12, gain≥2 nombrados, segundos por llamada).
