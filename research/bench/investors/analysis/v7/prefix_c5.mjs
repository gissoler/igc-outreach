#!/usr/bin/env node
// C5 (H3): curva prefix_curve de v5 (B2, 36 corridas de pares) para fijar el mínimo de búsquedas antes de aceptar stop.
// Para cada corrida: firmas acumuladas (stable_ids_so_far) según totals.searches (principales + resolución, la misma
// unidad que budgets.searches). Rendimiento marginal = firmas nuevas por búsqueda en cada tramo. Sin red.
import { writeFileSync } from 'node:fs';
import { loadRuns, DIRS, median } from './common.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const runs = loadRuns(DIRS.pairs).filter(r => r.cond === 'B2');
const at = (curve, s) => { let best = null; for (const p of curve) if (p.searches <= s) best = p; return best ? best.stable_ids_so_far.length : 0; };
const bands = [[0, 6], [6, 9], [9, 12], [12, 14], [14, 18]];
const rows = runs.map(r => { const c = r.r.prefix_curve ?? [], maxS = Math.max(0, ...c.map(p => p.searches)); return { run_id: r.rid, stop_reason: r.r.stop_reason, max_searches: maxS, firms_final_discovery: at(c, 99), bands: bands.map(([a, b]) => maxS >= b ? +((at(c, b) - at(c, a)) / (b - a)).toFixed(3) : null) }; });
const out = { runs: rows.length, stop_reason: rows.reduce((a, r) => (a[r.stop_reason] = (a[r.stop_reason] ?? 0) + 1, a), {}), max_searches_median: median(rows.map(r => r.max_searches)),
  runs_reaching: Object.fromEntries([9, 12, 14, 18].map(s => [s, rows.filter(r => r.max_searches >= s).length])),
  marginal_firms_per_search_median: Object.fromEntries(bands.map(([a, b], i) => [`${a}-${b}`, { runs: rows.filter(r => r.bands[i] != null).length, median: median(rows.filter(r => r.bands[i] != null).map(r => r.bands[i])) }])), per_run: rows };
console.log(JSON.stringify({ ...out, per_run: undefined }, null, 1));
if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify(out, null, 1)}\n`);
