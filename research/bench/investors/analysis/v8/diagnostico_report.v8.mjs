#!/usr/bin/env node
// V8: informe del diagnóstico de alcanzabilidad → docs/benchmark/investors/V8-DIAGNOSTICO.md. Sin red. Solo cifras.
// Uso (desde research/): node bench/investors/analysis/v8/diagnostico_report.v8.mjs [--md ../docs/benchmark/investors/V8-DIAGNOSTICO.md]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR, VARIANTS } from './diagnostico.v8.mjs';
import { CASES_A, CASES_B, loadCase } from './queries.v8.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const f = resolve(OUT_DIR, 'result.json'), fi = resolve(OUT_DIR, 'result-incompleto.json');
const complete = existsSync(f); if (!complete && !existsSync(fi)) { console.error('sin resultados del diagnóstico'); process.exit(1); }
const R = JSON.parse(readFileSync(complete ? f : fi, 'utf8'));
const DESC = { base10: 'cortas, puesto ≤10 (base)', b30: 'cortas, puesto ≤30', b50: 'cortas, puesto ≤50', a10: 'category company, puesto ≤10', a25: 'category company, puesto ≤25', e10: 'largas del brief, puesto ≤10', e25: 'largas del brief, puesto ≤25', c: 'por inversiones (empresas parecidas → inversores): dominio o nombre', d: 'páginas de listas: dominio o nombre' };
const md = ['# V8 — Diagnóstico de alcanzabilidad del oro por variante', '', `Ejecutado: ${R.executed_at ?? '—'}${complete ? '' : ` (INCOMPLETO: ${R.stopped ?? `${R.errors} errores`})`}. Pre-registro: docs/handoff/V8-PREREGISTRO.md. Solo Exa, llamada directa (exa-direct.v8.mjs).`, '',
  `Costo: ${R.paid_units ?? R.spent_units} unidades pagadas × 0.0089 = US$ ${R.usd_at_0_0089 ?? R.usd}. Tarifa nominal de esas llamadas: US$ ${R.nominal_usd ?? '—'}. costDollars devuelto por Exa (suma): US$ ${R.exa_cost_usd_reported ?? '—'}.`, ''];
const sec = (title, sum, cases) => {
  if (!sum) return;
  md.push(`## ${title}`, '', `| Variante | Descripción | Casos con el oro (regla) | Casos solo por dominio | ${cases.join(' | ')} |`, `|---|---|---|---|${cases.map(() => '---').join('|')}|`);
  for (const v of VARIANTS) if (sum[v]) md.push(`| ${v} | ${DESC[v]} | ${sum[v].cases_reached} de ${cases.length} | ${sum[v].cases_reached_domain} | ${cases.map(c => sum[v].per_case[c].reached ? (sum[v].per_case[c].domain ? 'D' : 'N') : '—').join(' | ')} |`);
  md.push('', 'D = dominio del oro en los resultados; N = solo el nombre del oro en el texto (c y d); — = no aparece.', '');
};
sec('Fase A: p01–p06 (elección)', R.summary_A, CASES_A);
md.push(`Variantes elegidas en la fase A (≥ base10 + 2 casos): ${R.selected_A?.length ? R.selected_A.join(', ') : 'ninguna'}.`, '');
sec('Fase B: p07–p12 (confirmación)', R.summary_B, CASES_B);
md.push(`Variantes confirmadas en la fase B (≥ base10 + 1 caso): ${R.confirmed_B?.length ? R.confirmed_B.join(', ') : R.summary_B ? 'ninguna' : 'sin fase B'}.`, '');
md.push('## Llamadas (consulta, costo y puesto del oro)', '', '| Caso | Fase | Tipo | Consulta | Resultados | Unidades | USD | Nominal USD | Puesto del oro | Nombre en texto |', '|---|---|---|---|---|---|---|---|---|---|');
for (const c of R.calls ?? []) md.push(`| ${c.case} | ${c.phase} | ${c.kind} | ${c.query.replace(/\|/g, '/')} | ${c.results} | ${c.cached ? '0 (caché)' : c.units} | ${c.cached ? 0 : c.usd} | ${c.cached ? 0 : c.nominal_usd} | ${c.gold_rank ?? '—'} | ${c.name_hit == null ? 'n/a' : c.name_hit ? 'sí' : 'no'} |`);
md.push('', `Oros (de cases/, sin cambios): ${[...CASES_A, ...CASES_B].map(c => `${c} ${loadCase(c).gold.domain}`).join(', ')}.`);
writeFileSync(arg('md') ?? resolve(OUT_DIR, '../../../../../docs/benchmark/investors/V8-DIAGNOSTICO.md'), `${md.join('\n')}\n`);
console.log(JSON.stringify({ complete, selected_A: R.selected_A ?? null, confirmed_B: R.confirmed_B ?? null }));
