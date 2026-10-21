# PROMPT v13 · para GPT/Codex (despliegue en Voltage Park g355) · compilador 30B + juez 120B

Reglas vigentes (las de PROMPT-v12): todo en español, texto plano, solo cifras, sin adjetivos.
No leer ni imprimir claves ni `research/.env`. Commits SIN Co-Authored-By ni Claude-Session.
Solo lo propio: procesos con `.pid` en `~/.outreach-engine/` y archivos de `~/outreach-engine-serve/`. No tocar la flota compartida (8000 Qwen3-30B, 8001, 8002, 8003 baai, 8004 mixbread, 8005 si existe) ni procesos de otros usuarios. Si algo ajeno cambia en el snapshot antes/después, parar y reportar.
No editar `research/server/**`, `research/agent/**` ni `research/bench/**`: de ese código se ocupa CLAUDE (PROMPT-v13-claude-arquitectura.md). Tú tocas `research/scripts/g355-*`, `run-mac.sh`, `tunnel-g355.sh` y `docs/handoff/V13-DESPLIEGUE.md`.

## Objetivo

Tener servidos a la vez, en las 2 GPU libres, dos modelos de familias distintas:
- Juez: `openai/gpt-oss-120b` (1 GPU, TP=1), puerto 8016.
- Compilador: `Qwen/Qwen3-30B-A3B-Instruct-2507` (1 GPU, TP=1), puerto 8017.
Ambos solo en 127.0.0.1 de g355, accesibles desde el Mac por túnel SSH (alias `voltage-park`).

## Estado de partida (13/10)

- Hoy corre `Qwen/Qwen3-235B-A22B-Instruct-2507-FP8` en el puerto 8016, GPU 6 y 7, TP=2, 132.9 de 143.8 GB por GPU, contexto 16 384, 4 secuencias, endpoint 127.0.0.1. gpt-oss-120b no está en ejecución.
- El caché de Hugging Face del servidor lista 78 carpetas. `openai/gpt-oss-120b` NO aparece en esa lista (sí `openai/gpt-oss-20b`), aunque ya se sirvió antes (~70 GB según `MOTOR_V2_RUNBOOK.md`): buscarlo en otras rutas (`/data/*/.cache/huggingface/hub`, `HF_HOME`). `Qwen/Qwen3-30B-A3B-Instruct-2507` sí aparece.
- `research/scripts/g355-serve-engine-model.sh` sirve UN modelo propio a la vez: si ya hay uno propio de otro modelo, lo apaga para liberar las GPU. Para tener dos a la vez hay que extenderlo.

## Tareas

1. Foto previa, solo lectura: `ssh voltage-park 'bash -s -- --snapshot' < research/scripts/g355-health.sh` y `g355-inventory.sh`. Reportar GPU libres/ocupadas (MiB), disco libre, versión de vLLM (gpt-oss exige ≥ 0.10.2), y dónde están los pesos de los dos modelos. Si falta gpt-oss-120b y hay que descargar, comprobar espacio (peso + 50 GB de margen) y salida a Hugging Face; si no hay, parar y reportar antes de seguir.
2. Extender el script sin romper su comportamiento por defecto: instancias con nombre (`ENGINE_NAME=judge|compiler`, archivos `.pid` y logs separados, `stop` por nombre y `stop all`), puerto, GPU y contexto por instancia. El modo actual (sin `ENGINE_NAME`) debe seguir igual. Probar con `check` (solo lectura) antes de arrancar.
3. Apagar solo el 235B propio con su `stop`. Confirmar que GPU 6 y 7 quedan por debajo de 1000 MiB y que lo ajeno no cambió.
4. Levantar el juez: gpt-oss-120b, TP=1, una GPU (6), puerto 8016, contexto 32 768 como mínimo (65 536 si cabe), ≥ 4 secuencias en paralelo, 127.0.0.1. Verificar que el JSON del juez llega limpio en `content` (razonamiento separado, no mezclado) y anotar el flag usado. Reportar `reasoning_effort` por defecto.
5. Levantar el compilador: Qwen3-30B-A3B-Instruct-2507, TP=1, la otra GPU (7), puerto 8017, contexto 32 768, ≥ 8 secuencias en paralelo, 127.0.0.1. Si no cabe en esa GPU, NO usar la flota compartida sin avisar: reportar la cifra de memoria y proponer alternativa (la 30B de la flota en 8000 está en uso compartido).
6. Prueba de humo por endpoint: `/v1/models`; una llamada con salida JSON estricta (`response_format` json_schema o el modo que acepte vLLM) sobre este texto de página: «Estimated Post Date: August 6, 2026. Estimated Application Due Date: October 6, 2026. Estimated Award Date: July 6, 2027. Estimated Project Start Date: July 6, 2027. The NIA intends to publish a NOFO.» pidiendo `{fechas:[{rol,fecha,cita}], tipo_pagina}`; 3 repeticiones con segundos por llamada y tokens/s; 4 llamadas simultáneas. Tabla modelo × (segundos, tokens/s, JSON válido sí/no, concurrencia probada).
7. Túnel: dejar documentado el comando exacto para abrir desde el Mac 127.0.0.1:8016 y 127.0.0.1:8017 hacia g355 (por ejemplo extendiendo `tunnel-g355.sh` con subcomando nuevo, sin cambiar el actual de 18000→8000). Comprobar los puertos libres en el Mac antes.
8. Escribir `docs/handoff/V13-DESPLIEGUE.md` con: modelos, puertos, GPU, contexto, concurrencia, flags de vLLM, valores para `research/.env` (`COMPILER_LLM_URL`, `COMPILER_LLM_MODEL`, `COMPILER_LLM_JSON_MODE`, `COMPILER_LLM_TIMEOUT_MS`, `JUDGE_LLM_URL`, `JUDGE_LLM_MODEL`, `JUDGE_LLM_REASONING_EFFORT`, `JUDGE_LLM_JSON_MODE`, `JUDGE_LLM_TIMEOUT_MS`; sin claves), cómo apagar cada uno, cómo comprobar salud, y el snapshot antes/después.
9. Al terminar NO apagues los dos modelos (se necesitan para las pruebas); deja el comando `stop all`. Confirma con `g355-health.sh` que lo ajeno no cambió.

Salida: `docs/handoff/V13-DESPLIEGUE.md` y la tabla de la tarea 6. Si una cifra no se pudo medir, escribir «no medido» y por qué.
