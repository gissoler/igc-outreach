import { validateInvestor } from './contracts.mjs';
import { stableInvestorId } from './identity.mjs';

const PLACEHOLDER_NAME = /^(?:null|unknown|n\/?a|none|not specified|unnamed)$/i;
const COLLECTION_NAME = /\b(?:best|top|list|directory|database|firms?|investors?|funding|trends?|report|guide|survey|article|news|podcast|companies)\b/i;
const INVESTMENT_EVIDENCE = /\b(?:venture capital|private equity|growth equity|impact investing|investment fund|fund manager|portfolio companies|back(?:s|ed|ing) (?:companies|startups|founders)|invest(?:s|ed|ing)? in (?:companies|startups|founders)|mak(?:e|es|ing) new [^.]{0,60}investments|deploy(?:s|ed|ing) capital|provid(?:e|es|ed|ing) equity|(?:venture|growth) financing)\b/i;

const normalized = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const hostname = value => {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
};
const sameDomain = (a, b) => a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
const nameMatchesDomain = (name, domain) => {
  const nameKey = normalized(name).toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  const domainKey = String(domain ?? '').split('.')[0].replace(/[^a-z0-9]/g, '');
  return nameKey.length >= 5 && domainKey.length >= 5 && (nameKey === domainKey || nameKey.includes(domainKey) || domainKey.includes(nameKey));
};

export function groundInvestorExtraction({ document, extraction }) {
  if (!extraction || typeof extraction !== 'object') return extraction;
  const out = structuredClone(extraction), text = normalized(document?.text), name = normalized(out.canonical_name);
  const literalQuote = normalized(out.quote);
  if (!literalQuote || !text.toLocaleLowerCase().includes(literalQuote.toLocaleLowerCase())) {
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(normalized).filter(Boolean);
    out.quote = sentences.find(sentence => sentence.toLocaleLowerCase().includes(name.toLocaleLowerCase()) && INVESTMENT_EVIDENCE.test(sentence)) ?? null;
  }
  const pageHost = hostname(document?.url);
  if (!out.official_domain && out.source_kind === 'official' && nameMatchesDomain(name, pageHost)) out.official_domain = pageHost;
  return out;
}

/** Deterministic acceptance gate. The LLM proposes facts; quoted page evidence decides identity. */
export function investorExtractionRejection({ document, extraction }) {
  if (!extraction || extraction.entity_kind !== 'institutional_investor') return extraction?.entity_kind ?? 'unknown';
  const name = normalized(extraction.canonical_name), text = normalized(document?.text), quote = normalized(extraction.quote);
  if (!name || PLACEHOLDER_NAME.test(name)) return 'missing_identity';
  if (COLLECTION_NAME.test(name) && !/\b(?:ventures?|capital|partners?|fund|holdings|investments?)\b/i.test(name)) return 'collection_page';

  // Offline fixtures created before this guard do not include page text. Live pages always do.
  if (Object.hasOwn(document ?? {}, 'text')) {
    if (text.length < 80) return 'insufficient_page_text';
    if (!quote || !text.toLocaleLowerCase().includes(quote.toLocaleLowerCase())) return 'missing_literal_quote';
    const identityTerms = [name, ...(extraction.aliases ?? [])].map(normalized).filter(x => x.length >= 3);
    const identityInQuote = identityTerms.some(term => quote.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
    const pageHost = hostname(document.url), officialHost = extraction.official_domain ? hostname(`https://${extraction.official_domain}`) : null;
    const officialFirstParty = Boolean(officialHost) && extraction.source_kind === 'official' && sameDomain(pageHost, officialHost);
    if (!identityInQuote && !officialFirstParty) return 'identity_not_in_quote';
    if (!INVESTMENT_EVIDENCE.test(quote)) return 'no_investment_evidence';
    if (!extraction.official_domain && !extraction.regulatory_id && !officialFirstParty) return 'unresolved_firm_identity';
  }
  return null;
}

export function extractFixtureInvestor({ document, extraction, today, firstSeen }) {
  extraction = groundInvestorExtraction({ document, extraction });
  const rejected = investorExtractionRejection({ document, extraction });
  if (rejected) return { entity: null, rejected_kind: rejected };
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

const FACT_FIELDS = ['canonical_name', 'official_domain', 'aliases', 'investor_type', 'parent_firm', 'vehicles', 'active_status', 'sectors', 'stages', 'rounds', 'geographies', 'check_range_usd', 'lead_follow', 'business_models', 'regulatory_restrictions', 'relevant_portfolio', 'potential_conflicts', 'recent_investment', 'regulatory_id', 'published_on', 'quote'];
const isFilled = value => {
  if (value == null) return false;
  if (typeof value === 'string') return !!value.trim() && !PLACEHOLDER_NAME.test(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(isFilled);
  return value !== false;
};

/** FIX-13: describe qué trajo el modelo y qué sobrevivió. Solo observabilidad; no decide nada. */
export function describeInvestorExtraction({ document, raw, grounded, entity }) {
  const text = normalized(document?.text).toLocaleLowerCase();
  const rawQuote = normalized(raw?.quote);
  const quote_source = rawQuote && text.includes(rawQuote.toLocaleLowerCase()) ? 'model' : normalized(grounded?.quote) ? 'fallback' : 'none';
  const pageHost = hostname(document?.url);
  let official_domain_source = 'none';
  if (normalized(raw?.official_domain)) official_domain_source = 'model';
  else if (normalized(grounded?.official_domain)) official_domain_source = nameMatchesDomain(grounded.canonical_name, pageHost) ? 'host_match' : 'alias_match';
  const fields_present = FACT_FIELDS.filter(f => isFilled(raw?.[f]));
  const keptSource = entity ? { ...entity, quote: entity.sources?.[0]?.quote, published_on: entity.sources?.[0]?.published_on, recent_investment: entity.recent_investment_evidence?.length > 0 } : null;
  const fields_kept = keptSource ? FACT_FIELDS.filter(f => isFilled(keptSource[f])) : [];
  return { kind: raw?.entity_kind ?? null, source_kind: raw?.source_kind ?? null, canonical_name: raw?.canonical_name ?? null, fields_present, fields_kept, quote_source, candidates: Array.isArray(raw?.candidates) ? raw.candidates.length : 0, official_domain_source, page_chars: normalized(document?.text).length };
}
