// Métricas finales: B0/B1/B2 (regla congelada) y B3 vs B2 (ablación independiente).
// Uso: node run_metrics.mjs <S=.../research/bench/investors> <bench_id> <E=carpeta de ejecución>
import fs from 'fs';
import path from 'path';
const [S, benchId, E] = process.argv.slice(2);
const B = path.resolve(S, '..');
const imp = f => import(path.join(S, f));
const { investorGain } = await imp('ranking.mjs');
const M = await imp('metrics.mjs');
const { proposedInvestorDecision } = await imp('decide.mjs');
const { wtl, bootstrapCI, signTestOneSided } = await import(path.join(B, 'stats.mjs'));
const O = path.join(S, 'out', benchId);
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const jsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)) : [];
const mean = xs => { const c = xs.filter(Number.isFinite); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null; };

const runs = fs.readdirSync(path.join(O, 'runs')).map(d => json(path.join(O, 'runs', d, 'result.json')));
const labels = jsonl(path.join(O, 'labels/adjudicator.jsonl'));
const second = jsonl(path.join(O, 'labels/second_reviewer.jsonl'));
const cases = fs.readdirSync(path.join(S, 'cases')).filter(x => x.endsWith('.json') && x !== 'manifest.json').map(x => json(path.join(S, 'cases', x))).sort((a, b) => a.case_id.localeCompare(b.case_id));
const cfg = json(path.join(S, 'config/v3-2026-10-08.json'));
const thresholds = cfg.decision_rule;
const CONDS = ['B0', 'B1', 'B2', 'B3'];
const gainOf = new Map(labels.map(l => [`${l.case_id}|${l.stable_id}`, investorGain(l)]));

// Extras sobre las métricas del código: tasa de falsos positivos duros sobre el top-10 por etiqueta (el sistema nunca da gain>=2)
const hardFp = (run, ll, k = 10) => {
  const by = new Map(ll.map(x => [x.stable_id, x]));
  const top = run.ranked.slice(0, k).map(x => by.get(x.stable_id)).filter(Boolean);
  const bad = top.filter(h => h.hard_eligibility === 'ineligible' || h.sector_fit === 'off' || h.active_status === 'inactive' || h.identity_correct === false || h.entity_kind !== 'institutional_investor');
  return { n: top.length, bad: bad.length, rate: top.length ? bad.length / top.length : null };
};
const posIds = (run, ll) => { const pos = new Set(ll.filter(x => investorGain(x) >= 2).map(x => x.stable_id)); return run.ranked.slice(0, 20).map(x => x.stable_id).filter(id => pos.has(id)); };

const metricsNames = ['hit_at_20', 'pooled_recall_at_20', 'ndcg_at_10', 'hard_false_positive_rate', 'hard_fp_top10_by_label'];
const per_run = runs.map(run => {
  const ll = labels.filter(x => x.case_id === run.case_id), c = cases.find(x => x.case_id === run.case_id);
  const cm = M.classificationMetrics(run, ll), hf = hardFp(run, ll);
  return {
    run_id: run.run_id, case_id: run.case_id, condition: run.condition, seed: run.seed, abstained: run.abstained, stop_reason: run.stop_reason,
    hit_at_20: M.hitAt20(run.ranked, c?.anchors), pooled_recall_at_20: M.pooledRecallAt20(run.ranked, ll), ndcg_at_10: M.ndcgAt10(run.ranked, ll),
    hard_fp_top10_by_label: hf.rate, top10_labeled: hf.n, top10_bad: hf.bad, positives_in_top20: posIds(run, ll).length, ranked_n: run.ranked.length,
    ...cm, totals: run.totals, apollo: run.apollo, recall_cost_curve: M.recallCostCurve(run, ll)
  };
});
const per_case = cases.map(c => {
  const row = { case_id: c.case_id, kind: c.kind, pool_size: labels.filter(l => l.case_id === c.case_id).length, pool_positives: labels.filter(l => l.case_id === c.case_id && investorGain(l) >= 2).length };
  for (const cond of CONDS) {
    const rr = per_run.filter(x => x.case_id === c.case_id && x.condition === cond);
    row[cond] = Object.fromEntries(metricsNames.map(m => [m, mean(rr.map(x => x[m]))]));
    row[cond].seed_dispersion = Object.fromEntries(metricsNames.map(m => [m, M.seedDispersion(rr, m)]));
  }
  return row;
});
// Comparaciones B2 vs B0/B1 (regla congelada)
const comparisons = [];
for (const metric of ['pooled_recall_at_20', 'ndcg_at_10', 'hit_at_20']) for (const other of ['B0', 'B1'])
  comparisons.push(M.compareConditions(per_case, metric, other, metric === 'hit_at_20' ? 0 : metric === 'ndcg_at_10' ? 0.03 : 0.05));
const abstention = M.abstentionMetrics(cases, runs.filter(r => r.condition !== 'B3'));
const latency = Object.fromEntries(CONDS.map(c => [c, M.latencyMetrics(runs.filter(x => x.condition === c))]));
const recallCmp = o => comparisons.find(x => x.metric === 'pooled_recall_at_20' && x.b === o);
const b2Runs = per_run.filter(x => x.condition === 'B2');
const ndcgDiffs = per_case.flatMap(x => ['B0', 'B1'].map(o => x.B2.ndcg_at_10 == null || x[o].ndcg_at_10 == null ? null : x.B2.ndcg_at_10 - x[o].ndcg_at_10)).filter(Number.isFinite);
const frozenInput = { comparisons: { vs_b0: recallCmp('B0'), vs_b1: recallCmp('B1') }, b2: { ndcg_delta_min: ndcgDiffs.length ? Math.min(...ndcgDiffs) : null, hard_false_positive_rate: mean(b2Runs.map(x => x.hard_false_positive_rate)), correct_null_abstentions: Number(abstention.B2.correct_abstentions.split('/')[0]) } };
const frozen = proposedInvestorDecision({ ...frozenInput, thresholds });
// Aviso: hard_false_positive_rate del sistema es null (ninguna corrida emitió gain>=2) y null<=umbral se evalúa a true en JS.
const b2HardTop10 = mean(b2Runs.map(x => x.hard_fp_top10_by_label));
const evaluable = {
  recall_vs_b0: frozenInput.comparisons.vs_b0.mean_diff != null && frozenInput.comparisons.vs_b0.sign_test_p_one_sided != null,
  recall_vs_b1: frozenInput.comparisons.vs_b1.mean_diff != null && frozenInput.comparisons.vs_b1.sign_test_p_one_sided != null,
  ndcg_noninferior: frozenInput.b2.ndcg_delta_min != null,
  hard_false_positive_rate: frozenInput.b2.hard_false_positive_rate != null,
  null_abstentions: true
};
const aggregate = Object.fromEntries(CONDS.map(c => {
  const rr = per_run.filter(x => x.condition === c);
  const tot = k => runs.filter(x => x.condition === c).reduce((s, x) => s + (x.totals?.[k] ?? 0), 0);
  return [c, {
    runs: rr.length, hit_at_20: mean(rr.map(x => x.hit_at_20)), pooled_recall_at_20: mean(rr.map(x => x.pooled_recall_at_20)), ndcg_at_10: mean(rr.map(x => x.ndcg_at_10)),
    identity_accuracy: mean(rr.map(x => x.identity_accuracy)), activity_accuracy: mean(rr.map(x => x.activity_accuracy)), unknown_rate: mean(rr.map(x => x.unknown_rate)),
    hard_false_positive_rate_system: mean(rr.map(x => x.hard_false_positive_rate)), hard_fp_top10_by_label: mean(rr.map(x => x.hard_fp_top10_by_label)),
    non_investor_rate: mean(rr.map(x => x.non_investor_rate)), portfolio_company_confusion_rate: mean(rr.map(x => x.portfolio_company_confusion_rate)),
    positives_in_top20_mean: mean(rr.map(x => x.positives_in_top20)),
    abstained_runs: rr.filter(x => x.abstained).length,
    searches: tot('searches'), fetches: tot('fetches'), planner_calls: tot('planner_calls'), nominal_cost_total: tot('nominal_cost'), tokens_nominal_total: tot('tokens_nominal'),
    nominal_cost_mean: mean(rr.map(x => x.totals?.nominal_cost)), latency_actual_ms_mean: latency[c].actual_ms_mean, latency_nominal_ms_mean: latency[c].nominal_ms_mean
  }];
}));
// criterios por condición
const criteria = {};
for (const c of ['B0', 'B1', 'B2']) { const acc = {}; for (const r of per_run.filter(x => x.condition === c)) for (const [k, v] of Object.entries(r.criteria ?? {})) { const a = acc[k] ??= { tp: 0, fp: 0, fn: 0, n: 0 }; a.tp += v.tp; a.fp += v.fp; a.fn += v.fn; a.n += v.n; } for (const a of Object.values(acc)) { a.precision = a.tp + a.fp ? a.tp / (a.tp + a.fp) : null; a.recall = a.tp + a.fn ? a.tp / (a.tp + a.fn) : null; a.f1 = a.precision != null && a.recall != null && a.precision + a.recall ? 2 * a.precision * a.recall / (a.precision + a.recall) : 0; } criteria[c] = acc; }

// ---- B3 vs B2 (ablación independiente) ----
const seeds = [101, 202, 303];
const pairs = per_case.map(r => ({ case_id: r.case_id, d_recall: r.B3.pooled_recall_at_20 == null || r.B2.pooled_recall_at_20 == null ? null : r.B3.pooled_recall_at_20 - r.B2.pooled_recall_at_20, d_ndcg: r.B3.ndcg_at_10 == null || r.B2.ndcg_at_10 == null ? null : r.B3.ndcg_at_10 - r.B2.ndcg_at_10 }));
const cmpB3 = (key, tie) => { const diffs = pairs.map(p => p[key]), o = wtl(diffs, tie), vals = diffs.filter(Number.isFinite), n = o.wins + o.losses; return { ...o, mean_diff: mean(vals), bootstrap_ci95: bootstrapCI(vals, { seed: 20261007 }), sign_test_p_one_sided: n ? signTestOneSided(n, o.wins) : null }; };
const events = jsonl(path.join(O, 'events.jsonl'));
const lastStart = new Map(); events.forEach((e, i) => { if (e.event === 'run_start') lastStart.set(e.run_id, i); });
const apolloEv = events.map((e, i) => ({ e, i })).filter(({ e, i }) => e.event?.startsWith('apollo_') && i > (lastStart.get(e.run_id) ?? -1));
const apolloByRun = {};
for (const { e } of apolloEv) { const a = apolloByRun[e.run_id] ??= { start: [], end: [], rejected: [] }; if (e.event === 'apollo_search_start') a.start.push(e); else if (e.event === 'apollo_search_end') a.end.push(e); else a.rejected.push(e); }
const b3Runs = runs.filter(r => r.condition === 'B3');
const apolloCalls = b3Runs.map(r => {
  const a = apolloByRun[r.run_id] ?? { start: [], end: [], rejected: [] };
  const ended = a.end.map((end, i) => {
    const q = a.start.filter(s => s.reason !== 'x')[i]?.query ?? '';
    const domain = (q.match(/APOLLO_ORG:\s*([^\s|]+)/) ?? [])[1] ?? null;
    const inRun = domain ? r.entities.some(en => en.official_domain === domain || (en.sources ?? []).some(s => s.url.includes(domain))) : false;
    const inTop20 = domain ? r.ranked.slice(0, 20).some(x => x.stable_id === `inv:domain:${domain}`) : false;
    const fromApolloSource = r.entities.some(en => JSON.stringify(en).toLowerCase().includes('apollo'));
    const verdict = end.records === 0 ? 'sin_contribucion' : (inRun ? 'confirmacion' : 'firma_nueva_sin_entidad');
    return { run_id: r.run_id, domain, records: end.records, credits: end.credits_estimated, latency_ms: end.latency_ms, in_run_entities: inRun, in_top20: inTop20, entity_with_apollo_source: fromApolloSource, verdict };
  });
  return { run_id: r.run_id, case_id: r.case_id, seed: r.seed, calls_reported: r.apollo?.calls ?? 0, credits_reported: r.apollo?.credits_estimated ?? 0, rejected: a.rejected.length, detail: ended };
});
const exposed = apolloCalls.filter(x => x.calls_reported > 0);
const incremental = per_case.map(c => {
  const ll = labels.filter(l => l.case_id === c.case_id), pos = new Set(ll.filter(x => investorGain(x) >= 2).map(x => x.stable_id));
  const u = cond => new Set(runs.filter(r => r.case_id === c.case_id && r.condition === cond).flatMap(r => r.ranked.slice(0, 20).map(x => x.stable_id).filter(id => pos.has(id))));
  const u2 = u('B2'), u3 = u('B3');
  const hf = cond => mean(per_run.filter(x => x.case_id === c.case_id && x.condition === cond).map(x => x.top10_bad));
  return { case_id: c.case_id, positives_B2_union: u2.size, positives_B3_union: u3.size, incremental_positives_B3_not_B2: [...u3].filter(i => !u2.has(i)).length, lost_positives_B2_not_B3: [...u2].filter(i => !u3.has(i)).length, extra_hard_fp_top10_mean: hf('B3') - hf('B2') };
});
const incTotal = incremental.reduce((s, x) => s + x.incremental_positives_B3_not_B2, 0), lostTotal = incremental.reduce((s, x) => s + x.lost_positives_B2_not_B3, 0);
const credits = b3Runs.reduce((s, r) => s + (r.apollo?.credits_estimated ?? 0), 0), callsTotal = b3Runs.reduce((s, r) => s + (r.apollo?.calls ?? 0), 0);
const dRecall = cmpB3('d_recall', 0.05), dNdcg = cmpB3('d_ndcg', 0.03);
const extraHardFp = mean(incremental.map(x => x.extra_hard_fp_top10_mean));
// Contrapartida emparejada en las corridas expuestas (misma caso+semilla)
const matched = exposed.map(x => { const b2 = per_run.find(r => r.case_id === x.case_id && r.seed === x.seed && r.condition === 'B2'), b3 = per_run.find(r => r.run_id === x.run_id); return { run_id: x.run_id, d_recall: b3.pooled_recall_at_20 - b2.pooled_recall_at_20, d_ndcg: b3.ndcg_at_10 - b2.ndcg_at_10 }; });
const apolloAttrib = exposed.some(x => x.detail.some(d => d.entity_with_apollo_source || d.verdict === 'firma_nueva_sin_entidad'));
let b3Class, b3Why;
const exposure = exposed.length / b3Runs.length;
if (incTotal === 0 && !apolloAttrib && Math.abs(dRecall.mean_diff ?? 0) < thresholds.min_recall_gain) {
  b3Class = exposure < 0.25 ? 'inconclusive' : 'no_measurable_increment';
  b3Why = `Apollo se invocó en ${exposed.length}/${b3Runs.length} corridas B3 (${(exposure * 100).toFixed(0)}%); ninguna llamada produjo una entidad o evidencia atribuible a Apollo y no hay positivos incrementales.`;
} else if ((dRecall.mean_diff ?? 0) >= thresholds.min_recall_gain && incTotal > 0 && (extraHardFp ?? 0) <= 0) { b3Class = 'useful_increment'; b3Why = 'Mejora de recall agrupado >= umbral con positivos incrementales y sin falsos positivos duros extra.'; }
else if ((dRecall.mean_diff ?? 0) <= -thresholds.min_recall_gain || (extraHardFp ?? 0) > thresholds.max_hard_false_positive_rate) { b3Class = 'harmful_increment'; b3Why = 'Pérdida de recall o falsos positivos duros extra por encima del umbral.'; }
else { b3Class = 'inconclusive'; b3Why = `Apollo se invocó en ${exposed.length}/${b3Runs.length} corridas B3 (${(exposure*100).toFixed(0)}%); la diferencia global B3-B2 (recall ${dRecall.mean_diff?.toFixed(3)}, IC95 ${dRecall.bootstrap_ci95.map(x=>x.toFixed(3)).join(' a ')}) está dominada por la variación de semilla de las 40 corridas sin llamadas; en las ${matched.length} corridas expuestas el efecto emparejado es mixto (media ${mean(matched.map(x=>x.d_recall))?.toFixed(3)}); ninguna entidad del ranking tiene Apollo como fuente.`; }

// ---- curva recall-costo por condición ----
const grid = []; for (let c = 0; c <= 80; c += 2) grid.push(c);
const curveRows = [['condition', 'nominal_cost', 'pooled_recall_at_20_mean', 'runs']];
for (const cond of CONDS) {
  const rr = per_run.filter(x => x.condition === cond);
  for (const g of grid) {
    const vals = rr.map(r => { const pts = r.recall_cost_curve.filter(p => p.nominal_cost <= g); const last = pts[pts.length - 1]; return last ? last.pooled_recall_at_20 : (r.recall_cost_curve.length ? 0 : null); });
    curveRows.push([cond, g, mean(vals.map(v => v == null ? NaN : v))?.toFixed(4) ?? '', vals.filter(v => v != null).length]);
  }
}
fs.writeFileSync(path.join(O, 'curve.csv'), curveRows.map(r => r.join(',')).join('\n') + '\n');

const slim = per_run.map(({ recall_cost_curve, criteria: _c, ...rest }) => rest);
const report = {
  schema_version: 'investor_metrics_report/1', bench_id: benchId, labels_origin: 'model_adjudicated_internal', label_count: labels.length,
  per_run: per_run.map(({ recall_cost_curve, ...rest }) => rest), per_case, aggregate, criteria_by_condition: criteria, comparisons, abstention, latency,
  labeling_agreement: second.length ? M.agreement(labels, second) : { reviewed: 0, agreement_raw: null, cohen_kappa: null, note: 'No hubo segundo revisor; no se estima acuerdo.' },
  decision_input: frozenInput, hard_false_positive_top10_by_label_B2: b2HardTop10
};
fs.writeFileSync(path.join(O, 'metrics_report.json'), JSON.stringify(report, null, 2) + '\n');
const decision = { ...frozen, thresholds, evaluable_checks: evaluable, caveats: [
  'hard_false_positive_rate del sistema es null porque ninguna corrida emitió gain>=2 (todas abstuvieron); decide.mjs coacciona null<=umbral a true. Ese check se marca no evaluable y no se interpreta como aprobado.',
  'Las 180 corridas se abstuvieron: el extractor vivo deja los estados de criterios en unknown y el gain de ejecución queda limitado a 1.',
  'Etiquetas model_adjudicated_internal; sin humano ni familia independiente.'],
  passes_if_approved_corrected: Object.entries(frozen.checks).every(([k, v]) => v && evaluable[k]), status: 'proposed' };
fs.writeFileSync(path.join(O, 'decision.json'), JSON.stringify(decision, null, 2) + '\n');
const ablation = { schema_version: 'investor_apollo_ablation/1', comparison: 'B3 vs B2 (independiente de la regla congelada)', b3_runs: b3Runs.length, exposed_runs: exposed.length, exposure_rate: exposure, apollo_calls: callsTotal, credits_estimated: credits, rejected_calls: apolloCalls.reduce((s, x) => s + x.rejected, 0),
  delta_pooled_recall_at_20: dRecall, delta_ndcg_at_10: dNdcg, incremental_positives_total: incTotal, lost_positives_total: lostTotal, extra_hard_false_positives_top10_mean: extraHardFp,
  wrong_organizations: 'No medible: los eventos solo guardan el número de registros devueltos, no el dominio devuelto.', apollo_attributable_coverage: apolloAttrib ? 'una llamada devolvió un registro para una firma sin entidad en la corrida (no entró al ranking); cero positivos atribuibles a Apollo' : 'ninguna entidad ni evidencia con fuente Apollo',
  call_outcomes: { sin_contribucion: exposed.flatMap(x => x.detail).filter(d => d.verdict === 'sin_contribucion').length, confirmacion: exposed.flatMap(x => x.detail).filter(d => d.verdict === 'confirmacion').length, firma_nueva_sin_entidad: exposed.flatMap(x => x.detail).filter(d => d.verdict === 'firma_nueva_sin_entidad').length },
  cost_per_incremental_positive: incTotal ? credits / incTotal : null, latency_extra_ms: { actual: aggregate.B3.latency_actual_ms_mean - aggregate.B2.latency_actual_ms_mean, nominal: aggregate.B3.latency_nominal_ms_mean - aggregate.B2.latency_nominal_ms_mean },
  seed_dispersion: Object.fromEntries(['B2', 'B3'].map(c => [c, { pooled_recall_at_20: mean(per_case.map(r => r[c].seed_dispersion.pooled_recall_at_20)), ndcg_at_10: mean(per_case.map(r => r[c].seed_dispersion.ndcg_at_10)) }])),
  matched_exposed_runs: matched, per_case_incremental: incremental, calls: apolloCalls, classification: b3Class, classification_reason: b3Why, cannot_change_b2_decision: true };
fs.writeFileSync(path.join(O, 'apollo_ablation_metrics.json'), JSON.stringify(ablation, null, 2) + '\n');
console.log(JSON.stringify({ aggregate, comparisons: comparisons.map(c => ({ m: c.metric, b: c.b, w: c.wins, t: c.ties, l: c.losses, md: c.mean_diff, ci: c.bootstrap_ci95, p: c.sign_test_p_one_sided })), abstention, frozen, evaluable, b2HardTop10, b3: { b3Class, b3Why, dRecall, dNdcg, incTotal, lostTotal, credits, callsTotal, extraHardFp, exposed: exposed.length } }, null, 1));
