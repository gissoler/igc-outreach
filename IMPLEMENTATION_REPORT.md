# Implementation report: capital strategy context + Apollo

Fecha: 2026-10-08. Estado: `complete` para implementación técnica; activación de producción y evaluación humana siguen pendientes.

## Qué existía antes

- Importación CSV/ICS que podía recibir exports de Apollo, sin cliente API ni OAuth.
- Discovery de fondos mediante motor web, fuentes de rondas y consultas laterales.
- Personas desde páginas oficiales, ScrapeGraph/Apify y Hunter.
- Cálculo de rutas desde red autorizada, con rutas verificadas e hipótesis.
- Expansión de términos y ángulos laterales, sin contrato previo de estrategias de capital.
- Advisor con salidas estructuradas, verificación y crítico reutilizables como patrón.

Diagnóstico detallado: `docs/CAPITAL_STRATEGY_APOLLO_DIAGNOSIS.md`.

## Requerimientos extraídos de la reunión

El bloque del transcript del 07/10/2026 expresa como requerimientos: que el agente elija herramientas; incorporar Apollo; comprender producto y empresa; explorar segmentos adyacentes; buscar comparables; investigar quién los financió; revisar premios, grants, pilotos, corporate venture y VC; y mostrar caminos que el founder no había considerado.

Esto se clasifica como requerimiento de reunión. No prueba que Apollo estuviera conectado ni aprueba automáticamente los ejemplos o segmentos mencionados. La separación grants/VC bajo funding, la aprobación humana, no enviar mensajes y no convertir relaciones públicas en warm paths sí constan como decisiones vigentes del vault.

## Qué se implementó

- `capital_strategy_context/1`, fase opcional antes de discovery, 3–6 rutas y preservación del segmento declarado.
- Router de herramientas por pregunta con log de motivo, coste estimado, resultado, evidencia, error y latencia.
- Ejecución acotada de queries estratégicas mediante el motor existente y promoción a `evidence_backed` solo con evidencia literal y URL.
- Cliente Apollo server-side, caché, límites y preflight de solo lectura.
- Resolver organización → personas → red autorizada; Apollo no altera score, bucket ni label.
- Clasificaciones `direct_contact`, `public_affiliation`, `possible_bridge`, `verified_network_path` y `unresolved`.
- Interfaz con secciones separadas “Estrategias de capital para explorar” y “Personas y rutas de contacto”.
- Métricas posteriores independientes del benchmark.

## Decisiones técnicas

- Los schemas nuevos viven fuera de `docs/contracts/**` para no tocar contratos congelados.
- Las dos capacidades están apagadas por defecto.
- Apollo usa API key con `x-api-key`; OAuth sigue sin implementarse.
- People search no revela emails. No se añadió people enrichment para evitar consumo y no ampliar el alcance sin aprobación.
- La caché y el límite diario son compartidos dentro del proceso; no sobreviven reinicios. Es una limitación explícita antes de escalar.
- No se guarda razonamiento privado: solo rationale breve, preguntas y evidencia.

## Preflight real de Apollo

Archivo: `research/artifacts/apollo-preflight.json`.

- Estado: `connected`.
- Autenticación: HTTP 200.
- Estadísticas de créditos: HTTP 200.
- Estadísticas de API/límites: HTTP 200.
- Búsqueda mínima de organización por `apollo.io`: HTTP 200, un registro.
- Búsqueda mínima de persona: HTTP 200, un registro.
- Latencia total observada: 3013 ms.
- Operaciones de escritura o contacto: cero.
- Clave o secretos expuestos en la salida: ninguno.

Apollo reportó sus balances oficiales en el artefacto. La documentación estima 1 crédito por la página de organization search y 0 por people search; el snapshot de crédito devolvió `lead_credit.consumed=0`. No se infiere ni se fuerza una reconciliación entre esos dos datos.

## Costos o créditos consumidos

- Preflight: 1 crédito estimado por documentación para organization search; 0 para people search.
- Saldo/consumo oficial devuelto en la llamada: conservar el valor exacto de `research/artifacts/apollo-preflight.json`; no se observó una deducción confirmada en ese snapshot.
- No se ejecutaron enriquecimientos de email/teléfono, campañas, secuencias ni mensajes.

## Separación del benchmark

No se modificaron perfiles, anclas, nulos, labels, hashes, configuración, pool, métricas, B0/B1/B2 ni regla de adopción. Un test estático falla si módulos de `research/agent` o `research/bench` importan Apollo o consumen `capitalStrategyContext`. No se corrió el benchmark formal.

## Archivos modificados y añadidos

- `research/capital/**`: contratos, estrategia, router, Apollo, resolver y métricas.
- `research/server/research/pipeline.mjs`: hooks opcionales de producción.
- `frontend/src/ResearchResults.tsx`, `frontend/src/researchApi.ts`: secciones y tipos.
- `research/tests/apollo.test.mjs`, `research/tests/capitalStrategy.test.mjs`.
- `research/scripts/apollo-preflight.mjs`, `research/.env.example`, `research/package.json`.
- `docs/CAPITAL_STRATEGY_APOLLO_DIAGNOSIS.md`, `docs/CAPITAL_STRATEGY_APOLLO_ARCHITECTURE.md`, `docs/APOLLO_RUNBOOK.md`.
- `research/tests/searchQuality.test.mjs`: se alineó una expectativa histórica con la cuarta razón `scope_mismatch` que el código ya devolvía; no se cambió producción ni el benchmark.
- `frontend/tsconfig.tsbuildinfo`: metadato regenerado por la compilación TypeScript.

## Pruebas ejecutadas y resultados

- Suite completa de investigación: 428/428 pasan (`npm --prefix research test`). Se ejecutó fuera del sandbox para permitir los puertos locales de las pruebas HTTP.
- Suite congelada del agente/benchmark: 85/85 pasan (`npm --prefix research run test:agent`), incluidos los digests y fixtures de B0/B1/B2.
- Pruebas focalizadas de capital, Apollo y regresión corregida: 32/32 pasan.
- Contratos, degradación sin clave, cuota, dominio exacto, rechazo de organización no relacionada, fallback de equipo oficial, posible puente sin warm path y ausencia en B0/B1/B2 están cubiertos por tests.
- `node --check` pasa en todos los módulos nuevos y en el pipeline modificado.
- Frontend: TypeScript + Vite compilan correctamente. Vite conserva una advertencia no bloqueante por chunks grandes.
- Suite Python: no se ejecutó porque este checkout no contiene un entorno con `pytest`; no se modificó código Python ni backend.
- Benchmark formal: no ejecutado, por instrucción explícita.

## Limitaciones y pendientes antes de una prueba real

- Activación de producción sigue apagada; el preflight no equivale a una corrida completa sobre un fondo real.
- No se verificó email porque people search no lo revela y no se habilitó enrichment.
- El fallback de equipo/página oficial está definido por dependencias inyectables; el pipeline actual usa Apollo por dominio y conserva las fuentes web existentes por separado.
- El ledger diario y la caché son de proceso; deben persistirse antes de uso distribuido o reinicios frecuentes.
- Falta evaluación humana de segmentos, comparables, personas y posibles puentes con el protocolo separado.

## Clasificación final

`complete`. Las capacidades son independientes, opcionales y funcionan con Apollo apagado; el preflight vivo verificó autenticación, alcance, organización, persona y estadísticas sin operaciones de escritura. Esta clasificación cubre implementación e integración técnica, no calidad de estrategias, relevancia de personas, utilidad comercial ni disposición de terceros a presentar. Esas métricas requieren el protocolo humano independiente descrito arriba.
