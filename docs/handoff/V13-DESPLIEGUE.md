# V13: despliegue del compilador y el juez en g355

Fecha: 2026-10-13, zona `America/Bogota`.

Estado: ejecutado. Los dos procesos continúan activos. Esta verificación confirma servicio, formato JSON y concurrencia técnica; no mide calidad general, resultados comerciales ni validación de usuarios.

## Resultado

| Rol | Modelo | Puerto | GPU | Contexto | `max-num-seqs` | Memoria final |
|---|---|---:|---:|---:|---:|---:|
| juez | `openai/gpt-oss-120b` | 8016 | 6 | 65.536 | 4 | 127.524 MiB de 143.771 MiB |
| compilador | `Qwen/Qwen3-30B-A3B-Instruct-2507` | 8017 | 7 | 32.768 | 8 | 126.298 MiB de 143.771 MiB |

Los dos servidores escuchan en `127.0.0.1` de g355. `/v1/models` devolvió el identificador previsto en ambos puertos.

Runtime compartido por las dos instancias:

- Python: `/data/gcaicedo/outreach-vllm-cu126/bin/python`
- vLLM: `0.11.1`
- PyTorch: `2.9.0+cu126`
- CUDA del runtime: `12.6`
- GPU disponible para PyTorch: `true`

Flags del juez:

```text
--host 127.0.0.1
--port 8016
--tensor-parallel-size 1
--max-model-len 65536
--gpu-memory-utilization 0.88
--max-num-seqs 4
--reasoning-parser openai_gptoss
--enable-prefix-caching
--enable-chunked-prefill
```

Flags del compilador:

```text
--host 127.0.0.1
--port 8017
--tensor-parallel-size 1
--max-model-len 32768
--gpu-memory-utilization 0.88
--max-num-seqs 8
--enable-prefix-caching
--enable-chunked-prefill
```

El valor configurado por defecto para `reasoning_effort` del juez es `medium`. El parser `openai_gptoss` separó el razonamiento: las respuestas incluyeron los campos `reasoning` y `reasoning_content`, mientras `content` contenía solo el JSON solicitado, sin marcadores de razonamiento.

## Pesos y disco

Antes del inicio, los directorios de ambos modelos contenían metadatos pero no shards:

- `openai/gpt-oss-120b`: 0 de 15 shards presentes.
- `Qwen/Qwen3-30B-A3B-Instruct-2507`: sin índice ni archivos `safetensors` presentes.
- Disco libre en `/data`: 388 GB.
- Salida a Hugging Face: HTTP 200.

La descarga del juez tardó 66,6 s; la del compilador, 34,4 s. Tamaños finales registrados por `du`:

- `openai/gpt-oss-120b`: 119 GB.
- `Qwen/Qwen3-30B-A3B-Instruct-2507`: 57 GB.
- Disco libre final en `/data`: 213 GB en el snapshot; `df -BG` mostró 214 GB por redondeo.

## Prueba de humo

Entrada:

```text
Estimated Post Date: August 6, 2026. Estimated Application Due Date: October 6, 2026. Estimated Award Date: July 6, 2027. Estimated Project Start Date: July 6, 2027. The NIA intends to publish a NOFO.
```

Esquema estricto: `{fechas:[{rol,fecha,cita}], tipo_pagina}`, con campos obligatorios y `additionalProperties:false`.

Cada modelo recibió 3 llamadas secuenciales y después 4 llamadas simultáneas. `tokens/s` se calculó como `completion_tokens / segundos`; en el juez, `completion_tokens` incluye los tokens de razonamiento reportados por el servidor.

| Modelo | 3 llamadas: segundos | 3 llamadas: tokens/s | JSON válido | 4 simultáneas: segundos por llamada | 4 simultáneas: tokens/s | Tiempo de pared | Concurrencia probada |
|---|---|---|---|---|---|---:|---:|
| `openai/gpt-oss-120b` | 2,771 · 2,727 · 2,754 | 184,778 · 185,205 · 187,026 | 3/3 | 3,604 · 3,604 · 3,521 · 4,240 | 136,785 · 142,047 · 138,900 · 147,416 | 4,345 s | 4/4 |
| `Qwen/Qwen3-30B-A3B-Instruct-2507` | 3,247 · 1,600 · 1,683 | 76,384 · 155,026 · 147,339 | 3/3 | 2,369 · 2,374 · 2,374 · 2,458 | 104,698 · 104,455 · 104,443 · 100,880 | 2,461 s | 4/4 |

Las 14 respuestas cumplieron el esquema. Las 14 extrajeron las 4 fechas y conservaron las 4 citas literales. Esto es una prueba sobre un texto, no una medición de calidad general.

## Túnel desde el Mac

Antes de consolidar el túnel, 8016 estaba ocupado por un proceso SSH que ya reenviaba `8016 → g355:8016`; 8017 estaba libre. Se cerraron esos reenvíos y se abrieron juntos bajo un socket administrado por el script.

Abrir en segundo plano:

```bash
bash research/scripts/tunnel-g355.sh dual-bg
```

Abrir en primer plano:

```bash
bash research/scripts/tunnel-g355.sh dual
```

Comprobar:

```bash
bash research/scripts/tunnel-g355.sh dual-status
curl -sS http://127.0.0.1:8016/v1/models
curl -sS http://127.0.0.1:8017/v1/models
```

Cerrar solo el túnel abierto con `dual-bg`:

```bash
bash research/scripts/tunnel-g355.sh dual-stop
```

El modo anterior `18000 → g355:8000` conserva los subcomandos `fg`, `bg`, `status` y `stop`.

## Valores para `research/.env`

No se modificó ni se leyó `research/.env`.

```text
COMPILER_LLM_URL=http://127.0.0.1:8017/v1
COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507
COMPILER_LLM_JSON_MODE=1
COMPILER_LLM_TIMEOUT_MS=240000

JUDGE_LLM_URL=http://127.0.0.1:8016/v1
JUDGE_LLM_MODEL=openai/gpt-oss-120b
JUDGE_LLM_REASONING_EFFORT=medium
JUDGE_LLM_JSON_MODE=1
JUDGE_LLM_TIMEOUT_MS=240000
```

## Operación

Comprobar salud sin modificar procesos:

```bash
ssh voltage-park 'bash -s -- --snapshot' < research/scripts/g355-health.sh
curl -sS http://127.0.0.1:8016/v1/models
curl -sS http://127.0.0.1:8017/v1/models
```

Detener solo el juez:

```bash
ssh voltage-park 'ENGINE_NAME=judge bash ~/outreach-engine-serve/g355-serve-engine-model.sh stop'
```

Detener solo el compilador:

```bash
ssh voltage-park 'ENGINE_NAME=compiler bash ~/outreach-engine-serve/g355-serve-engine-model.sh stop'
```

Detener todas las instancias registradas por este script:

```bash
ssh voltage-park 'bash ~/outreach-engine-serve/g355-serve-engine-model.sh stop all'
```

Los archivos de estado son:

```text
~/.outreach-engine/vllm-judge.pid
~/.outreach-engine/vllm-compiler.pid
~/.outreach-engine/vllm-judge.log
~/.outreach-engine/vllm-compiler.log
~/.outreach-engine-judge.env
~/.outreach-engine-compiler.env
```

## Snapshot antes y después

| Recurso | Antes | Después | Cambio |
|---|---:|---:|---:|
| GPU 0 | 53.144 MiB | 53.144 MiB | 0 MiB |
| GPU 1 | 80.509 MiB | 80.509 MiB | 0 MiB |
| GPU 2 | 111.396 MiB | 111.396 MiB | 0 MiB |
| GPU 3 | 111.396 MiB | 111.396 MiB | 0 MiB |
| GPU 4 | 3.747 MiB | 3.747 MiB | 0 MiB |
| GPU 5 | 131.810 MiB | 131.810 MiB | 0 MiB |
| GPU 6 | 134.608 MiB, 235B propio | 127.524 MiB, juez | −7.084 MiB |
| GPU 7 | 134.608 MiB, 235B propio | 126.298 MiB, compilador | −8.310 MiB |
| `/data` libre | 388 GB | 213 GB | −175 GB |
| RAM disponible | 405 GB | 402 GB | −3 GB |
| seguidores de log huérfanos | 0 | 0 | 0 |

La flota compartida mantuvo los mismos procesos y los mismos valores de memoria en las GPU 0–5. No había acceso a Docker con este usuario antes ni después. El conteo `own_vllm` del script de salud no es comparable entre los dos snapshots porque se amplió durante esta tarea para contar tanto `vllm serve` como `api_server`; la comparación se hizo con PID, línea de comando, puerto y memoria por GPU.

## Archivos modificados

- `research/scripts/g355-serve-engine-model.sh`: instancias con nombre, PID y log por instancia, parada individual, `stop all`, contexto, GPU, puerto, concurrencia y parser configurables; conserva el modo sin `ENGINE_NAME`.
- `research/scripts/g355-health.sh`: cuenta las dos formas de inicio de vLLM, incluye los dos modelos objetivo y lista PID registrados.
- `research/scripts/tunnel-g355.sh`: añade `dual`, `dual-bg`, `dual-status` y `dual-stop`; conserva el túnel anterior.
- `docs/handoff/V13-DESPLIEGUE.md`: este registro.

No se modificaron `research/server/**`, `research/agent/**`, `research/bench/**` ni `research/.env`.
