# V13 · T1 · Pre-registro (13/10/2026)

Escrito antes de implementar y antes de correr T6/T7/T8. Línea base: `V13-AUDITORIA.md` (suite `tests/*.test.mjs` 426/428; `tests/agent` 190/191).

## Qué se cambia y qué no

Se agregan dos roles de modelo (`compiler`, `judge`) y un auditor por código, detrás de `ENGINE_JUDGE=1` (apagada por defecto). `dates.mjs` sigue corriendo como alarma y no cambia estado ni fecha mostrada. No se editan archivos congelados (v5–v9, `bench/investors/engine*.mjs`, `extractor.mjs`, `judge.mjs`, gold, cases). Lo nuevo del benchmark va en archivos `.v13`. No se tocan `scripts/g355-*`, `run-mac.sh`, `tunnel-g355.sh`.

## Criterios de aceptación

1. NIA (b19c89bb y 7a4a9822), con modelos simulados que devuelven lo mismo que los reales del 12–13/10: 0 salen `open`, 0 en la lista principal (`tier: main`), 0 con `daysLeft` visible. Salen `forecast` o «a verificar» con motivo.
   - Medición: pruebas T6 con las páginas como fixture. Pasa si las 2 cumplen las 3 condiciones. T8 (modelos reales) repite la medición cuando existan los endpoints; si no se corre, se informa «no medido».
2. Citas: 0 casos donde una cita que no está literal en la página sostenga una decisión (estado, fecha, elegibilidad). Medición: prueba con juez/compilador simulados que inventan citas; el número de decisiones sostenidas por cita ausente debe ser 0. Se cuenta también en T7 («citas inválidas» por variante).
3. Juez caído, tiempo agotado o JSON inválido: 0 entradas nuevas en la lista principal respecto de la corrida con el juez apagado, con aviso visible en el audit. Un JSON inválido en una página no termina la corrida (las demás páginas se procesan).
4. Suite: `tests/*.test.mjs` ≥ 426 pasan y ≤ 1 falla (la de Apollo/v6); `tests/agent` ≥ 190 pasan y ≤ 1 falla (ACC-58). Las pruebas nuevas suman a las que pasan. `eval/regression/mentiva-grants.mjs` mantiene: 0 cerradas como abiertas, 0 sin fecha en la lista principal, 0 no-convocatorias retenidas, 0 no elegibles como `apply`, 100 % de fechas con cita. Con `ENGINE_JUDGE` apagada, el resultado de esa regresión no cambia.
5. T7 reporta aciertos y errores de A, B y C con las mismas páginas. No se promociona C salvo que la regla de abajo se cumpla; si A o B superan a C en aciertos, se dice.
6. `dates.mjs` no cambia de estado ni de fecha mostrada ningún resultado: con `ENGINE_JUDGE=1` el campo `dates.*` del resultado es idéntico al de `ENGINE_JUDGE` apagada para el mismo lector; solo se añade la bandera `date_pattern_disagrees`. Prueba de igualdad de `dates` con y sin el juez.

## Reglas de integración (fijas, no se ajustan después de ver cifras)

- Estado calculado por código a partir del rol de fecha del juez (`application_deadline`, `loi_deadline`, …), solo con citas presentes literales en la página:
  - todas las `application_deadline` verificadas < hoy → `closed`;
  - página tipo aviso previo/forecast, o fechas con «Estimated»/«Forecasted» → `forecast`;
  - sin fecha de cierre verificable → `unknown`;
  - fecha de cierre ≥ hoy, sin marca de forecast, con juez y compilador de acuerdo → `open`.
- Desacuerdo, cita ausente o juez sin respuesta → «a verificar» (`tier: verify`) con ambas lecturas visibles. Nunca `main`.
- `forecast` no entra a `main` ni muestra días restantes.
- Falla cerrado.

## T7 · prueba aislada de fechas

Corpus: las páginas con verdad conocida del repo, sin búsqueda ni Exa:
- 11 páginas de `eval/bench/mentiva-pages.json` con verdad en `mentiva-gold.json`;
- 3 casos de `tests/fixtures/search-quality-cases.json` (verdad en `eval/regression/mentiva-grants.mjs`);
- 2 páginas NIA.
Total máximo 16. Una página cuya clase de verdad no se pueda fijar con el gold existente se lista y se excluye; no se adivina. La clase de verdad es una de: `closed`, `open`, `forecast`, `not_a_call`, `unknown`. Para las NIA la verdad es `forecast` (el prompt v13 y el texto: «intends to publish», «Forecasted», fechas «Estimated»). La fecha de hoy de cada página es la del gold (2026-09-30 para mentiva-gold; 2026-10-12 para NIA).

Variantes:
- A: solo código (`deadlineDecision` actual).
- B: solo modelo, con la página y la fecha de hoy, sin código de resta.
- C-informado: compilador + juez (el juez ve el registro del compilador) + auditor.
- C-ciego: compilador + juez (el juez no ve la conclusión del compilador) + auditor. La comparación C-informado vs C-ciego es la prueba de independencia.

Métricas por variante y por modelo: páginas, aciertos por clase (`open`, `closed`, `forecast`), errores graves (cerrada como abierta, aviso previo como abierta, abierta como cerrada), citas inválidas, segundos por llamada.

Regla para elegir entre C-informado y C-ciego: se usa la que tenga menos errores graves; en empate, C-ciego (independencia). Con modelos simulados la prueba solo comprueba el cableado, no la calidad: la elección real se toma con endpoints reales y, si no se mide, se deja C-ciego y se informa «no medido».

Regla de promoción de C: C se recomienda como camino por defecto solo si (errores graves de C) ≤ mínimo(errores graves de A, de B) y citas inválidas aceptadas = 0, en el corpus real con endpoints. Con 16 páginas un empate dentro de ±1 página se informa como empate, no como victoria.

## Lo que este pre-registro no puede medir

- Calidad de Qwen3-30B y gpt-oss-120b mientras GPT no entregue `docs/handoff/V13-DESPLIEGUE.md` y los endpoints 8017/8016: hasta entonces T6 y T7 usan modelos simulados y T8 queda sin correr.
- El corpus de T7 tiene 16 páginas como máximo; no sostiene porcentajes finos.
- El texto de la página b19c89bb no está guardado en el repo. Su fixture es una reconstrucción: plantilla de la página real de NIAGADS (7a4a9822, caché de Firecrawl) con los valores de fecha citados por el modelo el 12/10 y confirmados en una lectura del 13/10. Se marca así en el archivo y en V13-CAMBIOS.md.

## Pregunta abierta para Gisel (no se implementa hasta responder)

Brief: ¿qué falta de la fecha? Propuesta: ventana de cierre aceptable `deadlineFrom`/`deadlineTo` además de `minDays`, y qué pasa con convocatorias `forecast` (opciones: ocultar, mostrar como «a verificar», o mostrar en una sección aparte). V13 no cambia `intake` ni `brief`; `forecast` se trata como «a verificar» (no `main`) hasta que se decida.
