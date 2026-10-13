# V9 — Pre-registro (PROMPT-v11, solución del oro)

Registrado el 2026-10-12 (America/Bogota), antes de cualquier gasto del trabajo v9. Nada de este documento se ajusta después de ver resultados. Cifras sin gasto: `docs/benchmark/investors/V9-TECHOS-SIN-GASTO.md` (regenerable con `analysis/v9/sin_gasto_report.mjs`). Código: `docs/handoff/V9-CAMBIOS.md`.

## 1. Techo medido sin gasto, por capa y por diseño (p01–p06)

Capas: nombrado (el nombre del oro está en una página de lista abierta), candidato (el diseño lo saca como nombre), seleccionado (queda dentro del cupo de resoluciones), resuelto (la búsqueda por nombre devuelve su sitio y el emparejador lo elige), aceptado (su sitio pasa el extractor con cita literal). O2 se cuenta por réplica y la regla pide ≥ 2 de 3, así que "caso" = capa cumplida en ≥ 2 de 3 réplicas v8.

| Diseño | Nombrado | Candidato | Seleccionado | Resuelto | Aceptado | Techo |
|---|---|---|---|---|---|---|
| v8 (LLM con tope 10 por página, cita con verbo y nombre completo, 8 resoluciones en orden de aparición) | 4 (p01 p02 p03 p06; p04 y p05 en 1 de 3 réplicas) | 0 verificados | 0 | — | — | 0 |
| (a) candidatos del LLM sin verbo ni nombre completo | 4 | 3 (p01 p02 p06, candidato crudo del LLM) | ≤ 3 | sin medir | sin medir | ≤ 3 |
| (b) extractor determinista sin tope (tablas, encabezados, líneas, listas, texto) | 4 | 4 | — | — | — | ≤ 4 |
| (b)+(c) orden por páginas que citan, solo nombres con forma de firma, cupo K = 8 / 16 / 32 / 64 | 4 | 4 | 0 / 0 / 2 / 2 (p01 p06) | sin medir | sin medir | ≤ 2 con K ≤ 64 |
| (b)+(c)+(d) cupo K = 128 | 4 | 4 | 4 (p01 p02 p03 p06) | sin medir (p01: Exa lo da en el puesto 1 con otra consulta) | p01 sí (portada aceptada en v5-pairs y v6); p02 p03 p06 sin datos | ≤ 4 |
| (e) más páginas de listas (diag + full) | 6 nombrado en alguna página | — | K = 128: 3 de 6 por caso (p02 361, p03 256: empeoran) | — | — | ≤ 3 |
| (f) emparejador nombre–dominio v9 y consulta sin el tipo pegado | no cambia | no cambia | no cambia | 23 de 109 no_domain v8 pasan a tener host; 0 son del oro (0 intentos de resolver el oro en v8) | — | sin efecto sobre el oro |

Presupuesto de Exa para resoluciones: tope 5 USD − diagnóstico 0.107 − parte del planner como v7 (152 llamadas, 1.353) = 3.54 USD = 397 llamadas a 0.0089 → 66 por caso (las réplicas repiten nombres y salen de la caché). Con K ≤ 66 el techo es 2 de 6.

(e) además es inestable: la misma consulta de listas con otros parámetros de Exa (texto 4.000 + highlights en el motor, 10.000 en el diagnóstico) trajo otras páginas; la página con el oro de p02, p03 y p04 salió solo en las búsquedas del motor, y la de p04 solo en 1 de 3 réplicas.

(g) Un solo oro por caso: hay 37 firmas con gain ≥ 2 etiquetadas en p01–p06 (8, 3, 9, 11, 2, 4). v7 encuentra 9 en la unión de réplicas y v8 6.

Casos sin usar: n04, r13 y r14 son casos nulos (sin oro): sirven para medir falsos positivos y abstención, no para confirmar el oro. Los perfiles -ib son p01–p06 redactados de otra forma con el mismo oro. No hay casos positivos sin usar: la confirmación se hace con p07–p12, que ya se usaron para elegir la variante d (sesgo declarado).

## 2. Decisión sin gasto

- Cualquier diseño solo con Exa dentro del tope: **NO-GO**. Techo medido 2 de 6 (K ≤ 66), menor que 4. No se implementa motor v9 sobre Exa.
- Único diseño con techo ≥ 4: **L128** = (b) + (c) + (d) con K = 128 + (f), resolviendo los nombres con un buscador distinto de Exa (Serper), porque 128 × 6 = 768 resoluciones a 0.0089 serían 6.84 USD de Exa. Su techo de selección es exactamente 4 de 6 (p01, p02, p03, p06): basta que uno de los cuatro no se resuelva o no pase el extractor para quedar en 3. Resolución y aceptación de p02, p03 y p06 no están medidas. Por eso no se implementa todavía: primero el diagnóstico del §3, que también es el paso 0 del encargo.

## 3. Diagnóstico v9 (lo lanza el usuario desde el Mac)

Comando: `bash research/bench/investors/go-v9-diagnostico.sh`. Script: `analysis/v9/diagnostico.v9.mjs`; config frozen `config/v9-diagnostico-2026-10-12.json`; salida `out/v9-diagnostico-2026-10-12/`; informe `docs/benchmark/investors/V9-DIAGNOSTICO.md`.

- N (paso 0). Para cada uno de los 12 casos, la consulta de resolución del motor con el nombre del oro tal como lo escriben las listas: `"<nombre>" venture capital`. Exa: 10 resultados, texto 4.000, highlights (1 unidad; 12 unidades = 0.107 USD). Serper: la misma consulta, 10 resultados (12 consultas; no cuentan para el tope de Exa). Se anota el puesto del dominio del oro y el host que elegiría la resolución con el emparejador v8 y con el v9. Los nombres del oro solo están en este script de medición y en cases/; la prueba V9-1 comprueba que no están en los módulos v9 del motor ni en la config.
- S. Resolución completa con `resolveCandidateV9` (emparejador v9, sin tipo pegado) sobre los resultados de Exa y de Serper, y sobre la URL oficial del ancla: descarga y extractor v7 con el prompt v3 sin cambios. "Aceptado" = sale accepted con el dominio del oro (misma condición que O2). LLM ≤ 60 llamadas no cacheadas; descargas ≤ 200.
- L. Selección con K = 128. p01–p06: la medida por réplica de las páginas que abrió v8 (de la caché). p07–p12: URL de las 2 consultas de listas del diagnóstico v8 (de la caché, sin Exa) con la política de apertura de v8 (puesto, ≤ 2 por sitio, 6 por consulta, lista negra), descarga y orden firm_pages.

Reglas (las aplica `decide()` en el script):
1. Paso 0: si el sitio del oro falta de los 10 primeros de Exa en ≥ 4 de 12 casos, el límite es Exa: no se diseña más sobre Exa.
2. GO condicional del diseño L128 con resolución por Serper: casos con (seleccionado y aceptado por Serper) ≥ 4 de 6 en p01–p06 **y** ≥ 4 de 6 en p07–p12. En otro caso: NO-GO.
3. GO condicional no lanza nada: después del diagnóstico se implementa el brazo v9 (§4) y se pide al usuario que apruebe el gasto de Serper antes de go-v9.sh.

Tope de gasto del diagnóstico: Exa 0.25 USD (esperado 0.107), medido con `exa_spend.mjs --usd-per-call 0.0089` y vigilante cada 10 s con `--stop-file`; error 401/402/403/429 o de saldo: se para y lo incompleto se descarta. Serper: 12 consultas. Si el gasto no se puede medir, se para.

## 4. Corrida formal v9, solo si el §3 da GO condicional (no implementada)

- Brazo v9 = v8 con la fase de listas cambiada: nombres de las páginas abiertas con el extractor determinista (sin LLM y sin tope por página), orden firm_pages, resolución de los 128 primeros por corrida con Serper (solo la búsqueda de resolución; el planner sigue con Exa como en v8), emparejador v9 y consulta sin el tipo pegado. Sin cambios: umbrales, juez, etiquetas, prompts, regla de aceptación (sitio propio + misma firma + cita literal verificada; citas verificadas 100%). Sin B2E ni embeddings.
- Alcance: B2, p01–p06, 3 réplicas = 18 corridas; líneas base v8 y v7.
- Métricas: O1, O2 (como v8), M1, M2 (mediana y rango por caso), resoluciones, llamadas pagadas de Exa, consultas de Serper, tokens.
- Regla: ORO si los casos con O2 en ≥ 2 de 3 réplicas son ≥ 4; ORO PARCIAL si son 2 o 3; SIN CAMBIO si son menos de 2. En los tres, M1 y M2 no deben empeorar según la regla de V7-PREREGISTRO.md y las citas verificadas deben ser 100%.
- Costo estimado: Exa ≤ 1.35 USD (parte del planner; las 2 consultas de listas por caso están en la caché v8) + 0.107 del diagnóstico, bajo el tope de 5. Serper: 768 consultas si las réplicas repiten nombres (cota alta 2.304). LLM: hasta 768 extracciones nuevas (unos 4.6 M tokens). Tiempo: unas 2.5 h para las 6 primeras réplicas.

## 5. Calibración del medidor de Exa

El medidor cuenta 0.0089 USD por llamada (7 USD del panel / 789 llamadas, 12-10). En el diagnóstico v8 dio 1.388 USD y la suma de costDollars de Exa 2.818. Propuesta: go-v9-diagnostico.sh pide el saldo del panel antes y después (opcional, Enter para omitir) y guarda en result.json `panel.delta` y `usd_per_unit_panel` = diferencia / unidades pagadas. Con 12 unidades la diferencia esperada es de 0.03 a 0.11 USD; si el panel muestra dos decimales, el error es de ±0.005 USD. Hasta tener esa cifra, el tope se vigila con el mayor de los dos: medidor y costDollars. El saldo estimado (~8 USD) no está verificado: el usuario lo confirma en el panel antes de lanzar.

## 6. Brazo v9 de candidatos del modelo (registrado el 2026-10-12, 22:30 Bogotá, antes de gastar)

Motivo, con datos del diagnóstico (§3, ya ejecutado): buscando por su nombre, Exa devuelve el sitio del oro en el puesto 1 en 12 de 12 casos y ese sitio pasa el extractor en 10 de 12 (Exa o Serper). Lo que falta es el nombre. Claude o Gemini lo obtienen de su conocimiento y de la búsqueda web; el motor no. Este brazo hace eso y verifica igual que siempre.

- Diseño (engine.v9.mjs, config v9-2026-10-13.json, bench_id investors-internal-2026-10-13-v9): v8 con la fase de listas apagada y, antes del planner, `b2.model_candidates`. Un modelo recibe el brief (sin el nombre de la empresa) con el prompt nuevo `candidates/v1` (manifest.v9.json; ningún prompt existente se edita) y propone hasta 40 fondos ordenados por ajuste, con nombre y dominio. Cada uno se verifica con resolveCandidateV9: primero su dominio propuesto; si no queda aceptado, la búsqueda `"<nombre>" venture capital` con el emparejador v9. Entra solo si su sitio oficial pasa el extractor con cita literal y el control de misma firma (regla sin cambios). Presupuesto propio: 40 resoluciones, 40 búsquedas, 80 fetches, 400.000 tokens; luego el planner sigue con el presupuesto de v8. Sin B2E ni embeddings. Prueba de no-fuga V9-14.
- Proveedores: fleet (gpt-oss-120b propio, sin búsqueda web), anthropic (ANTHROPIC_API_KEY; claude-sonnet-5-5 y si falla claude-opus-5-5; con búsqueda web si la API la acepta), gemini (GEMINI_API_KEY; gemini-3.1-pro-preview, gemini-3-flash-preview o gemini-2.5-pro; con Google Search). Se prueban los que tengan clave.
- Paso A, prueba de nombres sin Exa (`analysis/v9/names_check.mjs`): cada proveedor, 12 casos. Métrica: oro en la lista (nombre o dominio) y su puesto; firmas gain ≥ 2 nombradas. Elección: más casos con el oro en p01–p06; empate: p07–p12, luego firmas gain ≥ 2, luego el propio. Regla: GO si el elegido nombra el oro en ≥ 4 de 6 casos de p01–p06. Si no, NO-GO y no se gasta en Exa. Las listas quedan en la caché de la corrida: la corrida usa exactamente las mismas.
- Paso B, corrida formal (`run-v9.sh`): B2, p01–p06 × 3 réplicas; por caso, s101 sola y luego s202 y s303 (salen de la caché). Líneas base v8 y v7.
- Regla (analysis/v9/v9_results.mjs): ORO si los casos con O2 en ≥ 2 de 3 réplicas son ≥ 4; ORO PARCIAL si son 2 o 3; SIN CAMBIO si menos. Si M1 o M2 empeoran frente a v8 (regla de V7-PREREGISTRO.md) o las citas verificadas no son 100%: EMPEORA o NO VÁLIDA.
- Techo antes de correr, con lo ya medido: el oro de p04 no pasa el extractor en su sitio (0 de 3 URL) y el de p08 solo con la página que da Serper; el techo de O2 es 5 de 6 en p01–p06 si el modelo nombra al oro en todos.
- Costo: Exa hasta 392 llamadas (planner como v7, 152, más hasta 40 búsquedas por caso) = US$ 3.49, más US$ 0.107 del diagnóstico; tope US$ 5 sobre todo v9 con vigilante. Modelo externo: una llamada por caso (12 en la prueba, 0 en la corrida por la caché); con búsqueda web, centavos por llamada.

### 6.1 Ajuste antes de gastar (12-10, 21:50): solo el LLM propio

Por indicación del usuario, el brazo usa solo Exa y el LLM propio (gpt-oss-120b en Voltage Park); Claude y Gemini no se usan. La prueba de nombres compara dos modos del LLM propio: `fleet` (prompt candidates/v1, solo su conocimiento) y `fleet_lists` (prompt candidates/v2: además recibe hasta 300 nombres sacados sin LLM de las páginas de las 2 consultas de listas de Exa, con la política de apertura de v8, y elige los que encajan, como un asistente que lee sus resultados de búsqueda). Medido sin gasto: el nombre del oro está entre esos nombres en 5 de 6 casos de p01–p06 (puestos 20, 101, 77, 70, 27; p05 no) y en 5 de 6 de p07–p12. Regla y corrida: las del §6. Veredicto si da NO-GO: el cuello de botella es el LLM (le llega el nombre y no lo elige). Si el LLM no responde, no hay veredicto.
