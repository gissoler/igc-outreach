/* ─────────────────────────────────────────────────────────────────────────────
   V15 · Cosecha de convocatorias para un brief de grants.
   RD-04 (runs-v6): 8 búsquedas, 174 URLs, 3 leídas, todas alrededor de UNA convocatoria. La cobertura no puede
   depender de que el planificador elija bien. Aquí se reúnen candidatos por varias vías a la vez:
     1. NIH Guide (texto completo de cada aviso) con consultas cortas del brief;
     2. mecanismos generales del NIH (Parent R21/R01/R03 y SBIR/STTR) cuando el brief es del ámbito del NIH;
     3. Simpler.Grants.gov (o Grants.gov) con consultas cortas (AND sobre 1–3 palabras, no frases de relleno);
     4. web: fundaciones y catálogos oficiales, abriendo las páginas individuales de cada catálogo.
   Qué convocatoria sirve lo decide el juez sobre el expediente; aquí solo se recoge y se cuenta.
   ───────────────────────────────────────────────────────────────────────────── */
import { nihGuideSearch } from './nihGuide.mjs';
import { contentTokens } from './terms.mjs';
import { foaIdsIn } from '../grantSources.mjs';
import { hostKind, hostOf } from '../verify.mjs';
import { triagePage } from '../agentic/triage.mjs';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const noopTrace = { event: () => null };
const limiter = (n) => { let active = 0; const q = []; const next = () => { if (active >= n || !q.length) return; active++; const { fn, res, rej } = q.shift(); Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); }); }; return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); }); };

/** Mecanismos generales a cubrir según el brief (no son temáticos: el juez decide si el proyecto cabe). */
export function mechanismPlan(brief = {}) {
  const text = `${brief.stage || ''} ${brief.entityType || ''} ${brief.description || ''} ${brief.constraints || ''}`.toLowerCase();
  const academicOnly = /\b(university|academic|nonprofit|non-profit)\b/.test(String(brief.entityType || '').toLowerCase());
  const codes = ['R21', 'R01', 'R03'];
  if (!academicOnly && (brief.company || /for-?profit|company|small business|startup/.test(text))) codes.push('R43', 'R44', 'R41', 'R42');
  return { codes, clinicalTrial: /clinical trial/.test(text) && !/no clinical trial/.test(text) };
}

export const nihItem = (doc, query) => ({
  source: 'nih_guide', number: doc.id, url: doc.url, title: doc.title, agency: doc.agency, text: doc.text, textKind: doc.textKind, kind: doc.kind, query,
  meta: { status: doc.status, activityCodes: doc.activityCodes, parent: doc.parent, clinicalTrials: doc.clinicalTrials, opens: doc.opens, expires: doc.expires, posted: doc.posted, sponsors: doc.sponsors, purpose: doc.purpose, related: doc.related, nihKind: doc.kind },
});

/** NIH Guide: consultas temáticas + mecanismos generales. Devuelve ítems y cuentas; los errores quedan anotados, no rompen. */
export async function harvestNih({ client, terms, brief, today, trace = noopTrace, maxQueries = 6, perpage = 60, env = process.env } = {}) {
  const userAgent = String(env.RESEARCH_USER_AGENT || 'IGCOutreachResearch/1.0');
  const run = limiter(3); const docs = new Map(); const errors = []; const perQuery = [];
  const queries = terms.phrases.slice(0, maxQueries);
  await Promise.all(queries.map((query) => run(async () => {
    try { const r = await nihGuideSearch(client, { query, perpage, userAgent }); perQuery.push({ query, total: r.total, returned: r.docs.length }); for (const d of r.docs) if (!docs.has(d.id)) docs.set(d.id, { doc: d, query }); }
    catch (e) { errors.push({ query, error: String(e?.message || e).slice(0, 120) }); }
  })));
  // ¿El brief es del ámbito del NIH? Al menos dos avisos con el ancla del brief en título o propósito.
  const anchor = contentTokens(terms.anchor)[0];
  const topical = [...docs.values()].filter(({ doc }) => anchor && contentTokens(`${doc.title} ${doc.purpose}`).includes(anchor)).length;
  const plan = mechanismPlan(brief); const parents = [];
  if (topical >= 2) {
    const found = new Map();
    await Promise.all(['Parent R21', 'Parent R01', 'Parent R03', ...(plan.codes.includes('R43') ? ['Parent SBIR', 'Parent STTR'] : [])].map((query) => run(async () => {
      try { const r = await nihGuideSearch(client, { query, perpage: 50, types: 'active', userAgent }); for (const d of r.docs) if (d.parent && !found.has(d.id)) found.set(d.id, d); }
      catch (e) { errors.push({ query, error: String(e?.message || e).slice(0, 120) }); }
    })));
    for (const code of plan.codes) {
      const options = [...found.values()].filter((d) => d.activityCodes.includes(code) && (!d.expires || d.expires >= today) && !parents.some((p) => p.id === d.id))
        .sort((a, b) => (ctRank(a, plan) - ctRank(b, plan)) || String(b.posted || '').localeCompare(String(a.posted || '')));
      if (options[0]) parents.push(options[0]);
    }
    for (const d of parents) if (!docs.has(d.id)) docs.set(d.id, { doc: d, query: `mechanism:${d.activityCodes.join('/')}` });
  }
  const items = [...docs.values()].map(({ doc, query }) => nihItem(doc, query));
  trace.event('harvest', { source: 'nih_guide', queries, per_query: perQuery, items_n: items.length, topical_anchor_docs: topical, mechanisms: parents.map((d) => d.id), ...(errors.length ? { errors } : {}) });
  return { items, errors, parents: parents.map((d) => d.id), topical };
}
const ctRank = (d, plan) => { const ct = String(d.clinicalTrials || '').toLowerCase(); return plan.clinicalTrial ? (/required|optional/.test(ct) ? 0 : 1) : (/not_allowed|not allowed/.test(ct) ? 0 : /optional/.test(ct) ? 1 : 2); };

/** Registro federal (Simpler.Grants.gov si hay clave; si no, Grants.gov) con consultas cortas. Usa tools.registry (refs abribles y traza). */
/** Consultas de mecanismos generales del NIH en el registro (títulos oficiales «Parent R21 …»), por si la guía no responde. */
export const MECHANISM_QUERIES = { R21: 'Parent R21 Clinical Trial Not Allowed', R01: 'Parent R01 Clinical Trial Not Allowed', R03: 'Parent R03 Clinical Trial Not Allowed', R43: 'Parent SBIR Clinical Trial Not Allowed', R41: 'Parent STTR Clinical Trial Not Allowed' };
const parentCodes = (title) => { const m = String(title || '').match(/\(Parent\s+([A-Z0-9 /[\]]+?)\s+(?:Clinical|Basic|Independent)/i); if (!m) return []; const raw = m[1].toUpperCase(); const codes = raw.match(/\b[A-Z]{1,2}\d{2}\b/g) || []; if (/SBIR/.test(raw)) codes.push('R43', 'R44'); if (/STTR/.test(raw)) codes.push('R41', 'R42'); return [...new Set(codes)]; };
export async function harvestRegistry({ tools, terms, brief = {}, env = process.env, trace = noopTrace, maxQueries = 6, rows = 25 } = {}) {
  const source = env.SIMPLER_GRANTS_API_KEY ? 'simpler' : 'grants_gov';
  const topical = [...terms.phrases.slice(0, maxQueries - 1), ...(terms.anchor ? [terms.anchor] : [])].filter((q, i, a) => a.indexOf(q) === i).slice(0, maxQueries);
  const plan = mechanismPlan(brief); const mech = [...new Set(plan.codes.map((c) => MECHANISM_QUERIES[c]).filter(Boolean))];
  const queries = [...topical, ...(String(env.ENGINE_DOSSIER_MECHANISM_QUERIES ?? '1') !== '0' ? mech : [])];
  const items = []; const seen = new Set(); const errors = []; const perQuery = [];
  await Promise.all(queries.map(async (query) => {
    const out = await tools.registry({ source, query: query.replace(/[’']s\b/g, ''), n: rows });
    if (out?.error) { errors.push({ query, error: out.error }); return; }
    perQuery.push({ query, returned: (out?.rows || []).length });
    for (const row of out?.rows || []) {
      if (!row.ref || seen.has(row.url)) continue; seen.add(row.url);
      const stored = tools.refs?.get?.(row.ref) || {};
      const text = String(stored.markdown || '');
      const rich = /Summary:|Applicant eligibility:|Applicant types:/.test(text);
      const isMech = mech.includes(query); const codes = parentCodes(row.title);
      if (isMech && !codes.length) continue;   // la consulta de mecanismo solo aporta avisos «Parent …»
      items.push({ source, ref: row.ref, number: row.number, url: row.url, title: row.title, agency: row.agency, text, textKind: rich ? 'synopsis' : 'stub', query: isMech ? `mechanism:${codes.join('/')}` : query,
        meta: { status: row.status, closeDate: row.close_date ? toIso(row.close_date) : null, forecastClose: toIso(text.match(/Estimated \(forecasted\) close date: ([^.\n]+)/)?.[1] || '') || null, ...(codes.length ? { parent: true, activityCodes: codes } : {}) } });
    }
  }));
  // Mecanismos generales del NIH solo si el brief es del ámbito del NIH (al menos dos convocatorias temáticas del NIH).
  const nihTopical = items.filter((x) => !String(x.query).startsWith('mechanism:') && /National Institutes of Health|\bNIH\b/i.test(x.agency || '')).length;
  const kept = nihTopical >= 2 ? items : items.filter((x) => !String(x.query).startsWith('mechanism:'));
  trace.event('harvest', { source, queries, per_query: perQuery, items_n: kept.length, nih_topical: nihTopical, mechanisms: kept.filter((x) => String(x.query).startsWith('mechanism:')).map((x) => x.number), ...(errors.length ? { errors } : {}) });
  return { items: kept, errors, source };
}
/** Fechas del registro: «2026-11-01», «11/01/2026» (Grants.gov usa mm/dd/aaaa). */
export function toIso(v) {
  const s = clean(v); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

/* ── Web: fundaciones, asociaciones y catálogos oficiales ── */
const CALLY = /\b(grants?|awards?|fellowships?|funding|rfa|rfp|nofo|apply|application|opportunit(?:y|ies)|programs?|prizes?|research support|call for proposals)\b/i;
const NEWSY = /\b(news|press|blog|announces?|awarded|recipients?|winners?|receives?|story|stories|podcast|webinar|event)\b/i;
const REGISTRY_HOSTS = /(^|\.)(grants\.gov|simpler\.grants\.gov|sam\.gov)$/i;
/** Consultas web deterministas para fuentes no federales. */
export function webQueries(terms, today, n = 3) {
  const year = String(today || '').slice(0, 4); const a = terms.anchor || terms.phrases[0] || '';
  const topical = terms.phrases.find((p) => contentTokens(p).length >= 2 && !/^nia\b/i.test(p)) || terms.phrases[0] || a;
  return [`${a} research grant program ${year}`, `${topical.replace(/[’']s\b/g, '')} research funding`, `${a} foundation research grants`].filter((q, i, arr) => q.trim() && arr.indexOf(q) === i).slice(0, n);
}
/** Puntaje de un resultado o enlace como posible página de programa (no temático). */
export function callScore({ url = '', title = '', text = '' } = {}, anchor = '') {
  if (hostKind(url) !== 'other' || REGISTRY_HOSTS.test(hostOf(url))) return -99;
  let path = ''; try { path = new URL(url).pathname; } catch { return -99; }
  const label = `${title} ${text} ${path.replace(/[-_/]+/g, ' ')}`;
  let s = 0;
  if (CALLY.test(label)) s += 3;
  if (/\.(org|gov|edu)$|\.(ac|gov|org)\.[a-z]{2}$/.test(hostOf(url))) s += 1;
  if (anchor && label.toLowerCase().includes(anchor.toLowerCase())) s += 2;
  if (NEWSY.test(label)) s -= 4;
  if (/\/(20(1\d|2[0-4]))\//.test(path)) s -= 3;
  if (path === '/' || path === '') s -= 2;
  if (/\.pdf$/i.test(path)) s -= 1;
  return s;
}
/** Abre las mejores páginas de las búsquedas y recorre los catálogos (enlaces individuales del mismo sitio). */
export async function harvestWeb({ tools, terms, today, trace = noopTrace, skipIds = new Set(), maxOpen = 6, maxExpand = 14, perHub = 6, queries = null } = {}) {
  const qs = queries || webQueries(terms, today);
  const found = await Promise.all(qs.map((query) => tools.search({ query })));
  const seen = new Set(); const pool = [];
  for (const [i, f] of found.entries()) for (const r of f?.results || []) {
    if (seen.has(r.url)) continue; seen.add(r.url);
    const ids = foaIdsIn(`${r.url} ${r.title}`); if (ids.length && ids.every((id) => skipIds.has(id))) continue;   // ya cubierta por el registro oficial
    pool.push({ ...r, score: callScore(r, terms.anchor), query: qs[i] });
  }
  pool.sort((a, b) => b.score - a.score);
  const pick = pool.filter((r) => r.score >= 2).slice(0, maxOpen);
  const opened = await Promise.all(pick.map((r) => tools.open({ ref: r.ref })));
  const items = []; const hubs = []; const openedUrls = new Set();
  for (const [i, page] of opened.entries()) {
    if (!page?.ref) continue; openedUrls.add(page.url);
    const text = String(page.text || '').replace(/^<page_data>|<\/page_data>$/g, '');
    const triage = triagePage({ url: page.url, title: page.title, text, links: page.links || [], today });
    items.push({ source: 'web', ref: page.ref, url: page.url, title: page.title, text, textKind: 'web', query: pick[i].query, meta: {}, triage: { kind: triage.structure.kind, banners: triage.banners.map((b) => b.kind) } });
    const site = hostOf(page.url).split('.').slice(-2).join('.');
    const grantLinks = (page.links || []).filter((l) => hostOf(l.url).endsWith(site) && callScore({ url: l.url, title: l.text }, terms.anchor) >= 3 && !openedUrls.has(l.url));
    if (triage.structure.kind === 'list' || grantLinks.length >= 4) hubs.push({ page, links: grantLinks });
  }
  // Catálogo = fuente de descubrimiento, nunca candidato por sí mismo: se abren sus páginas individuales.
  const expand = []; const queued = new Set(openedUrls);
  for (const hub of hubs) for (const l of hub.links.sort((a, b) => callScore({ url: b.url, title: b.text }, terms.anchor) - callScore({ url: a.url, title: a.text }, terms.anchor)).slice(0, perHub)) {
    if (expand.length >= maxExpand || queued.has(l.url)) continue; queued.add(l.url); expand.push({ ...l, hub: hub.page.url });
  }
  const more = await Promise.all(expand.map((l) => tools.open({ ref: l.ref })));
  for (const [i, page] of more.entries()) {
    if (!page?.ref) continue;
    const text = String(page.text || '').replace(/^<page_data>|<\/page_data>$/g, '');
    items.push({ source: 'web', ref: page.ref, url: page.url, title: page.title, text, textKind: 'web', query: `catalog:${expand[i].hub}`, meta: {}, fromHub: expand[i].hub });
  }
  for (const it of items) if (hubs.some((h) => h.page.url === it.url)) it.hub = true;
  trace.event('harvest', { source: 'web', queries: qs, results_n: pool.length, opened_n: opened.filter((p) => p?.ref).length, hubs: hubs.map((h) => h.page.url), expanded_n: more.filter((p) => p?.ref).length, items_n: items.length });
  return { items, hubs: hubs.map((h) => h.page.url), queries: qs };
}
