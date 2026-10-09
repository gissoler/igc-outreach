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

// ───────────────────────────── v2 (config v4): FIX-06, FIX-07, FIX-08 ─────────────────────────────
import { typeState, stageState, stageExplicitMet, geoState, leadState, loadNormalization } from './normalize.mjs';

const tokenRelated = (sectorValues, entitySectors) => sectorValues.some(x => entitySectors.some(y => norm(x).split(/[^a-z0-9]+/).some(token => token.length >= 5 && norm(y).includes(token))));
/** Sector determinista v2: exacto → on; relación por token → partial; nunca produce off (un falso off es peor que unknown). */
export function deterministicSectorFit(profile, entity) {
  const f = profile.fields, sectorValues = [f.sector.value, ...(list(f.subsectors) ?? [])].filter(Boolean);
  if (!sectorValues.length || !entity.sectors.length) return 'unknown';
  if (overlap(sectorValues, entity.sectors)) return 'on';
  return tokenRelated(sectorValues, entity.sectors) ? 'partial' : 'unknown';
}

/**
 * Juez v2. Igual que judgeInvestor salvo TYPE/STAGE/GEO/LEAD (normalize.mjs), SECTOR (determinista o LLM con guarda)
 * y overall_relevance alineada con PROTOCOL.md:48-49 / LABELING_GUIDE.md:32.
 * @param sectorFit resultado ya guardado de sectorFitLLM ({sector_fit, quote}) o null.
 */
export function judgeInvestorV2({ entity, profile, catalog, sectorFit = null, normalization = null }) {
  const n = normalization ?? loadNormalization();
  const base = judgeInvestor({ entity, profile, catalog }), f = profile.fields;
  const det = deterministicSectorFit(profile, entity);
  const sector_fit = det === 'on' ? 'on' : sectorFit?.sector_fit && sectorFit.sector_fit !== 'unknown' ? sectorFit.sector_fit : det;
  const states = {
    'INV-TYPE': typeState(list(f.accepted_investor_types), entity.investor_type, n),
    'INV-SECTOR': sector_fit === 'unknown' ? 'unknown' : sector_fit === 'off' ? 'not_met' : 'met',
    'INV-STAGE': stageState(f.funding_stage.value, entity.stages, n),
    'INV-GEO': geoState([f.incorporation_country.value, ...(list(f.operating_regions) ?? []), ...(list(f.target_markets) ?? [])], entity.geographies, n),
    'INV-LEAD': leadState(f.lead_preference.value, entity.lead_follow, n)
  };
  const rationale = { 'INV-TYPE': 'normalization.v1 investor_type_map.', 'INV-SECTOR': sectorFit?.quote ? `Sector quote: ${sectorFit.quote}` : 'Deterministic sector match.', 'INV-STAGE': 'normalization.v1 stage ordinal.', 'INV-GEO': 'normalization.v1 regions.', 'INV-LEAD': 'normalization.v1 lead_map.' };
  const criteria = base.criteria.map(c => Object.hasOwn(states, c.criterion_id) ? criterion(c.criterion_id, states[c.criterion_id], rationale[c.criterion_id]) : c);
  const catalogKinds = new Map(catalog.criteria.map(x => [x.criterion_id, x.kind]));
  const hard = criteria.filter(x => catalogKinds.get(x.criterion_id) === 'hard');
  const hard_eligibility = hard.some(x => x.state === 'not_met') ? 'ineligible' : hard.every(x => ['met', 'not_applicable'].includes(x.state)) ? 'eligible' : 'undetermined';
  const active = criteria.find(x => x.criterion_id === 'INV-ACTIVE').state, stage = states['INV-STAGE'], geo = states['INV-GEO'];
  let overall_relevance;
  if (hard_eligibility === 'ineligible' || sector_fit === 'off') overall_relevance = 'irrelevant';
  else if (active === 'met' && sector_fit === 'on' && stage === 'met' && geo === 'met' && hard_eligibility === 'eligible') overall_relevance = 'strong';
  // V4-DBG-2 (pendiente de aprobación, DECISIONS_PENDING #13): plausible exige geografía met, o bien sector on +
  // etapa met con evidencia explícita cuando la geografía es unknown. En D3 (nulo) las firmas sin mandato geográfico
  // con "early-stage" y sector "partial" salían como gain 2.
  else if ((['on', 'partial'].includes(sector_fit) && geo === 'met') || (sector_fit === 'on' && geo === 'unknown' && stage === 'met' && stageExplicitMet(f.funding_stage.value, entity.stages, n))) overall_relevance = 'plausible';
  else overall_relevance = 'weak';
  const unknowns = criteria.filter(x => x.state === 'unknown').length;
  return { ...base, criteria, sector_fit, stage_fit: stage, geography_fit: geo, lead_fit: states['INV-LEAD'], hard_eligibility, overall_relevance, unknown_count: unknowns, sector_fit_source: det === 'on' ? 'deterministic' : sectorFit?.sector_fit && sectorFit.sector_fit !== 'unknown' ? 'llm' : 'deterministic' };
}

const OFF_GUARD = /\b(only|exclusively|solely|dedicated to|focused (?:solely|exclusively))\b/i;
const squash = s => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
/** FIX-08 guarda determinista sobre la respuesta del LLM de sector. */
export function guardSectorFit(answer, quotes) {
  if (!answer || !['on', 'partial', 'off'].includes(answer.sector_fit)) return { sector_fit: 'unknown', quote: null, guard: 'no_answer' };
  // V4-DBG-2/3: la cita debe salir de UNA sola cita de la firma. Si el modelo quitó los "…" de una evidencia con tramos,
  // se acepta solo si se descompone en ≤ 4 tramos literales consecutivos de esa misma cita (≥ 12 caracteres cada uno),
  // y se guarda con " … " para que la verificación literal por tramos la pueda comprobar.
  const groups = String(quotes ?? '').split('\n').filter(Boolean).map(g => g.split('\u2063').map(squash).filter(Boolean));
  const stitched = answer.quote ? groups.map(g => stitchQuote(squash(answer.quote), g)).find(Boolean) : null;
  if (!stitched) return { sector_fit: 'unknown', quote: null, guard: 'quote_not_literal' };
  answer = { ...answer, quote: stitched.length === 1 ? answer.quote : stitched.join(' … ') };
  if (answer.sector_fit === 'off' && !OFF_GUARD.test(answer.quote)) return { sector_fit: 'unknown', quote: null, guard: 'off_without_exclusive_language' };
  return { sector_fit: answer.sector_fit, quote: answer.quote, guard: 'ok' };
}
/** Descompone q en tramos literales de una misma cita (en orden de la cita), o null. */
function stitchQuote(q, parts) {
  if (parts.some(p => p.includes(q))) return [q];
  const out = []; let rest = q;
  while (rest && out.length < 4) {
    let best = '';
    for (const p of parts) for (let len = rest.length; len >= 12; len--) { const seg = rest.slice(0, len).trim(); if (seg.length >= 12 && p.includes(seg)) { if (seg.length > best.length) best = seg; break; } }
    if (!best) return null;
    out.push(best); rest = rest.slice(rest.indexOf(best) + best.length).replace(/^[\s.,;:–—-]+/, '');
  }
  return rest ? null : out;
}
/** Citas de la firma que ve el LLM de sector (máx. 1.500 caracteres). */
export function sectorQuotes(entity) {
  const parts = [];
  // Una línea por cita; los tramos de una evidencia con "…" van en la misma línea separados por U+2063 (invisible).
  for (const s of entity.sources ?? []) { if (s.quote) parts.push(s.quote.replace(/\s+/g, ' ')); if (s.field_evidence?.sectors) parts.push(s.field_evidence.sectors.split(/\s*(?:\.{3,}|…)\s*/).map(x => x.replace(/\s+/g, ' ')).join(' \u2063')); }
  return [...new Set(parts)].join('\n').slice(0, 1500);
}
