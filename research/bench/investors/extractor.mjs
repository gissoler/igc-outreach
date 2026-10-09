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

// ───────────────────────────── v2 (config v4): FIX-03 y FIX-04 ─────────────────────────────
// Las funciones v1 de arriba no cambian; v1–v3 siguen usándolas.

export const INVESTMENT_EVIDENCE_V2 = [
  INVESTMENT_EVIDENCE,
  /\b(?:invest(?:s|ed|ing)?|back(?:s|ed|ing)?|fund(?:s|ed|ing)?|lead(?:s|ing)?|co-?lead(?:s)?|writ(?:e|es|ing) (?:the )?(?:first )?(?:check|cheque|ticket)s?)\b[^.]{0,120}\b(?:pre-?seed|seed|series [a-e]|early[- ]stage|growth[- ]stage|start-?ups?|founders?|companies|businesses|entrepreneurs|ventures|rounds?)\b/i,
  /\b(?:venture (?:fund|firm|investor|arm)|vc (?:firm|fund)|seed fund|investment (?:firm|company|manager)|fund manager|asset manager)\b/i
];
export const hasInvestmentEvidenceV2 = text => INVESTMENT_EVIDENCE_V2.some(re => re.test(String(text ?? '')));
/**
 * La evidencia de inversión debe ser de la firma nombrada: el verbo va después del nombre ("X invests in…")
 * o la firma es el agente ("led/backed/funded by X"). Evita aceptar a la startup de una nota de ronda.
 */
export function attributedInvestmentV2(quote, terms) {
  const q = matchText(quote);
  for (const term of terms.map(matchText).filter(t => t.length >= 3)) {
    let from = q.indexOf(term);
    while (from >= 0) {
      if (hasInvestmentEvidenceV2(q.slice(from))) return true;
      from = q.indexOf(term, from + 1);
    }
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b(?:led|co-?led|backed|funded|financed|invested in)\\b[^.]{0,40}\\bby\\s+(?:the\\s+)?${esc}`).test(q) || new RegExp(`\\b(?:led|co-?led) by\\s+(?:the\\s+)?${esc}`).test(q)) return true;
  }
  return false;
}

/**
 * Forma de comparación para citas literales: misma transformación a página y cita.
 * Quita solo marcas de formato (markdown, comillas/guiones tipográficos, espacios); no cambia palabras.
 */
export function matchText(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*#`>|]+/g, ' ')
    .replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}
export const isLiteralIn = (pageText, s) => s != null && matchText(s).length >= 3 && matchText(pageText).includes(matchText(s));

const LIST_FIELDS_V2 = ['sectors', 'stages', 'rounds', 'geographies', 'regulatory_restrictions', 'relevant_portfolio'];

/** FIX-03: cada valor se conserva solo si su evidencia es literal en la página. */
export function groundFieldsV2({ document, extraction }) {
  const out = structuredClone(extraction ?? {}), text = document?.text ?? '', evidence = out.evidence ?? {};
  const lit = s => isLiteralIn(text, s);
  for (const f of LIST_FIELDS_V2) {
    const values = Array.isArray(out[f]) ? out[f] : [];
    if (!lit(evidence[f])) out[f] = [];
    else out[f] = values.filter(v => matchText(evidence[f]).includes(matchText(v)) || lit(v));
  }
  for (const f of ['investor_type', 'lead_follow']) if (!lit(evidence[f])) out[f] = 'unknown';
  if (!lit(evidence.check_range_usd)) out.check_range_usd = { min: null, max: null, source_url: null };
  else out.check_range_usd = { min: out.check_range_usd?.min ?? null, max: out.check_range_usd?.max ?? null, source_url: document.url };
  if (!lit(evidence.business_models)) out.business_models = { accepted: [], excluded: [] };
  if (out.active_status === 'inactive' && !lit(evidence.active_status)) out.active_status = 'unknown';
  if (out.active_status !== 'inactive') out.active_status = 'unknown';
  if (!(out.published_on && lit(evidence.published_on))) out.published_on = null;
  const kept = {
    investor_type: out.investor_type !== 'unknown', sectors: out.sectors.length > 0, stages: out.stages.length > 0, rounds: out.rounds.length > 0,
    geographies: out.geographies.length > 0, check_range_usd: out.check_range_usd.min != null || out.check_range_usd.max != null,
    lead_follow: out.lead_follow !== 'unknown', business_models: out.business_models.accepted.length + out.business_models.excluded.length > 0,
    active_status: out.active_status === 'inactive', published_on: out.published_on != null
  };
  out.field_evidence = Object.fromEntries(Object.entries(kept).filter(([f, ok]) => ok && typeof evidence[f] === 'string').map(([f]) => [f, evidence[f]]));
  out.fields_dropped_by_grounding = Object.keys(kept).filter(f => !kept[f] && isFilledV2(extraction?.[f], f));
  return out;
}
const isFilledV2 = (value, f) => {
  if (value == null) return false;
  if (f === 'check_range_usd') return value.min != null || value.max != null;
  if (f === 'business_models') return (value.accepted?.length ?? 0) + (value.excluded?.length ?? 0) > 0;
  if (f === 'active_status') return value === 'inactive';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value !== '' && value !== 'unknown';
  return true;
};

function sentenceWindows(text) {
  const sentences = String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map(normalized).filter(Boolean);
  return sentences.flatMap((s, i) => [s, ...(sentences[i + 1] ? [`${s} ${sentences[i + 1]}`] : [])]);
}

/** Candidatos válidos: la cita es literal, contiene el nombre y un verbo de inversión. */
export function verifiedCandidates({ document, extraction }) {
  const text = document?.text ?? '', out = [], seen = new Set();
  for (const c of extraction?.candidates ?? []) {
    const name = normalized(c?.name);
    if (!name || PLACEHOLDER_NAME.test(name) || seen.has(name.toLocaleLowerCase())) continue;
    if (!isLiteralIn(text, c.quote) || !matchText(c.quote).includes(matchText(name)) || !attributedInvestmentV2(c.quote, [name])) continue;
    const domain = c.domain_on_page && isLiteralIn(text, c.domain_on_page) ? hostname(`https://${String(c.domain_on_page).replace(/^https?:\/\//, '')}`) : null;
    seen.add(name.toLocaleLowerCase()); out.push({ name, quote: normalized(c.quote), domain_on_page: domain });
  }
  return out;
}

/** FIX-04: cita y dominio oficial para el gate v2 (alias, ventana de 2 oraciones, notas propias). */
export function groundIdentityV2({ document, extraction }) {
  if (!extraction || typeof extraction !== 'object') return extraction;
  const out = structuredClone(extraction), text = document?.text ?? '', name = normalized(out.canonical_name);
  const terms = [name, ...(out.aliases ?? [])].map(normalized).filter(x => x.length >= 3);
  out.quote_source = 'none';
  if (out.quote && isLiteralIn(text, out.quote)) out.quote_source = 'model';
  else {
    out.quote = sentenceWindows(text).find(w => attributedInvestmentV2(w, terms)) ?? null;
    if (out.quote) out.quote_source = 'fallback';
  }
  const pageHost = hostname(document?.url);
  out.official_domain_source = out.official_domain ? 'model' : 'none';
  if (out.official_domain && !isLiteralIn(text, out.official_domain) && !sameDomain(pageHost, hostname(`https://${out.official_domain}`))) { out.official_domain = null; out.official_domain_source = 'none'; }
  if (!out.official_domain && ['official', 'news'].includes(out.source_kind)) {
    if (nameMatchesDomain(name, pageHost)) { out.official_domain = pageHost; out.official_domain_source = 'host_match'; }
    else if ((out.aliases ?? []).some(a => nameMatchesDomain(a, pageHost))) { out.official_domain = pageHost; out.official_domain_source = 'alias_match'; }
  }
  return out;
}

export function investorExtractionRejectionV2({ document, extraction }) {
  const candidates = verifiedCandidates({ document, extraction });
  const reject = kind => ({ rejected_kind: kind, candidates });
  if (!extraction || extraction.entity_kind !== 'institutional_investor') return reject(extraction?.entity_kind ?? 'unknown');
  const name = normalized(extraction.canonical_name), text = normalized(document?.text), quote = normalized(extraction.quote);
  if (!name || PLACEHOLDER_NAME.test(name)) return reject('missing_identity');
  if (COLLECTION_NAME.test(name) && !/\b(?:ventures?|capital|partners?|fund|holdings|investments?)\b/i.test(name)) return reject('collection_page');
  if (text.length < 80) return reject('insufficient_page_text');
  if (!quote || !isLiteralIn(document.text, quote)) return reject('missing_literal_quote');
  const identityTerms = [name, ...(extraction.aliases ?? [])].map(normalized).filter(x => x.length >= 3);
  const identityInQuote = identityTerms.some(term => matchText(quote).includes(matchText(term)));
  const pageHost = hostname(document.url), officialHost = extraction.official_domain ? hostname(`https://${extraction.official_domain}`) : null;
  const officialFirstParty = Boolean(officialHost) && ['official', 'news'].includes(extraction.source_kind) && sameDomain(pageHost, officialHost);
  if (!identityInQuote && !officialFirstParty) return reject('identity_not_in_quote');
  if (!(identityInQuote ? attributedInvestmentV2(quote, identityTerms) : hasInvestmentEvidenceV2(quote))) return reject('no_investment_evidence');
  if (!extraction.official_domain && !extraction.regulatory_id && !officialFirstParty) {
    return { rejected_kind: 'unresolved_firm_identity', candidates, candidate: { name, quote, domain_on_page: null } };
  }
  return null;
}

/** Entidad v2: mismos campos que v1 más field_evidence en la fuente. */
export function extractFixtureInvestorV2({ document, extraction, today, firstSeen }) {
  const identity = groundIdentityV2({ document, extraction });
  const rejection = investorExtractionRejectionV2({ document, extraction: identity });
  const grounded = groundFieldsV2({ document, extraction: identity });
  const meta = { quote_source: identity?.quote_source ?? 'none', official_domain_source: identity?.official_domain_source ?? 'none', fields_dropped_by_grounding: grounded.fields_dropped_by_grounding ?? [] };
  if (rejection) return { entity: null, ...rejection, meta };
  const source = { url: document.url, title: document.title || document.url, source_kind: identity.source_kind, retrieved_on: today, published_on: grounded.published_on ?? null, quote: identity.quote ?? null, field_evidence: grounded.field_evidence };
  const entity = {
    schema_version: 'investor_entity/2', stable_id: 'inv:url:pending', canonical_name: normalized(identity.canonical_name),
    official_domain: identity.official_domain ?? null, aliases: [...new Set((identity.aliases ?? []).map(normalized).filter(Boolean))], investor_type: grounded.investor_type ?? 'unknown',
    parent_firm: identity.parent_firm ?? null, vehicles: (identity.vehicles ?? []).filter(v => v?.name), active_status: grounded.active_status ?? 'unknown', verified_on: today,
    sectors: [...new Set(grounded.sectors)], stages: [...new Set(grounded.stages)], rounds: [...new Set(grounded.rounds)], geographies: [...new Set(grounded.geographies)],
    check_range_usd: grounded.check_range_usd, lead_follow: grounded.lead_follow ?? 'unknown',
    business_models: grounded.business_models, regulatory_restrictions: [...new Set(grounded.regulatory_restrictions)],
    relevant_portfolio: [...new Set(grounded.relevant_portfolio)], potential_conflicts: [], recent_investment_evidence: [],
    sources: [source], first_seen: firstSeen, query_ids: firstSeen.query_id ? [firstSeen.query_id] : [], regulatory_id: identity.regulatory_id ?? null,
    canonical_url: identity.canonical_url ?? document.url, contradictions: identity.contradictions ?? []
  };
  entity.stable_id = stableInvestorId(entity);
  validateInvestor('investor_entity.v2', entity);
  return { entity, rejected_kind: null, candidates: rejection?.candidates ?? verifiedCandidates({ document, extraction }), meta };
}
