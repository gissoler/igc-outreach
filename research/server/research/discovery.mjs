/* ────────────────────────────────────────────────────────────────────────
   Descubrimiento a partir de lo ya verificado (fase de «expansión» del motor).
   Una página buena es un mapa: sus enlaces (portafolio, premiados, programas hermanos), las rutas de su mismo
   sitio (/portfolio, /apply, /news, PDFs de la convocatoria) y las páginas PARECIDAS (Exa findSimilar) llevan a lo que
   ningún buscador pone en la primera página.
   Regla de siempre: esto solo produce CANDIDATOS (URLs). Cada una entra al mismo flujo de lectura y verificación que
   el resto (fecha contra hoy con cita literal, elegibilidad contra el brief). Aquí no se decide nada.
   Todo está acotado en código (semillas, enlaces por semilla, páginas totales) y falla en silencio con una nota en el audit.
   ──────────────────────────────────────────────────────────────────────── */
import { safeUrl } from './core.mjs';
import { isPublicUrl, fetchPage } from './localSearch.mjs';
import { hostKind, hostOf } from './verify.mjs';
import { urlKey } from './searchApis.mjs';

const HUB_PATH = /(portfolio|investments?|investees|companies|grantees?|awardees?|awards?|funded|supported|partners?|co-?invest|syndicat|programs?|programmes?|funding|grants?|opportunit|apply|application|calls?|rfp|rfa|nofo|news|press|team|people|focus|thesis|eligib|faq)/i;
const FUNDER_TEXT = /(foundation|\bfund\b|capital|ventures?|partners|institute|accelerator|grants?|funding|invest|angels?|philanthrop|trust|council|agency|\bnih\b|\bnsf\b|horizon|innovat)/i;
const FILE_SKIP = /\.(jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|ico|xml|json)(\?|$)/i;
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
const tidy = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 140);

/** Enlaces de una página: anclas HTML y enlaces markdown, resueltos contra la base. Solo http(s) públicos, sin archivos ni anclas. */
export function extractLinks(source, baseUrl) {
  const found = [];
  const add = (href, text) => {
    try {
      const u = new URL(decode(href).trim(), baseUrl); u.hash = '';
      if (!/^https?:$/.test(u.protocol) || FILE_SKIP.test(u.pathname + u.search)) return;
      const url = safeUrl(u.toString());
      if (url && isPublicUrl(url)) found.push({ url, text: tidy(text) });
    } catch { /* href inválido */ }
  };
  const s = String(source || '');
  for (const m of s.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) add(m[1], m[2]);
  for (const m of s.matchAll(/\[([^\]\n]{1,160})\]\((https?:\/\/[^)\s]+)\)/g)) add(m[2], m[1]);
  const seen = new Set();
  return found.filter((l) => { const k = urlKey(l.url); if (seen.has(k)) return false; seen.add(k); return true; });
}

const sameSite = (a, b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
/** Qué tan prometedor es un enlace como siguiente página. ≥2 entra; las redes sociales y agregadores nunca. */
export function scoreLink(link, seedUrl) {
  if (hostKind(link.url) !== 'other') return -99;
  const seed = hostOf(seedUrl); const host = hostOf(link.url); let path = '/';
  try { path = new URL(link.url).pathname; } catch { return -99; }
  let s = 0;
  if (sameSite(host, seed)) {
    if (path === '/' || path === '') return -5;
    if (HUB_PATH.test(path)) s += 3;
    if (HUB_PATH.test(link.text)) s += 2;
    if (/\.pdf$/i.test(path)) s += /(rfa|nofo|guideline|call|rfp|apply|eligib)/i.test(path + link.text) ? 2 : -3;
    if (path.split('/').filter(Boolean).length > 4) s -= 1;
  } else {
    if (FUNDER_TEXT.test(link.text)) s += 2;
    if (FUNDER_TEXT.test(host)) s += 1;
    if (/\.pdf$/i.test(path)) s -= 3;
  }
  return s;
}
export function rankLinks(links, seedUrl, { max = 6, minScore = 2 } = {}) {
  const own = urlKey(seedUrl);
  return links.filter((l) => urlKey(l.url) !== own).map((l) => ({ ...l, score: scoreLink(l, seedUrl) })).filter((l) => l.score >= minScore)
    .sort((a, b) => b.score - a.score).slice(0, max);
}

async function fetchHtml(url, { fetcher = fetch, signal, maxBytes = 1_500_000, timeoutMs = 15_000 } = {}) {
  if (!isPublicUrl(url)) return null;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const r = await fetcher(url, { redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; IGCOutreachResearch/1.0)' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!r.ok || !/html|xml|text\/plain/i.test(r.headers?.get?.('content-type') || 'text/html')) return null;
    return { url: safeUrl(r.url) || url, html: (await r.text()).slice(0, maxBytes) };
  } catch { return null; }
}

/** Enlaces prometedores de las páginas semilla. Devuelve filas {url,title,provider:'snowball',seed}. */
export async function snowball(seeds, { fetcher = fetch, signal, perSeed = 6, exclude = new Set(), html = fetchHtml } = {}) {
  const out = []; const taken = new Set([...exclude].map(urlKey));
  for (const seed of seeds) {
    signal?.throwIfAborted?.();
    const got = await html(seed.url, { fetcher, signal });
    const links = [...extractLinks(got?.html || '', got?.url || seed.url), ...extractLinks(seed.text || '', seed.url)];
    for (const l of rankLinks(links, seed.url, { max: perSeed })) {
      const k = urlKey(l.url); if (taken.has(k)) continue; taken.add(k);
      out.push({ url: l.url, title: l.text, description: '', markdown: '', provider: 'snowball', seed: seed.url });
    }
  }
  return out;
}

/* ── Rutas del mismo sitio: Common Crawl (lo que ya está indexado) y, sin él, rutas típicas que se prueban antes de usarlas ── */
const GUESS = ['/portfolio', '/apply', '/funding', '/grants', '/programs', '/opportunities', '/about/team', '/news'];
let ccIndex = null;
export const resetCommonCrawl = () => { ccIndex = null; };
async function commonCrawlIndex({ fetcher, signal }) {
  ccIndex ||= (async () => {
    const r = await fetcher('https://index.commoncrawl.org/collinfo.json', { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Common Crawl collinfo HTTP ${r.status}`);
    const api = (await r.json())?.[0]?.['cdx-api'];
    if (!api) throw new Error('Common Crawl: no index listed');
    return api;
  })().catch((e) => { ccIndex = null; throw e; });
  return ccIndex;
}
export async function commonCrawlUrls(host, { fetcher = fetch, signal, limit = 1500 } = {}) {
  const api = await commonCrawlIndex({ fetcher, signal });
  const q = new URLSearchParams({ url: `${host}/*`, output: 'json', fl: 'url', limit: String(limit) });
  q.append('filter', 'status:200'); q.append('filter', 'mime:text/html');
  const r = await fetcher(`${api}?${q}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Common Crawl index HTTP ${r.status}`);
  const urls = [];
  for (const line of (await r.text()).split('\n')) { try { const u = JSON.parse(line)?.url; if (u) urls.push(u); } catch { /* línea vacía */ } }
  return urls;
}
/** Páginas «hub» del mismo sitio de una semilla. Con CC se usan URLs indexadas; sin él, rutas típicas que responden. */
export async function siteDive(seedUrl, { fetcher = fetch, signal, max = 3, exclude = new Set(), cc = true, probe = fetchPage } = {}) {
  const host = hostOf(seedUrl); const taken = new Set([...exclude, seedUrl].map(urlKey)); const rows = []; let via = 'common_crawl'; let note = '';
  if (cc) {
    try {
      const urls = await commonCrawlUrls(host, { fetcher, signal });
      const scored = [...new Set(urls)].map((u) => { let p = '/'; try { p = new URL(u).pathname; } catch { /* */ } return { u, p }; })
        .filter(({ u, p }) => p !== '/' && !FILE_SKIP.test(p) && HUB_PATH.test(p) && p.split('/').filter(Boolean).length <= 3 && isPublicUrl(u) && hostKind(u) === 'other')
        .sort((a, b) => a.p.split('/').length - b.p.split('/').length || a.p.length - b.p.length);
      for (const { u } of scored) { const k = urlKey(u); if (taken.has(k)) continue; taken.add(k); rows.push({ url: u, title: '', description: '', markdown: '', provider: 'site-dive', seed: seedUrl }); if (rows.length >= max) break; }
    } catch (e) { note = String(e.message || e).slice(0, 120); }
  }
  if (!rows.length) {
    via = 'guessed_paths';
    const origin = (() => { try { return new URL(seedUrl).origin; } catch { return ''; } })();
    for (const path of GUESS) {
      if (!origin || rows.length >= max) break;
      const url = `${origin}${path}`; const k = urlKey(url); if (taken.has(k)) continue; taken.add(k);
      const got = await probe(url, { fetcher, signal }).catch(() => null);
      if (got?.text) rows.push({ url: got.url || url, title: got.title || '', description: '', markdown: got.text.slice(0, 60_000), provider: 'site-dive', seed: seedUrl });
    }
  }
  return Object.assign(rows, { via, note });
}
