// Búsqueda y extracción web con Firecrawl (buscar + leer páginas) y ScrapeGraph (extraer personas).
// Reemplaza a Apify. No toca LinkedIn con scraping: solo usa resultados de búsqueda públicos.
import { candidate, evidence, norm, safeUrl } from './core.mjs';
import { noopRecorder, previewRecords, publicParams, queryOf, safeSample, sanitizeUrl } from './liveRun.mjs';

export const FIRECRAWL_URL = 'https://api.firecrawl.dev/v2';
export const SCRAPEGRAPH_URL = 'https://v2-api.scrapegraphai.com/api';
export const WEB_SOURCE = 'Firecrawl + ScrapeGraph';

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
};
const firecrawlKey = (env) => env.FIRECRAWL_API_KEY || '';
const scrapegraphKey = (env) => env.SGAI_API_KEY || env.SCRAPEGRAPH_API_KEY || '';
export const webConfigured = (env = process.env) => Boolean(firecrawlKey(env) && scrapegraphKey(env));
export const webMissing = (env = process.env) => [
  ...(firecrawlKey(env) ? [] : ['FIRECRAWL_API_KEY']),
  ...(scrapegraphKey(env) ? [] : ['SGAI_API_KEY']),
];

const BLOCKED_HOSTS = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|crunchbase\.com|pitchbook\.com|glassdoor\.com|zoominfo\.com|rocketreach\.co|apollo\.io)$/i;
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

async function callApi({ provider, host, url, headers, body, env, fetcher, signal, live = noopRecorder, record = () => {}, timeoutMs }) {
  const base = { kind: 'api', callId: `${provider}-${Date.now()}`, method: 'POST', host, endpoint: sanitizeUrl(url, live.secrets), params: publicParams(url, body, live.secrets) };
  base.query = queryOf(base.params);
  live({ phase: 'api_request', status: 'running', title: `POST ${host}`, message: `Querying ${provider}.`, publicUrl: url, detail: base });
  const started = Date.now();
  const fail = (message, httpStatus = null) => live({ phase: 'api_response', status: 'error', title: `Error from ${host}`, message, publicUrl: url, durationMs: Date.now() - started, detail: { ...base, httpStatus } });
  const timeout = AbortSignal.timeout(timeoutMs || clamp(env.WEB_TIMEOUT_MS, 10_000, 180_000, 90_000));
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': env.RESEARCH_USER_AGENT || 'IGCOutreachResearch/1.0', ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) { fail(error.message || `No response from ${provider}.`); throw new Error(`${provider}: ${error.message || 'no response'}`); }
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    fail(`${provider} HTTP ${response.status}`, response.status);
    throw new Error(`${provider} HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  if (Buffer.byteLength(text) > 20_000_000) { fail('Response too large.', response.status); throw new Error(`${provider} returned too large a response.`); }
  let data;
  try { data = JSON.parse(text); } catch { fail('Invalid JSON.', response.status); throw new Error(`${provider} returned invalid JSON.`); }
  live({ phase: 'api_response', status: 'success', title: `HTTP ${response.status} · ${host}`, message: `${provider} responded in ${Date.now() - started} ms.`, publicUrl: url, durationMs: Date.now() - started, detail: { ...base, httpStatus: response.status, bytes: Buffer.byteLength(text), sample: safeSample(data, { secrets: live.secrets }), preview: previewRecords(data?.data?.web || data?.json?.people || [], { secrets: live.secrets }) } });
  record(url, data);
  return data;
}

/** Firecrawl v2 /search. Con markdown=true también lee cada página. */
export async function firecrawlSearch(query, { limit = 5, markdown = false, tbs = '', sources = ['web'], env = process.env, fetcher = fetch, signal, live, record } = {}) {
  if (!firecrawlKey(env)) throw new Error('FIRECRAWL_API_KEY not set.');
  const body = { query: String(query).slice(0, 480), limit: clamp(limit, 1, 20, 5), sources: sources.filter((x) => ['web', 'news'].includes(x)) };
  if (!body.sources.length) body.sources = ['web'];
  // tbs según la documentación de Firecrawl v2: qdr:d|w|m|y o cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY.
  if (tbs && /^(qdr:[hdwmy]|cdr:1,cd_min:\d{1,2}\/\d{1,2}\/\d{4},cd_max:\d{1,2}\/\d{1,2}\/\d{4}|sbd:1)$/.test(tbs)) body.tbs = tbs;
  if (markdown) body.scrapeOptions = { formats: ['markdown'], onlyMainContent: true };
  const data = await callApi({ provider: 'Firecrawl', host: 'api.firecrawl.dev', url: `${FIRECRAWL_URL}/search`, headers: { Authorization: `Bearer ${firecrawlKey(env)}` }, body, env, fetcher, signal, live, record });
  const web = Array.isArray(data?.data?.web) ? data.data.web : Array.isArray(data?.data) ? data.data : [];
  const news = Array.isArray(data?.data?.news) ? data.data.news : [];
  return [...web, ...news].map((r) => ({ url: safeUrl(r.url || r.metadata?.url || r.metadata?.sourceURL), title: String(r.title || r.metadata?.title || ''), description: String(r.description || r.snippet || r.metadata?.description || ''), markdown: String(r.markdown || ''), date: String(r.date || r.metadata?.publishedTime || r.metadata?.['article:published_time'] || '') })).filter((r) => r.url);
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

/** Descubre personas decisoras en páginas públicas de fondos/empresas. Reemplaza apifyPeople. */
export async function webPeople(leads, brief, { env = process.env, fetcher = fetch, signal, record, live = noopRecorder } = {}) {
  if (!brief.fundingTypes.some((t) => ['investment', 'debt', 'partnering'].includes(t))) return { queries: [], pages: 0, leads: [] };
  const maxPages = clamp(env.WEB_MAX_PAGES, 1, 10, 4);
  const maxPeople = clamp(env.WEB_MAX_PEOPLE, 1, 50, 20);
  const queries = webDiscoveryQueries(brief);
  const pages = new Map();
  for (const query of queries) {
    const results = await firecrawlSearch(query, { limit: maxPages, markdown: true, env, fetcher, signal, live, record });
    for (const r of results) if (!BLOCKED_HOSTS.test(hostOf(r.url)) && r.markdown.length > 200 && !pages.has(r.url)) pages.set(r.url, r);
    if (pages.size >= maxPages) break;
  }
  const people = [];
  const errors = [];
  for (const page of [...pages.values()].slice(0, maxPages)) {
    try {
      const extracted = await scrapegraphExtract({ markdown: page.markdown, prompt: 'Extract the team members on this page (investors, partners, directors, business development) with role, organization, other affiliations mentioned (past jobs, universities, boards, portfolio companies), and email and LinkedIn link only if they appear literally.', schema: PEOPLE_SCHEMA }, { env, fetcher, signal, live, record });
      people.push(...verifiedPeople(extracted, page));
    } catch (error) { errors.push(`${hostOf(page.url)}: ${error.message}`); }
    if (people.length >= maxPeople) break;
  }
  const unique = [...new Map(people.map((p) => [`${norm(p.name)}|${norm(p.org)}`, p])).values()].slice(0, maxPeople);
  if (!unique.length && errors.length && errors.length === pages.size) throw new Error(errors.join('; '));
  return { queries, pages: pages.size, errors, leads: webLeads(unique, brief) };
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
