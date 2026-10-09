#!/usr/bin/env node
// Escribe report.md (FIX-17) junto a cada result.json de una carpeta de corrida. Sin red.
// Uso: node render_reports.mjs --out <dir de corrida> --cases <dir de casos>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderInvestorReport } from '../find.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const OUT = resolve(arg('out')), CASES = resolve(arg('cases')), repo = resolve(import.meta.dirname, '../../../..');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const cases = new Map(readdirSync(CASES).filter(x => x.endsWith('.json') && x !== 'manifest.json').map(x => { const c = json(resolve(CASES, x)); return [c.case_id, c]; }));
let n = 0;
for (const d of readdirSync(resolve(OUT, 'runs'))) {
  const p = resolve(OUT, 'runs', d, 'result.json'); if (!existsSync(p)) continue;
  const r = json(p), profile = json(resolve(repo, cases.get(r.case_id).profile_path));
  writeFileSync(resolve(OUT, 'runs', d, 'report.md'), renderInvestorReport(r, profile)); n++;
}
console.log(`report.md escritos: ${n}`);
