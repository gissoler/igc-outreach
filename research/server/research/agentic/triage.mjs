/* ─────────────────────────────────────────────────────────────────────────────
   Triage determinista de una página ANTES de la lectura del modelo (V14, P0.3).
   Solo extrae hechos estructurales, sin modelo y sin decidir relevancia temática:
     · fechas con la etiqueta cercana (dates.mjs#milestones) y si ya pasaron respecto de HOY
     · identificadores de convocatoria (grantSources.mjs#foaIdsIn) en el texto y en los enlaces
     · avisos de estado: EXPIRED / CLOSED / "no longer accepting" / archivado (dates.mjs#CLOSED_RX y título)
     · forma de la página: noticia, lista/índice, portafolio o página única (pageType.mjs#classifyPage + densidad de enlaces)
   Si una página sirve o no para el brief lo sigue decidiendo el modelo; esto solo le da contexto y queda
   como respaldo cuando la lectura del modelo falla.
   ───────────────────────────────────────────────────────────────────────────── */
import { CLOSED_RX, daysBetween, flat, milestones, todayIso } from '../dates.mjs';
import { classifyPage } from '../pageType.mjs';
import { foaIdsIn } from '../grantSources.mjs';

export const TRIAGE_VERSION = 'triage.v1';
const EXPIRED_RX = /\b(?:this (?:notice|funding opportunity|opportunity|announcement|NOFO|FOA|program) (?:has )?(?:expired|been archived)|expired (?:notice|funding opportunity|opportunity)|status:\s*(?:expired|closed|archived|inactive)|(?:has|have) been (?:archived|retired|cancelled|canceled)|no longer (?:available|active|accepting))/i;
const CAPS_RX = /\b(EXPIRED|ARCHIVED|CLOSED)\b/;   // banner en mayúsculas («EXPIRED»); la palabra en minúscula dentro de una frase no cuenta
const TITLE_STATE_RX = /^\s*\[?(expired|closed|archived|inactive)\]?\b/i;
const BANNER_KIND = (quote) => /expired/i.test(quote) ? 'expired' : /archiv|retired/i.test(quote) ? 'archived' : /cancel/i.test(quote) ? 'cancelled' : /no longer accepting|not (?:currently )?accepting/i.test(quote) ? 'not_accepting' : 'closed';
const around = (s, index, len, radius = 90) => s.slice(Math.max(0, index - radius), Math.min(s.length, index + len + radius)).trim();
const ROLE = { deadline: 'application_deadline', loi: 'loi_deadline', invited: 'application_deadline', opens: 'opens', result: 'award', published: 'posted', registration: 'other', event: 'other', none: 'other' };

/** Fechas con su etiqueta cercana; `past` se calcula contra hoy y nunca se infiere un año ausente. */
export function triageDates(text, today, max = 12) {
  const now = todayIso(today); const s = flat(text);
  // Cita: desde el inicio de la frase (o 80 caracteres antes de la etiqueta) hasta la fecha; es texto literal de la página.
  const quoteOf = (m) => { const from = Math.max(0, (m.labelStart ?? m.index) - 80); const cut = s.lastIndexOf('. ', m.labelStart ?? m.index); return s.slice(Math.max(from, cut >= 0 ? cut + 2 : 0), m.end).trim().slice(-240); };
  return milestones(text).filter((m) => m.iso && !m.yearless).slice(0, 60).map((m) => ({
    date: m.iso, label: String(m.label || '').slice(0, 60), phase: m.phase, role: ROLE[m.phase] || 'other', precision: m.precision,
    past: daysBetween(now, m.iso) < 0, quote: quoteOf(m), ...(m.optional ? { optional: true } : {}),
  })).sort((a, b) => (a.role === 'application_deadline' || a.role === 'loi_deadline' ? 0 : 1) - (b.role === 'application_deadline' || b.role === 'loi_deadline' ? 0 : 1)).slice(0, max);
}

/** Avisos de estado literales (con cita) en el título o el texto. */
export function triageBanners({ title = '', text = '' } = {}) {
  const out = []; const s = flat(text); const t = String(title || '');
  const tm = TITLE_STATE_RX.exec(t); if (tm) out.push({ kind: BANNER_KIND(tm[1]), where: 'title', quote: t.slice(0, 160) });
  for (const rx of [EXPIRED_RX, CAPS_RX, CLOSED_RX]) {
    const m = rx.exec(s); if (!m) continue;
    const quote = around(s, m.index, m[0].length, 60);
    if (!out.some((b) => b.quote === quote)) out.push({ kind: BANNER_KIND(m[0]), where: 'text', quote });
  }
  return out;
}

/** Forma de la página por señales estructurales (ruta, marcadores de comunicado, densidad de enlaces e IDs enlazados). */
export function triageStructure({ url = '', title = '', text = '', links = [] } = {}) {
  const page = classifyPage({ url, title, text });
  const chars = String(text || '').length; const linkCount = Array.isArray(links) ? links.length : 0;
  const foaLinks = (links || []).filter((l) => foaIdsIn(`${l.url || ''} ${l.text || ''}`).length);
  const density = chars ? linkCount / Math.max(1, chars / 1000) : 0;   // enlaces por cada 1.000 caracteres
  let kind = 'page';
  if (['news', 'blog'].includes(page.type)) kind = 'news';
  else if (page.type === 'cohort') kind = 'portfolio';
  else if (page.type === 'directory' || page.type === 'home' || foaLinks.length >= 3 || (linkCount >= 25 && density >= 8)) kind = 'list';
  if (/\/(portfolio|companies|investments?)(\/|$)/i.test((() => { try { return new URL(url).pathname; } catch { return ''; } })())) kind = 'portfolio';
  return { kind, page_type_code: page.type, is_call_code: Boolean(page.isCall), reason: page.reason, links: linkCount, link_density: Math.round(density * 10) / 10, foa_links: foaLinks.length, hub: foaLinks.length >= 3 };
}

/** Triage completo de una página abierta. No llama a ningún modelo ni a la red. */
export function triagePage({ url = '', title = '', text = '', links = [], today } = {}) {
  const ids = foaIdsIn(`${title} ${text}`).slice(0, 20);
  const linkIds = [...new Set((links || []).flatMap((l) => foaIdsIn(`${l.url || ''} ${l.text || ''}`)))].slice(0, 30);
  return { version: TRIAGE_VERSION, dates: triageDates(text, today), foa_ids: ids, linked_foa_ids: linkIds, banners: triageBanners({ title, text }), structure: triageStructure({ url, title, text, links }) };
}

/** Resumen corto del triage para el prompt del lector (el modelo puede contradecirlo con una cita). */
export function triageNote(t) {
  if (!t) return '';
  const parts = [`page shape (code): ${t.structure.kind}${t.structure.hub ? ', hub of calls' : ''}`];
  if (t.banners.length) parts.push(`status banners (code): ${t.banners.map((b) => `${b.kind} "${b.quote.slice(0, 120)}"`).join('; ')}`);
  if (t.foa_ids.length) parts.push(`call ids in text: ${t.foa_ids.slice(0, 8).join(', ')}`);
  const dated = t.dates.filter((d) => ['application_deadline', 'loi_deadline'].includes(d.role)).slice(0, 6);
  if (dated.length) parts.push(`labelled dates (code): ${dated.map((d) => `${d.role} ${d.date}${d.past ? ' (past)' : ''}`).join(', ')}`);
  return parts.join('\n');
}
