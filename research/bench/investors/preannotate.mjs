import { investorGain } from './ranking.mjs';

export async function preannotateInvestorItems({ caseId, profile, pool, agentFamily, preannotatorFamily, annotate }) {
  if (agentFamily === preannotatorFamily) throw new Error('Preannotator family must differ from agent family');
  const rows = [];
  for (const item of pool) {
    const annotation = await annotate({ profile, item });
    rows.push({ schema_version: 'investor_preannotation/1', case_id: caseId, stable_id: item.stable_id, model_family: preannotatorFamily, is_gold: false, gain: investorGain(annotation), annotation });
  }
  return rows;
}
