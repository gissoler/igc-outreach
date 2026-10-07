import { normalizeUrl } from './docs.mjs';

export function identifiersFromText(s) {
  const text = String(s); const out = []; const seen = new Set();
  const add = (scheme, value) => { const k = `${scheme}:${value}`; if (!seen.has(k)) { seen.add(k); out.push({ scheme, value }); } };
  for (const m of text.matchAll(/\b(RFA|PAR|PA|PAS|RFP|NOT|OTA)-([A-Z]{2})-(\d{2})-(\d{3})\b/gi)) add('nih', `${m[1]}-${m[2]}-${m[3]}-${m[4]}`.toUpperCase());
  for (const m of text.matchAll(/\bNSF[\s-]?(\d{2})-(\d{3})\b/gi)) add('nsf', `${m[1]}-${m[2]}`);
  for (const m of text.matchAll(/\bPD[\s-]?(\d{2})-(\d{4})\b/gi)) add('nsf', `PD-${m[1]}-${m[2]}`);
  for (const rx of [/grants\.gov\/search-results-detail\/(\d{5,7})/gi, /\bOpportunity ID[:\s]+(\d{5,7})\b/gi]) for (const m of text.matchAll(rx)) add('grantsgov', m[1]);
  for (const m of text.matchAll(/\b((?:HORIZON|EU4H|DIGITAL|ERC|LIFE)-[A-Z0-9]+(?:-[A-Z0-9]+){1,6})\b/g)) add('eu', m[1]);
  return out;
}
export function urlIdentifier(url) { const u = new URL(normalizeUrl(url)); return { scheme: 'url', value: `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.replace(/\/$/, '').toLowerCase() }; }
export function stableIdOf(ids) {
  const priority = { nih: 0, nsf: 1, eu: 2, grantsgov: 3, url: 4, sbir: 5, ukri: 6 };
  const sorted = [...ids].sort((a, b) => (priority[a.scheme] ?? 99) - (priority[b.scheme] ?? 99) || (a.scheme === 'nih' ? Number(a.value.startsWith('NOT-')) - Number(b.value.startsWith('NOT-')) : 0) || a.value.localeCompare(b.value));
  if (!sorted.length) throw new Error('No identifiers'); return `opp:${sorted[0].scheme}:${sorted[0].value}`;
}
export function identifierKeys(x) {
  const ids = Array.isArray(x) ? x : x?.identifiers || [];
  return new Set(ids.map(i => i.scheme === 'url' && /^https?:/.test(i.value) ? urlIdentifier(i.value) : i).map(i => `${i.scheme}:${i.value}`));
}
export function identifiersForAbout(doc, extraction) {
  const out = []; for (const t of extraction?.about?.identifier_texts || []) out.push(...identifiersFromText(t));
  out.push(...identifiersFromText(doc.url), urlIdentifier(doc.url));
  return [...new Map(out.map(x => [`${x.scheme}:${x.value}`, x])).values()];
}
