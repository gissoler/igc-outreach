#!/usr/bin/env node
// Métricas sin etiquetas de la corrida formal v5 (PROMPT-v6 §6), por condición, con umbrales de FIX_SPEC-investors-v4 §3.4. Solo cifras.
// Uso (desde research/): node bench/investors/analysis/v6_formal_metrics.mjs --out <dir> --cases <dir de casos> [--check <v5_check.json>] [--json salida.json] [--md salida.md]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CORE_CRITERIA } from '../metrics.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const OUT = resolve(arg('out')), CASES = resolve(arg('cases')), json = p => JSON.parse(readFileSync(p, 'utf8'));
const kinds = new Map(readdirSync(CASES).filter(x => x.endsWith('.json') && x !== 'manifest.json').map(x => { const c = json(resolve(CASES, x)); return [c.case_id, c.kind]; }));
const runs = readdirSync(resolve(OUT, 'runs')).filter(d => existsSync(resolve(OUT, 'runs', d, 'result.json'))).map(d => json(resolve(OUT, 'runs', d, 'result.json')));
const failed = readdirSync(resolve(OUT, 'runs')).filter(d => existsSync(resolve(OUT, 'runs', d, 'failure.json')) && !existsSync(resolve(OUT, 'runs', d, 'result.json')));
const pct = (n, d) => d ? +(100 * n / d).toFixed(1) : null, rate = (n, d) => d ? +(n / d).toFixed(3) : null;
const st = (j, id) => j.criteria.find(c => c.criterion_id === id)?.state ?? 'unknown';
const sum = (rs, f) => rs.reduce((a, r) => a + (f(r) ?? 0), 0);
const check = arg('check') && existsSync(resolve(arg('check'))) ? json(resolve(arg('check'))) : null;
const out = {};
for (const cond of ['B1', 'B2']) {
  const R = runs.filter(r => r.condition === cond), J = R.flatMap(r => r.judgments);
  const pos = [...kinds].filter(([, k]) => k === 'anchor').map(([id]) => id).sort(), nul = [...kinds].filter(([, k]) => k === 'null').map(([id]) => id).sort();
  const seedsGain = id => R.filter(r => r.case_id === id && r.ranked.some(x => x.gain >= 2)).length;
  const positives = pos.map(id => ({ case_id: id, runs: R.filter(r => r.case_id === id).length, seeds_with_gain2: seedsGain(id) }));
  const nullRuns = R.filter(r => nul.includes(r.case_id)), reasons = {};
  for (const r of nullRuns) { const k = r.abstained ? (r.abstention_reason ?? 'abstained') : 'NO_ABSTUVO'; reasons[k] = (reasons[k] ?? 0) + 1; }
  const valid = (reasons.no_candidates ?? 0) + (reasons.all_hard_not_met ?? 0);
  const fetches = sum(R, r => r.totals.fetches), dfetch = sum(R, r => r.v2_stats?.deepening?.fetches);
  out[cond] = {
    runs_valid: R.length, firms_accepted: J.length,
    core_all4_known_pct: pct(J.filter(j => CORE_CRITERIA.every(id => st(j, id) !== 'unknown')).length, J.length),
    core_any_known_pct: pct(J.filter(j => CORE_CRITERIA.some(id => st(j, id) !== 'unknown')).length, J.length),
    per_criterion_known_pct: Object.fromEntries(CORE_CRITERIA.map(id => [id, pct(J.filter(j => st(j, id) !== 'unknown').length, J.length)])),
    positives_with_gain2_in_ge2_seeds: positives.filter(p => p.seeds_with_gain2 >= 2).length, positives_total: positives.length, positives,
    null_runs: nullRuns.length, null_runs_with_gain2: nullRuns.filter(r => r.ranked.some(x => x.gain >= 2)).length, null_abstention_reasons: reasons,
    null_valid_abstention_pct: pct(valid, nullRuns.length), null_insufficient_evidence_pct: pct(reasons.insufficient_evidence ?? 0, nullRuns.length),
    discovery: { searches: sum(R, r => r.totals.searches), fetches, rejected_non_investors: sum(R, r => r.totals.rejected_non_investors), rejected_per_fetch: rate(sum(R, r => r.totals.rejected_non_investors), fetches), fetch_empty: sum(R, r => r.v2_stats?.fetch_empty), fetch_empty_rate: rate(sum(R, r => r.v2_stats?.fetch_empty), fetches), tokens_nominal: sum(R, r => r.totals.tokens_nominal), seconds_nominal: +sum(R, r => r.totals.seconds_nominal).toFixed(0), latency_actual_s: +(sum(R, r => r.totals.latency_actual_ms) / 1000).toFixed(0) },
    deepening_separate: { firms: sum(R, r => r.v2_stats?.deepening?.firms), searches: sum(R, r => r.v2_stats?.deepening?.searches), fetches: dfetch, fetch_empty: sum(R, r => r.v2_stats?.deepening?.fetch_empty), tokens_nominal: sum(R, r => r.v2_stats?.deepening?.tokens_nominal) },
    stop_reasons: R.reduce((o, r) => { o[r.stop_reason] = (o[r.stop_reason] ?? 0) + 1; return o; }, {})
  };
}
const b2 = out.B2, ok = (v, t, cmp) => v == null ? 'no evaluable' : cmp(v, t) ? 'sí' : 'no';
const criteria = [
  ['Firmas con SECTOR/STAGE/GEO/TYPE ≠ unknown (B2)', b2.core_all4_known_pct, '≥ 60 %', ok(b2.core_all4_known_pct, 60, (a, b) => a >= b)],
  ['Firmas con ≥ 1 criterio núcleo ≠ unknown (B2)', b2.core_any_known_pct, '≥ 85 %', ok(b2.core_any_known_pct, 85, (a, b) => a >= b)],
  ['Citas literales verificadas (todas las corridas, v5_check)', check?.summary?.citations_verified_pct ?? null, '100 %', ok(check?.summary?.citations_verified_pct ?? null, 100, (a, b) => a >= b)],
  ['Positivos con gain ≥ 2 en ≥ 2 de 3 semillas (B2)', `${b2.positives_with_gain2_in_ge2_seeds}/${b2.positives_total}`, '≥ 10/12', ok(b2.positives_with_gain2_in_ge2_seeds, 10, (a, b) => a >= b)],
  ['Nulos: corridas con gain ≥ 2 (B2)', `${b2.null_runs_with_gain2}/${b2.null_runs}`, '0', ok(b2.null_runs_with_gain2, 0, (a, b) => a === b)],
  ['Nulos: abstención válida (no_candidates/all_hard_not_met) (B2)', b2.null_valid_abstention_pct, '≥ 80 %', ok(b2.null_valid_abstention_pct, 80, (a, b) => a >= b)],
  ['Nulos: insufficient_evidence (B2)', b2.null_insufficient_evidence_pct, '≤ 20 %', ok(b2.null_insufficient_evidence_pct, 20, (a, b) => a <= b)],
  ['Rechazadas / fetches de descubrimiento (B2)', b2.discovery.rejected_per_fetch, '≤ 0,75', ok(b2.discovery.rejected_per_fetch, 0.75, (a, b) => a <= b)],
  ['FETCH_EMPTY (B2)', b2.discovery.fetch_empty_rate, '≤ 0,10', ok(b2.discovery.fetch_empty_rate, 0.10, (a, b) => a <= b)]
];
const expected = 90, report = { schema_version: 'v6_formal_metrics/1', runs_valid: runs.length, runs_expected: expected, runs_failed_without_result: failed, by_condition: out, criteria: criteria.map(([name, value, threshold, meets]) => ({ name, value, threshold, meets })), unlabeled_criteria_not_evaluated: ['gain2_label_agreement ≥ 0,70', 'hard_false_positive_rate ≤ 0,10', 'precisión de identidad ≥ 0,95', 'activity accuracy ≥ 0,45', 'pooled_recall@20'] };
if (arg('json')) writeFileSync(resolve(arg('json')), `${JSON.stringify(report, null, 2)}\n`);
const md = ['| Criterio | Valor | Umbral | ¿Cumple? |', '|---|---|---|---|', ...criteria.map(c => `| ${c[0]} | ${c[1] ?? '—'} | ${c[2]} | ${c[3]} |`)].join('\n');
if (arg('md')) writeFileSync(resolve(arg('md')), `${md}\n`);
console.log(JSON.stringify({ runs_valid: runs.length, runs_failed_without_result: failed.length }), '\n' + md);
