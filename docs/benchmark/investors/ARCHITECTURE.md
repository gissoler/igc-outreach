# Arquitectura del benchmark de investors v0

## Decisión

El benchmark es un hermano, no una generalización del benchmark de grants. Conserva intactos `research/bench/`, `docs/BENCHMARK_PROTOCOL.md`, `docs/benchmark/LABELING_GUIDE.md`, `criteria_catalog.grant@v1`, sus casos y sus contratos.

```
perfil congelado
      │
      ├── B0: templates estáticos versionados
      ├── B1: planner, una tanda
      └── B2: planner + reflexión adaptativa + parada
                    │
       search → fetch → extractor → identidad/deduplicación
                    │
             discovery terminada
                    │
             judge por criterio
                    │
                 ranking
                    │
 pool → preanotación no-gold → muestra ciega → labels humanos → métricas → decisión propuesta
```

Todos los artefactos de configuración, casos, prompts, contratos, caché y output viven bajo namespaces de investors. El motor usa dependencias inyectadas; los fixtures no tienen red. Search/fetch/cache/LLM pueden componerse posteriormente con las utilidades genéricas existentes sin importar identidad, fechas o elegibilidad de grants.

## Límites

- `engine.mjs` implementa el bucle común, presupuestos, paciencia y separación entre discovery y judge.
- `conditions.mjs` contiene únicamente la diferencia B0/B1/B2.
- `identity.mjs` aplica IDs de firma y deduplicación conservadora.
- `extractor.mjs`, `activity.mjs`, `judge.mjs` y `ranking.mjs` no conocen convocatorias.
- `pool.mjs`, `sample.mjs`, `labels.mjs`, `metrics.mjs` y `decide.mjs` implementan el harness humano y estadístico.
- `cli.mjs` fija los comandos. `run-all` compone fixtures o SearXNG + caché + flota LLM, pero exige una config `frozen` sin placeholders; en esta entrega no se ejecuta la ruta externa.

No existe una importación desde el benchmark de grants hacia la lógica de dominio de investors. Solo `metrics.mjs` importa bootstrap, κ, W/T/L y prueba de signos de `research/bench/stats.mjs`, que son funciones estadísticas genéricas.
