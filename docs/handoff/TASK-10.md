# TASK-10 · Preanotador, muestra ciega e importación de etiquetas

## Objetivo
Preparar el trabajo humano de forma ciega y estratificada, y reincorporar sus etiquetas.

## Archivos
- Crear `research/bench/preannotate.mjs`, `research/bench/sample.mjs` y `research/bench/labels.mjs`, y ampliar `cli.mjs` con `preannotate`, `sample` e `import-labels`.
- Ampliar `research/tests/agent/bench.test.mjs`.

## Contratos que usa
`preannotator_output`, `label`, el pool y `run_result`.

## Especificación
- **`preannotate --bench`:**
  - El cliente se construye con las variables de entorno de `preannotator_model` y la API compatible con OpenAI de `fleet.postChat`.
  - Comprueba `preannotator_model.family !== agent_model.family`.
  - Para cada ítem del pool renderiza `prompts/preannotator/v1`. `source_text` sale de la caché `fetch` (los documentos fuente de las corridas); si un ítem solo viene del ancla o de la búsqueda manual, se descarga su URL con la tool `fetch`.
  - Usa temperatura 0 y seed 0.
  - Guarda labels con `role:'preannotator'` y `annotator:'llm:<model_id>'` en `out/<bench>/labels/preannotations.jsonl`.
- **`sample --bench [--seed 7]`:**
  - Estratos S1–S6 de BENCHMARK_PROTOCOL §4.3 y pares de criterios (≤ 6 por caso).
  - Escribe `out/<bench>/labeling/sheet-<case_id>.csv` con las columnas exactas de ACC-33, más `sheet-<case_id>.json` (lo mismo, en JSON).
  - `item_key` es un hash opaco y el orden de filas está barajado (mulberry32 con la seed).
  - `criteria_to_label` = lista de `criterion_id` separados por `;`.
  - El mapeo `item_key → {strata, pares}` se guarda **aparte**, en `out/<bench>/labeling/key-<case_id>.json`, que no se entrega a quien adjudica.
- **`import-labels --bench --file <csv|json> --role adjudicator|second_reviewer --annotator <id>`:**
  - Valida cada fila contra `label` y la guarda en `labels/<role>.jsonl`.
  - Las columnas de criterios del CSV vienen como `G-ENTITY=met|<url>|<quote>;…`.
  - Un `item_key` desconocido aborta la importación.
  - Si un ítem tiene varias etiquetas del mismo rol, gana la última importada y se avisa.

## Criterios de aceptación
ACC-33.

## No tocar
Las hojas no deben contener ninguna información de condición, seed, rank, juicio ni preanotación.
