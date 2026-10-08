/**
 * Normaliza identificadores y construye identidades estables.
 * No decide si dos entidades son pertinentes.
 * Contratos: identificadores de documentos y entidades.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { normalizeUrl } from './docs.mjs';

/**
 * Extrae identificadores reconocibles sin inventar valores ausentes.
 * Puro respecto de red, disco y reloj.
 * @param {string} value Texto o URL que puede contener identificadores.
 * @returns {Array<{scheme:string, value:string}>} Identificadores únicos en orden de aparición.
 */
export function identifiersFromText(value) {
  const text = String(value);
  const identifiers = [];
  const seen = new Set();
  const add = (scheme, identifierValue) => {
    const key = `${scheme}:${identifierValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    identifiers.push({ scheme, value: identifierValue });
  };
  for (const match of text.matchAll(/\b(RFA|PAR|PA|PAS|RFP|NOT|OTA)-([A-Z]{2})-(\d{2})-(\d{3})\b/gi)) {
    add('nih', `${match[1]}-${match[2]}-${match[3]}-${match[4]}`.toUpperCase());
  }
  for (const match of text.matchAll(/\bNSF[\s-]?(\d{2})-(\d{3})\b/gi)) {
    add('nsf', `${match[1]}-${match[2]}`);
  }
  for (const match of text.matchAll(/\bPD[\s-]?(\d{2})-(\d{4})\b/gi)) {
    add('nsf', `PD-${match[1]}-${match[2]}`);
  }
  const grantsGovPatterns = [
    /grants\.gov\/search-results-detail\/(\d{5,7})/gi,
    /\bOpportunity ID[:\s]+(\d{5,7})\b/gi,
  ];
  for (const pattern of grantsGovPatterns) {
    for (const match of text.matchAll(pattern)) add('grantsgov', match[1]);
  }
  for (const match of text.matchAll(/\b((?:HORIZON|EU4H|DIGITAL|ERC|LIFE)-[A-Z0-9]+(?:-[A-Z0-9]+){1,6})\b/g)) {
    add('eu', match[1]);
  }
  return identifiers;
}

/**
 * Convierte una URL normalizada en un identificador comparable.
 * Puro respecto de red, disco y reloj.
 * @param {string} url URL pública del documento.
 * @returns {{scheme:'url', value:string}} Identificador sin protocolo ni barra final.
 */
export function urlIdentifier(url) {
  const parsed = new URL(normalizeUrl(url));
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return {
    scheme: 'url',
    value: `${parsed.hostname}${path}`.replace(/\/$/, '').toLowerCase(),
  };
}

/**
 * Elige el identificador canónico con la prioridad congelada de grants.
 * Puro respecto de red, disco y reloj.
 * @param {Array<{scheme:string, value:string}>} identifiers Identificadores de una entidad.
 * @returns {string} Identidad estable prefijada con opp.
 */
export function stableIdOf(identifiers) {
  const priority = { nih: 0, nsf: 1, eu: 2, grantsgov: 3, url: 4, sbir: 5, ukri: 6 };
  const sorted = [...identifiers].sort((left, right) => (
    (priority[left.scheme] ?? 99) - (priority[right.scheme] ?? 99) ||
    (left.scheme === 'nih'
      ? Number(left.value.startsWith('NOT-')) - Number(right.value.startsWith('NOT-'))
      : 0) ||
    left.value.localeCompare(right.value)
  ));
  if (!sorted.length) throw new Error('No identifiers');
  return `opp:${sorted[0].scheme}:${sorted[0].value}`;
}

/**
 * Produce claves comparables a partir de una entidad o de una lista de identificadores.
 * Puro respecto de red, disco y reloj.
 * @param {object|Array<object>} input Entidad o identificadores que se compararán.
 * @returns {Set<string>} Claves scheme:value únicas.
 */
export function identifierKeys(input) {
  const identifiers = Array.isArray(input) ? input : input?.identifiers || [];
  const normalized = identifiers.map(identifier => (
    identifier.scheme === 'url' && /^https?:/.test(identifier.value)
      ? urlIdentifier(identifier.value)
      : identifier
  ));
  return new Set(normalized.map(identifier => `${identifier.scheme}:${identifier.value}`));
}

/**
 * Reúne identificadores aceptados del documento y conserva la URL como respaldo.
 * Puro respecto de red, disco y reloj.
 * @param {{acceptedTexts:string[], url:string}} input Textos verificados y URL del documento.
 * @returns {Array<{scheme:string, value:string}>} Identificadores únicos en orden estable.
 */
export function identifiersForDocument({ acceptedTexts = [], url }) {
  const identifiers = [];
  for (const text of acceptedTexts) identifiers.push(...identifiersFromText(text));
  identifiers.push(...identifiersFromText(url), urlIdentifier(url));
  return [...new Map(identifiers.map(identifier => [
    `${identifier.scheme}:${identifier.value}`,
    identifier,
  ])).values()];
}
