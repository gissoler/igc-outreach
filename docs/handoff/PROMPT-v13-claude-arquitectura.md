# PROMPT v13 · para CLAUDE (código y arquitectura) · agente de compilación + agente juez

Reglas vigentes (las de PROMPT-v12): todo en español, texto plano, solo cifras, sin adjetivos, sin etiquetar fondos ni convocatorias a ojo.
No leer ni imprimir claves de `research/.env`. Exa solo con script de un comando, con dry run y tope (5 USD, `analysis/exa_spend.mjs --usd-per-call 0.0089`).
Commits SIN Co-Authored-By ni Claude-Session. Un commit por tarea.
No editar archivos congelados: la lista está en PROMPT-v12. Ojo: `research/bench/investors/engine.mjs` está congelado y `research/server/research/engine.mjs` es el del producto. Comprobar la lista antes de tocar cada archivo; lo nuevo del benchmark va en archivos `.v13`.
No tocar la flota compartida de g355 (puertos 8000–8005). Del despliegue se ocupa GPT (PROMPT-v13-gpt-despliegue.md): no editar `research/scripts/g355-*`, `run-mac.sh` ni `tunnel-g355.sh`.
`research/data/prod-research.sqlite` es una copia de producción con cuentas de usuarios. Solo lectura, solo las tablas `jobs` y `sources`. No abrir `users`, `sessions` ni `account_*`. No se commitea (`research/data/` y `research/eval/runs/` están en .gitignore).

## Objetivo

Incorporar en la arquitectura del agente iterativo, para grants e inversionistas con el mismo motor de búsqueda, dos agentes sobre dos modelos distintos:
1. Agente de compilación (rol `compiler`, Qwen/Qwen3-30B-A3B-Instruct-2507): recopila. Lee cada página y devuelve candidatos y hechos con cita literal.
2. Agente de validación/juez (rol `judge`, openai/gpt-oss-120b): valida los datos del compilador contra la página y el brief, criterio por criterio.
Meta: resolver de forma definitiva los fallos de filtro (elegibilidad, deadline, región, tipo de entidad, etapa), sin añadir patrones de fechas.

## Evidencia (13/10)

- Corrida de producción `98eccb69` (12/10, brief IGC pharma / mint ad) y repetición local `research/eval/runs/2026-10-13-19-37-repro-jefe/` (Qwen3-235B, 1727 s, 12 verificadas, 0 apply). Brief guardado en `research/eval/briefs/jefe-igc-mint-ad-2026-10-12.json`.
- Caso 1: simpler.grants.gov `b19c89bb-baf4-4121-a24f-28891f9b1111` (NIA «Novel Approaches to Advance Precision Aging and Cognitive Health»). Sale `open`, cierre 2027-07-06, 267 días. Es un aviso previo («intends to publish») con fechas «Estimated».
- Caso 2: simpler.grants.gov `7a4a9822-f39f-464d-8a1d-d941afaebcdf` (NIAGADS). Mismo formato. Sale `open`, cierre 2026-11-01.
- En los dos casos el modelo (gpt-oss-120b en producción, Qwen3-235B en la repetición) etiquetó bien las fechas con su cita literal: Estimated Post Date, Estimated Application Due Date, Estimated Award Date, Estimated Project Start Date.
- `research/server/research/dates.mjs` (361 líneas de patrones) las reetiquetó mal: corrió las etiquetas una columna (regla de tablas, cerca de la línea 248) y marcó la fecha de publicación (2026-08-06) como «Application Due» y la de adjudicación (2027-07-06) como «Due Date». Con `deadline_conflict`, `verify.mjs:115` manda el caso a «a verificar», pero se muestra la fecha del código con «267 días».
- El modelo también falló: devolvió `status: upcoming` con cierre 2026-10-06 cuando hoy era 2026-10-12. La resta con la fecha de hoy debe hacerla el código.
- Conclusión pedida: el modelo asigna el rol de cada fecha; el código audita (cita literal presente en la página, resta contra hoy). El lector por patrones deja de decidir y queda como alarma.

## Arquitectura pedida

Flujo por página, igual para grants e inversionistas (cambia el catálogo de criterios por dominio):
1. Compilador (30B): recibe brief, fecha de hoy y texto de la página. Devuelve JSON validado con: identidad, tipo de página (convocatoria, aviso previo/forecast, programa, noticia, agregador…), lista de fechas `{rol, fecha, cita}`, elegibilidad (tipos de solicitante, países/regiones, etapa, ánimo de lucro) con cita, monto con cita. Roles de fecha: `application_deadline`, `loi_deadline`, `opens`, `award`, `project_start`, `posted`, `other`.
2. Juez (120B): recibe brief, hoy, el texto de la página y el registro del compilador como afirmaciones a verificar. Devuelve, por criterio (deadline, elegibilidad, región, tipo de entidad, etapa, encaje temático): `{veredicto: yes|no|unknown, cita, motivo}`. Debe poder contradecir al compilador. Decidir y justificar con una prueba si conviene ocultarle la conclusión del compilador (independencia) o no.
3. Código (auditor): comprueba que cada cita esté literal en la página; convierte la cita a fecha; compara con hoy; aplica la regla de estado. No clasifica fechas por patrones.
4. Reglas de integración:
   - Estado por código a partir del rol del juez: si todas las fechas `application_deadline` verificadas son anteriores a hoy → `closed`. Si la página es un aviso previo o las fechas son «Estimated» → `forecast` (no `open`; no muestra «días restantes»). Si no hay fecha de cierre verificable → `unknown`.
   - Compilador y juez en desacuerdo, cita ausente o juez sin respuesta → «a verificar» con ambas lecturas visibles. Nunca lista principal.
   - Juez caído o con JSON inválido: falla cerrado (nada entra a la lista principal), con aviso visible. Un JSON inválido en una página no termina la corrida.
   - `dates.mjs` sigue corriendo como alarma (`date_pattern_disagrees`), sin cambiar el estado ni la fecha mostrada.
   - Todo detrás de bandera (`ENGINE_JUDGE=1`, apagada por defecto). Sin los roles configurados, el comportamiento actual no cambia y se avisa.
   - El texto de las páginas es dato no confiable (`<page_data>`), nunca instrucción.
5. Auditoría: el Run audit muestra, por página, modelo compilador, modelo juez, veredicto por criterio, citas, desacuerdos, tiempo y número de llamadas por modelo.

Brief: los criterios (tipo de entidad, país/estado, etapa, monto, uso de fondos) ya existen en `brief` (`entityType`, `country`, `state`, `stage`, `amount`, `useOfFunds`, `minDays`). Lo que falta es la fecha. La fecha de hoy la pone el sistema (no el usuario). Antes de implementar el cambio de intake/brief, preguntar a Gisel con una pregunta cerrada qué falta exactamente (propuesta: ventana de cierre aceptable `deadlineFrom`/`deadlineTo`, además de `minDays`) y qué pasa con convocatorias `forecast`.

## Contrato con el despliegue (lo implementa GPT)

Variables en `research/.env` (sin claves en el repo; documentar en `.env.example`):
- `COMPILER_LLM_URL=http://127.0.0.1:8017/v1`, `COMPILER_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507`, `COMPILER_LLM_JSON_MODE`, `COMPILER_LLM_TIMEOUT_MS`.
- `JUDGE_LLM_URL=http://127.0.0.1:8016/v1`, `JUDGE_LLM_MODEL=openai/gpt-oss-120b`, `JUDGE_LLM_REASONING_EFFORT`, `JUDGE_LLM_JSON_MODE`, `JUDGE_LLM_TIMEOUT_MS`.
Los valores finales los confirma `docs/handoff/V13-DESPLIEGUE.md` (lo escribe GPT). Mientras tanto, todo se prueba con modelos simulados, como el resto de la suite.

## Tareas (en orden)

T0 · Línea base y auditoría, sin cambiar código. Correr `node --test tests/*.test.mjs` en `research/` y anotar pasan/fallan/omitidas. Documentar en `docs/handoff/V13-AUDITORIA.md`: (a) si grants e inversionistas comparten hoy el camino de búsqueda y lectura (`server/research/engine.mjs`, `investor.mjs`, `research/agent/`, `research/agent/eligibility_judge.mjs`, `research/bench/`), (b) dónde se decide hoy cada criterio y por quién, (c) la propuesta de núcleo + paquete de dominio del 07/10 (rama `arquitectura/agente-general-2026-10-07`): `git branch -a` solo muestra main, origin/main y mejoras-busqueda-2026-09-30; comprobar si existe en el remoto antes de asumirla.
T1 · Pre-registro `docs/handoff/V13-PREREGISTRO.md` con los criterios de aceptación de abajo, antes de correr nada.
T2 · Roles `compiler` y `judge` en la configuración de la flota (`fleetConfig`) y `.env.example`, con respaldo explícito.
T3 · Esquemas JSON del compilador y del juez (contratos nuevos, sin editar los v1/v2 existentes) y prompts nuevos versionados.
T4 · Auditor por código: cita literal, conversión a fecha, resta contra hoy, regla de estado (`closed`, `forecast`, `unknown`, `open`). Sin patrones nuevos de fechas.
T5 · Integración en el motor del producto con `ENGINE_JUDGE`, grants e inversionistas, y panel Run audit.
T6 · Pruebas con modelos simulados: las dos páginas NIA como fixtures (texto desde la tabla `sources` de la copia de producción para el job `98eccb69`, o desde el `result.json` de la repetición; solo esas páginas), desacuerdo compilador/juez, cita inventada, juez caído, JSON inválido, aviso previo con fechas «Estimated», fecha pasada con `status: upcoming` del modelo. Más un caso de inversionistas.
T7 · Prueba aislada de fechas, sin búsqueda ni Exa, sobre las páginas guardadas con fecha conocida (`eval/regression/mentiva-grants.mjs`, `eval/gold/`, caché de páginas): variantes A (solo código, hoy), B (solo modelo con la página y la fecha de hoy), C (compilador + juez + auditor). Script nuevo `research/scripts/dates-ab.mjs` que corre contra los endpoints reales cuando existan y contra simulados en pruebas. Tabla: páginas, aciertos abierta/cerrada/aviso previo, citas inválidas, segundos por llamada, por variante y por modelo.
T8 · Cuando GPT confirme los endpoints: repetir la corrida del 12/10 con `scripts/engine-run.mjs --brief eval/briefs/jefe-igc-mint-ad-2026-10-12.json --objectives grant --today 2026-10-12 --no-cache` con `ENGINE_JUDGE=1`, y comparar con la repetición anterior. Registrar duración y llamadas por modelo.

## Criterios de aceptación (a pre-registrar)

1. Los dos casos NIA no salen como `open` ni en la lista principal ni con «días restantes»; salen `forecast` o «a verificar», con el motivo visible.
2. 0 casos donde una cita ausente de la página sostenga una decisión.
3. Juez caído o JSON inválido: 0 entradas nuevas en la lista principal.
4. La suite completa pasa igual o mejor que la línea base de T0; `eval/regression/mentiva-grants.mjs` mantiene 0 cerradas como abiertas, 0 sin fecha en la lista principal, 0 no-convocatorias retenidas, 0 no elegibles como `apply`, 100 % de fechas con cita.
5. T7 reporta las cifras de A, B y C; no se promociona C por intuición. Si B o A superan a C en aciertos, decirlo.
6. `dates.mjs` no cambia de estado ni de fecha mostrada ningún resultado.

## Salida

`docs/handoff/V13-CAMBIOS.md` (qué cambió, flags, variables nuevas, cifras de T0/T7/T8, lo que no se pudo medir) y una nota corta para el vault Outreach. No afirmar nada que no esté medido. Cualquier decisión de producto sin respaldo se deja como pregunta, no como cambio.
