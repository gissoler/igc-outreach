/**
 * Extrae hechos verificables de un documento descargado.
 * No decide oficialidad ni elegibilidad final.
 * Contratos: document/1, extraction/1 y evidence/1.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { literalIn } from '../server/research/verify.mjs';
import { isPublicUrl } from '../server/research/localSearch.mjs';
import { render, sanitizePageText } from './prompts.mjs';

const FOCUS = /\b(eligib\w*|who (?:can|may) apply|applicants?|deadline|due date|closing date|letter of intent|open to|not eligible|cost[- ]shar\w*|foreign|award (?:ceiling|amount|size)|budget|purpose|objective|priorit\w*|will not (?:fund|support)|out of scope|how to apply|submission)\b/gi;

/**
 * Recorta texto sin perder el inicio ni los pasajes cercanos a criterios relevantes.
 * Puro respecto de red, disco y reloj.
 * @param {string} text Texto íntegro del documento.
 * @param {number} max Máximo de caracteres aceptado por el extractor.
 * @returns {string} Extracto determinista de hasta max caracteres.
 */
export function excerptForExtraction(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const ranges = [[0, Math.min(6000, clean.length)]];
  for (const match of clean.matchAll(FOCUS)) {
    ranges.push([
      Math.max(0, match.index - 600),
      Math.min(clean.length, match.index + 600),
    ]);
  }
  ranges.sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
  }
  return merged.map(([start, end]) => clean.slice(start, end)).join(' … ').slice(0, max);
}

function acceptedEvidence(extraction, text) {
  const evidenceDrafts = [];
  let rejectedQuotes = 0;
  for (const evidence of extraction.evidence) {
    const invalidQuote = !literalIn(evidence.quote, text);
    const invalidRequirement = evidence.criterion_id === 'REQ' && !evidence.requirement_summary;
    if (invalidQuote || invalidRequirement) {
      rejectedQuotes++;
      continue;
    }
    evidenceDrafts.push({ ...evidence });
  }
  return { evidenceDrafts, rejectedQuotes };
}

function acceptedIdentifiers(extraction, text, url) {
  const acceptedTexts = [];
  let rejectedIdentifiers = 0;
  for (const value of extraction.about?.identifier_texts || []) {
    if (literalIn(value, text) || String(url).includes(value)) acceptedTexts.push(value);
    else rejectedIdentifiers++;
  }
  return { acceptedTexts, rejectedIdentifiers };
}

function acceptedOfficialLinks(extraction, text, fetchSeq) {
  const links = [];
  for (const link of extraction.official_links) {
    if (!String(text).includes(link.url) || !isPublicUrl(link.url)) continue;
    links.push({
      ...link,
      link_id: `l${String(fetchSeq).padStart(3, '0')}-${String(links.length).padStart(2, '0')}`,
    });
  }
  return links;
}

/**
 * Llama al extractor y conserva únicamente citas, identificadores y links verificables.
 * Efectos: realiza una llamada LLM mediante la dependencia inyectada.
 * @param {object} input Documento, texto, prompt, catálogo y límites de la llamada.
 * @returns {Promise<object>} Extracción filtrada y metadatos reproducibles.
 */
export async function extractDocument({
  doc,
  text,
  llm,
  prompt,
  catalog,
  today,
  step,
  fetchSeq,
  maxChars = 30000,
  temperature = 0,
  maxTokens = 8000,
}) {
  const criteria = catalog.criteria.map(criterion => ({
    criterion_id: criterion.criterion_id,
    label: criterion.label,
  }));
  criteria.push({ criterion_id: 'REQ', label: 'Any other binding requirement of this call' });
  const user = render(prompt.user, {
    today,
    criteria_json: criteria,
    url: doc.url,
    title: sanitizePageText(doc.title),
    page_text: `<page_data>${sanitizePageText(excerptForExtraction(text, maxChars))}</page_data>`,
  });
  const call = await llm.call({
    promptRef: prompt,
    system: prompt.system,
    user,
    schemaName: 'extraction',
    temperature,
    seed: 0,
    maxTokens,
    meta: { promptId: 'extractor', url: doc.url },
  });
  const extraction = call.json;
  const evidence = acceptedEvidence(extraction, text);
  const identifiers = acceptedIdentifiers(extraction, text, doc.url);
  return {
    extraction,
    evidenceDrafts: evidence.evidenceDrafts,
    acceptedIdentifierTexts: identifiers.acceptedTexts,
    officialLinks: acceptedOfficialLinks(extraction, text, fetchSeq),
    mentions: extraction.mentions,
    rejected: {
      quotes: evidence.rejectedQuotes,
      identifiers: identifiers.rejectedIdentifiers,
    },
    tokens: call.tokens,
    latency: call.latency,
    modelId: call.modelId,
    fullText: text,
    promptRef: { id: prompt.id, version: prompt.version, sha256: prompt.sha256 },
    step,
  };
}
