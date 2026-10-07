export function investorGain(label) {
  if (label.identity_correct === false || label.entity_kind && label.entity_kind !== 'institutional_investor' || label.active_status === 'inactive' || label.sector_fit === 'off' || label.hard_eligibility === 'ineligible' || label.overall_relevance === 'irrelevant') return 0;
  const hardNotMet = (label.criteria ?? []).some(x => ['INV-ACTIVE', 'INV-TYPE', 'INV-STAGE', 'INV-GEO', 'INV-CHECK', 'INV-BUSINESS-MODEL', 'INV-REGULATORY'].includes(x.criterion_id) && x.state === 'not_met');
  if (label.active_status === 'active' && label.overall_relevance === 'strong' && label.sector_fit === 'on' && label.hard_eligibility === 'eligible' && label.stage_fit === 'met' && label.geography_fit === 'met' && !hardNotMet) return 3;
  if (['active', 'possibly_active'].includes(label.active_status) && label.overall_relevance === 'plausible' && ['on', 'partial'].includes(label.sector_fit) && ['eligible', 'undetermined'].includes(label.hard_eligibility) && !hardNotMet) return 2;
  return 1;
}

export function rankInvestors(entities, judgments) {
  const byId = new Map(judgments.map(x => [x.stable_id, x]));
  return entities.map(entity => {
    const judgment = byId.get(entity.stable_id);
    return { entity, judgment, gain: investorGain({ ...judgment, identity_correct: true, entity_kind: 'institutional_investor' }) };
  }).sort((a, b) => b.gain - a.gain || a.judgment.unknown_count - b.judgment.unknown_count || a.entity.first_seen.order - b.entity.first_seen.order || a.entity.stable_id.localeCompare(b.entity.stable_id)).map((x, i) => ({ rank: i + 1, stable_id: x.entity.stable_id, gain: x.gain, hard_eligibility: x.judgment.hard_eligibility, active_status: x.entity.active_status }));
}
