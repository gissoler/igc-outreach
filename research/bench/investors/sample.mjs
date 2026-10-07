import { opaqueItemKey } from './identity.mjs';

export const ADJUDICATION_COLUMNS = ['item_key','case_id','profile_summary','name','urls','identity_correct','entity_kind','active_status','sector_fit','stage_fit','geography_fit','check_fit','round_fit','business_model_fit','lead_fit','hard_eligibility','portfolio_conflict','overall_relevance','confidence','evidence_json','labeled_on','notes'];

export function blindSample({ caseId, profileSummary, pool, preannotations = [], seed = 7, maxNegatives = 10 }) {
  const pre = new Map(preannotations.map(x => [x.stable_id, x]));
  const ordered = [...pool].sort((a, b) => opaqueItemKey(caseId, a.stable_id, seed).localeCompare(opaqueItemKey(caseId, b.stable_id, seed)));
  const must = ordered.filter(x => x.origins.includes('anchor') || (pre.get(x.stable_id)?.gain ?? 0) >= 2);
  const rest = ordered.filter(x => !must.includes(x)).slice(0, maxNegatives);
  const selected = [...new Map([...must, ...rest].map(x => [x.stable_id, x])).values()];
  const key = {};
  const rows = selected.map(item => {
    const item_key = opaqueItemKey(caseId, item.stable_id, seed); key[item_key] = { case_id: caseId, stable_id: item.stable_id };
    return { item_key, case_id: caseId, profile_summary: profileSummary, name: item.name, urls: item.urls.join(' '), identity_correct: '', entity_kind: '', active_status: '', sector_fit: '', stage_fit: '', geography_fit: '', check_fit: '', round_fit: '', business_model_fit: '', lead_fit: '', hard_eligibility: '', portfolio_conflict: '', overall_relevance: '', confidence: '', evidence_json: '', labeled_on: '', notes: '' };
  });
  return { rows, key };
}

const quote = value => { const s = String(value ?? ''); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
export function sampleCsv(rows) { return `${ADJUDICATION_COLUMNS.join(',')}\n${rows.map(row => ADJUDICATION_COLUMNS.map(k => quote(row[k])).join(',')).join('\n')}\n`; }
