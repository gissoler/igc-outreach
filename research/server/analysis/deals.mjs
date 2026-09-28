// Corpus de deals: esquema de extracción, verificación literal campo por campo y texto canónico.
// Regla del proyecto: un campo solo se acepta si su valor aparece en la cita, y la cita solo se acepta
// si aparece literal en el texto de la página. Lo que no pasa queda como 'descartado' (no se inventa).
import { createHash } from 'node:crypto';
import { fundId, normText, personKey, resolveFundNames, startupKey } from './entities.mjs';

export const DEAL_FIELDS = ['startup', 'sector', 'country', 'stage', 'amount', 'date', 'lead_investors', 'co_investors', 'partners', 'description'];

export const DEAL_SCHEMA = {
  type: 'object',
  properties: {
    deals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startup: { type: 'string', description: 'Company receiving the investment, as written.' },
          sector: { type: 'string', description: 'Sector as written in the quote (e.g. "mental health", "healthtech").' },
          country: { type: 'string', description: 'Startup country as written in the quote.' },
          stage: { type: 'string', description: 'Stage as written: "pre-seed", "seed", "Series A"…' },
          amount_text: { type: 'string', description: 'Amount copied literally: "$14M", "US$9 million"…' },
          date_text: { type: 'string', description: 'Announcement date if literally in the quote.' },
          lead_investors: { type: 'array', items: { type: 'string' }, description: 'Only the lead ("led by", "liderada por").' },
          co_investors: { type: 'array', items: { type: 'string' }, description: 'Other named participants.' },
          partners: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, fund: { type: 'string' } }, required: ['name'] }, description: 'Named fund people (partner, principal) and their fund.' },
          quote: { type: 'string', description: '1 to 3 sentences copied LITERALLY from the page containing the data above.' },
          description: { type: 'string', description: 'One sentence copied LITERALLY from the page describing what the startup does.' },
        },
        required: ['startup', 'quote'],
      },
    },
  },
  required: ['deals'],
};

export const EXTRACT_SYSTEM = `You extract funding rounds from news and press releases. Reply only JSON with the given schema.
Rules:
1. Only equity rounds (pre-seed, seed, Series A, B…) of a specific startup. Ignore funds raising, acquisitions, grants and debt.
2. "quote" is 1 to 3 sentences copied LITERALLY from the text (same spelling). All other values must appear inside "quote".
3. If a value isn't in the text, leave it empty. Don't infer, translate or complete.
4. lead_investors only if the text says who led ("led by", "co-led by", "liderada por", "encabezada por").
5. If there are no rounds, return {"deals": []}.`;

export const extractionPrompt = (page) => `Source: ${page.url}
Title: ${page.title || ''}
Publication date (metadata): ${page.published || 'desconocida'}

Text:
${String(page.text || '').slice(0, 24_000)}`;

/** Texto plano para comparar literalmente: sin sintaxis markdown, con comillas y espacios normalizados. */
export function plainText(markdown) {
  return String(markdown || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]\s)\s*/gm, ' ')
    .replace(/\*\*|__|\*|`/g, '')
    .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const lit = (s) => plainText(s).toLowerCase();
/** ¿La cita aparece literal en la página? (ignora mayúsculas, espacios y marcas de markdown). */
export const quoteInPage = (quote, pageText) => { const q = lit(quote); return q.length >= 25 && lit(pageText).includes(q); };
/** ¿El valor aparece en la cita? Comparación por tokens normalizados (sin acentos ni puntuación). */
export const valueInQuote = (value, quote) => { const v = normText(value); return v.length >= 2 && ` ${normText(quote)} `.includes(` ${v} `); };

const SECTORS = [
  ['mental health', /mental health|salud mental|behavioral health|saude mental|psychiatr|therapy|terapia|anxiety|depress/i],
  ['digital health', /digital health|salud digital|healthtech|health tech|healthcare technology|telehealth|telemedic|telemedicina/i],
  ['neuro', /neuro|alzheimer|dementia|demencia|parkinson|cognitive|cognitiv/i],
  ['biotech', /biotech|biotecnolog|therapeutics|drug discovery|biopharma/i],
  ['medtech', /medtech|medical device|dispositivo m[eé]dico/i],
  ['diagnostics', /diagnostic|diagn[oó]stico/i],
  ['ai', /\bai\b|artificial intelligence|inteligencia artificial|machine learning/i],
  ['health', /health|salud|sa[uú]de|clinic|cl[ií]nic|medical|m[eé]dic|care\b/i],
];
export const sectorsIn = (text) => SECTORS.filter(([, rx]) => rx.test(text)).map(([k]) => k);

const COUNTRIES = { colombia: 'CO', colombian: 'CO', colombiana: 'CO', mexico: 'MX', 'méxico': 'MX', mexican: 'MX', mexicana: 'MX', brazil: 'BR', brasil: 'BR', brazilian: 'BR', argentina: 'AR', argentine: 'AR', chile: 'CL', chilean: 'CL', chilena: 'CL', peru: 'PE', 'perú': 'PE', peruvian: 'PE', uruguay: 'UY', ecuador: 'EC', 'costa rica': 'CR', guatemala: 'GT', panama: 'PA', 'panamá': 'PA', 'united states': 'US', 'u.s.': 'US', 'estados unidos': 'US', usa: 'US', canada: 'CA', 'canadá': 'CA', 'united kingdom': 'UK', uk: 'UK', spain: 'ES', 'españa': 'ES', 'latin america': 'LATAM', latam: 'LATAM', 'latinoamérica': 'LATAM', 'america latina': 'LATAM', 'américa latina': 'LATAM' };
export function countryIn(value, quote) {
  const q = ` ${normText(quote)} `;
  const candidates = [value, ...Object.keys(COUNTRIES)].filter(Boolean);
  for (const c of candidates) { const k = normText(c); if (k && q.includes(` ${k} `) && COUNTRIES[String(c).toLowerCase()]) return { code: COUNTRIES[String(c).toLowerCase()], text: c }; }
  if (value && valueInQuote(value, quote)) return { code: null, text: value };
  return null;
}

export function stageOf(text) {
  const t = String(text || '').toLowerCase();
  if (/pre[- ]?seed|pre[- ]?semilla|presemilla/.test(t)) return 'pre-seed';
  const series = t.match(/\bseries?\s+([a-e])\b|\bserie\s+([a-e])\b/);
  if (series) return `series-${series[1] || series[2]}`;
  if (/\bseed\b|semilla|capital semente|rodada seed/.test(t)) return 'seed';
  if (/growth round|growth equity/.test(t)) return 'growth';
  return null;
}

const MULT = { k: 1e3, thousand: 1e3, mil: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, millones: 1e6, millón: 1e6, millon: 1e6, 'milhões': 1e6, milhoes: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
const CUR = [['US$', 'USD'], ['USD', 'USD'], ['R$', 'BRL'], ['BRL', 'BRL'], ['€', 'EUR'], ['EUR', 'EUR'], ['£', 'GBP'], ['GBP', 'GBP'], ['MXN', 'MXN'], ['COP', 'COP'], ['CAD', 'CAD'], ['C$', 'CAD'], ['$', 'USD']];
/** '$14M' -> {value:14e6, currency:'USD'}; '1,2 millones de dólares' -> USD. Sin tasa de cambio: solo USD va a amount_usd. */
export function parseAmount(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  let currency = null;
  for (const [sym, code] of CUR) if (s.toUpperCase().includes(sym)) { currency = code; break; }
  if (!currency && /d[oó]lares|dollars/i.test(s)) currency = 'USD';
  const m = s.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|thousand|mil(?:hões|hoes)?|mm|mn|m|million|millones|millón|millon|bn|b|billion)?\b/i);
  if (!m) return null;
  let num = m[1];
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, '');
  else num = num.replace(',', '.');
  let value = Number(num);
  const unit = (m[2] || '').toLowerCase();
  if (unit) value *= MULT[unit] || 1;
  if (/millones|million|milh/i.test(s) && !unit) value *= 1e6;
  return Number.isFinite(value) && value > 0 ? { value, currency } : null;
}

const MONTHS = { jan: 1, january: 1, enero: 1, feb: 2, february: 2, febrero: 2, mar: 3, march: 3, marzo: 3, apr: 4, april: 4, abril: 4, may: 5, mayo: 5, jun: 6, june: 6, junio: 6, jul: 7, july: 7, julio: 7, aug: 8, august: 8, agosto: 8, sep: 9, sept: 9, september: 9, septiembre: 9, setiembre: 9, oct: 10, october: 10, octubre: 10, nov: 11, november: 11, noviembre: 11, dec: 12, december: 12, diciembre: 12 };
/** Fecha ISO desde texto ('Dec 17, 2025', '17 de diciembre de 2025', '2025-12-17'); null si es ambigua. */
export function parseDate(text) {
  const s = String(text || '').toLowerCase();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/([a-zé]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1]]) return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})\s+(?:de\s+)?([a-zé]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MONTHS[m[2]]) return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/\b([a-zé]+)\s+(?:de\s+)?(\d{4})\b/);
  if (m && MONTHS[m[1]]) return `${m[2]}-${String(MONTHS[m[1]]).padStart(2, '0')}`;
  return null;
}

const LEAD_WORDS = /\bled by\b|\bco-led by\b|\bleads?\b|\blead investor|lider(?:ada|ado|ó|o)\b|encabezad[ao]|liderad[ao]|capitaneada|conduzida|liderada/i;

/**
 * Verifica una extracción cruda contra el texto de la página.
 * Devuelve {deal|null, status: {campo: 'verificado'|'descartado'|'ausente'}, reason}.
 */
export function verifyDeal(raw, page, { extractor = 'desconocido', now = new Date().toISOString() } = {}) {
  const text = plainText(page.text || page.markdown || '');
  const quote = plainText(raw?.quote || '');
  const status = Object.fromEntries(DEAL_FIELDS.map((f) => [f, 'ausente']));
  if (!quote || !quoteInPage(quote, text)) return { deal: null, status, reason: 'The quote isn\'t literally on the page.' };
  const startup = String(raw.startup || '').trim();
  if (!startup || !valueInQuote(startup, quote)) { status.startup = 'descartado'; return { deal: null, status, reason: 'The startup isn\'t in the quote.' }; }
  status.startup = 'verificado';

  const sectorSrc = raw.sector && valueInQuote(raw.sector, quote) ? raw.sector : '';
  const sectors = sectorsIn(`${sectorSrc} ${quote}`);
  status.sector = sectors.length ? 'verificado' : raw.sector ? 'descartado' : 'ausente';

  const country = countryIn(raw.country, quote);
  status.country = country ? 'verificado' : raw.country ? 'descartado' : 'ausente';

  const stageRaw = raw.stage && lit(quote).includes(lit(raw.stage)) ? raw.stage : '';
  const stage = stageOf(stageRaw) || stageOf(quote);
  status.stage = stage ? 'verificado' : raw.stage ? 'descartado' : 'ausente';

  let amount = null;
  if (raw.amount_text && lit(quote).includes(lit(raw.amount_text))) amount = parseAmount(raw.amount_text);
  status.amount = amount ? 'verificado' : raw.amount_text ? 'descartado' : 'ausente';

  let date = null, dateBasis = null;
  if (raw.date_text && lit(quote).includes(lit(raw.date_text))) { date = parseDate(raw.date_text); dateBasis = date ? 'cita' : null; }
  if (!date && page.published) { date = parseDate(page.published) || String(page.published).slice(0, 10); dateBasis = 'publication date'; }
  status.date = date ? 'verificado' : raw.date_text ? 'descartado' : 'ausente';

  const names = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((x) => String(x || '').trim()).filter(Boolean))];
  const leadsRaw = names(raw.lead_investors), coRaw = names(raw.co_investors);
  const leadOk = LEAD_WORDS.test(quote);
  const leads = leadsRaw.filter((n) => valueInQuote(n, quote) && leadOk);
  const demoted = leadsRaw.filter((n) => valueInQuote(n, quote) && !leadOk);
  const co = [...new Set([...coRaw.filter((n) => valueInQuote(n, quote)), ...demoted])].filter((n) => !leads.includes(n) && n !== startup);
  status.lead_investors = leads.length ? (leads.length === leadsRaw.length ? 'verificado' : 'parcial') : leadsRaw.length ? 'descartado' : 'ausente';
  status.co_investors = coRaw.length ? (coRaw.every((n) => co.includes(n) || leads.includes(n)) ? 'verificado' : 'parcial') : 'ausente';
  const partners = (Array.isArray(raw.partners) ? raw.partners : []).filter((p) => p?.name && String(p.name).trim().split(/\s+/).length >= 2 && valueInQuote(p.name, quote))
    .map((p) => ({ name: String(p.name).trim(), fund: p.fund && valueInQuote(p.fund, quote) ? String(p.fund).trim() : null }));
  status.partners = partners.length ? 'verificado' : (raw.partners || []).length ? 'descartado' : 'ausente';
  // Descripción del producto: literal en la página (no hace falta que esté en la cita). Da contenido a la
  // similitud de la tesis revelada: sin ella, dos deals solo se parecen por sector y etapa.
  const description = raw.description && quoteInPage(raw.description, text) ? plainText(raw.description).slice(0, 500) : null;
  status.description = description ? 'verificado' : raw.description ? 'descartado' : 'ausente';

  const { ids } = resolveFundNames([...leads, ...co, ...partners.map((p) => p.fund).filter(Boolean)]);
  const investors = [
    ...leads.map((name) => ({ fundId: ids.get(name), name, role: 'lead' })),
    ...co.map((name) => ({ fundId: ids.get(name), name, role: 'co' })),
  ];
  const deal = {
    id: dealId(startup, stage, date),
    startup,
    startupKey: startupKey(startup),
    sector: sectors[0] || null,
    sectors,
    country: country?.code || null,
    countryText: country?.text || null,
    stage,
    amountUsd: amount?.currency === 'USD' ? Math.round(amount.value) : null,
    amountValue: amount ? Math.round(amount.value) : null,
    amountText: amount ? raw.amount_text : null,
    currency: amount?.currency || null,
    date,
    dateBasis,
    investors,
    partners: partners.map((p) => ({ ...p, personKey: personKey(p.name), fundId: p.fund ? ids.get(p.fund) || fundId(p.fund) : null })),
    url: page.url,
    title: page.title || '',
    quote,
    description,
    source: page.source || 'web',
    extractor,
    retrievedAt: now,
    fieldStatus: status,
  };
  return { deal, status, reason: '' };
}

export const dealId = (startup, stage, date) => createHash('sha256').update([startupKey(startup), stage || '', String(date || '').slice(0, 7)].join('|')).digest('hex').slice(0, 20);

/** Texto canónico de un deal para embeddings y rerank. */
export const dealText = (d) => [d.stage || 'unknown stage', ...(d.sectors?.length ? d.sectors : ['unknown sector']), d.country || d.countryText || 'unknown country', String(d.date || '').slice(0, 7), d.amountUsd ? `US$${(d.amountUsd / 1e6).toFixed(1)}M` : '', `startup: ${d.startup}`, d.description ? `what it does: ${d.description}` : '', `— ${String(d.quote).slice(0, 300)}`].filter(Boolean).join(' · ');

/** Fusiona dos versiones del mismo deal (mismo id) conservando más campos verificados y todas las fuentes. */
export function mergeDeals(a, b) {
  if (!a) return b;
  const score = (d) => Object.values(d.fieldStatus || {}).filter((s) => s === 'verificado').length;
  const [main, other] = score(b) > score(a) ? [b, a] : [a, b];
  const investors = [...new Map([...main.investors, ...other.investors].map((i) => [`${i.fundId}|${i.role}`, i])).values()];
  const leadIds = new Set(investors.filter((i) => i.role === 'lead').map((i) => i.fundId));
  return { ...main, investors: investors.filter((i) => i.role === 'lead' || !leadIds.has(i.fundId)), sources: [...new Map([...(main.sources || [{ url: main.url, quote: main.quote }]), ...(other.sources || [{ url: other.url, quote: other.quote }])].map((s) => [s.url, s])).values()] };
}

/**
 * Extractor por reglas (línea base, sin LLM): oraciones con "raises/raised/levanta … led by/liderada por".
 * Sirve para medir cuánto aporta el LLM y para operar sin flota. Sus salidas pasan por verifyDeal igual.
 */
export function ruleExtract(pageText) {
  const sentences = String(pageText || '').split(/\n+/).map(plainText).filter(Boolean).flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ"'])/));
  const out = [];
  for (const s of sentences) {
    if (!/rais(?:es|ed)|secur(?:es|ed)|closes?|closed|levant[aóo]|recaud[aóo]|cierra|capt[aó]|anuncia/i.test(s) || !LEAD_WORDS.test(s)) continue;
    const startup = s.match(/^([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*){0,3})(?:,|\s+(?:rais|secur|clos|levant|recaud|cierr|capt|anunci))/)?.[1];
    const amount = s.match(/(?:US\$|USD|R\$|€|£|\$)\s?\d+(?:[.,]\d+)?\s?(?:million|millones|milhões|[MmKkBb]n?\b)?|\d+(?:[.,]\d+)?\s?(?:millones de d[oó]lares|million dollars)/)?.[0];
    const leadPart = s.split(/led by|co-led by|liderad[ao] por|encabezad[ao] por|lider[oó]/i)[1] || '';
    const leads = leadPart.replace(/\bwith participation from\b.*|\bcon (?:la )?participaci[oó]n de\b.*/i, '').split(/,|\band\b|\by\b|\be\b/).map((x) => x.replace(/[.;].*$/, '').replace(/^\s*(the|la|el)\s+/i, '').trim()).filter((x) => /^[A-Z0-9]/.test(x) && x.length > 1 && x.split(' ').length <= 6);
    const coPart = s.match(/(?:with participation from|participation from|con (?:la )?participaci[oó]n de)\s+(.+)$/i)?.[1] || '';
    const co = coPart.split(/,|\band\b|\by\b/).map((x) => x.replace(/[.;].*$/, '').replace(/^\s*(existing investors?|inversionistas existentes)\s*/i, '').trim()).filter((x) => /^[A-Z0-9]/.test(x) && x.split(' ').length <= 6);
    if (startup) out.push({ startup, stage: stageOf(s) || '', amount_text: amount || '', lead_investors: leads, co_investors: co, quote: s });
  }
  return { deals: out };
}
