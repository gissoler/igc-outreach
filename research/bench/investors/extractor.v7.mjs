// V7 (C2, H4): extractor v7 = extractor v2/v3 de extractor.mjs (que no se edita) + rescate de la cita del modelo.
// Solo actúa cuando el v5 se quedaría sin cita (groundIdentityV2 devuelve quote=null → missing_literal_quote).
// La cita guardada es SIEMPRE un tramo copiado del texto de la página (forma NFKC), así que sigue siendo literal
// para isLiteralIn/isLiteralEvidence de extractor.mjs y para v5_check.mjs. Normalización permitida al comparar:
// espacios (incluidos los de antes de un signo de puntuación y los caracteres invisibles), comillas, guiones,
// mayúsculas y escapes de markdown. No se acepta ninguna firma sin cita: si ningún tramo es literal, se rechaza igual.
import {
  matchText, isLiteralIn, attributedInvestmentV2, hasInvestmentEvidenceV2, groundIdentityV2, investorExtractionRejectionV2,
  groundFieldsV2, verifiedCandidates, investorHostname, sameDomain, nameMatchesDomain
} from './extractor.mjs';
import { stableInvestorId } from './identity.mjs';
import { validateInvestor } from './contracts.mjs';

const normalized = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const QUOTES = { '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"' };
const INVISIBLE = /[​-‏⁠﻿­]/;
const PUNCT_AFTER_SPACE = /[.,;:!?)\]]/;

/**
 * Forma comparable carácter a carácter con mapa a la posición original (sobre el texto ya en NFKC).
 * Devuelve { s, map } donde s[i] proviene de raw[map[i]].
 */
export function comparable(raw) {
  const src = String(raw ?? '').normalize('NFKC'), out = [], map = [];
  let pendingSpace = false, pendingAt = -1;
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (INVISIBLE.test(ch)) continue;
    if (ch === '\\' && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!|]/.test(src[i + 1])) continue;   // escape de markdown
    if (/[*#`>|]/.test(ch) || /\s/.test(ch)) { if (out.length) { pendingSpace = true; if (pendingAt < 0) pendingAt = i; } continue; }
    ch = QUOTES[ch] ?? (/[‐-―−]/.test(ch) ? '-' : ch.toLocaleLowerCase());
    if (pendingSpace && !PUNCT_AFTER_SPACE.test(ch)) { out.push(' '); map.push(pendingAt); }
    pendingSpace = false; pendingAt = -1;
    for (const c of ch) { out.push(c); map.push(i); }
  }
  return { s: out.join(''), map, src };
}

/** Tramo literal de la página que corresponde a la cita con la normalización permitida, o null. */
export function literalSpan(pageText, quote) {
  const q = comparable(quote).s.replace(/[\s.,;:!?]+$/, '').replace(/^[\s.,;:!?]+/, '');
  if (q.length < 12) return null;
  const page = comparable(pageText), at = page.s.indexOf(q);
  if (at < 0) return null;
  const start = page.map[at], end = page.map[at + q.length - 1];
  const span = normalized(page.src.slice(start, end + 1));
  return isLiteralIn(pageText, span) ? span : null;   // doble control con la regla v5
}

/** Tramos de la cita del modelo (separados por "...", "…", fin de oración, encabezados o saltos) que son literales en la página. */
export function literalSegments(pageText, quote) {
  const parts = String(quote ?? '').split(/\s*(?:\.{3,}|…)\s*|(?<=[.!?])\s+|\s+#+\s+|\n+|\s\|\s/).map(x => x.trim()).filter(x => matchText(x).length >= 20);
  const out = [];
  for (const p of parts) { const lit = isLiteralIn(pageText, p) ? normalized(p) : literalSpan(pageText, p); if (lit && !out.includes(lit)) out.push(lit); }
  return out;
}

const terms = extraction => [normalized(extraction?.canonical_name), ...(extraction?.aliases ?? [])].map(normalized).filter(x => x.length >= 3);
// Misma condición que groundIdentityV2 para aceptar la cita del modelo.
const usable = (q, ts) => attributedInvestmentV2(q, ts) || (!ts.some(t => matchText(q).includes(matchText(t))) && hasInvestmentEvidenceV2(q));

/** groundIdentityV2 + rescate v7 cuando el v5 se queda sin cita. quote_check explica qué pasó con la cita del modelo. */
export function groundIdentityV7({ document, extraction }) {
  const identity = groundIdentityV2({ document, extraction });
  if (!identity || typeof identity !== 'object') return identity;
  const text = document?.text ?? '', raw = extraction?.quote, ts = terms(extraction);
  const literalV5 = raw != null && isLiteralIn(text, raw);
  identity.quote_check = !normalized(raw) ? 'none' : literalV5 ? (usable(raw, ts) ? 'literal_usable' : 'literal_not_attributed') : 'not_literal_v5';
  if (identity.quote) return identity;                       // el v5 ya tiene cita: no se toca
  if (!normalized(raw)) return identity;
  const whole = literalV5 ? null : literalSpan(text, raw);
  if (whole && usable(whole, ts)) return { ...identity, quote: whole, quote_source: 'model_normalized', quote_check: 'normalized_usable' };
  const segs = literalSegments(text, raw);
  const pick = segs.find(s => attributedInvestmentV2(s, ts)) ?? segs.find(s => usable(s, ts));
  if (pick) return { ...identity, quote: pick, quote_source: 'model_segment', quote_check: 'segment_usable' };
  if (whole) identity.quote_check = 'normalized_not_attributed';
  else if (segs.length) identity.quote_check = 'segments_not_attributed';
  return identity;
}

/** extractFixtureInvestorV2 con groundIdentityV7 (resto idéntico). */
export function extractFixtureInvestorV7({ document, extraction, today, firstSeen }) {
  const identity = groundIdentityV7({ document, extraction });
  const rejection = investorExtractionRejectionV2({ document, extraction: identity });
  const grounded = groundFieldsV2({ document, extraction: identity });
  const meta = { quote_source: identity?.quote_source ?? 'none', quote_check: identity?.quote_check ?? 'none', official_domain_source: identity?.official_domain_source ?? 'none', fields_dropped_by_grounding: grounded.fields_dropped_by_grounding ?? [] };
  const deepening_fields = {
    entity_kind: identity?.entity_kind ?? null, canonical_name: normalized(identity?.canonical_name), aliases: (identity?.aliases ?? []).map(normalized).filter(Boolean),
    investor_type: grounded.investor_type ?? 'unknown', sectors: [...new Set(grounded.sectors ?? [])], stages: [...new Set(grounded.stages ?? [])], geographies: [...new Set(grounded.geographies ?? [])],
    published_on: grounded.published_on ?? null, field_evidence: grounded.field_evidence ?? {}, quote: rejection ? null : (identity?.quote ?? null)
  };
  if (rejection) return { entity: null, ...rejection, meta, deepening_fields };
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
  return { entity, rejected_kind: null, candidates: rejection?.candidates ?? verifiedCandidates({ document, extraction }), meta, deepening_fields };
}
export { investorHostname, sameDomain, nameMatchesDomain };
