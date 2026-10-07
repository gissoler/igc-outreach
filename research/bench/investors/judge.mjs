const norm = value => String(value ?? '').trim().toLowerCase();
const list = field => field?.value == null ? null : Array.isArray(field.value) ? field.value : [field.value];
const overlap = (a, b) => a?.some(x => b?.some(y => norm(x) === norm(y))) ?? false;
const criterion = (criterion_id, state, rationale) => ({ criterion_id, state, rationale });

export function judgeInvestor({ entity, profile, catalog }) {
  const f = profile.fields;
  const acceptedTypes = list(f.accepted_investor_types);
  const sectorValues = [f.sector.value, ...(list(f.subsectors) ?? [])].filter(Boolean);
  const active = entity.active_status === 'inactive' ? 'not_met' : entity.active_status === 'active' ? 'met' : 'unknown';
  const type = acceptedTypes == null || entity.investor_type === 'unknown' ? 'unknown' : acceptedTypes.some(x => norm(x) === norm(entity.investor_type)) ? 'met' : 'not_met';
  const sectorExact = overlap(sectorValues, entity.sectors);
  const sectorRelated = sectorValues.some(x => entity.sectors.some(y => norm(x).split(/[^a-z0-9]+/).some(token => token.length >= 5 && norm(y).includes(token))));
  const sector_fit = sectorValues.length === 0 || !entity.sectors.length ? 'unknown' : sectorExact ? 'on' : sectorRelated ? 'partial' : 'off';
  const sector = sector_fit === 'unknown' ? 'unknown' : sector_fit === 'off' ? 'not_met' : 'met';
  const stage = f.funding_stage.value == null || !entity.stages.length ? 'unknown' : overlap([f.funding_stage.value], entity.stages) ? 'met' : 'not_met';
  const geos = [...(list(f.operating_regions) ?? []), ...(list(f.target_markets) ?? []), f.incorporation_country.value].filter(Boolean);
  const geo = !geos.length || !entity.geographies.length ? 'unknown' : overlap(geos, entity.geographies) ? 'met' : 'not_met';
  const amount = f.capital_sought_usd.value, range = entity.check_range_usd;
  const check = amount == null || range.min == null || range.max == null ? 'unknown' : amount >= range.min && amount <= range.max ? 'met' : 'not_met';
  const round = f.round_sought.value == null || !entity.rounds.length ? 'unknown' : overlap([f.round_sought.value], entity.rounds) ? 'met' : 'not_met';
  const models = list(f.business_model);
  let business = models == null ? 'unknown' : !entity.business_models.accepted.length && !entity.business_models.excluded.length ? 'unknown' : overlap(models, entity.business_models.excluded) ? 'not_met' : overlap(models, entity.business_models.accepted) ? 'met' : 'unknown';
  const leadPreference = norm(f.lead_preference.value);
  const lead = !leadPreference ? 'not_applicable' : entity.lead_follow === 'unknown' ? 'unknown' : entity.lead_follow === 'both' || entity.lead_follow === leadPreference ? 'met' : 'not_met';
  const regulations = list(f.relevant_regulation);
  const regulatory = regulations == null || !entity.regulatory_restrictions.length ? 'unknown' : overlap(regulations, entity.regulatory_restrictions) ? 'not_met' : 'met';
  const conflicts = list(f.known_portfolio_conflicts);
  const portfolio = conflicts == null ? 'unknown' : overlap(conflicts, [...entity.relevant_portfolio, ...entity.potential_conflicts]) ? 'conflict' : 'met';
  const recency = entity.recent_investment_evidence.length ? 'met' : entity.active_status === 'inactive' ? 'not_met' : 'unknown';
  const criteria = [
    criterion('INV-ACTIVE', active, 'Derived from activity evidence, not website existence.'), criterion('INV-TYPE', type, 'Compared with accepted institutional investor types.'),
    criterion('INV-SECTOR', sector, 'Compared with stated investment sectors.'), criterion('INV-STAGE', stage, 'Compared with published stages.'),
    criterion('INV-GEO', geo, 'Compared with published geographies.'), criterion('INV-CHECK', check, 'Compared only when both limits and amount are known.'),
    criterion('INV-ROUND', round, 'Compared with published round types.'), criterion('INV-BUSINESS-MODEL', business, 'Explicit accepted and excluded models only.'),
    criterion('INV-LEAD', lead, 'Compared with explicit lead/follow evidence.'), criterion('INV-REGULATORY', regulatory, 'Explicit restrictions only.'),
    criterion('INV-PORTFOLIO-CONFLICT', portfolio, 'Signal only; never an automatic hard failure.'), criterion('INV-RECENCY', recency, 'Historical investment alone is insufficient.')
  ];
  const catalogKinds = new Map(catalog.criteria.map(x => [x.criterion_id, x.kind]));
  const hard = criteria.filter(x => catalogKinds.get(x.criterion_id) === 'hard');
  const hard_eligibility = hard.some(x => x.state === 'not_met') ? 'ineligible' : hard.every(x => ['met', 'not_applicable'].includes(x.state)) ? 'eligible' : 'undetermined';
  const unknowns = criteria.filter(x => x.state === 'unknown').length;
  const overall_relevance = hard_eligibility === 'ineligible' || sector_fit === 'off' ? 'irrelevant' : active === 'met' && sector_fit === 'on' && stage === 'met' && geo === 'met' && hard_eligibility === 'eligible' ? 'strong' : unknowns >= 5 ? 'weak' : 'plausible';
  return { stable_id: entity.stable_id, criteria, active_status: entity.active_status, sector_fit, stage_fit: stage, geography_fit: geo, check_fit: check, round_fit: round, business_model_fit: business, lead_fit: lead, hard_eligibility, portfolio_conflict: portfolio === 'conflict' ? 'direct' : portfolio === 'unknown' ? 'unknown' : 'none', overall_relevance, unknown_count: unknowns };
}

export function assertUnknownNeverMet(inputState, finalState) {
  if (inputState === 'unknown' && finalState === 'met') throw new Error('unknown cannot become met');
  return finalState;
}
