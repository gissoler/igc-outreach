# V8 — Pre-registro (alcanzabilidad del oro, PROMPT-v10)

Registrado el 2026-10-12 (America/Bogota), antes de cualquier gasto en Exa del brazo v8. Nada de este documento se ajusta después de ver resultados. Código: `docs/handoff/V8-CAMBIOS.md`.

## 1. Diagnóstico por variante (paso 1)

Script: `research/bench/investors/analysis/v8/diagnostico.v8.mjs`; lanzador: `bash research/bench/investors/go-v8-diagnostico.sh`. Salida: `research/bench/investors/out/v8-diagnostico-2026-10-12/`; informe: `docs/benchmark/investors/V8-DIAGNOSTICO.md`.

Consultas: generadas por plantilla desde el perfil del caso (`analysis/v8/queries.v8.mjs`), la misma plantilla para p01–p12; ninguna lleva el nombre ni el dominio del oro (prueba V8-1). Solo Exa, `type auto`, llamada directa (`exa-direct.v8.mjs`) porque el cliente actual limita a 20 resultados y no admite `category`.

| Variante | Llamadas por caso | Parámetros | Ventana medida |
|---|---|---|---|
| base10 | 3 consultas cortas (etapa + sector + región; subsector; etapa + 2 subsectores) | 50 resultados, sin texto | puesto ≤ 10 |
| b30, b50 | las mismas 3 llamadas que base10 | 50 resultados, sin texto | puesto ≤ 30 y ≤ 50 |
| a10, a25 | las mismas 3 consultas cortas con `category: "company"` | 25 resultados, sin texto | puesto ≤ 10 y ≤ 25 |
| c | paso 1: 1 consulta de empresas del mismo producto, etapa y región (`category: "company"`, 10 resultados); paso 2: "<empresa> <etapa> funding round investors" para 3 empresas (comparables del perfil primero, luego las del paso 1; nunca el oro) | paso 2: 10 resultados, texto 3.000 caracteres | dominio del oro en cualquier resultado, o nombre del oro en título o texto |
| d | 2 consultas de listas ("top venture capital firms investing in <sector> in <región>", "list of <etapa> investors <sector> <subsector> <región>") | 10 resultados, texto 10.000 caracteres | dominio del oro en cualquier resultado, o nombre del oro en título o texto |
| e10, e25 | 3 consultas largas con el lenguaje del brief (producto, primera frase de la descripción, tipo de inversor + sector + subsectores + región + etapa + monto) | 25 resultados, sin texto | puesto ≤ 10 y ≤ 25 |

Número de llamadas: 12 por caso en llamadas fijas + 3 de c paso 2 = 15 llamadas, 18 unidades de costo por caso.

Métrica por caso y variante: el oro está presente si aparece en al menos una de las llamadas de la variante dentro de su ventana (base, a, b, e: dominio del oro en las URL; c y d: dominio en las URL o nombre del oro, con las formas de `GOLD_ALIASES`, en título o texto). Se anota el puesto del oro en cada llamada y, aparte, cuántos casos se alcanzan solo por dominio. En c y d el nombre en el texto exige después extraer y resolver el sitio oficial; el diagnóstico no mide esa resolución.

Fases y regla de elección (las aplica el propio script):
- Fase A, p01–p06: todas las variantes. Elegida = casos con el oro ≥ casos de base10 + 2. Si se eligen las dos ventanas de un par (b30/b50, a10/a25, e10/e25) y la menor alcanza los mismos casos, se queda la menor.
- Fase B, p07–p12 (el motor no los ha visto; oros leídos de `cases/` sin cambiarlos): base10 + solo las variantes elegidas. Confirmada = casos con el oro ≥ casos de base10 + 1.
- Se implementan en el motor solo las variantes elegidas en A y confirmadas en B. Si ninguna se confirma: no se implementa nada y el resultado es NO-GO para la corrida formal.

Costo del diagnóstico: unidades = ceil(tarifa nominal / 0.027), mínimo 1, cada una a 0.0089 USD (costo real medido por llamada de 10 resultados con texto y highlights, cuya tarifa nominal es 0.027). Tarifa (exa.ai/pricing, 2026-10-12): 7 USD/1.000 hasta 10 resultados, +1 USD/1.000 por resultado extra, contenido 1 USD/1.000 páginas. Cada llamada se registra en events.jsonl como tantas llamadas pagadas como unidades, para que `exa_spend.mjs --usd-per-call 0.0089` lo mida. 50 resultados sin texto = 2 unidades; 25 sin texto = 1; 10 con texto = 1.
- Fase A: 108 unidades = 0.961 USD. Fase B: entre 36 unidades (0.320 USD, solo base) y 108 (0.961 USD). Máximo 1.922 USD.
- Tope del diagnóstico: 2 USD (224 unidades), comprobado antes de cada llamada no cacheada, más vigilante cada 10 s con `exa_spend.mjs` y `--stop-file`. Si el gasto no se puede medir, se para. Error 401/402/403/429 o de saldo, o 3 errores seguidos: se para, no se escribe result.json y lo incompleto se descarta.

## 2. Corrida formal v8 (pasos 3 y 4)

- Brazo v8 = brazo v7 + las variantes confirmadas, en archivos .v8. Sin cambios de umbrales, juez, etiquetas, prompts congelados ni regla de cita. B2E y filtros de embeddings: no.
- Alcance: B2, p01–p06 variante A, 3 réplicas (etiquetas s101/s202/s303) = 18 corridas, en `out/investors-internal-2026-10-12-v8`. Línea base: las 18 corridas v7 (no se repiten ni se regeneran).
- Métricas primarias del objetivo, por corrida: O1 = el dominio del oro aparece en algún resultado de búsqueda de la corrida; O2 = el oro está entre las entidades aceptadas. Por caso: réplicas con O1 y con O2 (0 a 3). Secundarias: M1 y M2 con las definiciones de V7-PREREGISTRO.md, mediana y rango por caso; llamadas pagadas, fetches, FETCH_EMPTY, rechazos por cita.
- Línea base v7 (datos existentes): O1 en 1 de 18 corridas (p05 s303), O2 en 1 de 18 (la misma).
- Regla: MEJORA EN ORO si los casos con O2 en ≥ 2 de 3 réplicas pasan de 0 (v7) a ≥ 2 y M1 y M2 no empeoran según la regla de V7-PREREGISTRO.md (v8 frente a v7). SOLO ALCANCE si los casos con O1 en ≥ 2 de 3 réplicas son ≥ 2 pero O2 no cumple. SIN CAMBIO en otro caso. Condición de validez: citas verificadas 100% (v5_check) y 6 casos con 3 réplicas válidas.
- Tope de Exa del brazo v8 completo (diagnóstico + corrida formal): 9 USD medidos con `exa_spend.mjs --usd-per-call 0.0089` sobre las dos carpetas; la corrida se para entre lotes a 8 USD y el vigilante corta a 9. El costo esperado de la corrida formal se fija en V8-CAMBIOS.md antes de lanzarla, con las llamadas por corrida de v7 (8.44 pagadas de media) más las de las variantes confirmadas.
- Una sola corrida formal; se reintentan solo fallos de infraestructura.

## 3. Resultado del diagnóstico y diseño de la corrida formal (registrado tras el diagnóstico, antes de la corrida formal)

Diagnóstico ejecutado el 2026-10-13T00:11Z (19:06–19:11 en Bogotá): 156 unidades pagadas = US$ 1.388 a 0.0089 por unidad. Tarifa nominal de esas llamadas: US$ 3.24. `costDollars` devuelto por Exa, suma: US$ 2.818. Las dos medidas de Exa y la mía no coinciden (1.388 / 2.818 / 3.24): el cobro real hay que leerlo en el panel de Exa; ver V8-CAMBIOS.md.

Casos con el oro por variante (regla del §1; D = dominio, N = solo el nombre en el texto):

| Variante | Fase A, p01–p06 | Fase B, p07–p12 |
|---|---|---|
| base10 | 1 | 2 |
| b30, b50, a10, a25, e10, e25 | 1 cada una | no se midieron (no elegidas) |
| c | 0 | no se midió |
| d | 3 (p01 N, p04 D, p06 N) | 5 (p07 N, p08 N, p09 N, p10 D, p11 N; p12 —) |

Elegida en A: d (3 ≥ 1 + 2). Confirmada en B: d (5 ≥ 2 + 1). Ninguna otra variante supera a la base. Por dominio, d alcanza 1 de 6 en A y 1 de 6 en B (la base 1 y 2): la ganancia de d es de nombre en el texto, no de dominio. De los aciertos de nombre, la mayoría están en páginas de agregadores (shizune.co, signal.nfx.com, fundraisingfox.com), que el triage del motor descarta y la lista negra (fundraisingfox.com) bloquea.

Implementación (brazo v8 = v7 + fase de listas, `b2.list_discovery` en `config/v8-2026-10-12.json`):
- Antes del lote inicial del planner se hacen las 2 consultas de listas del diagnóstico (misma plantilla, `list-discovery.v8.mjs`).
- Esas consultas saltan el triage (que descarta listas y agregadores). Se abren hasta 6 páginas por consulta, por puesto del buscador, como mucho 2 por sitio. La lista negra de fetch sigue vigente.
- El extractor, sin cambios, devuelve hasta 10 firmas por página con cita literal; sus nombres van a la cola de candidatos y se resuelven a su sitio oficial con la resolución de siempre. La firma solo cuenta si el sitio oficial pasa el extractor y la regla de cita (100% literal).
- Cupo de la fase: 8 resoluciones, 10 búsquedas (2 de listas + 8 de resolución), 20 fetches (12 de listas + 8 de resolución). Al terminar, los topes de búsquedas y fetches y `min_searches_before_stop` suben en lo gastado en la fase: el planner dispone de 18 búsquedas y 54 fetches como en v7 (la cola de candidatos que queda sigue bajo el tope de 6 resoluciones de v7).
- Las páginas de lista cuentan como rechazadas por no ser firma (suben `rejected_non_investors`).
- Sin cambios: umbrales, juez, etiquetas, prompts, regla de cita, presupuesto de profundización, C1, C2, C3, C5 y C6 de v7. B2E y embeddings: no.
- Capas de caché de lectura: las de v7 más la caché de la corrida v7 (solo lectura). No se escribe en ninguna carpeta v5, v6 ni v7.

Costo esperado de la corrida formal: v7 pagó 8.44 llamadas por corrida (152 en 18). v8 añade como máximo 10 búsquedas pagadas por corrida (2 de listas, que son idénticas en las 3 réplicas de un caso y salen de la caché desde la segunda, y hasta 8 de resolución). Esperado = 18 × 18.5 × 0.0089 = US$ 2.96. Cota alta sin ningún acierto de caché = 18 × 44 × 0.0089 = US$ 7.05. Con el diagnóstico (US$ 1.388) el total es US$ 4.35 esperado y US$ 8.44 como cota alta, bajo el tope de 9. Se para entre lotes a 8 y el vigilante corta a 9 con `exa_spend.mjs --usd-per-call 0.0089` sobre `out/investors-internal-2026-10-12-v8` y `out/v8-diagnostico-2026-10-12`.

Regla de decisión de la corrida formal (la del §2, con v7 como línea base, aplicada por `analysis/v8/v8_results.mjs`):
- MEJORA EN ORO: casos con O2 en ≥ 2 de 3 réplicas v8 ≥ 2 y > v7 (hoy 0), y ni M1 ni M2 empeoran (v8 frente a v7, regla de V7-PREREGISTRO.md).
- SOLO ALCANCE: no cumple lo anterior y los casos con O1 en ≥ 2 de 3 réplicas son ≥ 2 y > v7 (hoy 0).
- SIN CAMBIO: en otro caso. Condición de validez: citas verificadas 100% y 6 casos con 3 réplicas válidas.
- Riesgo declarado antes de correr: el diagnóstico mide el nombre del oro en el texto que devuelve Exa (hasta 10.000 caracteres), no que el extractor lo saque como candidato con cita, ni que la resolución encuentre su sitio. Esa parte solo la mide la corrida formal.
