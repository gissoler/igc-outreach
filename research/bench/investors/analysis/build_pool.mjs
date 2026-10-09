import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const S = process.argv[2], BENCH = process.argv[3];
const { buildInvestorPool } = await import(resolve(S, 'pool.mjs'));
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const base = resolve(S, 'out', BENCH), runsDir = resolve(base, 'runs');
const runs = readdirSync(runsDir).map(d => json(resolve(runsDir, d, 'result.json')));
const casesDir = resolve(S, 'cases'); mkdirSync(resolve(base, 'pool'), { recursive: true });
const summary = [];
for (const f of readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json')) {
  const c = json(resolve(casesDir, f)), mp = resolve(base, 'manual', `${c.case_id}.json`);
  const pool = buildInvestorPool({ runs: runs.filter(r => r.case_id === c.case_id), anchors: c.anchors ?? [], manual: existsSync(mp) ? json(mp) : [] });
  writeFileSync(resolve(base, 'pool', `${c.case_id}.json`), JSON.stringify(pool, null, 2) + '\n');
  summary.push({ case: c.case_id, kind: c.kind ?? c.case_type ?? '?', pool: pool.length, anchors: (c.anchors ?? []).length, withAnchorOrigin: pool.filter(x => x.origins.includes('anchor')).length });
}
console.table(summary); console.log('total pool items:', summary.reduce((a, b) => a + b.pool, 0));
