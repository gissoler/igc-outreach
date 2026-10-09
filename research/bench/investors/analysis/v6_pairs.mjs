#!/usr/bin/env node
// Pares de intenciones (PROMPT-v6 §4; regla pre-registrada en docs/handoff/V6-PREREGISTRO-pares.md). Descriptivo y exploratorio; sin etiquetas nuevas.
// Uso (desde research/): node bench/investors/analysis/v6_pairs.mjs --a <out variante A> --b <out variante B> [--labels <adjudicator.jsonl>] [--json salida.json] [--md salida.md]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { investorGain } from '../ranking.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const A = resolve(arg('a')), B = resolve(arg('b')), LABELS = resolve(arg('labels') ?? 'bench/investors/gold/v3/labels/adjudicator.jsonl');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const labels = new Map(readFileSync(LABELS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(l => [`${l.case_id}|${l.stable_id}`, l]));
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const range = xs => xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
const PAIRS = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06'], CONDS = ['B1', 'B2'], SEEDS = [101, 202, 303];
const load = (dir, caseId, cond, seed) => { const d = resolve(dir, 'runs'); for (const bench of ['investors-internal-2026-10-09-v5']) { const p = resolve(d, `${bench}__${caseId}__${cond}__s${seed}`, 'result.json'); if (existsSync(p)) return json(p); } return null; };
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size && !B.size) return 1; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); };
const rel = (a, b) => Math.max(a, b) === 0 ? 0 : Math.abs(a - b) / Math.max(a, b);
const types = r => r.entities.reduce((o, e) => { o[e.investor_type] = (o[e.investor_type] ?? 0) + 1; return o; }, {});
const labelStats = (r, caseA) => { const ids = r.entities.map(e => e.stable_id), lab = ids.map(id => labels.get(`${caseA}|${id}`)), labeled = lab.filter(Boolean); return { accepted: ids.length, labeled: labeled.length, gain2_labeled: labeled.filter(l => investorGain(l) >= 2).length, gain2_share_of_labeled: labeled.length ? +(labeled.filter(l => investorGain(l) >= 2).length / labeled.length).toFixed(3) : null, unlabeled: ids.filter((id, i) => !lab[i]) }; };
const side = (r, caseA) => ({ n: r.entities.length, ids: r.entities.map(e => e.stable_id), types: types(r), ...labelStats(r, caseA), searches: r.totals.searches, fetches: r.totals.fetches, deep_searches: r.v2_stats?.deepening?.searches ?? 0, deep_fetches: r.v2_stats?.deepening?.fetches ?? 0 });
const rows = [];
for (const p of PAIRS) for (const cond of CONDS) {
  const caseA = `inv-case-syn-${p}`, per = [];
  for (const seed of SEEDS) {
    const ra = load(A, caseA, cond, seed), rb = load(B, `${caseA}-ib`, cond, seed);
    if (!ra || !rb) { per.push({ seed, missing: { A: !ra, B: !rb } }); continue; }
    const a = side(ra, caseA), b = side(rb, caseA);
    per.push({ seed, A: a, B: b, jaccard: +jaccard(a.ids, b.ids).toFixed(3), rel_diff_n: +rel(a.n, b.n).toFixed(3), new_unlabeled_in_B: b.unlabeled.filter(id => !a.ids.includes(id)) });
  }
  const ok = per.filter(x => x.A);
  const J = ok.map(x => x.jaccard), D = ok.map(x => x.rel_diff_n);
  rows.push({ pair: p, condition: cond, seeds_complete: ok.length, per_seed: per, median_jaccard: median(J), range_jaccard: range(J), median_rel_diff_n: median(D), range_rel_diff_n: range(D),
    median_n_A: median(ok.map(x => x.A.n)), median_n_B: median(ok.map(x => x.B.n)), median_searches_A: median(ok.map(x => x.A.searches)), median_searches_B: median(ok.map(x => x.B.searches)), median_fetches_A: median(ok.map(x => x.A.fetches)), median_fetches_B: median(ok.map(x => x.B.fetches)),
    // Regla pre-registrada: sensible si mediana(J) < 0,5 o mediana(D) > 0,30 (solo evaluable con las 3 semillas).
    sensitive: ok.length === SEEDS.length ? (median(J) < 0.5 || median(D) > 0.30) : null });
}
const summary = Object.fromEntries(CONDS.map(c => [c, { pairs_evaluable: rows.filter(r => r.condition === c && r.sensitive !== null).length, pairs_sensitive: rows.filter(r => r.condition === c && r.sensitive === true).length }]));
const report = { schema_version: 'v6_pairs/1', exploratory: true, rule: 'sensible si mediana(Jaccard) < 0,5 o mediana(|nA-nB|/max) > 0,30', summary, rows };
if (arg('json')) writeFileSync(resolve(arg('json')), `${JSON.stringify(report, null, 2)}\n`);
const f = x => x == null ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(2), rg = r => r ? `${f(r[0])}–${f(r[1])}` : '—';
const md = ['| Par | Cond | Semillas | n A (med) | n B (med) | Jaccard med (rango) | Dif. rel. n med (rango) | Búsquedas A/B | Fetches A/B | Sensible |', '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.pair} | ${r.condition} | ${r.seeds_complete}/3 | ${f(r.median_n_A)} | ${f(r.median_n_B)} | ${f(r.median_jaccard)} (${rg(r.range_jaccard)}) | ${f(r.median_rel_diff_n)} (${rg(r.range_rel_diff_n)}) | ${f(r.median_searches_A)}/${f(r.median_searches_B)} | ${f(r.median_fetches_A)}/${f(r.median_fetches_B)} | ${r.sensitive === null ? 'no evaluable' : r.sensitive ? 'sí' : 'no'} |`)].join('\n');
if (arg('md')) writeFileSync(resolve(arg('md')), `${md}\n`);
console.log(JSON.stringify(summary)); console.log(md);
