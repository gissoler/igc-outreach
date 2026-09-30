/* ─────────────────────────────────────────────────────────────────────────────
   Verificación en código de lo que el modelo lee de una página de convocatoria.
   Regla de oro: el modelo EXTRAE, el código DECIDE.
     · una fecha límite solo vale si aparece literalmente en la página (cita + fecha dentro de la cita)
     · el estado (abierta / cerrada) se calcula comparando la fecha con HOY, nunca lo dice el modelo
     · agregadores, redes sociales y blogs de listas no son fuente oficial → se descartan
   Sin red, sin dependencias: se prueba con páginas guardadas.
   ───────────────────────────────────────────────────────────────────────────── */
import { norm } from './core.mjs';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RX = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const iso = (y, m, d) => {
  const t = Date.UTC(y, m - 1, d);
  const x = new Date(t);
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : null;
};

/** Todas las fechas completas (con año) de un texto, como YYYY-MM-DD. */
export function datesIn(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const out = new Set();
  const add = (v) => { if (v) out.add(v); };
  for (const m of s.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) add(iso(+m[1], +m[2], +m[3]));
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RX})\\.?,?\\s+(20\\d{2})\\b`, 'gi'))) add(iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]));
  for (const m of s.matchAll(new RegExp(`\\b(${MONTH_RX})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi'))) add(iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]));
  return [...out];
}

const todayIso = (today) => (today instanceof Date ? today : new Date(today || Date.now())).toISOString().slice(0, 10);
const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

/** ¿La cita aparece tal cual en la página? (sin distinguir mayúsculas, espacios ni markdown) */
export function literalIn(quote, pageText) {
  const strip = (v) => norm(String(v || '').replace(/[*_`#>|\[\]()]/g, ' ')).replace(/\s+/g, ' ').trim();
  const q = strip(quote);
  return q.length >= 8 && strip(pageText).includes(q);
}

const SOCIAL = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|reddit\.com|medium\.com|substack\.com|quora\.com|crunchbase\.com|pitchbook\.com|glassdoor\.com)$/i;
const AGGREGATORS = /(^|\.)(startupgrantsindia\.com|fundsforngos\.org|fundsforcompanies\.com|fundsforindividuals\.com|opportunitydesk\.org|opportunitiesforafricans\.com|grantwatch\.com|grants\.gov\.in|vestbee\.com|f6s\.com|startupticker\.ch|dealroom\.co|eu-startups\.com|tech\.eu|startus-insights\.com|growthlist\.co|startupstash\.com|beststartup\.org|grantforward\.com|instrumentl\.com|grantstation\.com|opportunities-for-youth\.org|youthop\.com|scholarshipdb\.net)$/i;
// Directorios, marketplaces y blogs de listas: nunca son la fuente oficial (lista heurística; ampliarla cuando aparezcan más).
const AGGREGATORS_EXTRA = /(^|\.)(roundfunded\.com|hellodarwin\.com|ellty\.com|spinverse\.com|wellfound\.com|angel\.co|tracxn\.com|cbinsights\.com|seedtable\.com|failory\.com|signal\.nfx\.com|openvc\.app|visible\.vc|gust\.com)$/i;
const DIRECTORY_PATH = /^https?:\/\/(www\.)?ycombinator\.com\/(companies|library)/i;
export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
export const hostKind = (url) => { const h = hostOf(url); return SOCIAL.test(h) ? 'social' : AGGREGATORS.test(h) || AGGREGATORS_EXTRA.test(h) || DIRECTORY_PATH.test(String(url)) ? 'aggregator' : 'other'; };

const CLOSED_RX = /\b(applications?\s+(?:are\s+|is\s+)?closed|call\s+(?:is\s+)?closed|now\s+closed|submissions?\s+(?:are\s+)?closed|no\s+longer\s+accepting)\b/i;
const OPEN_RX = /\b(applications?\s+(?:are\s+|is\s+)?(?:now\s+)?open|now\s+accepting|accepting\s+applications|rolling\s+(?:basis|applications?|admission)|open\s+call|apply\s+now)\b/i;

/**
 * Convierte la salida del modelo en un hecho verificado.
 * @param out   JSON del modelo {status, deadline, official, eligible, non_dilutive, quotes}
 * @param page  {url, text}
 * @returns {{keep, drop, status, deadline, official, eligible, nonDilutive, verdict, flags, quotes}}
 */
export function verifyOpportunity(out, page, { today } = {}) {
  const now = todayIso(today);
  const text = String(page?.text || '');
  const flags = [];
  const kind = hostKind(page?.url);
  const q = out?.quotes && typeof out.quotes === 'object' ? out.quotes : {};
  const quotes = {};
  for (const key of ['status', 'deadline', 'eligible']) {
    const v = typeof q[key] === 'string' ? q[key].trim() : '';
    if (!v || /^(null|none|n\/a|unknown)$/i.test(v)) continue;
    if (literalIn(v, text)) quotes[key] = v; else flags.push(`fake_quote:${key}`);
  }

  // 1) fecha límite: cita literal en la página y la fecha dentro de la cita (o de la página, si la cita es corta)
  let deadline = null;
  const claimed = /^\d{4}-\d{2}-\d{2}$/.test(String(out?.deadline || '')) ? String(out.deadline) : null;
  if (claimed) {
    const inQuote = quotes.deadline && datesIn(quotes.deadline).includes(claimed);
    if (inQuote) deadline = claimed;
    else flags.push(quotes.deadline ? 'deadline_not_in_quote' : 'deadline_without_quote');
    if (deadline) {
      const gap = daysBetween(now, deadline);
      if (gap > 365 * 3) { flags.push('deadline_implausible'); deadline = null; }
    }
  }

  // 2) estado: calculado por el código
  const modelStatus = String(out?.status || 'unknown').toLowerCase();
  let status = 'unknown';
  if (modelStatus === 'not_a_call') status = 'not_a_call';
  else if (deadline) status = daysBetween(now, deadline) < 0 ? 'closed' : modelStatus === 'upcoming' && quotes.status ? 'upcoming' : 'open';
  else if (quotes.status && CLOSED_RX.test(quotes.status)) status = 'closed';
  else if (quotes.status && OPEN_RX.test(quotes.status) && modelStatus === 'open') { status = 'open'; flags.push('open_without_deadline'); }
  else if (modelStatus === 'upcoming' && quotes.status) status = 'upcoming';
  else if (modelStatus === 'open') flags.push('open_claim_unsupported');

  const official = Boolean(out?.official) && kind === 'other';
  const eligible = ['yes', 'no', 'unclear'].includes(String(out?.eligible)) ? String(out.eligible) : 'unclear';
  const nonDilutive = ['yes', 'no', 'unknown'].includes(String(out?.non_dilutive)) ? String(out.non_dilutive) : 'unknown';
  if (eligible !== 'unclear' && !quotes.eligible) flags.push('eligibility_without_quote');

  // 3) decisión
  let drop = null;
  if (kind === 'social') drop = 'social_host';
  else if (kind === 'aggregator') drop = 'aggregator';
  else if (status === 'not_a_call') drop = 'not_a_call';
  else if (status === 'closed') drop = 'closed';
  else if (eligible === 'no' && quotes.eligible) drop = 'not_eligible';
  else if (nonDilutive === 'no') drop = 'equity_or_loan';
  else if (!official) drop = 'not_official';
  const verdict = drop ? 'skip' : status === 'open' && deadline && eligible === 'yes' ? 'apply' : 'watch';
  return { keep: !drop, drop, status, deadline, official, eligible: eligible === 'no' && !quotes.eligible ? 'unclear' : eligible, nonDilutive, verdict, flags, quotes, daysLeft: deadline ? daysBetween(now, deadline) : null };
}
