/**
 * Registra documentos, entidades y evidencia de grants, y fusiona identidades por claves compartidas.
 * No decide elegibilidad ni realiza red, disco o llamadas a modelos.
 * Contratos: target_entity/1 y evidence/1.
 */
import { createHash } from 'node:crypto';
import { norm } from '../server/research/core.mjs';
import { identifiersFromText, urlIdentifier, stableIdOf } from './identifiers.mjs';
import { computeValidity } from './validity.mjs';
import { normalizeUrl } from './docs.mjs';
import { validate } from './contracts.mjs';

const CREATES_ENTITY = new Set(['call', 'program_page', 'award_record', 'news', 'blog']);
const hash16 = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const identifierKey = identifier => `${identifier.scheme}:${identifier.value}`;
const uniqueBy = (items, keyOf) => [...new Map(items.map(item => [keyOf(item), item])).values()];

/**
 * Crea el registro mutable de una corrida.
 * Invariante: el orden de `records` es el orden de primera aparición de las entidades.
 * Efectos: conserva documentos y resultados extraídos solo en memoria.
 * @param {{today:string, catalog:object}} options
 * @returns {object}
 */
export function createRegistry({ today, catalog }) {
  const records = [];
  const docsMap = new Map();
  const texts = new Map();
  const linksArr = [];
  const mentionsArr = [];
  let order = 0;

  const matchingRecords = identifiers => {
    const keys = new Set(identifiers.map(identifierKey));
    return records
      .filter(record => record.entity.identifiers.some(identifier => keys.has(identifierKey(identifier))))
      .sort((a, b) => a.entity.first_seen.order - b.entity.first_seen.order);
  };

  const storeReferences = (extractionResult, stableId, step) => {
    linksArr.push(...extractionResult.officialLinks.map(link => ({ ...link, stable_id: stableId, fetched: false })));
    mentionsArr.push(...extractionResult.mentions.map(mention => ({ ...mention, stable_id: stableId, step })));
  };

  const nextRequirementId = record => `REQ-${String(record.req.size + 1).padStart(2, '0')}`;

  const requirementId = (record, evidence) => {
    if (!evidence.criterion_id.startsWith('REQ')) return evidence.criterion_id;
    const key = norm(evidence.quote);
    if (!record.req.has(key)) record.req.set(key, nextRequirementId(record));
    return record.req.get(key);
  };

  const mergeEvidence = (target, evidence) => {
    const criterionId = requirementId(target, evidence);
    const merged = {
      ...evidence,
      criterion_id: criterionId,
      stable_id: target.entity.stable_id,
      evidence_id: `ev-${hash16(`${evidence.doc_id}|${criterionId}|${evidence.quote.trim()}`)}`,
    };
    if (!target.evidence.some(item => item.evidence_id === merged.evidence_id)) target.evidence.push(merged);
  };

  const absorbRecord = (target, source) => {
    const sourceId = source.entity.stable_id;
    target.entity.identifiers = uniqueBy([...target.entity.identifiers, ...source.entity.identifiers], identifierKey);
    target.entity.source_doc_ids = uniqueBy([...target.entity.source_doc_ids, ...source.entity.source_doc_ids], value => value);
    target.entity.query_ids = uniqueBy([...target.entity.query_ids, ...source.entity.query_ids], value => value);
    for (const evidence of source.evidence) mergeEvidence(target, evidence);
    if (!target.entity.official && source.entity.official) {
      target.entity.official = true;
      target.entity.official_basis = source.entity.official_basis;
      target.entity.canonical_url = source.entity.canonical_url;
    }
    for (const link of linksArr) if (link.stable_id === sourceId) link.stable_id = target.entity.stable_id;
    for (const mention of mentionsArr) if (mention.stable_id === sourceId) mention.stable_id = target.entity.stable_id;
    records.splice(records.indexOf(source), 1);
    return sourceId;
  };

  const createRecord = ({ about, identifiers, doc, ctx }) => {
    const entity = {
      schema_version: 'target_entity/1',
      stable_id: stableIdOf(identifiers),
      entity_type: 'grant_opportunity',
      name: about.name,
      issuer: { name: about.issuer_name, domain: about.issuer_domain },
      identifiers,
      canonical_url: doc.url,
      official: Boolean(doc.official),
      official_basis: doc.official_basis || 'none',
      validity: {
        status: 'unknown', opens_on: null, closes_on: null, deadline_label: null,
        deadline_quote: null, deadline_doc_id: null, as_of: today, computed_by: 'code', conflict: false,
      },
      amount_text: about.amount_text,
      instrument: about.instrument,
      source_doc_ids: [],
      first_seen: { step: ctx.step, search_index: ctx.searchIndex, order: order++, query_id: ctx.queryId ?? null },
      query_ids: [],
    };
    const record = { entity, evidence: [], req: new Map() };
    records.push(record);
    return record;
  };

  const addDocumentEvidence = (record, doc, extractionResult, ctx) => {
    for (const draft of extractionResult.evidenceDrafts) {
      const criterionId = requirementId(record, draft);
      const evidence = {
        evidence_id: `ev-${hash16(`${doc.doc_id}|${criterionId}|${draft.quote.trim()}`)}`,
        doc_id: doc.doc_id,
        url: doc.url,
        official: Boolean(doc.official),
        stable_id: record.entity.stable_id,
        criterion_id: criterionId,
        quote: draft.quote.trim(),
        binding: draft.binding,
        requirement_summary: draft.requirement_summary ?? null,
        retrieved_at: doc.fetched_at,
        doc_published_date: doc.published_date ?? null,
        step: ctx.step,
        extractor: extractionResult.promptRef,
      };
      validate('evidence', evidence);
      if (!record.evidence.some(item => item.evidence_id === evidence.evidence_id)) record.evidence.push(evidence);
    }
  };

  return {
    register({ doc, extractionResult, ctx }) {
      docsMap.set(doc.doc_id, { ...doc, page_type: extractionResult.extraction.page_type });
      texts.set(doc.doc_id, extractionResult.fullText || '');
      const about = extractionResult.extraction.about;
      if (!about || !CREATES_ENTITY.has(extractionResult.extraction.page_type)) {
        storeReferences(extractionResult, null, ctx.step);
        return { stable_id: null, isNew: false, newOfficial: false };
      }
      const identifiers = uniqueBy([
        ...extractionResult.aboutIdentifiers,
        ...identifiersFromText(doc.url),
        urlIdentifier(doc.url),
      ].map(identifier => ({ ...identifier, doc_id: doc.doc_id })), identifierKey);
      const matches = matchingRecords(identifiers);
      const isNew = matches.length === 0;
      const wasOfficial = matches.some(record => record.entity.official);
      const record = matches[0] || createRecord({ about, identifiers, doc, ctx });
      const merged = matches.slice(1).map(source => absorbRecord(record, source));
      record.entity.identifiers = uniqueBy([...record.entity.identifiers, ...identifiers], identifierKey);
      if (!record.entity.source_doc_ids.includes(doc.doc_id)) record.entity.source_doc_ids.push(doc.doc_id);
      if (ctx.queryId && !record.entity.query_ids.includes(ctx.queryId)) record.entity.query_ids.push(ctx.queryId);
      if (doc.official && !record.entity.official) {
        record.entity.official = true;
        record.entity.official_basis = doc.official_basis;
        record.entity.canonical_url = doc.url;
      }
      addDocumentEvidence(record, doc, extractionResult, ctx);
      storeReferences(extractionResult, record.entity.stable_id, ctx.step);
      record.entity.validity = computeValidity(record.entity, docsMap, texts, today);
      return {
        stable_id: record.entity.stable_id,
        isNew,
        newOfficial: record.entity.official && (isNew || !wasOfficial),
        merged,
      };
    },
    entities() { return records.map(record => record.entity); },
    evidenceFor(id) { return records.find(record => record.entity.stable_id === id)?.evidence || []; },
    docs() { return [...docsMap.values()]; },
    links() { return linksArr; },
    markFetchedUrl(normalizedUrl) {
      for (const link of linksArr) if (normalizeUrl(link.url) === normalizedUrl) link.fetched = true;
    },
    mentions() { return mentionsArr; },
    textOf(id) { return texts.get(id) || ''; },
    finalize() {
      for (const record of records) {
        const oldId = record.entity.stable_id;
        record.entity.stable_id = stableIdOf(record.entity.identifiers);
        for (const evidence of record.evidence) evidence.stable_id = record.entity.stable_id;
        for (const link of linksArr) if (link.stable_id === oldId) link.stable_id = record.entity.stable_id;
        for (const mention of mentionsArr) if (mention.stable_id === oldId) mention.stable_id = record.entity.stable_id;
        record.entity.validity = computeValidity(record.entity, docsMap, texts, today);
        validate('target_entity', record.entity);
      }
      return records.map(record => record.entity);
    },
  };
}
