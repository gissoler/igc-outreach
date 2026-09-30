// Búsqueda y extracción web con Firecrawl (buscar + leer páginas) y ScrapeGraph (extraer personas).
// Reemplaza a Apify. No toca LinkedIn con scraping: solo usa resultados de búsqueda públicos.
import { readMany } from './readOpportunity.mjs';
import { verifyOpportunity, compactVerification } from './verify.mjs';
import { EXTRACT_SCHEMA, EXTRACT_PROMPT } from './extract.mjs';
import { candidate, evidence, norm, safeUrl } from './core.mjs';
import { noopRecorder, previewRecords, publicParams, queryOf, safeSample, sanitizeUrl } from './liveRun.mjs';

export const FIRECRAWL_URL = 'https://api.firecrawl.dev/v2';
export const SCRAPEGRAPH_URL = 'https://v2-api.scrapegraphai.com/api';
export const WEB_SOURCE = 'Firecrawl + ScrapeGraph';
export const GRANT_WEB_SOURCE = 'Open web opportunities';

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
};
const firecrawlKey = (env) => env.FIRECRAWL_API_KEY || '';
const scrapegraphKey = (env) => env.SGAI_API_KEY || env.SCRAPEGRAPH_API_KEY || '';
export const webConfigured = (env = process.env) => Boolean(firecrawlKey(env) && scrapegraphKey(env));
export const firecrawlConfigured = (env = process.env) => Boolean(firecrawlKey(env));
export const webMissing = (env = process.env) => [
  ...(firecrawlKey(env) ? [] : ['FIRECRAWL_API_KEY']),
  ...(scrapegraphKey(env) ? [] : ['SGAI_API_KEY']),
];

const BLOCKED_HOSTS = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|crunchbase\.com|pitchbook\.com|glassdoor\.com|zoominfo\.com|rocketreach\.co|apollo\.io)$/i;
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

/** Errores que no se arreglan reintentando: clave inválida, sin créditos, plan agotado. */
const FATAL_STATUS = new Set([401, 402, 403]);
const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const HUMAN_ERROR = { 401: 'invalid API key', 402: 'out of credits (top up the plan)', 403: 'key not allowed for this endpoint', 408: 'timed out', 429: 'rate limited' };
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(signal.reason || new Error('aborted')); }, { once: true });
});
/** Breakers por proveedor para toda la vida del proceso: tras un 401/402 no seguimos gastando llamadas. */
const disabledUntil = new Map();
export function providerDisabled(provider) { const until = disabledUntil.get(provider) || 0; return until > Date.now() ? until : 0; }
export function resetProviderBreakers() { disabledUntil.clear(); }

async function callApi({ provider, host, url, headers, body, env, fetcher, signal, live = noopRecorder, record = () => {}, timeoutMs, retries }) {
  const base = { kind: 'api', callId: `${provider}-${Date.now()}`, method: 'POST', host, endpoint: sanitizeUrl(url, live.secrets), params: publicParams(url, body, live.secrets) };
  base.query = queryOf(base.params);
  if (providerDisabled(provider)) throw Object.assign(new Error(`${provider}: disabled after a key/credit error; skipped until the key or plan is fixed.`), { fatal: true });
  live({ phase: 'api_request', status: 'running', title: `POST ${host}`, message: `Querying ${provider}.`, publicUrl: url, detail: base });
  const started = Date.now();
  const fail = (message, httpStatus = null) => live({ phase: 'api_response', status: 'error', title: `Error from ${host}`, message, publicUrl: url, durationMs: Date.now() - started, detail: { ...base, httpStatus } });
  const attempts = 1 + clamp(retries ?? env.WEB_RETRIES, 0, 4, 2);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await sleep(Math.min(8000, 700 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250), signal);
    const timeout = AbortSignal.timeout(timeoutMs || clamp(env.WEB_TIMEOUT_MS, 10_000, 180_000, 90_000));
    let response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': env.RESEARCH_USER_AGENT || 'IGCOutreachResearch/1.0', ...headers },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      lastError = new Error(`${provider}: ${error.name === 'TimeoutError' ? 'timed out' : error.message || 'no response'}`);
      continue; // red o timeout: reintentar
    }
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      let detail = '';
      try { const j = JSON.parse(text); detail = String(j?.error || j?.message || j?.detail?.message || '').slice(0, 200); } catch { detail = text.replace(/\s+/g, ' ').slice(0, 200); }
      const human = HUMAN_ERROR[response.status] || `HTTP ${response.status}`;
      lastError = Object.assign(new Error(`${provider} HTTP ${response.status} (${human})${detail ? `: ${detail}` : ''}`), { status: response.status });
      if (FATAL_STATUS.has(response.status)) {
        disabledUntil.set(provider, Date.now() + clamp(env.WEB_BREAKER_MS, 60_000, 86_400_000, 15 * 60_000));
        fail(lastError.message, response.status);
        throw Object.assign(lastError, { fatal: true });
      }
      if (!RETRY_STATUS.has(response.status)) { fail(lastError.message, response.status); throw lastError; }
      const wait = Number(response.headers?.get?.('retry-after'));
      if (Number.isFinite(wait) && wait > 0 && wait <= 20) await sleep(wait * 1000, signal);
      continue;
    }
    if (Buffer.byteLength(text) > 20_000_000) { fail('Response too large.', response.status); throw new Error(`${provider} returned too large a response.`); }
    let data;
    try { data = JSON.parse(text); } catch { fail('Invalid JSON.', response.status); throw new Error(`${provider} returned invalid JSON.`); }
    // Firecrawl puede responder 200 con success:false (p. ej. timeout interno de la búsqueda).
    if (data && data.success === false) {
      lastError = new Error(`${provider}: ${String(data.error || data.message || 'request failed').slice(0, 200)}`);
      continue;
    }
    live({ phase: 'api_response', status: 'success', title: `HTTP ${response.status} · ${host}`, message: `${provider} responded in ${Date.now() - started} ms${attempt ? ` after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}` : ''}.`, publicUrl: url, durationMs: Date.now() - started, detail: { ...base, httpStatus: response.status, bytes: Buffer.byteLength(text), sample: safeSample(data, { secrets: live.secrets }), preview: previewRecords(data?.data?.web || data?.json?.people || [], { secrets: live.secrets }) } });
    record(url, data);
    return Object.assign(data, { __ms: Date.now() - started });
  }
  fail(lastError?.message || `${provider}: no response`, lastError?.status ?? null);
  throw lastError || new Error(`${provider}: no response`);
}

/** Firecrawl v2 /search. Con markdown=true también lee cada página. */
export async function firecrawlSearch(query, { limit = 5, markdown = false, tbs = '', sources = ['web'], env = process.env, fetcher = fetch, signal, live, record } = {}) {
  if (!firecrawlKey(env)) throw new Error('FIRECRAWL_API_KEY not set.');
  const body = { query: String(query).slice(0, 480), limit: clamp(limit, 1, 20, 5), sources: sources.filter((x) => ['web', 'news'].includes(x)) };
  if (!body.sources.length) body.sources = ['web'];
  // tbs según la documentación de Firecrawl v2: qdr:d|w|m|y o cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY.
  if (tbs && /^(qdr:[hdwmy]|cdr:1,cd_min:\d{1,2}\/\d{1,2}\/\d{4},cd_max:\d{1,2}\/\d{1,2}\/\d{4}|sbd:1)$/.test(tbs)) body.tbs = tbs;
  body.ignoreInvalidURLs = true;
  // Firecrawl corta la búsqueda a los 60 s por defecto; con scrape de cada resultado se queda corto.
  body.timeout = clamp(env.FIRECRAWL_SEARCH_TIMEOUT_MS, 10_000, 170_000, markdown ? 85_000 : 30_000);
  if (markdown) body.scrapeOptions = { formats: ['markdown'], onlyMainContent: true, timeout: clamp(env.FIRECRAWL_SCRAPE_TIMEOUT_MS, 5_000, 60_000, 25_000) };
  const data = await callApi({ provider: 'Firecrawl', host: 'api.firecrawl.dev', url: `${FIRECRAWL_URL}/search`, headers: { Authorization: `Bearer ${firecrawlKey(env)}` }, body, env, fetcher, signal, live, record, timeoutMs: body.timeout + 10_000 });
  const web = Array.isArray(data?.data?.web) ? data.data.web : Array.isArray(data?.data) ? data.data : [];
  const news = Array.isArray(data?.data?.news) ? data.data.news : [];
  const seen = new Set();
  const rows = [...web, ...news].map((r) => ({ url: safeUrl(r.url || r.metadata?.url || r.metadata?.sourceURL), title: String(r.title || r.metadata?.title || ''), description: String(r.description || r.snippet || r.metadata?.description || ''), markdown: typeof r.markdown === 'string' ? r.markdown : '', date: String(r.date || r.metadata?.publishedTime || r.metadata?.['article:published_time'] || ''), statusCode: Number(r.metadata?.statusCode) || null }))
    .filter((r) => r.url && !seen.has(r.url) && seen.add(r.url) && !(r.statusCode && r.statusCode >= 400 && !r.markdown));
  return Object.assign(rows, { ms: data.__ms || 0, credits: Number(data.creditsUsed) || 0 });
}

/** Firecrawl v2 /scrape: una URL → markdown. Respaldo cuando la búsqueda no trajo el contenido. Nunca lanza. */
export async function firecrawlScrape(url, { env = process.env, fetcher = fetch, signal, live, record } = {}) {
  if (!firecrawlKey(env) || !safeUrl(url) || BLOCKED_HOSTS.test(hostOf(url))) return null;
  try {
    const data = await callApi({ provider: 'Firecrawl', host: 'api.firecrawl.dev', url: `${FIRECRAWL_URL}/scrape`, headers: { Authorization: `Bearer ${firecrawlKey(env)}` }, body: { url, formats: ['markdown'], onlyMainContent: true, timeout: clamp(env.FIRECRAWL_SCRAPE_TIMEOUT_MS, 5_000, 60_000, 25_000) }, env, fetcher, signal, live, record, retries: 1, timeoutMs: 45_000 });
    const d = data?.data || {};
    const markdown = typeof d.markdown === 'string' ? d.markdown : '';
    return markdown.length > 80 ? { url: safeUrl(d.metadata?.sourceURL || d.metadata?.url) || url, title: String(d.metadata?.title || ''), markdown, text: markdown } : null;
  } catch { return null; }
}

/**
 * Firecrawl v2 /scrape con formato JSON: la página se descarga (con JavaScript si hace falta), se limpia y un modelo
 * del proveedor devuelve fases/fechas/elegibilidad con cita. Devuelve {json, markdown, credits, ms}; si falla, {error, fatal?} (o null sin clave o host bloqueado); nunca lanza.
 * La respuesta es dato NO confiable: extract.mjs comprueba cada cita contra el markdown antes de usarla.
 * Coste: la extracción JSON gasta más créditos que un scrape normal (ver el plan de Firecrawl); por eso el motor la pide
 * solo para candidatas y con tope (ENGINE_EXTRACT_MAX).
 */
export async function firecrawlExtract(url, { env = process.env, fetcher = fetch, signal, live, record } = {}) {
  if (!firecrawlKey(env) || !safeUrl(url) || BLOCKED_HOSTS.test(hostOf(url))) return null;
  try {
    const timeout = clamp(env.FIRECRAWL_EXTRACT_TIMEOUT_MS, 10_000, 120_000, 50_000);
    const body = { url, formats: ['markdown', { type: 'json', schema: EXTRACT_SCHEMA, prompt: EXTRACT_PROMPT }], onlyMainContent: env.FIRECRAWL_EXTRACT_MAIN_ONLY === '1', timeout };
    const data = await callApi({ provider: 'Firecrawl', host: 'api.firecrawl.dev', url: `${FIRECRAWL_URL}/scrape`, headers: { Authorization: `Bearer ${firecrawlKey(env)}` }, body, env, fetcher, signal, live, record, retries: 1, timeoutMs: timeout + 15_000 });
    const d = data?.data || {};
    const json = d.json && typeof d.json === 'object' ? d.json : d.extract && typeof d.extract === 'object' ? d.extract : null;
    const markdown = typeof d.markdown === 'string' ? d.markdown : '';
    if (!json) return { error: `Firecrawl answered without JSON (keys: ${Object.keys(d).slice(0, 6).join(', ') || 'none'})` };
    return { json, markdown, credits: Number(data.creditsUsed ?? d.metadata?.creditsUsed) || 0, ms: data.__ms || 0 };
  } catch (error) { return { error: String(error.message || error).slice(0, 200), ...(error?.fatal ? { fatal: true } : {}) }; }
}

/** Varias búsquedas; una que falla no tumba las demás. Devuelve {results, errors, calls, ms}. */
export async function firecrawlSearchMany(queries, options = {}) {
  const results = []; const errors = []; let ms = 0; let calls = 0;
  for (const query of queries) {
    try {
      calls++;
      const rows = await firecrawlSearch(query, options);
      ms += rows.ms || 0;
      results.push(...rows.map((row) => ({ ...row, query })));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      errors.push(`${String(query).slice(0, 80)}: ${error.message}`);
      if (error.fatal) break; // sin créditos o clave inválida: no seguir gastando llamadas
    }
  }
  return { results, errors, calls, ms };
}

const opportunityType = (text) => /challenge|competition/i.test(text) ? 'challenge' : /prize|award/i.test(text) ? 'prize' : /accelerator|incubator|cohort/i.test(text) ? 'accelerator' : /fellowship/i.test(text) ? 'fellowship' : 'open_call';
const opportunityDate = (text) => {
  const months = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const matches = [...String(text).matchAll(new RegExp(`(?:apply by|deadline|applications? close(?:s)?|closing)\\s*(?:on\\s*)?([0-9]{1,2}\\s+(?:${months})\\s+20[2-9][0-9]|(?:${months})\\s+[0-9]{1,2}(?:st|nd|rd|th)?[,]?\\s+20[2-9][0-9])`, 'ig'))];
  for (const match of matches) { const date = new Date(match[1].replace(/(\d)(st|nd|rd|th)/i, '$1')); if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10); }
  return null;
};
const opportunityExcerpt = (text) => {
  const clean = String(text || '').replace(/[#*_>`|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const at = clean.search(/apply|application|challenge|competition|prize|accelerator|open call/i);
  return clean.slice(Math.max(0, at < 0 ? 0 : at - 120), Math.max(500, at + 700)).slice(0, 900);
};

/** Discovery amplio de challenges, prizes y aceleradoras. Solo Firecrawl search; no ScrapeGraph. */
export async function grantWebOpportunities(brief, plan, { env = process.env, fetcher = fetch, signal, live = noopRecorder, record = () => {}, usageClient = null } = {}) {
  if (!firecrawlConfigured(env)) return Object.assign([], { searchAudit: [] });
  const focus = focusOf(brief);
  const year = new Date().getFullYear();
  const terms = [...new Set((plan.terms || []).map((x) => x.term).filter(Boolean))];
  const queries = [
    `${focus} startup challenge prize competition applications open ${year}`,
    `${focus} startup accelerator innovation program non-dilutive funding apply ${year}`,
    `${terms[1] || focus} early stage startup open call global prize`,
  ].slice(0, clamp(env.GRANT_WEB_MAX_SEARCHES, 1, 5, 3));
  const seen = new Map();
  const audit = [];
  const pageText = new Map();
  const searchErrors = [];
  for (const query of queries) {
    let results = [];
    try { results = await firecrawlSearch(query, { limit: clamp(env.GRANT_WEB_RESULTS_PER_QUERY, 3, 10, 6), markdown: true, env, fetcher, signal, live, record }); }
    catch (error) { if (signal?.aborted) throw error; searchErrors.push(error.message); audit.push({ provider: GRANT_WEB_SOURCE, query, dimension: 'opportunity_type', returned: 0, discovered: 0, error: error.message }); if (error.fatal) break; continue; }
    let accepted = 0;
    for (const result of results) {
      const hay = `${result.title} ${result.description} ${result.markdown}`;
      if (!/(apply|applications?|challenge|competition|prize|accelerator|incubator|fellowship|open call|startup call)/i.test(hay)) continue;
      if (BLOCKED_HOSTS.test(hostOf(result.url))) continue;
      const excerpt = opportunityExcerpt(result.markdown || result.description);
      if (excerpt.length < 80) continue;
      const host = hostOf(result.url).replace(/^www\./, '');
      // Sin modelo, el código verifica lo que puede (tipo de página, plazo contra hoy, elegibilidad); nunca "open" por defecto.
      const v = verifyOpportunity({}, { url: result.url, title: result.title, text: result.markdown || result.description || '' }, { brief, codeOnly: true });
      const deadline = v.deadline;
      const ev = [evidence(`${GRANT_WEB_SOURCE} · ${host}`, result.url, excerpt, 'opportunity')];
      if (v.deadline && v.deadlineQuote) ev.push(evidence(`${GRANT_WEB_SOURCE} · deadline quote`, result.url, v.deadlineQuote, 'opportunity'));
      const lead = candidate({
        externalId: `web-opportunity:${result.url}`,
        org: host,
        title: result.title || `${opportunityType(hay)} opportunity`,
        kind: 'opportunity', fundingType: 'grant', opportunityType: opportunityType(hay),
        status: v.status,
        deadline,
        codeCheck: compactVerification(v),   // verificación solo-código; `verification` queda para la lectura con modelo
        contact: { type: 'source', value: result.url, provenance: 'Official or first-party opportunity page found by web search; verify before applying' },
        evidence: ev,
        risks: ['Open-web opportunity: confirm organizer, eligibility, terms and whether the benefit is cash, equity or access'],
        missing: [...(deadline ? [] : ['Application deadline not confirmed']), 'Eligibility and program terms to confirm'],
        searchText: hay.slice(0, 8000),
        foundBy: [{ provider: GRANT_WEB_SOURCE, term: focus, objective: 'grant', query, dimension: 'opportunity_type' }],
      });
      if (!seen.has(result.url)) { seen.set(result.url, lead); pageText.set(result.url, { url: result.url, title: result.title, text: result.markdown || result.description }); accepted++; }
    }
    audit.push({ provider: GRANT_WEB_SOURCE, query, dimension: 'opportunity_type', returned: results.length, discovered: accepted });
  }
  usageClient?.track?.('Firecrawl', { calls: queries.length, results: seen.size });
  if (!seen.size && searchErrors.length === queries.length) throw new Error(searchErrors[0]);
  // Lectura con el modelo de la flota + verificación en código (solo con GRANT_WEB_READ=1 y flota configurada).
  if (env.GRANT_WEB_READ === '1' && seen.size) {
    const urls = [...seen.keys()].slice(0, clamp(env.GRANT_WEB_READ_MAX, 1, 40, 18));
    const reads = await readMany(urls.map((u) => pageText.get(u)), brief, { env, fetcher, signal });
    const dropped = {};
    urls.forEach((url, i) => {
      const r = reads[i];
      if (!r || r.read === false) return; // sin flota o página no leída: el lead queda como estaba
      const lead = seen.get(url);
      if (!r.keep) { seen.delete(url); dropped[r.drop] = (dropped[r.drop] || 0) + 1; return; }
      lead.status = r.status === 'unknown' ? 'unknown' : r.status;
      lead.deadline = r.deadline;
      lead.missing = [...(r.deadline ? [] : ['Application deadline not confirmed on the page']), ...(r.eligible === 'yes' ? [] : ['Eligibility to confirm'])];
      lead.verification = compactVerification(r, { nonDilutive: r.nonDilutive, quotes: r.quotes, model: r.model });
      if (r.quotes.deadline) lead.evidence.push(evidence(`${GRANT_WEB_SOURCE} · deadline quote`, url, r.quotes.deadline, 'opportunity'));
    });
    audit.push({ provider: GRANT_WEB_SOURCE, query: '(page reading)', dimension: 'verification', returned: urls.length, discovered: seen.size, dropped });
  }
  return Object.assign([...seen.values()].slice(0, 18), { searchAudit: audit });
}

/** ScrapeGraph v2 /extract sobre el markdown que ya leyó Firecrawl (o sobre una URL). */
export async function scrapegraphExtract({ markdown, url, prompt, schema }, { env = process.env, fetcher = fetch, signal, live, record } = {}) {
  if (!scrapegraphKey(env)) throw new Error('SGAI_API_KEY not set.');
  const body = { prompt, ...(schema ? { schema } : {}), ...(markdown ? { markdown: String(markdown).slice(0, 150_000) } : { url }) };
  const data = await callApi({ provider: 'ScrapeGraph', host: 'v2-api.scrapegraphai.com', url: `${SCRAPEGRAPH_URL}/extract`, headers: { 'SGAI-APIKEY': scrapegraphKey(env) }, body, env, fetcher, signal, live, record });
  return data?.json ?? data?.result ?? null;
}

const PEOPLE_SCHEMA = {
  type: 'object',
  properties: {
    organization: { type: 'string', description: 'Organization that owns the page (fund, company, university).' },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string', description: 'Current role as shown.' },
          organization: { type: 'string' },
          affiliations: { type: 'array', items: { type: 'string' }, description: 'Other organizations mentioned for this person: past jobs, universities, boards, portfolio.' },
          email: { type: 'string' },
          linkedin_url: { type: 'string' },
          relation: { type: 'string', description: 'Only if asked: relationship to the reference person (co-author, co-founder, colleague, panelist, board...).' },
        },
        required: ['name'],
      },
    },
  },
  required: ['people'],
};

const literalIn = (text, value) => { const n = norm(value); return n.length >= 3 && norm(text).includes(n); };
/** Cita literal de la página alrededor del nombre: evita citas inventadas por el LLM. */
export function quoteAround(markdown, name, radius = 220) {
  const text = String(markdown || '').replace(/\s+/g, ' ');
  const parts = String(name || '').trim().split(/\s+/).filter((p) => p.length > 1);
  if (!parts.length) return '';
  let at = text.toLowerCase().indexOf(String(name).toLowerCase());
  if (at < 0) at = text.toLowerCase().indexOf(parts.at(-1).toLowerCase());
  if (at < 0) return '';
  return text.slice(Math.max(0, at - radius), at + name.length + radius).trim();
}
const linkedinProfile = (value) => {
  const url = safeUrl(value);
  if (!url) return null;
  const u = new URL(url);
  const handle = /(^|\.)linkedin\.com$/i.test(u.hostname) ? u.pathname.match(/^\/in\/([^/]+)/i)?.[1] : null;
  return handle ? `https://www.linkedin.com/in/${handle}/` : null;
};

/** Personas extraídas por ScrapeGraph, filtradas contra el texto real de la página. */
export function verifiedPeople(extracted, page) {
  const people = Array.isArray(extracted?.people) ? extracted.people : [];
  const md = page.markdown || '';
  return people.flatMap((p) => {
    const name = String(p?.name || '').trim();
    if (!name || name.split(/\s+/).length < 2 || !literalIn(md, name)) return [];
    const quote = quoteAround(md, name);
    if (!quote) return [];
    const org = String(p.organization || extracted.organization || '').trim();
    const title = String(p.title || '').trim();
    const affiliations = [...new Set((Array.isArray(p.affiliations) ? p.affiliations : []).map((a) => String(a).trim()).filter((a) => a && literalIn(md, a)))].slice(0, 12);
    const linkedin = linkedinProfile(p.linkedin_url);
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email || '')) && md.includes(p.email) ? p.email : '';
    return [{ name, title: literalIn(md, title) ? title : '', org, affiliations, linkedin: linkedin && md.includes(linkedin.replace(/\/$/, '').split('/in/')[1]) ? linkedin : null, email, relation: String(p.relation || '').trim(), url: page.url, pageTitle: page.title, quote }];
  });
}

const focusOf = (brief) => {
  const industry = String(brief.industry || brief.product || '').trim();
  if (/mental\s+health/i.test(industry)) return 'mental health';
  if (/digital\s+health/i.test(industry)) return 'digital health';
  return industry.split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
};
export function webDiscoveryQueries(brief) {
  const focus = focusOf(brief);
  const stage = String(brief.stage || '').replace(/-/g, ' ');
  if (brief.fundingTypes.includes('investment')) return [`${focus} venture capital fund team partners ${stage}`.trim(), `${focus} ${stage} investors portfolio team`.trim()];
  if (brief.fundingTypes.includes('debt')) return [`${focus} venture debt lender team`];
  return [`${focus} business development licensing partnerships team`];
}
const ROLE = {
  investment: /partner|principal|investor|invest|venture|angel|associate|managing director|founder|gp\b|general partner|fund/i,
  debt: /debt|credit|lending|partner|principal|director/i,
  partnering: /business development|licens|partner|alliance|corporate development|search|evaluation|director|head/i,
};

export function webLeads(people, brief) {
  const type = brief.fundingTypes.includes('partnering') ? 'partnering' : brief.fundingTypes.includes('investment') ? 'investment' : brief.fundingTypes.includes('debt') ? 'debt' : brief.fundingTypes[0];
  const roleRe = ROLE[type] || ROLE.investment;
  return people.filter((p) => !p.title || roleRe.test(p.title)).map((p) => {
    const ev = evidence(`${WEB_SOURCE} · ${hostOf(p.url)}`, p.url, p.quote, 'profile');
    const contact = p.email
      ? { type: 'email', value: p.email, provenance: `Email published on ${hostOf(p.url)}` }
      : p.linkedin
        ? { type: 'linkedin', value: p.linkedin, provenance: `Link published on ${hostOf(p.url)}` }
        : { type: 'web', value: p.url, provenance: `Public page ${hostOf(p.url)}` };
    return candidate({
      externalId: `web:${norm(p.name)}:${norm(p.org)}`,
      person: p.name,
      role: p.title || null,
      org: p.org || hostOf(p.url),
      title: p.title ? `${p.title} on ${p.org || hostOf(p.url)}` : `Appears on ${p.org || hostOf(p.url)}`,
      kind: 'person',
      fundingType: type,
      status: 'unknown',
      contact,
      affiliations: p.affiliations,
      evidence: [ev],
      risks: ['Person from a public page; confirm the role is current'],
      missing: [...(p.title ? [] : ['Role not confirmed on the page']), 'Funding or partnering authority not confirmed', ...(p.email ? [] : ['No public email'])],
      searchText: `${p.title} ${p.org} ${p.affiliations.join(' ')} ${p.pageTitle} ${brief.industry}`,
    });
  });
}

/** Extrae y verifica personas desde páginas ya leídas. Compartido por discovery y follow-up. */
export async function peopleFromPages(pages, brief, { env = process.env, fetcher = fetch, signal, record, live = noopRecorder, maxPeople = 20, parent = null, usageClient = null } = {}) {
  const people = [];
  const errors = [];
  for (const page of pages) {
    try {
      const started = Date.now();
      const extracted = await scrapegraphExtract({ markdown: page.markdown, prompt: 'Extract the team members on this page (investors, partners, principals, directors, business development) with role, organization, other affiliations mentioned, and email and LinkedIn link only if they appear literally.', schema: PEOPLE_SCHEMA }, { env, fetcher, signal, live, record });
      usageClient?.track?.('ScrapeGraph', { calls: 1, results: Array.isArray(extracted?.people) ? extracted.people.length : 0, ms: Date.now() - started, bytes: Buffer.byteLength(page.markdown || '') });
      people.push(...verifiedPeople(extracted, page));
    } catch (error) { errors.push(`${hostOf(page.url)}: ${error.message}`); }
    if (people.length >= maxPeople) break;
  }
  const unique = [...new Map(people.map((person) => [`${norm(person.name)}|${norm(person.org)}`, person])).values()].slice(0, maxPeople);
  const leads = webLeads(unique, brief).map((lead) => ({
    ...lead,
    ...(parent ? { parentKey: parent.parentKey, followUp: { from: parent.org, question: `Who decides at ${parent.org}?` } } : {}),
    foundBy: [...(lead.foundBy || []), { provider: parent ? 'Follow-up: funder → people' : WEB_SOURCE, term: parent?.term || '', objective: lead.fundingType, query: parent?.query || '' }],
  }));
  return { people: unique, leads, errors };
}

/** Descubre personas decisoras en páginas públicas de fondos/empresas. Reemplaza apifyPeople. */
export async function webPeople(leads, brief, { env = process.env, fetcher = fetch, signal, record, live = noopRecorder, usageClient = null } = {}) {
  if (!brief.fundingTypes.some((t) => ['investment', 'debt', 'partnering'].includes(t))) return { queries: [], pages: 0, leads: [] };
  const maxPages = clamp(env.WEB_MAX_PAGES, 1, 10, 4);
  const maxPeople = clamp(env.WEB_MAX_PEOPLE, 1, 50, 20);
  const queries = webDiscoveryQueries(brief);
  const pages = new Map();
  const found = await firecrawlSearchMany(queries, { limit: Math.min(10, maxPages + 2), markdown: true, env, fetcher, signal, live, record });
  const thin = [];
  for (const r of found.results) {
    if (BLOCKED_HOSTS.test(hostOf(r.url)) || pages.has(r.url) || pages.size >= maxPages) continue;
    if (r.markdown.length > 200) pages.set(r.url, r); else thin.push(r);
  }
  // Búsqueda sin contenido (scrape fallido o página con JS): se lee la página con /scrape.
  for (const r of thin) {
    if (pages.size >= maxPages) break;
    const got = await firecrawlScrape(r.url, { env, fetcher, signal, live, record });
    if (got && got.markdown.length > 200) pages.set(r.url, { ...r, markdown: got.markdown, title: r.title || got.title });
  }
  usageClient?.track?.('Firecrawl', { calls: found.calls, results: pages.size, ms: found.ms });
  if (!pages.size && found.errors.length) throw new Error(found.errors.join('; '));
  const extracted = await peopleFromPages([...pages.values()].slice(0, maxPages), brief, { env, fetcher, signal, record, live, maxPeople, usageClient });
  if (!extracted.people.length && extracted.errors.length && extracted.errors.length === pages.size) throw new Error(extracted.errors.join('; '));
  return { queries, pages: pages.size, errors: [...found.errors, ...extracted.errors], leads: extracted.leads };
}

const handleOf = (url) => { try { return decodeURIComponent(new URL(url).pathname.match(/^\/in\/([^/]+)/i)?.[1] || '').toLowerCase(); } catch { return ''; } };
/** "gisel-caicedo-4a1b2c" → "gisel caicedo" (quita el sufijo aleatorio que LinkedIn añade). */
const handleWords = (handle) => handle.split(/[-_.]+/).filter((w) => w && !/\d/.test(w)).join(' ');
const parseProfileTitle = (title, description = '') => {
  const clean = String(title || '').replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/\s*[-–—]\s*LinkedIn\s*$/i, '').trim();
  const [name, ...rest] = clean.split(/\s+[-–—]\s+/);
  const headline = rest.join(' – ').trim();
  const orgMatch = headline.match(/^(.+?)\s+(?:at|en|@|[-–—])\s+(.+)$/i);
  return { name: String(name || '').trim(), headline: headline || String(description || '').slice(0, 160), role: String(orgMatch?.[1] || headline || '').trim(), organization: String(orgMatch?.[2] || rest.at(-1) || '').trim() };
};

/** Exa sí tiene perfiles de LinkedIn indexados: /contents con la URL exacta, y si no, búsqueda por el handle. */
async function exaProfile(url, handle, { env, fetcher, signal }) {
  if (!env.EXA_API_KEY) return null;
  const post = async (endpoint, body) => {
    const timeout = AbortSignal.timeout(30_000);
    const r = await fetcher(`https://api.exa.ai/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.EXA_API_KEY}` }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!r.ok) throw new Error(`Exa HTTP ${r.status}`);
    return r.json();
  };
  const pick = (results) => (Array.isArray(results) ? results : []).find((r) => handleOf(r.url || r.id) === handle && r.title);
  try { const hit = pick((await post('contents', { urls: [url], text: { maxCharacters: 500 } }))?.results); if (hit) return hit; } catch { /* sigue con la búsqueda */ }
  try { return pick((await post('search', { query: `linkedin.com/in/${handle}`, type: 'auto', numResults: 5, includeDomains: ['linkedin.com'] }))?.results) || null; } catch { return null; }
}

/** Perfil público a partir de resultados de búsqueda (sin raspar LinkedIn). Prueba varias consultas y Exa antes de rendirse. */
export async function webProfileLookup(profileUrl, { env = process.env, fetcher = fetch, signal, name = '', org = '' } = {}) {
  const raw = String(profileUrl || '').trim();
  const url = linkedinProfile(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!url || !/^\/in\/[^/]+\/?$/i.test(new URL(url).pathname)) throw new Error('Paste a valid profile link, e.g. linkedin.com/in/your-profile.');
  const handle = handleOf(url);
  const words = handleWords(handle);
  const known = String(name || '').trim().split(/\s+/).length >= 2 ? String(name).trim() : '';
  const queries = [...new Set([
    `linkedin.com/in/${handle}`,
    `site:linkedin.com/in/${handle}`,
    ...(known ? [`"${known}" ${org} site:linkedin.com/in`.replace(/\s+/g, ' ').trim()] : []),
    ...(words && words !== handle ? [`${words} site:linkedin.com/in`] : []),
  ])];
  let hit = null;
  const errors = [];
  for (const query of queries) {
    try {
      const results = await firecrawlSearch(query, { limit: 8, env, fetcher, signal });
      hit = results.find((r) => handleOf(r.url) === handle && r.title);
      if (hit) break;
    } catch (error) { errors.push(error.message); }
  }
  let source = 'Public search result (Firecrawl)';
  if (!hit) { hit = await exaProfile(url, handle, { env, fetcher, signal }); source = 'Public profile index (Exa)'; }
  if (!hit) {
    const detail = errors.length === queries.length ? ` (${errors[0]})` : '';
    throw new Error(`We couldn't find that profile publicly. Enter your name and role manually.${detail}`);
  }
  return { linkedinUrl: url, ...parseProfileTitle(hit.title, hit.description || hit.text || ''), location: '', verifiedAt: new Date().toISOString(), source };
}

/** Relaciones públicas: personas que aparecen junto a ti en artículos, papers, paneles, equipos o juntas. */
export async function webPublicRelations(profileUrl, { env = process.env, fetcher = fetch, signal, name = '', org = '' } = {}) {
  const owner = String(name || '').trim();
  if (!owner) throw new Error('Your name is needed to search public relationships.');
  const maxPages = clamp(env.WEB_RELATION_MAX_PAGES, 1, 15, 6);
  const queries = [`"${owner}" ${org}`.trim(), `"${owner}" cofounder OR coauthor OR panel OR board`];
  const pages = new Map();
  const errors = [];
  for (const query of queries) {
    try {
      const results = await firecrawlSearch(query, { limit: maxPages, markdown: true, env, fetcher, signal });
      for (const r of results) if (!BLOCKED_HOSTS.test(hostOf(r.url)) && literalIn(r.markdown, owner) && !pages.has(r.url)) pages.set(r.url, r);
    } catch (error) { errors.push(`search: ${error.message}`); }
  }
  const people = new Map();
  for (const page of [...pages.values()].slice(0, maxPages)) {
    try {
      const extracted = await scrapegraphExtract({ markdown: page.markdown, prompt: `List the people (other than ${owner}) on this page directly related to ${owner}: co-founders, co-authors, teammates, co-panelists, board members, mentors or investors. Put the relationship in "relation". Include role and organization if shown.`, schema: PEOPLE_SCHEMA }, { env, fetcher, signal });
      for (const p of verifiedPeople(extracted, page)) {
        if (norm(p.name) === norm(owner)) continue;
        const key = p.linkedin || norm(p.name);
        const current = people.get(key) || { name: p.name, org: p.org, role: p.title, url: p.linkedin || '', connectedOn: '', source: 'web_public_relation', relation: p.relation, affiliations: [], interactions: { comments: 0, reactions: 0, authoredComments: 0, authoredReactions: 0, receivedComments: 0, receivedReactions: 0, lastAt: null, urls: [] }, quotes: [] };
        current.org ||= p.org; current.role ||= p.title; current.relation ||= p.relation;
        current.affiliations = [...new Set([...current.affiliations, ...p.affiliations])].slice(0, 12);
        if (!current.interactions.urls.includes(p.url)) current.interactions.urls.push(p.url);
        current.quotes.push(p.quote.slice(0, 400));
        people.set(key, current);
      }
    } catch (error) { errors.push(`${hostOf(page.url)}: ${error.message}`); }
  }
  const strong = /co-?found|cofundador|co-?author|coautor|board|junta|colleague|colega|team|equipo|mentor|advisor|asesor/i;
  const connections = [...people.values()].map((p) => ({ ...p, strength: Math.min(0.8, (strong.test(p.relation) ? 0.5 : 0.3) + 0.1 * (p.interactions.urls.length - 1)), quotes: p.quotes.slice(0, 3) })).sort((a, b) => b.strength - a.strength);
  if (!connections.length && errors.length && !pages.size) throw new Error(errors.join('; '));
  return { actor: WEB_SOURCE, actors: [WEB_SOURCE], connections, posts: pages.size, items: pages.size, errors };
}

/**
 * Módulo 3: publicaciones públicas de LinkedIn de una persona (posts/artículos), para saber de qué habla y
 * a quién le habla. Solo páginas que Google/Firecrawl ya indexan como públicas (linkedin.com/posts/... o
 * /pulse/...) — nunca login, cookie ni "conexiones"; si el buscador no la indexa, no aparece nada (igual que
 * el resto de "relaciones públicas"). Devuelve el texto para indexar en voice.mjs, no una lista de personas.
 */
export async function linkedinPublicContent(personName, { env = process.env, fetcher = fetch, signal, org = '', maxPages } = {}) {
  const owner = String(personName || '').trim();
  if (!owner) throw new Error('The person\'s name is needed to search their posts.');
  const cap = clamp(maxPages ?? env.WEB_LINKEDIN_MAX_PAGES, 1, 15, 6);
  const queries = [
    `"${owner}" ${org} site:linkedin.com/posts`.trim(),
    `"${owner}" ${org} site:linkedin.com/pulse`.trim(),
  ];
  const isPublicPost = (url) => /linkedin\.com\/(posts|pulse)\//i.test(url || '');
  const pages = new Map();
  const errors = [];
  for (const query of queries) {
    try {
      const results = await firecrawlSearch(query, { limit: cap, markdown: true, env, fetcher, signal });
      for (const r of results) if (isPublicPost(r.url) && literalIn(r.markdown, owner) && !pages.has(r.url)) pages.set(r.url, r);
    } catch (error) { errors.push(`search: ${error.message}`); }
  }
  const posts = [...pages.values()].slice(0, cap).map((page) => ({
    url: page.url,
    title: page.title || `Post by ${owner} on LinkedIn`,
    published: page.date || null,
    text: page.markdown,
  }));
  if (!posts.length && errors.length && errors.length === queries.length) throw new Error(errors.join('; '));
  return { actor: 'Firecrawl (public LinkedIn posts)', posts, errors };
}
