# Motor v2 — cómo correrlo (29/09/2026)

## Cómo correrlo (desde tu Mac)

Reparto: **el motor (`research`, APIs de búsqueda, `.env`) corre en el Mac; en g355 solo vive el modelo de IA**, conectados por un túnel SSH.

**Paso 0 (solo lee):** `ssh voltage-park 'bash -s -- check' < research/scripts/g355-serve-engine-model.sh` dice qué runtime, modelo, GPU y puerto usaría, sin arrancar nada.

**A. Sin tocar nada en g355 (recomendado para empezar)** — usa un modelo que ya corre allí (p. ej. `Qwen/Qwen3.6-27B-FP8` en el puerto 8005):
```bash
cd ~/Documents/PROJECTS/AGENT
ENGINE_REMOTE_PORT=8005 bash research/scripts/run-mac.sh
```
No levanta ni apaga nada en g355; solo abre el túnel y le manda peticiones. Compara ese modelo con Qwen3-30B (mismas búsquedas en caché).
Si el modelo razona y tarda demasiado: `ENGINE_LLM_THINKING=0` (desactiva el modo de razonamiento en modelos Qwen).

**B. Levantar un modelo grande propio** (usa GPUs vacías):
```bash
bash research/scripts/run-mac.sh
```
Copia a g355 solo los scripts `g355-serve-engine-model.sh` y `g355-health.sh` (no `.env` ni código) y lo levanta **con el mismo vLLM del sistema que usa la flota** (`/usr/bin/python3`, ya compatible con el driver 560), como proceso propio de tu usuario (grupo de procesos aparte, `nice 10`, solo `127.0.0.1`).
Tu usuario no está en el grupo `docker`, así que Docker no se usa (el script lo soporta si algún día lo tienes). Modelo `auto`: `openai/gpt-oss-120b` (1 GPU) si vLLM ≥ 0.10.2; si no, Qwen3-235B-FP8 (necesita 4 GPU vacías).
Puerto: el primero libre desde 8010 (el 8010 ya lo usa otro servicio).

En ambos casos: el script prueba las APIs, abre el túnel, corre Mentiva (grants e inversores) con el modelo grande y luego con Qwen3-30B, cierra el túnel y deja reportes en `research/eval/runs/<fecha>-<modelo>/report.md`.

### Variables útiles (anteponer al comando)

| Variable | Por defecto | Para qué |
|---|---|---|
| `OBJECTIVES` | `grant,investment` | objetivos a correr (grant, investment, debt, partnering, sponsorship) |
| `BRIEF` | `eval/briefs/mentiva.json` | otro brief |
| `COMPARE_30B` | `1` | `0` = no repetir con Qwen3-30B |
| `ENGINE_MODEL` | `auto` | `auto`, un modelo de Hugging Face, o `none` (no levantar ninguno) |
| `ENGINE_REMOTE_PORT` | — | usar el modelo que ya corre en ese puerto de g355 (modo A) |
| `ENGINE_PYTHON` | el python de la flota | python con vLLM a usar |
| `ENGINE_PORT` | primero libre desde 8010 | puerto en g355 |
| `ENGINE_TP` / `ENGINE_GPUS` | `1` / auto | GPUs para modelos más grandes (p. ej. `ENGINE_TP=2`) |
| `ENGINE_SEARCH_PROVIDERS` | todos | p. ej. `exa,tavily` para medir un subconjunto |

Ejemplo: `OBJECTIVES=investment COMPARE_30B=0 bash research/scripts/run-mac.sh`

Apagar el modelo grande (borra el contenedor `outreach-engine-*`): `ssh voltage-park 'bash ~/outreach-engine-serve/g355-serve-engine-model.sh stop'`.
El entorno pip que dejó el primer intento (`~/.outreach-engine/venv` en g355) ya no se usa cuando hay Docker; se puede borrar con `rm -rf`.

El script termina con código distinto de 0 y una lista de problemas si algo falla (modelo, túnel, APIs, o `engine-run`); solo dice «Todo correcto» si todo salió bien.

## Qué cambió en el código

| Pieza | Archivo |
|---|---|
| Clientes Linkup, Exa, You.com, Tavily, Jina (búsqueda) + Jina Reader; fusión por URL y orden por consenso | `server/research/searchApis.mjs` |
| El motor usa las APIs si hay claves (antes: SearXNG o Firecrawl); páginas sin texto → descarga directa → Jina Reader (JS/PDF); auditoría por proveedor | `server/research/engine.mjs` |
| Rol `engine` (ENGINE_LLM_*): el modelo que planea y lee se cambia sin tocar el 30B del resto de la app | `server/analysis/fleet.mjs` |
| Pruebas (APIs simuladas) | `tests/searchApis.test.mjs` |
| Scripts | `run-mac.sh` (principal), `search-apis-check.mjs`, `engine-run.mjs`, `g355-serve-engine-model.sh`, `tunnel-g355.sh`; alternativa todo-en-g355: `g355-engine.sh`, `push-to-g355.sh` |
| Claves | `.env` (las 5); variables documentadas en `.env.example` |

Copia de los archivos anteriores en `.backup-2026-09-29/`.

## Cambios tras la primera corrida real (30/09, Qwen3-30B)

La corrida parcial (184 s, 36 consultas, 38 retenidos, recall de grants 1/5) mostró falsos positivos y un proveedor sin saldo. Ajustes (con pruebas en `tests/engineGuards.test.mjs`):

| Problema visto | Ajuste |
|---|---|
| Linkup falló 36/36 (sin saldo) | Cortacircuito: un proveedor con error fatal (401/402/403/432/433, «credit», «balance»…) se apaga para el resto de la corrida; otros fallos, tras 3 seguidos. El reporte lo marca «⚠ apagado» |
| Directorio de Y Combinator, Cognito (empresa que recibió inversión), Advent (adquisición) como «inversores» | El modelo debe decir qué es la página (`kind`: programa, financiador, inversor, prestamista, empresa, noticia de operación, directorio, noticia…). Solo entra el tipo que el objetivo pide (inversión → `investor`). Sin `kind` no se descarta, pero se avisa (`kind_missing`) |
| `apply` con citas inventadas (`fake_quote`) | Una cita inventada impide `apply` (baja a `watch`); dos o más descartan la lectura entera (`unreliable_read`) |
| Directorios y blogs de listas (roundfunded, hellodarwin, ellty, spinverse, YC/companies…) | Añadidos a la lista de agregadores (heurística: hay que ampliarla cuando aparezcan más) |

**Lo que estos ajustes no arreglan:** (1) la cobertura: 1/5 de recall significa que las consultas que planeó el 30B no llegaron a MIT Solve, One Mind, NIH ni Future of Health; un planificador más fuerte es la palanca (por eso el modelo grande). (2) La elegibilidad: varios `apply` eran de solicitantes solo de Canadá o consorcios de la UE; eso depende de que el modelo compare la página con el brief, y el código no lo puede comprobar. Los reportes siguientes dirán si el modelo grande lo hace mejor.

## Cuidado con g355 (reglas fijas)

g355 es una máquina compartida con la flota; Outreach debe dejarla como la encontró.

| Regla | Cómo se cumple |
|---|---|
| No tocar la flota | (la flota corre como root con el vLLM del sistema; nuestro proceso es de tu usuario y no puede afectarla) Solo GPUs **vacías** (< 1000 MiB usados; `ENGINE_IDLE_MIB`). Si no hay suficientes, no arranca y lo dice. Nunca se comparte una GPU con procesos ajenos salvo `ENGINE_GPUS` explícito. Solo se borran contenedores llamados `outreach-engine-*` |
| Sin privilegios | Nunca `sudo`. El modelo propio corre como tu usuario, con `nice 10`, en su propio grupo de procesos y escucha solo en `127.0.0.1` (se accede por túnel SSH); sin `--trust-remote-code`. Solo se detienen procesos cuyo pid escribió este script y cuya línea de comando coincide |
| No cargarla de cosas | Sin un runtime de vLLM utilizable **no instala nada** (pip solo con `ENGINE_ALLOW_PIP=1`). Sin procesos de fondo (nada de `docker logs -f`). Si algo falla, borra su contenedor a medias |
| Disco | Antes de descargar comprueba espacio (peso del modelo + 50 GB de margen) y se niega si no alcanza. Los pesos descargados se quedan en `HF_HOME` (~70 GB gpt-oss, ~250 GB Qwen3-235B); borrarlos es decisión tuya |
| Apagar al terminar | Si `run-mac.sh` levantó el modelo (modo B), lo apaga al final y también si lo interrumpes (Ctrl-C). `KEEP_MODEL=1` lo deja corriendo |
| Verificar integridad | `run-mac.sh` toma una foto de g355 antes y después (contenedores, GPUs, disco, RAM, carga) y **falla con aviso** si un contenedor ajeno se reinició o desapareció, si una GPU ajena cambió > 1,5 GB, o si quedan contenedores/procesos vLLM propios |

Revisar la huella de Outreach (solo lee): `ssh voltage-park 'bash -s' < research/scripts/g355-health.sh`. Inventario completo (permisos, cómo corre la flota, quién carga la CPU): `g355-inventory.sh`.
El intento con pip dejó `~/.outreach-engine/venv` (7,5 GB, vLLM con CUDA 13, inservible con el driver 560): se puede borrar.

## Qué mira el reporte

- **Aporte de cada buscador:** resultados, errores, coste, páginas verificadas y cuántas *solo* trajo ese buscador → dice cuáles valen la pena.
- **Recall contra la lista de referencia** (grants Mentiva): MIT Solve, One Mind, NIH PAR-25-136, EIC Accelerator, Future of Health.
- Oportunidades verificadas con citas literales, y todas las consultas ejecutadas.

## Usarlo en la app (encender y apagar)

Un solo comando, con el Qwen3-30B que ya corre en g355 (no arranca nada allí):

`bash research/scripts/app-motor.sh`

Abre el túnel (18000 → g355:8000), enciende el motor v2 en `research/.env` y arranca el servidor de research. Con Ctrl-C apaga el servidor, cierra el túnel y deja el `.env` como estaba. Si el `.env` ya tiene `ENGINE_V2`, `VLLM_CHAT_*` o `ENGINE_*` propios fuera del bloque, se detiene y avisa. Antes, para el servidor de research si ya está corriendo. `app-engine.sh on|off|status` edita solo el `.env`.

Cada búsqueda de la app añade la fuente «engine» (2–3 min con 18 consultas por objetivo). El motivo de usar el 30B: en la segunda tanda verificó 16 grants y acertó 1/5 (el 27B: 2 y 0/5), aunque en inversores el 27B verificó 13 frente a 9 (sin lista de referencia de inversores no se puede decir cuál es mejor).

## No verificado todavía

- Ninguna API se probó en vivo desde aquí (la red del entorno de desarrollo las bloquea). Los formatos siguen la documentación oficial
  de cada proveedor; el paso 2 del script confirma cada una y muestra el error exacto si alguna falla.
- Que g355 tenga salida a Hugging Face (para bajar los pesos) y que el túnel SSH funcione desde tu Mac.
- Que el vLLM de la flota soporte gpt-oss; si no, el script crea un entorno con vLLM reciente y reintenta solo.
