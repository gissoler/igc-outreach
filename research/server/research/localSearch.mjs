/* Búsqueda y lectura propias (sin Firecrawl/Exa/Serper).
   · searxSearch: metabuscador SearXNG autoalojado (JSON) → agrega varios buscadores a la vez.
   · fetchPage: descarga directa de la página y la convierte en texto legible. Solo URLs públicas (sin SSRF). */
import { safeUrl } from './core.mjs';

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
export const isPublicUrl = (url) => { const u = safeUrl(url); if (!u) return false; try { return !PRIVATE_HOST.test(new URL(u).hostname); } catch { return false; } };

export const searxConfigured = (env = process.env) => Boolean(String(env.SEARXNG_URL || '').trim());

/** Resultados normalizados {url,title,description,markdown:''}. `timeRange`: day|week|month|year|'' */
export async function searxSearch(query, { env = process.env, fetcher = fetch, signal, timeRange = '', limit = 10, engines = env.SEARXNG_ENGINES || '' } = {}) {
  const base = String(env.SEARXNG_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('SEARXNG_URL not set.');
  const params = new URLSearchParams({ q: String(query).slice(0, 400), format: 'json', language: 'en', safesearch: '0', categories: 'general' });
  if (timeRange) params.set('time_range', timeRange);
  if (engines) params.set('engines', engines);
  const timeout = AbortSignal.timeout(Number(env.SEARXNG_TIMEOUT_MS) || 25_000);
  const r = await fetcher(`${base}/search?${params}`, { headers: { Accept: 'application/json', 'User-Agent': 'IGCOutreachResearch/1.0' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!r.ok) throw new Error(`SearXNG HTTP ${r.status}${r.status === 403 ? ' (enable "json" in search.formats of settings.yml)' : ''}`);
  const data = await r.json();
  const seen = new Set();
  return (Array.isArray(data?.results) ? data.results : []).map((x) => ({ url: safeUrl(x.url), title: String(x.title || ''), description: String(x.content || ''), markdown: '' }))
    .filter((x) => x.url && isPublicUrl(x.url) && !seen.has(x.url) && seen.add(x.url)).slice(0, limit);
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—' };
/** HTML → texto: quita script/style/nav/footer, conserva títulos y párrafos como líneas. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${'#'.repeat(+n)} `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp|ndash|mdash);/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Descarga una página pública. Devuelve {url,title,text} o null (no HTML, error, demasiado grande, no pública). */
export async function fetchPage(url, { fetcher = fetch, signal, maxBytes = 1_500_000, timeoutMs = 15_000 } = {}) {
  if (!isPublicUrl(url)) return null;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const r = await fetcher(url, { redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; IGCOutreachResearch/1.0)' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!r.ok) return null;
    const final = safeUrl(r.url) || url;
    if (!isPublicUrl(final)) return null;
    if (!/html|xml|text\/plain/i.test(r.headers?.get?.('content-type') || 'text/html')) return null;
    const html = (await r.text()).slice(0, maxBytes);
    const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim();
    const text = htmlToText(html);
    return text.length > 80 ? { url: final, title, text, html } : null;
  } catch { return null; }
}
