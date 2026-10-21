/* ─────────────────────────────────────────────────────────────────────────────
   V15 · NIH Guide for Grants and Contracts como fuente oficial con TEXTO COMPLETO.
   API pública de búsqueda de la guía (la misma que usa grants.nih.gov):
     GET https://search.grants.nih.gov/guide/api/data?perpage=N&from=0&type=active,activenosis&query=…
   Cada resultado trae docnum (PA-25-304, RFA-AG-27-005, NOT-AG-…), título, códigos de actividad,
   fechas (opendate, expdate) y `doctext`: el texto completo del aviso. Con eso el juez lee la
   convocatoria entera y no una ficha de 257 caracteres (RD-04).
   Forma de la respuesta comprobada el 20/10/2026 (data.hits.hits[]._source).
   ───────────────────────────────────────────────────────────────────────────── */

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const day = (v) => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
export const NIH_GUIDE_API = 'https://search.grants.nih.gov/guide/api/data';

/** URL pública del aviso en la guía, a partir del tipo y el nombre de archivo que da la API. */
export function guideUrl(src = {}) {
  const docnum = clean(src.docnum).toUpperCase(); const file = clean(src.filename) || (docnum ? `${docnum}.html` : '');
  const type = clean(src.doctype).toUpperCase() || docnum.split('-')[0];
  const dir = type === 'RFA' ? 'rfa-files' : type === 'NOT' || type === 'NOSI' ? 'notice-files' : ['PA', 'PAR', 'PAS'].includes(type) ? 'pa-files' : null;
  return dir && file ? `https://grants.nih.gov/grants/guide/${dir}/${file}` : null;
}

/** Un resultado de la API → aviso normalizado (sin perder el texto completo). */
export function nihDoc(hit = {}) {
  const s = hit._source || hit; const docnum = clean(s.docnum).toUpperCase();
  if (!docnum) return null;
  const doctype = clean(s.doctype).toUpperCase() || docnum.split('-')[0];
  return {
    source: 'nih_guide', id: docnum, number: docnum, title: clean(s.title), agency: `NIH ${clean(s.primaryIC || s.organization?.primary || '')}`.trim(),
    url: guideUrl(s), doctype, kind: doctype === 'NOT' ? 'nosi' : 'nofo', parent: String(s.parentFOA || '').toLowerCase() === 'yes',
    activityCodes: Array.isArray(s.ac) ? s.ac.map(clean).filter(Boolean) : String(s.ac || '').split(/[ ,]+/).filter(Boolean),
    clinicalTrials: clean(s.clinicaltrials) || null, sponsors: Array.isArray(s.sponsors) ? s.sponsors : [], primaryIC: clean(s.primaryIC) || null,
    posted: day(s.reldate), opens: day(s.opendate), expires: day(s.expdate), lastReceipt: day(s.lard), receipt: clean(s.appreceiptdate) || null,
    status: clean(s.type) || null, purpose: clean(s.purpose), related: Array.isArray(s.relatedDocs) ? s.relatedDocs.map(clean) : [],
    text: String(s.doctext || ''), textKind: String(s.doctext || '').length >= 1500 ? 'full' : 'synopsis',
  };
}

/** Una búsqueda en la guía. `client.json(url)` es inyectable (tests sin red). Devuelve avisos activos normalizados. */
export async function nihGuideSearch(client, { query = '', perpage = 100, types = 'active,activenosis', userAgent = '' } = {}) {
  const q = clean(String(query).replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}\s/-]+/gu, ' '));
  const url = `${NIH_GUIDE_API}?${new URLSearchParams({ perpage: String(Math.min(100, Math.max(1, perpage))), from: '0', type: types, query: q })}`;
  // Cabeceras de una petición del propio sitio de la guía (Accept JSON y Referer); el UA identifica a Outreach, no se disfraza.
  const data = await client.json(url, undefined, { Accept: 'application/json, text/plain, */*', Referer: 'https://grants.nih.gov/funding/nih-guide-for-grants-and-contracts', ...(userAgent ? { 'User-Agent': userAgent } : {}) });
  const hits = data?.data?.hits?.hits;
  if (!Array.isArray(hits)) throw new Error(`nih_guide_invalid_response${data?.statusCode ? `_${data.statusCode}` : ''}`);
  return { url, total: Number(data?.data?.hits?.total?.value ?? data?.data?.hits?.total) || hits.length, docs: hits.map(nihDoc).filter(Boolean) };
}

/* ── Secciones del texto completo de un aviso del NIH (doctext viene sin saltos de línea) ── */
const cut = (text, startRx, endRx, max) => {
  const s = String(text || ''); const m = startRx.exec(s); if (!m) return '';
  const rest = s.slice(m.index); const e = endRx ? endRx.exec(rest.slice(m[0].length + 1)) : null;
  return rest.slice(0, e ? Math.min(max, e.index + m[0].length + 1) : max);
};
/** Fechas clave (Part 1): publicación, apertura, LOI, fechas de entrega, vencimiento. */
export const nihKeyDates = (text, max = 2200) => cut(text, /Key Dates/i, /Required Application Instructions|Table of Contents|Part 2\.|Section I\./i, max);
/** Propósito y objetivos (Section I). */
export const nihPurpose = (text, max = 3200) => cut(text, /Section I\.\s*(?:Notice of Funding Opportunity|Funding Opportunity) Description/i, /Section II\./i, max) || cut(text, /Funding Opportunity Purpose|Purpose/i, /Key Dates/i, max);
/** Elegibilidad (Section III): organizaciones, extranjeras, PI. */
export const nihEligibility = (text, max = 2600) => cut(text, /Section III\.\s*Eligibility Information/i, /Section IV\./i, max);
/** Para los NOSI: la parte que dice a qué avisos aplica y hasta cuándo. */
export const nihNosiCore = (text, max = 3000) => cut(text, /Notice Number:|Purpose/i, /Inquiries/i, max);

/* ── Próxima fecha de entrega de una solicitud NUEVA (código, sin modelo) ──
   En la tabla de Key Dates del NIH cada fila empieza por la fecha para solicitudes nuevas y sigue, pegada, la de
   renovación/reenvío (un mes después), y luego meses de revisión. RD-04: la próxima fecha NUEVA del R21 es
   16/02/2027 aunque el 16/11/2026 aparezca antes (es para resubmission/renewal). Con «Standard dates apply» se usan
   las fechas estándar publicadas por el NIH para el código de actividad. */
const STANDARD_NEW = {
  R01: [[2, 5], [6, 5], [10, 5]], U01: [[2, 5], [6, 5], [10, 5]], R03: [[2, 16], [6, 16], [10, 16]], R21: [[2, 16], [6, 16], [10, 16]], R33: [[2, 16], [6, 16], [10, 16]], R34: [[2, 16], [6, 16], [10, 16]], R36: [[2, 16], [6, 16], [10, 16]],
  R15: [[2, 25], [6, 25], [10, 25]], R13: [[4, 12], [8, 12], [12, 12]], K01: [[2, 12], [6, 12], [10, 12]], K08: [[2, 12], [6, 12], [10, 12]], K23: [[2, 12], [6, 12], [10, 12]], K25: [[2, 12], [6, 12], [10, 12]], K99: [[2, 12], [6, 12], [10, 12]],
  F31: [[4, 8], [8, 8], [12, 8]], F32: [[4, 8], [8, 8], [12, 8]], P01: [[1, 25], [5, 25], [9, 25]],
  R41: [[1, 5], [4, 5], [9, 5]], R42: [[1, 5], [4, 5], [9, 5]], R43: [[1, 5], [4, 5], [9, 5]], R44: [[1, 5], [4, 5], [9, 5]], U43: [[1, 5], [4, 5], [9, 5]], U44: [[1, 5], [4, 5], [9, 5]],
};
const pad = (n) => String(n).padStart(2, '0');
export function standardNextDue(activityCodes = [], today, expires = null) {
  const code = (activityCodes || []).find((c) => STANDARD_NEW[c]); if (!code) return null;
  const y = Number(String(today).slice(0, 4));
  for (const year of [y, y + 1, y + 2]) for (const [m, d] of STANDARD_NEW[code]) {
    const iso = `${year}-${pad(m)}-${pad(d)}`;
    if (iso >= today && (!expires || iso <= expires)) return { date: iso, code, source: 'nih_standard_dates' };
  }
  return null;
}

/** Fechas de entrega de solicitudes nuevas leídas de la sección Key Dates; `next` es la primera ≥ hoy y ≤ vencimiento. */
export function nihDueDates(text, { today, expires = null, activityCodes = [], parse } = {}) {
  const block = String(text || '').replace(/\s+/g, ' ');
  const at = block.search(/Application Due Dates?/i); if (at < 0) return { next: null, newDates: [], standard: false };
  const end = block.slice(at).search(/Expiration Date|Due Dates for E\.?O\.? ?12372|Required Application Instructions|Part 2\./i);
  const section = block.slice(at, end > 0 ? at + end : at + 4000);
  if (/standard dates apply/i.test(section.slice(0, 600))) {
    const std = standardNextDue(activityCodes, today, expires);
    return { next: std, newDates: [], standard: true, quote: 'Standard dates apply' };
  }
  const dates = (parse ? parse(section) : []).filter((d) => d.iso && !d.yearless && d.precision === 'day');
  const rowStarts = dates.filter((d, i) => i === 0 || !/^\s{0,3}$/.test(section.slice(dates[i - 1].end, d.index)));
  const newDates = [...new Set(rowStarts.map((d) => d.iso))].sort();
  const nextIso = newDates.find((iso) => iso >= today && (!expires || iso <= expires)) || null;
  const raw = nextIso ? rowStarts.find((d) => d.iso === nextIso)?.raw : null;
  return { next: nextIso ? { date: nextIso, source: 'nih_key_dates', quote: raw } : null, newDates, standard: false };
}

/* ── Respaldo cuando la API de búsqueda de la guía no responde (runs-v7: HTTP 403 desde el Mac) ──
   Se lee la página pública del aviso (grants.nih.gov/grants/guide/…/ID.html) con el lector de páginas y, si falla, con el
   lector de respaldo (Firecrawl). Del texto se sacan por código el vencimiento y el estado EXPIRED. */
const EXPIRED_BANNER = /\bEXPIRED\b|this (?:notice of funding opportunity|funding opportunity announcement|notice) has expired/;
export function nihItemFromPage(page, number, { parse } = {}) {
  const text = String(page?.text || ''); if (text.length < 1500) return null;
  const flatText = text.replace(/\s+/g, ' ');
  const expRaw = flatText.match(/Expiration Date\s*:?\s*([A-Z][a-z]+\.? \d{1,2},? \d{4})/)?.[1] || null;
  const expires = expRaw && parse ? (parse(expRaw).find((d) => d.iso && d.precision === 'day')?.iso || null) : null;
  const ac = [...new Set((flatText.match(/Activity Code\s*:?\s*((?:[A-Z]{1,2}\d{2}[A-Z]?(?:\s*(?:,|\/|and)\s*)?)+)/)?.[1] || '').match(/\b[A-Z]{1,2}\d{2}[A-Z]?\b/g) || [])];
  const title = String(page.title || '').replace(/\s*\|\s*NIH.*$/i, '').replace(/^\s*[A-Z]+-[A-Z]{0,4}-?\d{2}-\d{2,4}\s*:\s*/, '').trim();
  return {
    source: 'nih_guide', number, url: page.url, title: title || number, agency: 'NIH', text, textKind: 'full', kind: /^NOT-/.test(number) ? 'nosi' : 'nofo', query: `guide_page:${number}`,
    meta: { status: EXPIRED_BANNER.test(flatText.slice(0, 3000)) ? 'expired' : 'published', activityCodes: ac, parent: /\(Parent\b/i.test(title), expires, nihKind: /^NOT-/.test(number) ? 'nosi' : 'nofo', purpose: (flatText.match(/Funding Opportunity Purpose\s*(.{40,600}?)(?:Key Dates|Funding Opportunity Goal)/)?.[1] || '').trim() },
  };
}
