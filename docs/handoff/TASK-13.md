# TASK-13 · Smoke y piloto con proveedores reales

**La ejecuta una persona, después de H9.** Codex solo prepara el script y la checklist.

## Objetivo
Comprobar que el sistema completo funciona contra la web real y el modelo real con 2 casos piloto, que **no** forman parte del benchmark. Así se detectan fallos de integración antes de congelar la configuración.

## Archivos (Codex)
- `research/bench/pilot/README.md`: pasos y checklist.
- `research/bench/pilot/config.pilot.json`: copia de `v0.json` con `bench_id:"pilot"`, `status:"draft"`, `budgets.searches=8` y `budgets.fetches=24`.
- `research/bench/pilot/cases/`: 2 cases construidos con `briefToProfile` a partir de `mentiva.json` y `aha-nonprofit.json`, con `kind:"null"` (para no exigir ancla) y `manual_search_minutes:20`.

## Checklist (persona)
1. Variables de entorno: el modelo del agente (`ENGINE_LLM_*`) y la clave del buscador elegido. La guía no recomienda un proveedor concreto: se elige en H5.
2. `node research/bench/cli.mjs run --config research/bench/pilot/config.pilot.json --case … --condition B0 --seed 101`, y lo mismo para B1 y B2.
3. Verificar:
   - los `steps.jsonl` validan;
   - hay al menos 1 entidad oficial;
   - `fetch_errors / fetches` < 0,5;
   - ningún log tiene `QUOTE_NOT_LITERAL` en más del 30 % de las citas;
   - `model_id` es el esperado;
   - la latencia nominal está por debajo del tope.
4. Revisar a mano 5 evidencias al azar: la cita está en la página.
5. Anotar en el vault los problemas encontrados. Los prompts solo se ajustan creando `v2`, y eso es **antes** de H5.

## Criterio de terminado
Las 6 corridas terminan sin `fatal_error` y se cumplen los puntos de la checklist, o los problemas quedan documentados con su decisión.
