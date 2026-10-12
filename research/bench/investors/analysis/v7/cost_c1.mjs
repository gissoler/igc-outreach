#!/usr/bin/env node
// C1 (H11): costo de Exa por corrida con datos v5 (sin red). Llamadas pagadas = attempts de Exa con cached=false en search_end.
// Fase de cada búsqueda: profundización (entre deepening_start y deepening_end), resolución (entre resolution_start y
// resolution_end) o principal. "Después" = misma corrida contando solo la profundización de las 8 primeras firmas en el
// orden en que el motor las profundizó (deepening.max_firms_per_run = 8 en v7). Uso: node .../cost_c1.mjs [--json f]
import { writeFileSync } from 'node:fs';
import { loadRuns, DIRS, median } from './common.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const RATE = 0.0089, MAXF = 8;
const runs = loadRuns(DIRS.pairs).filter(r => r.cond === 'B2');
const per = runs.map(r => {
  let phase = 'principal', firm = -1; const c = { principal: 0, resolution: 0, deep: 0, deep_first8: 0, searches: { principal: 0, resolution: 0, deep: 0, deep_first8: 0 }, deep_fetches: 0, deep_fetches_first8: 0, firms: 0 };
  for (const e of r.ev) {
    if (e.event === 'deepening_start') { phase = 'deep'; firm++; c.firms++; }
    else if (e.event === 'deepening_end') phase = 'principal';
    else if (e.event === 'resolution_start' && phase !== 'deep') phase = 'resolution';
    else if (e.event === 'resolution_end' && phase === 'resolution') phase = 'principal';
    else if (e.event === 'search_end') {
      const paid = (e.attempts ?? []).filter(a => a.provider === 'exa' && !a.cached).length;
      c[phase] += paid; c.searches[phase]++;
      if (phase === 'deep' && firm < MAXF) { c.deep_first8 += paid; c.searches.deep_first8++; }
    } else if (e.event === 'fetch_end' && phase === 'deep') { c.deep_fetches++; if (firm < MAXF) c.deep_fetches_first8++; }
  }
  const before = c.principal + c.resolution + c.deep, after = c.principal + c.resolution + c.deep_first8;
  return { run_id: r.rid, case: r.case, variant: r.variant, seed: r.seed, ...c, paid_before: before, paid_after: after, usd_before: +(before * RATE).toFixed(4), usd_after: +(after * RATE).toFixed(4) };
});
const agg = rows => { const s = f => rows.reduce((a, r) => a + f(r), 0); return {
  runs: rows.length, paid_principal: s(r => r.principal), paid_resolution: s(r => r.resolution), paid_deep: s(r => r.deep), paid_deep_first8: s(r => r.deep_first8),
  searches_deep: s(r => r.searches.deep), searches_deep_first8: s(r => r.searches.deep_first8), deep_fetches: s(r => r.deep_fetches), deep_fetches_first8: s(r => r.deep_fetches_first8),
  firms_deepened: s(r => r.firms), runs_with_more_than_8_firms: rows.filter(r => r.firms > MAXF).length,
  paid_per_run_before_mean: +(s(r => r.paid_before) / rows.length).toFixed(2), paid_per_run_after_mean: +(s(r => r.paid_after) / rows.length).toFixed(2),
  paid_per_run_before_median: median(rows.map(r => r.paid_before)), paid_per_run_after_median: median(rows.map(r => r.paid_after)),
  usd_per_run_before_mean: +(s(r => r.paid_before) * RATE / rows.length).toFixed(4), usd_per_run_after_mean: +(s(r => r.paid_after) * RATE / rows.length).toFixed(4) }; };
const out = { rate_usd_per_paid_call: RATE, max_firms_after: MAXF, all_B2_36: agg(per), variant_A_18: agg(per.filter(r => r.variant === 'A')), per_run: per };
console.log(JSON.stringify({ all_B2_36: out.all_B2_36, variant_A_18: out.variant_A_18 }, null, 1));
if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify(out, null, 1)}\n`);
