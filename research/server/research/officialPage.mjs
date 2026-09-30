/* ─────────────────────────────────────────────────────────────────────────────
   Página oficial dentro de la app (pestaña "Official page" del detalle).
   · Solo se usa la URL que el propio pipeline guardó para ese lead (evidencia o
     canal de contacto): nunca una URL enviada por el cliente, así el servidor
     no se convierte en un proxy/SSRF.
   · `embeddable` lee X-Frame-Options y CSP frame-ancestors: si el sitio se deja
     mostrar en un iframe, el frontend lo embebe directo; si no, usa el navegador
     remoto (remoteBrowser.mjs), que sí permite navegar dentro de la app.
   ───────────────────────────────────────────────────────────────────────────── */
import { safeUrl } from './core.mjs';

const MAX_CACHE = 60;
const TTL_MS = 6 * 60 * 60_000;

/** URL oficial del lead: la primera evidencia verificada, luego cualquier evidencia, luego el canal web. */
export function officialUrlOf(lead) {
  const ev = lead?.evidence || [];
  const pick = ev.find((e) => e.verified && safeUrl(e.url)) || ev.find((e) => safeUrl(e.url));
  if (pick) return safeUrl(pick.url);
  if (lead?.contact && lead.contact.type !== 'email') return safeUrl(lead.contact.value);
  return null;
}

/** ¿Permite el sitio mostrarse dentro de otra app? Solo se mira la política declarada. */
export function embedPolicy(headers) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]) || '';
  const xfo = String(get('x-frame-options')).trim().toLowerCase();
  if (xfo === 'deny' || xfo === 'sameorigin' || xfo.startsWith('allow-from')) return { embeddable: false, reason: `The site sends X-Frame-Options: ${xfo.toUpperCase()}.` };
  const csp = String(get('content-security-policy'));
  const fa = /frame-ancestors\s+([^;]+)/i.exec(csp);
  if (fa) {
    const v = fa[1].trim();
    if (!/(^|\s)\*(\s|$)/.test(v)) return { embeddable: false, reason: 'The site only allows itself to be framed by its own pages.' };
  }
  return { embeddable: true, reason: null };
}

export function createOfficialPages({ fetcher = fetch, now = () => Date.now() } = {}) {
  const cache = new Map(); // key → { at, url, info }
  const inflight = new Map();
  const remember = (key, value) => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  };

  async function inspect(url) {
    let status = null, finalUrl = url, policy = { embeddable: false, reason: 'The page did not answer a plain request.' };
    try {
      const r = await fetcher(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html' } });
      status = r.status;
      finalUrl = safeUrl(r.url) || url;
      policy = r.ok ? embedPolicy(r.headers) : { embeddable: false, reason: `The page answered ${r.status} to a plain request.` };
      try { await r.body?.cancel(); } catch { /* ignore */ }
    } catch { /* keep default */ }
    return { url: finalUrl, status, ...policy };
  }

  return {
    officialUrlOf,
    /** Datos de la página oficial de un lead: URL y si se puede embeber directo. */
    async info(jobId, lead) {
      const url = officialUrlOf(lead);
      if (!url) return { url: null, embeddable: false, reason: 'No official page was found for this item.' };
      const key = `${jobId}:${lead.id}`;
      const hit = cache.get(key);
      if (hit && hit.url === url && now() - hit.at < TTL_MS) return hit.info;
      if (!inflight.has(key)) inflight.set(key, inspect(url).then((info) => { remember(key, { at: now(), url, info }); return info; }).finally(() => inflight.delete(key)));
      return inflight.get(key);
    },
  };
}
