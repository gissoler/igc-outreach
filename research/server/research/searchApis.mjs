/* ─────────────────────────────────────────────────────────────────────────────
   Búsqueda con APIs externas para el motor v2: Linkup, Exa, You.com, Tavily, Jina, Serper (Google) y
   Firecrawl (+ Jina Reader y Firecrawl /scrape como lectores).
   · Cada proveedor devuelve [{url,title,description,markdown,provider,rank,published}].
   · multiSearch lanza todos los configurados en paralelo, une por URL y ordena por consenso
     (cuántos buscadores trajeron la misma página) y luego por posición.
   · Todo lo que llega aquí son PISTAS no verificadas: el motor lee la página y verify.mjs decide.
   · Las claves viven solo en el servidor (.env). Nunca van en la URL salvo donde el proveedor no ofrece otra vía (ninguno aquí).
   ───────────────────────────────────────────────────────────────────────────── */
import { safeUrl } from './core.mjs';
import { isPublicUrl, searxSearch } from './localSearch.mjs';
import { firecrawlSearch, firecrawlScrape, firecrawlDisabled } from './webscrape.mjs';

export const PROVIDER_KEYS = { linkup: 'LINKUP_API_KEY', exa: 'EXA_API_KEY', you: 'YOU_API_KEY', tavily: 'TAVILY_API_KEY', jina: 'JINA_API_KEY', serper: 'SERPER_API_KEY', firecrawl: 'FIRECRAWL_API_KEY', searxng: 'SEARXNG_URL' };
export const SEARCH_PROVIDERS = Object.keys(PROVIDER_KEYS);
const key = (env, p) => (p === 'firecrawl' && firecrawlDisabled(env) ? '' : String(env[PROVIDER_KEYS[p]] || '').trim());

/** SearXNG propio como base: SEARCH_PROVIDER=searxng y SEARXNG_URL http(s). */
export const searxngBase = (env = process.env) => String(env.SEARCH_PROVIDER || '').toLowerCase() === 'searxng' && /^https?:\/\//i.test(String(env.SEARXNG_URL || ''));
const PAID_DEFAULT = 'exa,serper';

/** Proveedores activos. Con SearXNG como base, siempre va primero y las APIs de pago solo lo COMPLEMENTAN:
 *  SEARCH_COMPLEMENT (por defecto «exa,serper»; «none» = solo SearXNG; «all» = todas las que tengan clave). */
export function searchProviders(env = process.env) {
  if (searxngBase(env)) {
    const c = String(env.SEARCH_COMPLEMENT ?? PAID_DEFAULT).trim().toLowerCase();
    const extra = c === 'none' ? [] : c === 'all' ? SEARCH_PROVIDERS.filter((p) => !['firecrawl', 'searxng'].includes(p)) : c.split(',').map((x) => x.trim());
    return ['searxng', ...new Set(extra.filter((p) => PROVIDER_KEYS[p] && !['firecrawl', 'searxng'].includes(p) && key(env, p)))];
  }
  // Por defecto todos los que tengan clave, salvo Firecrawl como buscador (gasta 1 crédito por página);
  // Firecrawl sigue leyendo páginas difíciles. Para usarlo también como buscador, inclúyelo en ENGINE_SEARCH_PROVIDERS.
  const wanted = String(env.ENGINE_SEARCH_PROVIDERS || SEARCH_PROVIDERS.filter((p) => !['firecrawl', 'searxng'].includes(p)).join(',')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set(wanted)].filter((p) => PROVIDER_KEYS[p] && key(env, p));
}
export const searchApisConfigured = (env = process.env) => searchProviders(env).length > 0;

async function call(name, url, { method = 'GET', headers = {}, body, env = process.env, fetcher = fetch, signal, timeoutMs } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs || Number(env.ENGINE_SEARCH_TIMEOUT_MS) || 45_000);
  const r = await fetcher(url, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`${name} HTTP ${r.status}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`);
  try { return JSON.parse(text); } catch { throw new Error(`${name} returned invalid JSON`); }
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
/** Texto largo = página (se lee tal cual); corto = snippet (el motor descargará la página). */
const LONG = 600;
function row(provider, rank, { url, title, description, content, published }) {
  const u = safeUrl(str(url));
  if (!u || !isPublicUrl(u)) return null;
  const body = str(content).trim(); const desc = str(description).trim();
  return { url: u, title: str(title).trim(), description: (desc || body).slice(0, 600), markdown: body.length >= LONG ? body.slice(0, 60_000) : '', provider, rank, published: str(published) || null };
}
const clean = (rows, n) => rows.filter(Boolean).slice(0, n);
const n = (env, limit) => Math.min(20, Math.max(1, Number(limit || env.ENGINE_RESULTS_PER_PROVIDER) || 8));
const sinceIso = (recency) => { const d = { day: 1, week: 7, month: 31, year: 366 }[recency]; return d ? new Date(Date.now() - d * 864e5).toISOString().slice(0, 10) : null; };

/* ── Proveedores ── */

/** Linkup: POST /v1/search · Bearer · depth fast|standard|deep · outputType searchResults → results[{name,url,content}] */
export async function linkupSearch(query, { env = process.env, fetcher, signal, limit, recency = '' } = {}) {
  const since = sinceIso(recency);
  const data = await call('Linkup', 'https://api.linkup.so/v1/search', {
    method: 'POST', env, fetcher, signal, timeoutMs: Number(env.LINKUP_TIMEOUT_MS) || 60_000,
    headers: { Authorization: `Bearer ${key(env, 'linkup')}` },
    body: { q: str(query).slice(0, 1000), depth: env.LINKUP_DEPTH || 'standard', outputType: 'searchResults', maxResults: n(env, limit), ...(since ? { fromDate: since } : {}) },
  });
  return clean((data?.results || []).map((x, i) => row('linkup', i + 1, { url: x.url, title: x.name, content: x.content })), n(env, limit));
}

/** Exa: POST /search · x-api-key · type auto · contents.text → results[{url,title,text,publishedDate}] */
export async function exaSearchApi(query, { env = process.env, fetcher, signal, limit, recency = '' } = {}) {
  const since = sinceIso(recency);
  const data = await call('Exa', 'https://api.exa.ai/search', {
    method: 'POST', env, fetcher, signal,
    headers: { 'x-api-key': key(env, 'exa') },
    body: { query: str(query).slice(0, 1000), type: env.EXA_SEARCH_TYPE || 'auto', numResults: n(env, limit), contents: { text: { maxCharacters: Number(env.EXA_TEXT_CHARS) || 20_000 } }, ...(since ? { startPublishedDate: `${since}T00:00:00.000Z` } : {}) },
  });
  const rows = clean((data?.results || []).map((x, i) => row('exa', i + 1, { url: x.url, title: x.title, content: x.text, description: Array.isArray(x.highlights) ? x.highlights.join(' … ') : '', published: x.publishedDate })), n(env, limit));
  return Object.assign(rows, { costUsd: Number(data?.costDollars?.total) || 0 });
}

/** You.com: GET https://ydc-index.io/v1/search · X-API-Key → results.web[{url,title,description,snippets[]}] (acepta también hits[]) */
export async function youSearch(query, { env = process.env, fetcher, signal, limit, recency = '' } = {}) {
  const params = new URLSearchParams({ query: str(query).slice(0, 400), count: String(n(env, limit)) });
  if (recency) params.set('freshness', recency);
  const data = await call('You.com', `${(env.YOU_API_URL || 'https://ydc-index.io/v1/search').replace(/\/+$/, '')}?${params}`, { env, fetcher, signal, headers: { 'X-API-Key': key(env, 'you') } });
  const list = Array.isArray(data?.results?.web) ? data.results.web : Array.isArray(data?.hits) ? data.hits : [];
  return clean(list.map((x, i) => row('you', i + 1, { url: x.url, title: x.title, description: [x.description, ...(Array.isArray(x.snippets) ? x.snippets : [])].filter(Boolean).join(' … '), content: str(x.contents?.markdown || x.content || '') })), n(env, limit));
}

/** Tavily: POST /search · Bearer · include_raw_content markdown → results[{url,title,content,raw_content}] */
export async function tavilySearch(query, { env = process.env, fetcher, signal, limit, recency = '' } = {}) {
  const data = await call('Tavily', 'https://api.tavily.com/search', {
    method: 'POST', env, fetcher, signal,
    headers: { Authorization: `Bearer ${key(env, 'tavily')}` },
    body: { query: str(query).slice(0, 400), max_results: n(env, limit), search_depth: env.TAVILY_DEPTH || 'basic', include_raw_content: 'markdown', topic: 'general', ...(recency ? { time_range: recency } : {}) },
  });
  return clean((data?.results || []).map((x, i) => row('tavily', i + 1, { url: x.url, title: x.title, description: x.content, content: x.raw_content })), n(env, limit));
}

/** Jina Search: GET https://s.jina.ai/?q= · Bearer · Accept json → data[{url,title,description,content}] (content = markdown de la página) */
export async function jinaSearch(query, { env = process.env, fetcher, signal, limit } = {}) {
  const params = new URLSearchParams({ q: str(query).slice(0, 400), num: String(n(env, limit)) });
  const data = await call('Jina', `https://s.jina.ai/?${params}`, { env, fetcher, signal, timeoutMs: Number(env.JINA_TIMEOUT_MS) || 60_000, headers: { Authorization: `Bearer ${key(env, 'jina')}`, 'X-Retain-Images': 'none', ...(env.JINA_SEARCH_CONTENT === '0' ? { 'X-Respond-With': 'no-content' } : {}) } });
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return clean(list.map((x, i) => row('jina', i + 1, { url: x.url, title: x.title, description: x.description, content: x.content })), n(env, limit));
}

/** Serper (Google): POST /search · X-API-KEY · tbs qdr:d|w|m|y → organic[{link,title,snippet,date}]. Solo snippets: el motor descarga la página. */
const SERPER_TBS = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };
export async function serperSearch(query, { env = process.env, fetcher, signal, limit, recency = '' } = {}) {
  const data = await call('Serper', 'https://google.serper.dev/search', {
    method: 'POST', env, fetcher, signal, timeoutMs: Number(env.SERPER_TIMEOUT_MS) || 20_000,
    headers: { 'X-API-KEY': key(env, 'serper') },
    body: { q: str(query).slice(0, 500), num: Math.min(20, Math.max(10, n(env, limit))), ...(SERPER_TBS[recency] ? { tbs: SERPER_TBS[recency] } : {}), ...(env.SERPER_GL ? { gl: env.SERPER_GL } : {}) },
  });
  const organic = Array.isArray(data?.organic) ? data.organic : [];
  const rows = clean(organic.map((x, i) => row('serper', i + 1, { url: x.link, title: x.title, description: x.snippet, published: x.date })), n(env, limit));
  // Coste aproximado por consulta (Serper cobra por consulta, no por resultado). Configurable.
  return Object.assign(rows, { costUsd: Number(env.COST_SERPER_PER_CALL) || 0 });
}

/** Firecrawl como buscador: trae markdown de cada resultado (1 crédito por página). Con errores claros y reintentos. */
export async function firecrawlSearchApi(query, { env = process.env, fetcher, signal, limit, recency = '' } = {}) {
  // Búsqueda principal: sin caché y sin bloqueo por el tope diario (sí cuenta en el gasto del día).
  const rows = await firecrawlSearch(str(query), { cache: false, essential: true, limit: Math.min(10, n(env, limit)), markdown: env.FIRECRAWL_SEARCH_MARKDOWN !== '0', tbs: SERPER_TBS[recency] || '', env, fetcher, signal });
  return clean(rows.map((x, i) => row('firecrawl', i + 1, { url: x.url, title: x.title, description: x.description, content: x.markdown, published: x.date })), n(env, limit));
}

export async function searxngProviderSearch(query, { env = process.env, fetcher, signal, limit, recency = '' } = {}) {
  const tr = { day: 'day', week: 'week', month: 'month', year: 'year' }[recency] || '';
  const list = await searxSearch(query, { env, fetcher: fetcher || fetch, signal, timeRange: tr, limit: n(env, limit) });
  return clean(list.map((x, i) => row('searxng', i + 1, { url: x.url, title: x.title, description: x.description })), n(env, limit));
}
export const PROVIDER_FN = { searxng: searxngProviderSearch, linkup: linkupSearch, exa: exaSearchApi, you: youSearch, tavily: tavilySearch, jina: jinaSearch, serper: serperSearch, firecrawl: firecrawlSearchApi };

/** Lector de respaldo con Firecrawl /scrape (páginas con JavaScript). Devuelve {url,title,text} o null. */
export async function firecrawlRead(url, { env = process.env, fetcher = fetch, signal, ledger, meter } = {}) {
  if (!key(env, 'firecrawl') || !isPublicUrl(url)) return null;
  const got = await firecrawlScrape(url, { env, fetcher, signal, ledger, meter });   // caché + tope diario (firecrawlLedger.mjs)
  return got ? { url: got.url, title: got.title, text: got.markdown.slice(0, 120_000) } : null;
}

/** Jina Reader: página → markdown (sirve para páginas con JavaScript y PDFs). Devuelve {url,title,text} o null; nunca lanza. */
export async function jinaRead(url, { env = process.env, fetcher = fetch, signal } = {}) {
  if (!key(env, 'jina') || !isPublicUrl(url)) return null;
  try {
    const data = await call('Jina Reader', `https://r.jina.ai/${url}`, { env, fetcher, signal, timeoutMs: Number(env.JINA_TIMEOUT_MS) || 60_000, headers: { Authorization: `Bearer ${key(env, 'jina')}`, 'X-Retain-Images': 'none', 'X-Timeout': '25' } });
    const d = data?.data || data || {};
    const text = str(d.content).trim();
    return text.length > 80 ? { url: safeUrl(str(d.url)) || url, title: str(d.title).trim(), text: text.slice(0, 120_000) } : null;
  } catch { return null; }
}

/** Clave de fusión: sin www, sin #, sin utm_*, sin barra final. */
export function urlKey(url) {
  try {
    const u = new URL(url); u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`;
  } catch { return String(url); }
}

/**
 * Busca en todos los proveedores activos a la vez y une resultados.
 * @returns array de {url,title,description,markdown,providers[],rank} con `.stats` = {proveedor:{returned,ms,error?,costUsd?}}
 */
/** Errores que no se arreglan reintentando (sin saldo, clave inválida, plan agotado). */
const FATAL = /HTTP (401|402|403|432|433)\b|credit|balance|saldo|insufficient|quota|billing|payment|exceeded your|out of/i;
export async function multiSearch(query, { env = process.env, fetcher = fetch, signal, limit, recency = '', providers = searchProviders(env), fns = PROVIDER_FN, breaker = {}, maxFails = 3 } = {}) {
  const stats = {};
  const lists = await Promise.all(providers.filter((p) => !breaker[p]?.off).map(async (p) => {
    const at = Date.now(); const b = (breaker[p] ||= { fails: 0, off: false, reason: '' });
    try {
      const rows = await fns[p](query, { env, fetcher, signal, limit, recency });
      b.fails = 0;
      stats[p] = { returned: rows.length, ms: Date.now() - at, ...(rows.costUsd ? { costUsd: rows.costUsd } : {}) };
      return rows;
    } catch (error) {
      const msg = str(error?.message).slice(0, 240);
      b.fails++; stats[p] = { returned: 0, ms: Date.now() - at, error: msg };
      // Cortacircuitos: un proveedor sin saldo/clave inválida se apaga para el resto de la corrida; otros fallos, tras `maxFails` seguidos.
      if (!b.off && (FATAL.test(msg) || b.fails >= maxFails)) { b.off = true; b.reason = msg; stats[p].disabled = msg; }
      return [];
    }
  }));
  const merged = new Map();
  for (const rows of lists) for (const r of rows) {
    const k = urlKey(r.url); const m = merged.get(k);
    if (!m) { merged.set(k, { url: r.url, title: r.title, description: r.description, markdown: r.markdown, providers: [r.provider], rank: r.rank, published: r.published }); continue; }
    if (!m.providers.includes(r.provider)) m.providers.push(r.provider);
    m.rank = Math.min(m.rank, r.rank);
    if (r.markdown.length > m.markdown.length) m.markdown = r.markdown;
    if (r.description.length > m.description.length) m.description = r.description;
    if (!m.title && r.title) m.title = r.title;
    if (!m.published && r.published) m.published = r.published;
  }
  const out = [...merged.values()].sort((a, b) => b.providers.length - a.providers.length || a.rank - b.rank);
  return Object.assign(out, { stats });
}

/** Exa findSimilar: páginas parecidas a una URL (fondos o convocatorias de nicho cuyas palabras no coinciden con ninguna consulta). */
export async function exaSimilar(url, { env = process.env, fetcher = fetch, signal, limit = 6 } = {}) {
  if (!key(env, 'exa')) return [];
  const data = await call('Exa similar', 'https://api.exa.ai/findSimilar', {
    method: 'POST', env, fetcher, signal,
    headers: { 'x-api-key': key(env, 'exa') },
    body: { url: str(url).slice(0, 2000), numResults: n(env, limit), excludeSourceDomain: true, contents: { text: { maxCharacters: Number(env.EXA_TEXT_CHARS) || 20_000 } } },
  });
  const rows = clean((data?.results || []).map((x, i) => row('exa-similar', i + 1, { url: x.url, title: x.title, content: x.text, published: x.publishedDate })), n(env, limit));
  return Object.assign(rows, { costUsd: Number(data?.costDollars?.total) || 0 });
}
