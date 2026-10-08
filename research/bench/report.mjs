/**
 * Renderiza el informe reproducible del benchmark.
 * No recalcula métricas ni altera la decisión.
 * Contratos: metrics_report/1.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const threats = [
  '**Sesgo del curator:** las anclas que encuentra una persona con búsqueda web son, por construcción, encontrables con ' +
    'búsqueda web. Eso favorece a cualquier sistema basado en un buscador frente a otros (por ejemplo, registros oficiales).',
  '**Sesgo del pool:** los positivos solo pueden venir de lo que trajo algún sistema o la búsqueda manual. ' +
    '\`pooled_recall\` sobrestima el recall real.',
  '**Prompts escritos por el mismo arquitecto** para B1 y B2. El prompt compartido reduce la asimetría, pero no la elimina.',
  '**Familia del modelo:** planner, extractor y judge son el mismo modelo. Los resultados no se generalizan a otros modelos.',
  '**n pequeño:** con 12 a 25 casos, la v0 solo detecta efectos grandes.',
  '**Web cambiante:** se mitiga con la ejecución el mismo día y la caché compartida, pero no se elimina.',
  '**Perfiles parciales:** muchos campos \`null\` empujan al judge hacia \`unknown\`. Es lo correcto, pero reduce ' +
    '\`recommendable\` en todas las condiciones por igual.',
];

const show = value => value == null ? 'n/a' : typeof value === 'number' ? value.toFixed(4) : String(value);

function comparisonRows(report) {
  return report.comparisons.map(row => [
    `| ${row.metric} | ${row.a} vs ${row.b} | ${row.wins}/${row.ties}/${row.losses} |`,
    `${show(row.sign_test_p_one_sided)} | ${row.bootstrap_ci95.map(show).join(' – ')} |`,
  ].join(' ')).join('\n');
}

function summaryRows(report) {
  return ['B0', 'B1', 'B2'].map(condition => {
    const rows = report.per_run.filter(row => row.condition === condition);
    const mean = metric => {
      const values = rows.map(row => row[metric]).filter(value => value != null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    return [
      `| ${condition} | ${show(mean('hit_at_20'))} | ${show(mean('pooled_recall_at_20'))} |`,
      `${show(mean('ndcg_at_10'))} | ${show(mean('hard_false_positive_rate'))} |`,
    ].join(' ');
  }).join('\n');
}

function curveRows(report) {
  return (report.curve || []).map(row => (
    `| ${row.condition} | ${row.tokens} | ${show(row.pooled_recall_at_20)} |`
  )).join('\n');
}

function abstentionRows(report) {
  return Object.entries(report.abstention).map(([condition, value]) => (
    `- ${condition}: abstenciones correctas ${value.correct_abstentions}; abstenciones falsas ${value.false_abstentions}`
  )).join('\n');
}

function latencyRows(report) {
  return Object.entries(report.latency || {}).map(([condition, value]) => [
    `- ${condition}: mediana discovery ${show(value.discovery_seconds_median)} s;`,
    `mediana judge ${show(value.judge_seconds_median)} s;`,
    `mediana de desviaciones por seed ${JSON.stringify(value.median_seed_sd)}`,
  ].join(' ')).join('\n');
}

/**
 * Escribe el informe sin reinterpretar el reporte validado.
 * Efectos: crea report.md dentro del directorio de salida.
 * @param {object} report Reporte de métricas validado.
 * @param {string} outDir Directorio de salida del benchmark.
 * @returns {string} Contenido exacto escrito en report.md.
 */
export function writeReport(report, outDir) {
  const quality = report.labeling_quality;
  const text = [
    `# Benchmark ${report.bench_id}`,
    '',
    '**Alcance honesto.** Esto es un harness exploratorio para comparar búsqueda estática y adaptativa sobre entidades ' +
      'ancla conocidas. Su resultado es una regla de negocio interna (\`business_rule_exploratory\`). No es una estimación ' +
      'general de recall ni de calidad del producto.',
    '',
    '## Métricas por condición',
    '',
    '| Condición | hit_at_20 | pooled_recall_at_20 | ndcg_at_10 | hard_false_positive_rate |',
    '|---|---:|---:|---:|---:|',
    summaryRows(report),
    '',
    '## Comparaciones',
    '',
    '| Métrica | Comparación | V/E/D | p | IC95 |',
    '|---|---|---:|---:|---|',
    comparisonRows(report),
    '',
    '## Curva pooled_recall frente a costo',
    '',
    '| Condición | Tokens nominales | pooled_recall_at_20 |',
    '|---|---:|---:|',
    curveRows(report),
    '',
    '## Calidad del etiquetado',
    '',
    `- Ítems adjudicados: ${quality.adjudicated_items}`,
    `- Ítems con segundo revisor: ${quality.second_reviewed_items}`,
    `- Kappa positivo: ${show(quality.kappa_positive)}`,
    `- Kappa de elegibilidad dura: ${show(quality.kappa_hard_eligibility)}`,
    `- Acuerdo bruto: ${show(quality.agreement_raw)}`,
    '',
    '## Abstenciones',
    '',
    abstentionRows(report),
    '',
    '## Latencia y dispersión',
    '',
    latencyRows(report),
    '',
    '## Amenazas a la validez',
    '',
    threats.map(value => `- ${value}`).join('\n'),
    '',
  ].join('\n');
  writeFileSync(resolve(outDir, 'report.md'), text);
  return text;
}
