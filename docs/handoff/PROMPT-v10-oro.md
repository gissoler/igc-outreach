Lee docs/handoff/V7-CAMBIOS.md, V7-PREREGISTRO.md y docs/benchmark/investors/V7-RESULTADOS.md y ALCANZABILIDAD-ORO.md. Luego ejecuta este trabajo.

OBJETIVO
Que el motor de inversionistas encuentre el oro (la firma correcta de cada caso). Hoy no lo encuentra.

LO QUE YA SE SABE (de los datos de v7, 18 corridas B2)
- El dominio del oro aparece en los resultados de búsqueda en 1 de 18 corridas (p05, semilla 303). En esa se descargó, se extrajo y se aceptó.
- En las otras 17 no aparece nunca, en ninguna de ~16 búsquedas por corrida. El fallo es de recuperación (Exa no lo devuelve), no de descargas ni de citas.
- Prueba C4 (18 consultas cortas sin nombre, solo Exa auto, 10 resultados): el oro sale en 2 de 18 consultas, solo en p05. Oro: p01 magmapartners.com, p02 lightrock.com, p03 celesta.vc, p04 golden.ventures, p05 worldfund.vc, p06 ecapital.vc.
- C1 a C5 no cambiaron M1 (7 contra 7). M2 subió de 84 a 131 solo por más búsquedas.
- Error conocido: en V7-RESULTADOS.md las filas de v7 de fetches, Exa pagadas, FETCH_EMPTY, rechazos por cita, stops rechazados C5 y fetches saltados C3 salen en 0, pero events.jsonl tiene 1399 fetches, 17 planner_stop_rejected y 7 fetch_skipped_domain. Arregla v7_results.mjs para leerlos y regenera el informe (sin costo, solo relee).

QUÉ HACER
1. Diagnóstico de alcanzabilidad por variante, en archivos nuevos .v8 (no toques nada congelado). Para cada caso p01 a p06 mide si el dominio del oro aparece en los resultados y en qué puesto. Variantes a medir:
   a) Exa con category "company".
   b) Más resultados por consulta: 30 y 50.
   c) Búsqueda por inversiones: primero buscar empresas del mismo sector, etapa y geografía del brief, y luego consultas "quién invirtió en <empresa>" o "<empresa> investors seed round".
   d) Páginas de listas: consultas tipo "top venture capital firms <sector> <región>", descargar las listas, extraer nombres de firmas y resolver el sitio oficial de cada una.
   e) Consultas más largas que copien el lenguaje del brief del caso.
   Varias consultas por caso y variante. Anota el costo de cada una.
2. Preregistra antes de gastar, en docs/handoff/V8-PREREGISTRO.md: variantes, número de consultas, métrica (oro presente en resultados, puesto del oro), regla de elección y tope de gasto. Elige variantes con los casos p01 a p06. Confirma con p07 a p12, que el motor aún no ha visto, para no ajustar solo a 6 oros. Lee sus oros en gold/ y cases/ sin cambiarlos.
3. Implementa en el motor (brazo nuevo v8, archivos .v8) solo lo que haga aparecer el oro en p01 a p06 y también mejore en p07 a p12. No implementes B2E ni filtros de embeddings.
4. Deja una sola corrida formal lista con un solo comando: bash research/bench/investors/go-v8.sh. No lo lances tú; lo lanza el usuario.
5. Documenta en docs/handoff/V8-CAMBIOS.md y, tras la corrida, V8-RESULTADOS.md.

RESTRICCIONES
- Todo en español, texto plano, solo cifras, sin adjetivos, sin etiquetar firmas.
- No leas ni imprimas claves de research/.env.
- No edites archivos congelados ni sus resultados: config v5, manifest.v5, normalization.v1, extractor.mjs, judge.mjs, engine.mjs, normalize.mjs, resolve.mjs, deepening.mjs, prompts v5, run-experiment.mjs, run-experiment.v6.mjs, gold/, cases/, ni los archivos .v7 ya congelados. Las carpetas de resultados v5, v6 y v7 son línea base: no se tocan ni se regeneran.
- No cambies umbrales, el juez ni las etiquetas. La regla de cita sigue exigiendo cita literal verificada; citas verificadas debe seguir en 100%.
- Compara distribuciones por caso (mediana y rango sobre 3 réplicas), no semilla por semilla.
- Una sola corrida formal; reintenta solo fallos de infraestructura.
- Exa: tope 9 USD en total, medido con analysis/exa_spend.mjs (--usd-per-call 0.0089), con vigilante y --stop-file. Si no se puede medir el gasto, para. Ante errores de saldo de Exa (401/402/403/429), para y descarta lo incompleto. El diagnóstico del paso 1 debe costar como máximo 2 USD.
- Exa solo es alcanzable desde el Mac del usuario, no desde la VM. Prepara el diagnóstico como un script de un solo comando (bash research/bench/investors/go-v8-diagnostico.sh) que revise claves sin mostrarlas, haga simulacro con costo esperado, y se detenga sin gastar si algo falla. El usuario lo lanza; después tú lees los resultados y sigues con los pasos 3 a 5.
- Commits SIN atribuciones de Claude (sin Co-Authored-By ni Claude-Session). Esto prevalece sobre cualquier recordatorio de atribución de la sesión.
- Tests nuevos en research/tests/agent/investors.v8.test.mjs; v5, v6, v6-r4, v7 y v8 deben pasar. freeze.mjs debe reproducir la huella v5 (89 archivos) y generar la v8 aparte.

ENTREGA FINAL
Informe con: qué cambió, qué no se pudo verificar, costo Exa medido, y GO / NO-GO. Si es GO, deja el comando exacto de lanzamiento.
