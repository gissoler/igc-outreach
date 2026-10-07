/**
 * Digest de comportamiento de una corrida: lo que el agente decidió, sin metadatos de versión ni horas.
 * Contrato: entrada = {result, logs, plannerInputs} de runCase; salida = objeto canónico cuyo sha256
 * congela el comportamiento de grants (REFACTOR-PLAN ACC-50). V1 y V2 leen los nombres de cada contrato
 * y producen el mismo objeto.
 */
import { createHash } from 'node:crypto';

const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;

/** @param {unknown} v @returns {string} sha256 hex del JSON con claves ordenadas */
export const digestSha = v => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');

/** Lector de contratos v1. @returns {object} */
export const V1 = {
  totals: t => ({ searches: t.searches, fetches: t.fetches, fetch_errors: t.fetch_errors, unique_docs: t.unique_docs, verified_entities: t.official_opportunities, planner_calls: t.planner_calls, tokens_discovery_nominal: t.tokens_discovery_nominal, tokens_judge_nominal: t.tokens_judge_nominal }),
  validity: v => ({ status: v.status, valid_from: v.opens_on, valid_until: v.closes_on, label: v.deadline_label, quote: v.deadline_quote, doc_id: v.deadline_doc_id, conflict: v.conflict }),
  attributes: e => ({ issuer: e.issuer, amount_text: e.amount_text, instrument: e.instrument }),
  extras: j => ({ route: j.route, route_rationale: j.route_rationale }),
  signals: s => ({ new_unique_docs: s.new_unique_docs, duplicates: s.duplicates, new_verified_entities: s.new_official_opportunities, validity_parsed: s.deadlines_parsed, criteria_unknown: s.criteria_unknown, searches_without_new_verified: s.searches_without_new_official }),
  newEntity: d => d.new_opportunity,
};

/** Lector de contratos v2 (ARCHITECTURE_AGENT §4.2). @returns {object} */
export const V2 = {
  totals: t => ({ searches: t.searches, fetches: t.fetches, fetch_errors: t.fetch_errors, unique_docs: t.unique_docs, verified_entities: t.verified_entities, planner_calls: t.planner_calls, tokens_discovery_nominal: t.tokens_discovery_nominal, tokens_judge_nominal: t.tokens_judge_nominal }),
  validity: v => ({ status: v.status, valid_from: v.valid_from, valid_until: v.valid_until, label: v.label, quote: v.quote, doc_id: v.doc_id, conflict: v.conflict }),
  attributes: e => e.attributes,
  extras: j => j.extras,
  signals: s => ({ new_unique_docs: s.new_unique_docs, duplicates: s.duplicates, new_verified_entities: s.new_verified_entities, validity_parsed: s.validity_parsed, criteria_unknown: s.criteria_unknown, searches_without_new_verified: s.searches_without_new_verified }),
  newEntity: d => d.new_entity,
};

/**
 * @param {{result: object, logs: object[], plannerInputs: object[]}} run
 * @param {typeof V1} R lector del contrato
 * @returns {object} digest canónico
 */
export function behaviorDigest({ result, logs, plannerInputs }, R = V1) {
  const of = k => logs.filter(l => l.kind === k);
  return {
    stop_reason: result.stop_reason,
    abstained: result.abstained,
    totals: R.totals(result.totals),
    ranked: result.ranked.map(r => [r.stable_id, r.eligibility_class, r.recommendable, r.official, r.sort_key]),
    entities: result.entities.map(e => ({ stable_id: e.stable_id, name: e.name, identifiers: e.identifiers.map(i => `${i.scheme}:${i.value}`), official: e.official, official_basis: e.official_basis, validity: R.validity(e.validity), attributes: R.attributes(e), source_doc_ids: e.source_doc_ids, first_seen: e.first_seen })),
    evidence: result.evidence.map(e => [e.evidence_id, e.stable_id, e.criterion_id, e.doc_id, e.official, e.binding]),
    judgments: result.judgments.map(j => ({ stable_id: j.stable_id, extras: R.extras(j), aggregate: j.aggregate, criteria: j.criteria.map(c => [c.criterion_id, c.state, c.llm_state, c.evidence_ids, c.overrides]) })),
    searches: of('search').map(l => ({ query: l.data.query, origin: l.data.origin, results: l.data.results.map(r => r.result_id), signals: R.signals(l.data.signals) })),
    fetches: of('fetch').map(l => [l.data.ref, l.data.trigger, l.data.document.doc_id, l.data.document.ok, l.data.document.official, l.data.document.official_basis]),
    extracts: of('extract').map(l => [l.data.doc_id, l.data.page_type, l.data.about_stable_id, R.newEntity(l.data), l.data.evidence_ids, l.data.quotes_rejected, l.data.identifiers_rejected]),
    planner_calls: of('planner_call').map(l => ({ mode: l.data.mode, accepted: l.data.actions_accepted, rejected: l.data.actions_rejected, gaps_offered: l.data.gaps_offered })),
    planner_gaps: plannerInputs.map(i => ({ step: i.step, gaps: i.gaps.map(g => g.gap_id) })),
  };
}
