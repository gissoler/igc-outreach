# TASK-12 · B2: planner adaptativo

## Objetivo
Implementar la condición adaptativa con el mismo bucle, los mismos topes y la misma regla de parada que B0 y B1.

## Archivos
- Modificar `research/agent/search_agent.mjs`, `research/agent/planner.mjs` y `research/agent/conditions.mjs`.
- Ampliar `research/tests/agent/loop.test.mjs` y `research/tests/agent/e2e.test.mjs`.

## Especificación
- ARCHITECTURE §4 (B2), §5.3 y §7.
- **Paso 0:** `initial_batch` con `batch_size = b2.initial_batch`.
- **Pasos siguientes:** `adaptive_step` con los límites indicados.
- **Orden de ejecución dentro de un paso:** primero las búsquedas aceptadas (cada una con su descarga por defecto, su extracción y la paciencia), después las descargas extra. Las nuevas oficiales que aportan esas descargas actualizan la paciencia con `afterExtraFetches`.
- **Fin:** pasos vacíos y fallos del planner según §4.
- `deps.onPlannerInput?.(input)` se llama con cada `planner_input` **antes** de la llamada al LLM.
- **El planner recibe solo** el `planner_input` (señales, cobertura de evidencia y gaps). Ninguna salida de `eligibility_judge.mjs` es accesible durante el discovery: el judge corre después de `runDiscovery`.

## Criterios de aceptación
ACC-12, ACC-13 (todos los casos), ACC-20 y ACC-21 (B2). ACC-18 y ACC-19 siguen pasando.

## No tocar
B0, B1, las señales y la regla de parada. Si B2 necesita un cambio en ellos, es un cambio de diseño: anótalo en el PR y detente.
