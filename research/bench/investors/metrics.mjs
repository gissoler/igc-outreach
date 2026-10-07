import { investorGain } from './ranking.mjs';
import { bootstrapCI, signTestOneSided, wtl, cohenKappa } from '../stats.mjs';

const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export function hitAt20(ranked, anchors) { if (!anchors?.length) return null; const ids = new Set(ranked.slice(0, 20).map(x => x.stable_id)); return anchors.some(x => ids.has(x.stable_id)) ? 1 : 0; }
export function pooledRecallAt20(ranked, labels) { const positives = labels.filter(x => investorGain(x) >= 2); if (!positives.length) return null; const ids = new Set(ranked.slice(0, 20).map(x => x.stable_id)); return positives.filter(x => ids.has(x.stable_id)).length / positives.length; }
export function ndcgAt10(ranked, labels) { const gains = new Map(labels.map(x => [x.stable_id, investorGain(x)])); const score = values => values.reduce((sum, gain, i) => sum + (2 ** gain - 1) / Math.log2(i + 2), 0); const actual = ranked.slice(0, 10).map(x => gains.get(x.stable_id) ?? 0), ideal = [...gains.values()].sort((a, b) => b - a).slice(0, 10); const best = score(ideal); return best ? score(actual) / best : null; }

export function classificationMetrics(run, labels) {
  const human = new Map(labels.map(x => [x.stable_id, x])), pairs = run.judgments.map(system => ({ system, human: human.get(system.stable_id) })).filter(x => x.human);
  const identity_accuracy = pairs.length ? pairs.filter(x => x.human.identity_correct === true).length / pairs.length : null;
  const activePairs = pairs.filter(x => x.human.identity_correct === true), activity_accuracy = activePairs.length ? activePairs.filter(x => x.system.active_status === x.human.active_status).length / activePairs.length : null;
  const criteria = {}; let unknown = 0, total = 0;
  for (const { system, human: h } of pairs) for (const hc of h.criteria) { const sc = system.criteria.find(x => x.criterion_id === hc.criterion_id); if (!sc) continue; const row = criteria[hc.criterion_id] ??= { tp: 0, fp: 0, fn: 0, n: 0 }; const hp = hc.state === 'met', sp = sc.state === 'met'; if (hp && sp) row.tp++; else if (!hp && sp) row.fp++; else if (hp) row.fn++; row.n++; total++; if (sc.state === 'unknown') unknown++; }
  for (const row of Object.values(criteria)) { row.precision = row.tp + row.fp ? row.tp / (row.tp + row.fp) : null; row.recall = row.tp + row.fn ? row.tp / (row.tp + row.fn) : null; row.f1 = row.precision != null && row.recall != null && row.precision + row.recall ? 2 * row.precision * row.recall / (row.precision + row.recall) : 0; }
  const recommended = run.ranked.filter(x => x.gain >= 2 && human.has(x.stable_id));
  const hard_false_positive_rate = recommended.length ? recommended.filter(x => human.get(x.stable_id).hard_eligibility === 'ineligible' || human.get(x.stable_id).sector_fit === 'off' || human.get(x.stable_id).active_status === 'inactive').length / recommended.length : null;
  const nonInvestor = run.totals?.rejected_non_investors ?? pairs.filter(x => x.human.entity_kind !== 'institutional_investor').length;
  const portfolio = run.totals?.portfolio_companies_rejected ?? pairs.filter(x => x.human.entity_kind === 'portfolio_company').length;
  const denominator = run.totals?.fetches ?? pairs.length;
  return { identity_accuracy, activity_accuracy, criteria, unknown_rate: total ? unknown / total : null, hard_false_positive_rate, non_investor_rate: denominator ? nonInvestor / denominator : null, portfolio_company_confusion_rate: denominator ? portfolio / denominator : null };
}

export function recallCostCurve(run, labels) { const positives = labels.filter(x => investorGain(x) >= 2); return run.prefix_curve.map(point => ({ nominal_cost: point.nominal_cost, pooled_recall_at_20: pooledRecallAt20(point.stable_ids_so_far.map(stable_id => ({ stable_id })), positives) })); }

export function compareConditions(perCase, metric, other, tieMargin, { bootstrapSeed = 20261007 } = {}) { const diffs = perCase.map(row => row.B2?.[metric] == null || row[other]?.[metric] == null ? null : row.B2[metric] - row[other][metric]); const outcome = wtl(diffs, tieMargin), values = diffs.filter(Number.isFinite), n = outcome.wins + outcome.losses; return { metric, a: 'B2', b: other, ...outcome, mean_diff: avg(values), bootstrap_ci95: bootstrapCI(values, { seed: bootstrapSeed }), sign_test_p_one_sided: n ? signTestOneSided(n, outcome.wins) : null }; }

export function seedDispersion(runs, metric) {
  const values = runs.map(x => x[metric]).filter(Number.isFinite); if (!values.length) return null;
  const mean = avg(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function latencyMetrics(runs) {
  const actual = runs.map(x => x.totals?.latency_actual_ms).filter(Number.isFinite), nominal = runs.map(x => x.totals?.latency_nominal_ms).filter(Number.isFinite);
  return { actual_ms_mean: avg(actual), nominal_ms_mean: avg(nominal) };
}

export function agreement(labelsA, labelsB) { const b = new Map(labelsB.map(x => [`${x.case_id}|${x.stable_id}`, x])), table = [[0,0],[0,0]]; let same = 0, n = 0; for (const a of labelsA) { const other = b.get(`${a.case_id}|${a.stable_id}`); if (!other) continue; const ai = investorGain(a) >= 2 ? 0 : 1, bi = investorGain(other) >= 2 ? 0 : 1; table[ai][bi]++; same += ai === bi; n++; } return { reviewed: n, agreement_raw: n ? same / n : null, cohen_kappa: n ? cohenKappa(table) : null }; }

export function abstentionMetrics(cases, runs) { const out = {}; for (const condition of ['B0','B1','B2']) { let correct = 0, nulls = 0, falseA = 0, anchors = 0; for (const c of cases) { const rr = runs.filter(x => x.case_id === c.case_id && x.condition === condition); const abstained = rr.length ? rr.filter(x => x.abstained).length >= Math.ceil(rr.length / 2) : false; if (c.kind === 'null') { nulls++; if (abstained) correct++; } else { anchors++; if (abstained) falseA++; } } out[condition] = { correct_abstentions: `${correct}/${nulls}`, false_abstentions: `${falseA}/${anchors}` }; } return out; }
