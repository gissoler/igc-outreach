// V9 hipótesis (g) (solo relectura): firmas con etiqueta gain>=2 por caso y fracción que encuentran v7 y v8 (unión de réplicas y mediana por réplica).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadLabels, investorGain, median } from '../v7/common.mjs';
import { OUT } from './data.v9.mjs';
const L = loadLabels(), byCase = {};
for (const [k, l] of L) { const g = investorGain(l); (byCase[l.case_id] ??= { labeled: 0, g2: new Set(), g3: new Set() }); byCase[l.case_id].labeled++; if (g >= 2) byCase[l.case_id].g2.add(l.stable_id); if (g >= 3) byCase[l.case_id].g3.add(l.stable_id); }
const runs = dir => { const d = resolve(OUT, dir, 'runs'); return existsSync(d) ? readdirSync(d).map(n => resolve(d, n, 'result.json')).filter(existsSync).map(f => JSON.parse(readFileSync(f, 'utf8'))) : []; };
const arms = { v7: runs('investors-internal-2026-10-12-v7'), v8: runs('investors-internal-2026-10-12-v8') };
const rows = [];
for (const c of Object.keys(byCase).sort()) {
  const b = byCase[c], row = { case: c, labeled: b.labeled, gain2: b.g2.size, gain3: b.g3.size };
  for (const [a, rs] of Object.entries(arms)) {
    const mine = rs.filter(r => r.case_id === c); if (!mine.length) continue;
    const ids = r => new Set((r.entities ?? []).map(e => e.stable_id));
    const union = new Set(mine.flatMap(r => [...ids(r)]));
    row[`${a}_union_g2`] = [...b.g2].filter(x => union.has(x)).length;
    row[`${a}_med_g2`] = median(mine.map(r => [...b.g2].filter(x => ids(r).has(x)).length));
  }
  rows.push(row);
}
console.table(rows);
