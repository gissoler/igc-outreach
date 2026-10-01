/* ─────────────────────────────────────────────────────────────────────────────
   Crawl4AI: lector de páginas propio (servidor Docker en tu infraestructura, sin créditos por página).
   Descarga la página con un navegador real (JavaScript incluido) y devuelve markdown. Sustituye a Firecrawl como lector de respaldo.
   Solo LEE: lo que el modelo extrae y lo que el código decide sigue siendo igual (fecha contra hoy con cita, elegibilidad contra el brief).
   · CRAWL4AI_URL        servidor, p. ej. http://crawl4ai:11235 (sin él, el lector no se usa)
   · CRAWL4AI_TOKEN      opcional: Bearer, solo si el servidor tiene JWT activado
   · CRAWL4AI_TIMEOUT_MS tiempo máximo por página (45 s por defecto; sin reintento tras timeout)
   · CRAWL4AI_MARKDOWN   raw (por defecto: texto completo, conserva fechas y requisitos) | fit (filtrado, más corto)
   Seguridad: solo se le envían URLs públicas (el servidor vive dentro de tu red y no debe poder abrir hosts internos).
   ───────────────────────────────────────────────────────────────────────────── */
import { safeUrl } from './core.mjs';
import { isPublicUrl } from './localSearch.mjs';

const clean = (s) => String(s ?? '').trim();
/** El servidor es tuyo y suele estar en una red interna sin TLS: se acepta http o https (nunca con usuario ni clave en la URL). */
export const crawl4aiBase = (env = process.env) => {
  try { const u = new URL(clean(env.CRAWL4AI_URL)); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.origin + u.pathname.replace(/\/+$/, '') : ''; } catch { return ''; }
};
export const crawl4aiConfigured = (env = process.env) => Boolean(crawl4aiBase(env));

/** El servidor devuelve `markdown` como texto o como objeto {raw_markdown, fit_markdown, ...} según la versión: se aceptan las dos. */
export function pickMarkdown(m, prefer = 'raw') {
  if (typeof m === 'string') return m.trim();
  if (!m || typeof m !== 'object') return '';
  const order = prefer === 'fit' ? ['fit_markdown', 'raw_markdown', 'markdown_with_citations'] : ['raw_markdown', 'markdown_with_citations', 'fit_markdown'];
  for (const k of order) if (typeof m[k] === 'string' && m[k].trim()) return m[k].trim();
  return '';
}

/** Página → {url,title,text} o null. Nunca lanza (un fallo del lector no tumba la corrida). */
export async function crawl4aiRead(url, { env = process.env, fetcher = fetch, signal } = {}) {
  const base = crawl4aiBase(env);
  if (!base || !isPublicUrl(url)) return null;
  const timeoutMs = Math.min(170_000, Math.max(5_000, Number(env.CRAWL4AI_TIMEOUT_MS) || 45_000));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs + 5_000);
  const onAbort = () => ctl.abort(); signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    const token = clean(env.CRAWL4AI_TOKEN);
    const res = await fetcher(`${base}/crawl`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        urls: [url],
        browser_config: { type: 'BrowserConfig', params: { headless: true } },
        crawler_config: { type: 'CrawlerRunConfig', params: { cache_mode: 'bypass', page_timeout: timeoutMs } },
      }),
    });
    if (!res?.ok) return null;
    const data = await res.json();
    if (data?.success === false) return null;
    const r = Array.isArray(data?.results) ? data.results[0] : data?.result || data;
    if (!r || r.success === false) return null;
    const text = pickMarkdown(r.markdown, clean(env.CRAWL4AI_MARKDOWN).toLowerCase() === 'fit' ? 'fit' : 'raw');
    return text.length > 80 ? { url: safeUrl(clean(r.url)) || url, title: clean(r.metadata?.title), text: text.slice(0, 120_000) } : null;
  } catch { return null; }
  finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
}
