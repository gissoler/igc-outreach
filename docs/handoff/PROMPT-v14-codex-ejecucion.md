# PROMPT v14 · para CODEX · ejecución del plan de Claude (trazas, agente primero, limpieza)

Entrada obligatoria: `docs/handoff/V14-PLAN-CODEX.md` y, para el contexto, `V14-DIAGNOSTICO.md`, `V14-ARQUITECTURA.md`, `V14-BENCHMARK.md`. Si falta alguno, parar y avisar a Gisel; no improvisar el plan.
Reparto: Claude diagnosticó, diseñó y escribió el plan; Codex lo ejecuta. Codex no toma decisiones de producto ni cambia el diseño. Si algo del plan choca con el código real, parar en esa tarea, escribir la discrepancia en `docs/handoff/V14-DISCREPANCIAS.md` con la evidencia y esperar.

Reglas vigentes: todo en español, texto plano, solo cifras, sin adjetivos, sin afirmar nada que no esté medido. No leer ni imprimir claves de `research/.env`; las variables de modelos se pasan en la línea de comandos. Exa solo con script de un comando con dry run y tope de 5 USD (`analysis/exa_spend.mjs --usd-per-call 0.0089`). Apollo, solo con el tope de créditos que Gisel fijó en `V14-PLAN-CODEX.md`; sin tope escrito, no se llama a Apollo. Commits sin Co-Authored-By ni Claude-Session, uno por tarea. No tocar la flota compartida de g355 (puertos 8000–8005). No editar `research/scripts/g355-*`, `run-mac.sh`, `tunnel-g355.sh`. `research/data/prod-research.sqlite`: solo lectura, solo `jobs` y `sources`, sin commitear. Archivos congelados (PROMPT-v13): no se editan; se mueven con `git mv` a `research/_archivo/` solo los que Gisel aprobó por escrito en el plan; los demás no se tocan ni se borran.

Entorno: endpoints por túnel desde el Mac (`bash research/scripts/tunnel-g355.sh dual-status`; si no responden, `dual-bg`; no editar ese script). Juez `openai/gpt-oss-120b` en 127.0.0.1:8016, compilador `Qwen/Qwen3-30B-A3B-Instruct-2507` en 127.0.0.1:8017; el 235B está apagado, así que el motor usa el 30B (`ENGINE_LLM_URL=http://127.0.0.1:8017/v1`, `ENGINE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507`). Variables de rol en `docs/handoff/V13-DESPLIEGUE.md`.

## Método

1. Antes de cada tarea: `git status` limpio salvo los cambios ajenos de GPT en `research/scripts/g355-*` y `tunnel-g355.sh`, y suite en la línea base del plan (referencia: 485 pruebas en `tests/*.test.mjs`, 483 pasan, 1 falla Apollo, 1 omitida; `tests/agent` 191, 190 pasan, 1 falla ACC-58 por la ruta de git del Mac).
2. Ejecutar la tarea tal como está en el plan: los archivos, la prueba y el comando de verificación que ella indica.
3. Después de cada tarea: suite igual o mejor que antes; un commit con solo los archivos de la tarea (`git add` por ruta, nunca `git add -A`); cifras de verificación en el mensaje del commit.
4. Si la suite empeora, deshacer la tarea con el procedimiento del plan y anotarlo en `V14-DISCREPANCIAS.md`.
5. Nada nuevo por patrones de fechas, tipo de página, región, solicitante o etapa. Si una tarea parece pedirlo, es una discrepancia.
6. Todo comportamiento nuevo detrás de bandera apagada por defecto (`ENGINE_AGENT=1`), salvo el registro de trazas, que no cambia resultados.

## Fases (el detalle, los archivos y las pruebas están en el plan)

F1 · Trazas con el motor actual. Implementar el registro (`events.jsonl`, `summary.json`, `report.md`, `pages/`) según `V14-BENCHMARK.md`, en un solo script (extender `scripts/engine-run.mjs` o el que indique el plan; no crear uno aparte si el plan no lo pide). Correr los dos casos con `ENGINE_JUDGE=1`: grant y inversionistas, con `--today 2026-10-12 --no-cache`. Guardar las carpetas de salida. Revisar que el log responde las preguntas del benchmark; si no, corregir el registro, no el motor.
F2 · Bucle del agente tras `ENGINE_AGENT=1`, según `V14-ARQUITECTURA.md`. Repetir los dos casos con la bandera y con el mismo registro. Informar, junto a la línea de F1: páginas, llamadas por rol, segundos, USD o créditos por herramienta, verificadas, pistas, descartes por motivo y por quién los decidió. Si el agente no supera a F1 en lo que fija el benchmark, decirlo en el informe y no pasar a F3.
F3 · Limpieza. Solo si F2 cumple los criterios del benchmark y solo lo que el plan lista como aprobado. Un commit por archivo o grupo, con la suite igual o mejor antes y después. No borrar nada fuera de la lista.
F4 · Informe `docs/handoff/V14-CAMBIOS.md`: líneas antes y después por directorio (`wc -l`), cifras de F1 y F2, tareas hechas y no hechas, discrepancias, lo que no se midió. Nota corta para el vault Outreach (`Outreach/Código/`, número siguiente al 18).

## Entregables

Commits por tarea; carpetas de las corridas F1 y F2 (dos casos cada una) con `events.jsonl`, `summary.json`, `report.md`, `pages/`; `V14-CAMBIOS.md`; `V14-DISCREPANCIAS.md` si hubo. No afirmar nada que no esté medido; toda decisión de producto sin respaldo queda como pregunta para Gisel.
