# V13 · Cambios: agente compilador + agente juez

Fecha de hoy en las pruebas: 2026-10-12 (fixtures NIA) y 2026-09-30 (Mentiva).

## Qué cambió

Con `ENGINE_JUDGE=1`, por página: compilador (rol `compiler`) → juez (rol `judge`) → auditor por código → `dateOverride` en `verifyOpportunity` → `applyAudit`. Grants e inversionistas usan el mismo flujo; cambia el catálogo de criterios (`CRITERIA` en `prompts.v13.mjs`). Inversionistas: sin fecha de cierre; criterios región, tipo de entidad, etapa, encaje temático; el juez solo puede bajar o descartar.

Archivos nuevos (research/): `server/research/judge/contracts.v13.mjs`, `prompts.v13.mjs`, `audit.v13.mjs`; `scripts/dates-ab.mjs`. Contratos: `docs/contracts/v13/page_compilation.schema.json`, `page_judgment.schema.json`.
Archivos modificados: `server/analysis/fleet.mjs`, `server/research/verify.mjs`, `server/research/engine.mjs`, `runAudit.mjs`, `explain.mjs`, `.env.example`, `frontend/src/researchApi.ts`, `frontend/src/app/Audit.tsx`. `frontend/dist` no se reconstruyó.
Archivos congelados: sin cambios.

Reglas del auditor (código, sin patrones de fechas nuevos):
- Fecha verificada solo si la cita está literal en la página, la fecha afirmada está en `datesIn(cita)` y la cita contiene una sola fecha.
- Estado: `forecast` (aviso previo o cualquier `application_deadline` estimada), `closed` (todas las verificadas < hoy), `upcoming` (fecha `opens` verificada > hoy), `open` (primer cierre futuro, días por resta), `unknown`, `unverified` (juez caído).
- Desacuerdo compilador/juez, cita ausente o juez sin respuesta → «a verificar» con ambas lecturas. Juez «no» con cita literal → descarte. Sí/no sin cita literal → `unknown`. Plazo del juez sin cita válida bloquea la lista principal.
- Juez caído o JSON inválido: falla cerrado, con aviso. Compilador caído: página no leída. Una página inválida no termina la corrida.
- `dates.mjs` queda como alarma: resultado en `v.dates`, bandera `date_pattern_disagrees`. No cambia estado ni fecha mostrada.
- Convocatorias `forecast`: estado `forecasted`, sin fecha, sin días restantes.

## Banderas y variables nuevas

- `ENGINE_JUDGE` (apagada por defecto), `ENGINE_JUDGE_BLIND` (oculta las afirmaciones del compilador al juez).
- `COMPILER_LLM_{URL,MODEL,API_KEY,JSON_MODE,REASONING_EFFORT,MAX_TOKENS,TIMEOUT_MS,THINKING}` y `JUDGE_LLM_*` equivalentes. Sin respaldo implícito; respaldo solo con `*_LLM_FALLBACK=engine|chat`.
- Sin roles configurados: comportamiento anterior y aviso. Timeout del juez por defecto 120 s; `V13-DESPLIEGUE.md` fija 240000 ms.

## Cifras medidas

T0 (línea base, `V13-AUDITORIA.md`): 428 pruebas, 426 pasan, 1 falla (`apollo.test.mjs:99`, vía `run-experiment.v6.mjs` congelado), 1 omitida (Chromium). `tests/agent`: 191, 190 pasan, 1 falla (ACC-58, ruta de git).
Final: 472 pruebas, 470 pasan, 1 falla (Apollo, la misma de la base), 1 omitida. Pruebas nuevas: 44 (V13-1..43 más contratos).
Mentiva (`eval/regression/mentiva-grants.mjs`, modo adversarial): 0 cerradas como abiertas, 0 sin fecha en lista principal, 0 no-convocatorias retenidas, 0 no elegibles como `apply`, 100 % fechas con cita. Salida idéntica a la línea base.

T7 (`V13-T7-fechas.md`, 16 páginas guardadas): solo A medida.
A (solo código): 11 de 16 correctas. Cerrada 7/8, próxima 2/2, aviso previo 0/2, no convocatoria 2/3, desconocida 0/1. Errores graves (aviso previo → abierta): 2 (las dos NIA).
Con C (modelos simulados en pruebas V13-23..34) las dos NIA salen `forecast` / «a verificar», sin días restantes. Eso es prueba con simulados, no medición con los modelos reales.

## Criterios de aceptación

1. NIA no `open`, ni lista principal ni días restantes: cumplido con modelos simulados (V13-23..34); con modelos reales, no medido.
2. 0 citas ausentes sosteniendo una decisión: cumplido en pruebas (V13-10..22).
3. Juez caído o JSON inválido, 0 entradas nuevas en principal: cumplido en pruebas.
4. Suite igual a la línea base y Mentiva en 0: cumplido (arriba).
5. Cifras de A, B y C: solo A medida. B y C: no medidas. No se promociona C; la regla informado/ciego tampoco se pudo aplicar.
6. `dates.mjs` sin cambiar estado ni fecha: cumplido por construcción y prueba V13-38..43.

## No se pudo medir

- B y C de T7 con endpoints reales (T8 se corrió el 13/10, ver más abajo). Los endpoints (puertos 8016/8017 en g355) no son alcanzables desde este entorno: `tunnel-g355.sh dual-bg` falla con «Could not resolve hostname voltage-park». Hay que correrlo desde el Mac con el túnel abierto:
  `node --env-file-if-exists=.env scripts/dates-ab.mjs --report docs/handoff/V13-T7-fechas.md`
  `ENGINE_JUDGE=1 node --env-file-if-exists=.env scripts/engine-run.mjs --brief eval/briefs/jefe-igc-mint-ad-2026-10-12.json --objectives grant --today 2026-10-12 --no-cache`
- Duración y llamadas por modelo de T8: sin dato.
- Fixture `nia-precision-aging-b19c89bb.md`: reconstruido (la página original no está en el repo); reproduce el defecto, pero no es la página original. El de NIAGADS es real.
- El corpus de T7 no tiene páginas de verdad `open`: «abierta como cerrada» no es medible.
- Si compilador y juez coinciden en la misma etiqueta o bandera `estimated` equivocada, el código no lo detecta.
- Rama `arquitectura/agente-general-2026-10-07`: remoto no verificable desde aquí.
- Fallas previas, no causadas por V13: Apollo y ACC-58.
- Con `*_LLM_FALLBACK=engine`, compilador y juez pueden ser el mismo modelo; la independencia se pierde.

## Ventana de cierre en el brief (agregado 13/10)

El brief acepta `deadlineFrom` y `deadlineTo` (YYYY-MM-DD, opcionales, ambos incluidos; from <= to). El juez las recibe en el brief y en la regla del criterio deadline. El código aplica la ventana sobre la fecha de cierre con cita literal: fuera de la ventana → descarte `outside_window`; el veredicto del juez no la reemplaza. Aviso previo (`forecast`) no se descarta por la ventana y sigue sin entrar a la lista principal. Sin ventana, nada cambia. Pantalla Research: dos campos de fecha. Pruebas V13-44..52 (9) pasan; suite 481 / 479 pasan / 1 falla (Apollo) / 1 omitida; Mentiva sin cambios.
Sin decidir: destino de los avisos previos (hoy «a verificar» sin fecha ni días).

## T8: corrida del brief IGC con ENGINE_JUDGE=1 (13/10, carpeta eval/runs/2026-10-13-22-44-v13-jefe)

Condiciones: motor y compilador en Qwen3-30B (puerto 8017), juez gpt-oss-120b (8016); la repetición anterior usó Qwen3-235B como motor (el 235B se apagó para liberar GPU 6 y 7). Búsqueda sin caché. El resultado no separa el efecto de los agentes del efecto del cambio de modelo del motor.
- Duración 632 s (anterior: 1727 s). Verificadas: 0 (anterior: 12). Apply: 0 (igual).
- 80 páginas leídas con compilador + juez: 80 llamadas por modelo. Suma de tiempos de llamada: compilador 547 s, juez 1230 s (en paralelo; no es tiempo de pared).
- JSON inválido: compilador 20 de 80 (25 %), juez 0. Causas del compilador: rol de fecha fuera del catálogo y citas o listas por encima del largo del esquema. Errores de llamada: 1 compilador, 1 juez. Falla cerrada por juez caído: 0 páginas.
- Estado por página: unknown 36, closed 10, open 7, upcoming 3, forecast 3. Compilador y juez en desacuerdo: 45 de 80. Alarma de `dates.mjs` (date_pattern_disagrees): 23.
- NIA b19c89bb: salió `forecast` (fecha estimada 2026-10-06), no `open`, sin días restantes. NIA 7a4a9822: no apareció en esta búsqueda, sin dato.
- 0 verificadas: la causa no está medida página por página. Bloqueos más repetidos en las 7 `open`: elegibilidad y encaje temático sin «sí» con cita del juez, y compilador inválido (5 de las 7).
- Jina sin saldo (HTTP 402), apagado desde la tercera llamada; no afectó al juez.

Corrección posterior a esta corrida (commit aparte): el normalizador del compilador manda un rol de fecha desconocido a `other` y recorta citas y listas al largo del esquema. Pruebas V13-53 y V13-54. Sin repetir la corrida con modelos reales: el efecto sobre el 25 % de inválidos no está medido.

## Commits

fec9177 T0 · ccbfa77 T1 · 95409b9 T2 · c07f77f T3 · 1a173a1 T4 · f509dea T5 · fccef27 revisión T5 · 59bd85d T7. T6 va dentro de T4/T5 (pruebas) y T8 sin commit.
