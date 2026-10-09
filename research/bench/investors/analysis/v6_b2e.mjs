#!/usr/bin/env node
// Ablación B2E frente a B2 (PROMPT-v6 §5; exploratoria, fuera de la regla de decisión congelada). Misma semilla y casos p01–p12.
// Uso (desde research/): node bench/investors/analysis/v6_b2e.mjs --b2 <out con B2> --b2e <out con B2E> [--seed 101] [--labels ...] [--json salida.json]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { investorGain } from '../ranking.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const D2 = resolve(arg('b2')), DE = resolve(arg('b2e')), SEED = Number(arg('seed') ?? 101), LABELS = resolve(arg('labels') ?? 'bench/investors/gold/v3/labels/adjudicator.jsonl');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const labels = new Map(readFileSync(LABELS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(l => [`${l.case_id}|${l.stable_id}`, l]));
const find = (dir, caseId, cond) => { const d = resolve(dir, 'runs'); if (!existsSync(d)) return null; const n = readdirSync(d).find(x => x.endsWith(`__${caseId}__${cond}__s${SEED}`)); return n && existsSync(resolve(d, n, 'result.json')) ? json(resolve(d, n, 'result.json')) : null; };
const m = (r, caseId) => { const lab = r.entities.map(e => labels.get(`${caseId}|${e.stable_id}`)), L = lab.filter(Boolean), f = r.totals.fetches;
  return { accepted: r.entities.length, labeled: L.length, unlabeled: lab.length - L.length, label_gain2: L.filter(l => investorGain(l) >= 2).length, system_gain2: (r.ranked ?? []).filter(x => x.gain >= 2).length, searches: r.totals.searches, fetches: f, rejected: r.totals.rejected_non_investors, rejected_per_fetch: f ? +(r.totals.rejected_non_investors / f).toFixed(3) : null,
    tokens_nominal: r.totals.tokens_nominal, seconds_nominal: +r.totals.seconds_nominal.toFixed(1), latency_actual_ms: r.totals.latency_actual_ms, deep_tokens: r.v2_stats?.deepening?.tokens_nominal ?? 0, deep_fetches: r.v2_stats?.deepening?.fetches ?? 0, stop_reason: r.stop_reason }; };
const rows = [];
for (let i = 1; i <= 12; i++) {
  const id = `inv-case-syn-p${String(i).padStart(2, '0')}`, a = find(D2, id, 'B2'), b = find(DE, id, 'B2E');
  rows.push({ case_id: id, seed: SEED, B2: a ? m(a, id) : null, B2E: b ? m(b, id) : null,
    relevance_filter: b?.relevance_filter ?? null, sparse_after_round_2: b?.sparse_after_round_2 ?? null, accepted_after_round_2: b?.accepted_after_round_2 ?? null });
}
const both = rows.filter(r => r.B2 && r.B2E), sum = (rs, k, f) => rs.reduce((s, r) => s + (r[k]?.[f] ?? 0), 0);
const total = Object.fromEntries(['accepted', 'label_gain2', 'system_gain2', 'searches', 'fetches', 'rejected', 'tokens_nominal', 'deep_tokens', 'latency_actual_ms'].map(f => [f, { B2: sum(both, 'B2', f), B2E: sum(both, 'B2E', f) }]));
const sep = { embed_ms: 0, model_load_ms: 0, llm_calls: 0, llm_tokens: 0, llm_ms: 0, embedded_texts: 0, results_in: 0, results_kept: 0, empty_queries: 0 };
for (const r of both) for (const k of Object.keys(sep)) sep[k] += r.relevance_filter?.[k] ?? 0;
const report = { schema_version: 'v6_b2e/1', exploratory: true, seed: SEED, cases_compared: both.length, totals_paired: total, relevance_filter_costs_separate: sep, sparse_after_round_2_count: rows.filter(r => r.sparse_after_round_2 === true).length, rows };
if (arg('json')) writeFileSync(resolve(arg('json')), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ cases_compared: both.length, totals_paired: total, relevance_filter_costs_separate: sep, sparse_after_round_2_count: report.sparse_after_round_2_count }, null, 2));
