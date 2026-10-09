import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const [O, E] = process.argv.slice(2);
const dirs = fs.readdirSync(path.join(O, 'runs'));
const runs = dirs.map(d => JSON.parse(fs.readFileSync(path.join(O, 'runs', d, 'result.json'))));
const fails = []; 
for (const d of dirs) for (const f of fs.readdirSync(path.join(O, 'runs', d)).filter(x => x.startsWith('failure'))) { const j = JSON.parse(fs.readFileSync(path.join(O, 'runs', d, f), 'utf8')); fails.push({ run_id: d, file: f, condition: d.split('__')[2], error: (j.error?.message ?? j.message ?? j.error ?? JSON.stringify(j)).toString().slice(0, 140), name: j.error?.name ?? j.name ?? null }); }
const by = (xs, k) => xs.reduce((a, x) => (a[k(x)] = (a[k(x)] ?? 0) + 1, a), {});
const audit = {
  valid_results: runs.length, by_condition: by(runs, r => r.condition), by_case_seed_unique: new Set(runs.map(r => `${r.case_id}|${r.condition}|${r.seed}`)).size,
  capital_strategy_context_true: runs.filter(r => r.capital_strategy_context !== false).length,
  apollo_outside_b3: runs.filter(r => r.condition !== 'B3' && (r.apollo?.calls ?? 0) > 0).length,
  apollo_over_run_cap: runs.filter(r => (r.apollo?.calls ?? 0) > 2).length,
  apollo_calls_total: runs.reduce((s, r) => s + (r.apollo?.calls ?? 0), 0), apollo_credits_total: runs.reduce((s, r) => s + (r.apollo?.credits_estimated ?? 0), 0),
  null_unknown_names: runs.flatMap(r => r.entities).filter(e => !e.canonical_name || /^(null|unknown|undefined)$/i.test(e.canonical_name)).length,
  entities_total: runs.reduce((s, r) => s + r.entities.length, 0),
  abstained_runs: runs.filter(r => r.abstained).length, stop_reasons: by(runs, r => r.stop_reason),
  totals: { searches: 0, fetches: 0, tokens_nominal: 0, nominal_cost: 0, planner_calls: 0, rejected_non_investors: 0 }
};
for (const r of runs) for (const k of Object.keys(audit.totals)) audit.totals[k] += r.totals?.[k] ?? 0;
audit.failure_files = fails.length; audit.failure_attempts = fails.filter(f => /attempt/.test(f.file)).length; audit.failure_resolved = fails.filter(f => /resolved/.test(f.file)).length;
audit.failures_by_condition = by(fails.filter(f => /attempt/.test(f.file)), f => f.condition);
audit.failure_kinds = by(fails.filter(f => /attempt/.test(f.file)), f => (f.name ? f.name + ': ' : '') + f.error.slice(0, 70));
const ev = fs.readFileSync(path.join(O, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
const fe = ev.filter(e => e.event === 'fetch_end'); audit.fetch_via = by(fe, e => e.via ?? 'none');
audit.run_starts = ev.filter(e => e.event === 'run_start').length; audit.run_ends = ev.filter(e => e.event === 'run_end').length;
audit.hashes = { events_jsonl_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(O, 'events.jsonl'))).digest('hex'), labels_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(O, 'labels/adjudicator.jsonl'))).digest('hex'), metrics_report_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(O, 'metrics_report.json'))).digest('hex'), curve_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(O, 'curve.csv'))).digest('hex') };
fs.writeFileSync(path.join(E, 'analysis/audit_runs.json'), JSON.stringify({ audit, failures: fails }, null, 2) + '\n');
console.log(JSON.stringify(audit, null, 1));
