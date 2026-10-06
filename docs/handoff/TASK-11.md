# TASK-11 · Métricas, estadística, decisión y reporte

## Objetivo
Calcular exactamente las métricas pre-registradas y aplicar la regla de decisión.

## Archivos
- Crear `research/bench/metrics.mjs`, `research/bench/stats.mjs`, `research/bench/decide.mjs` y `research/bench/report.mjs`, y ampliar `cli.mjs` con `metrics` y `decide`.
- Ampliar `research/tests/agent/bench.test.mjs`.

## Contratos que usa
`metrics_report`, `label` y `run_result`.

## Especificación
- **`gain(label)`:** BENCHMARK_PROTOCOL §4.4.
- **Etiqueta efectiva por ítem:**
  - Si existen las dos (`adjudicator` y `second_reviewer`) y no coinciden en `gain≥2` o en `hard_eligibility`, se usa la del adjudicador y se marca `disagreement`. La κ se calcula sobre los ítems que tienen ambas.
  - Si solo hay preanotación, el ítem cuenta como no adjudicado (`gain = 0` para las métricas).
- **Métricas:** BENCHMARK_PROTOCOL §5, puntos 1 a 10, con los nombres de campo de `metrics_report.schema.json`.
- **`stats.mjs`:**
  - `signTestOneSided(n, w)`.
  - `bootstrapCI(d, {B:10000, seed:20261006})`, con el algoritmo exacto de ACC-36.
  - `cohenKappa(table)`.
  - `wtl(d, tau)`.
- **`decide.mjs`:** `decide(aggregates)` → `decision`. Reglas D1–D7 y precedencia de BENCHMARK_PROTOCOL §7. `rule_version:'decision_rule@v1'`, `label:'business_rule_exploratory'`.
- **`report.mjs`:** `out/<bench>/report.md` con:
  - las tablas por condición (media y dispersión);
  - victorias, empates y derrotas, la p y el IC;
  - la curva (`curve.csv`);
  - la calidad del etiquetado;
  - las abstenciones como «x/y»;
  - las amenazas a la validez (texto fijo, copiado de BENCHMARK_PROTOCOL §10);
  - y la frase de alcance de BENCHMARK_PROTOCOL al inicio.

  Nunca escribe la palabra «recall» sin el prefijo `pooled_`, salvo en esa frase fija.

## Criterios de aceptación
ACC-34 a ACC-39. `metrics_report.json` valida contra el schema.

## No tocar
Las definiciones de las métricas. Si te parece que una es incorrecta, anótalo en el PR y no la cambies.
