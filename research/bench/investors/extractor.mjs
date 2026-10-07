import { validateInvestor } from './contracts.mjs';
import { stableInvestorId } from './identity.mjs';

export function extractFixtureInvestor({ document, extraction, today, firstSeen }) {
  if (!extraction || extraction.entity_kind !== 'institutional_investor') return { entity: null, rejected_kind: extraction?.entity_kind ?? 'unknown' };
  const source = { url: document.url, title: document.title, source_kind: extraction.source_kind, retrieved_on: today, published_on: extraction.published_on ?? null, quote: extraction.quote ?? null };
  const entity = {
    schema_version: 'investor_entity/1', stable_id: 'inv:url:pending', canonical_name: extraction.canonical_name,
    official_domain: extraction.official_domain ?? null, aliases: extraction.aliases ?? [], investor_type: extraction.investor_type ?? 'unknown',
    parent_firm: extraction.parent_firm ?? null, vehicles: extraction.vehicles ?? [], active_status: extraction.active_status ?? 'unknown', verified_on: today,
    sectors: extraction.sectors ?? [], stages: extraction.stages ?? [], rounds: extraction.rounds ?? [], geographies: extraction.geographies ?? [],
    check_range_usd: extraction.check_range_usd ?? { min: null, max: null, source_url: null }, lead_follow: extraction.lead_follow ?? 'unknown',
    business_models: extraction.business_models ?? { accepted: [], excluded: [] }, regulatory_restrictions: extraction.regulatory_restrictions ?? [],
    relevant_portfolio: extraction.relevant_portfolio ?? [], potential_conflicts: extraction.potential_conflicts ?? [], recent_investment_evidence: extraction.recent_investment ? [source] : [],
    sources: [source], first_seen: firstSeen, query_ids: firstSeen.query_id ? [firstSeen.query_id] : [], regulatory_id: extraction.regulatory_id ?? null,
    canonical_url: extraction.canonical_url ?? document.url, contradictions: extraction.contradictions ?? []
  };
  entity.stable_id = stableInvestorId(entity);
  validateInvestor('investor_entity', entity);
  return { entity, rejected_kind: null };
}
