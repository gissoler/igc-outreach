/* ─────────────────────────────────────────────────────────────────────────────
   V15 · Etapa de inversionistas: de la búsqueda a fondos con evidencia verificable por código.
   Por qué (benchmark v9, 12-10; runs-v5 del Pipeline I+D, 20-10): el modelo elegía el fondo entre listas de nombres y
   acertaba 0–3 de 6; el juez LLM dejó en «apply» a Sanofi Ventures sin geografía ni hechos del solicitante, y retuvo una
   empresa operativa (Recursion), una nota de prensa de 2023 (Chugai) y un premio de investigación (Gates/NACC) como
   «inversores». Aquí NINGÚN paso pide al modelo elegir ni juzgar:
     1. cosecha: consultas escritas por el código desde el brief; listas → candidatos con dominio (sus enlaces);
        noticias de rondas → nombres («led by…») resueltos por búsqueda con coincidencia nombre–dominio; Apollo
        (organizaciones por palabras clave, si está encendido); páginas que leyó el agente;
     2. candidatos por organización (dominio registrable), ordenados por evidencia de búsqueda (fuentes distintas, señal
        de inversor en nombre/título, términos del brief) — sin modelo;
     3. expediente por organización: página de entrada + home + hasta 3 páginas institucionales (about/approach/focus/
        portfolio/contact) del mismo dominio;
     4. evidencia por código con cita literal y URL (evidence.mjs): inversor, tesis, etapa, geografía, contacto, actividad;
     5. clasificación: se descarta todo lo que no sea un inversor con tesis en el sector del brief; «main» solo con todo
        verificado Y hechos del solicitante confirmados; si no, «verify» con bloqueos y condiciones a la vista;
     6. orden por evidencia (no por el modelo), embudo completo y una línea de estado honesta.
   ───────────────────────────────────────────────────────────────────────────── */
import { applicantFacts } from '../dossier/pipeline.mjs';
import { hostOf, literalIn } from '../verify.mjs';
import { contentTokens } from '../dossier/terms.mjs';
import { investorQueries, sectorOf } from './sector.mjs';
import { orgEvidence } from './evidence.mjs';
import { INVESTORISH_LABEL, isArticleUrl, linkedInvestors, nameCore, namesFromHeadings, orgDisplayName, candidatesFromList, isThirdParty, nameMatchesDomain, namesFromNews, orgKey, roleOf } from './orgs.mjs';

const noopTrace = { event: () => null };
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const unpage = (t) => String(t || '').replace(/^<page_data>|<\/page_data>$/g, '');
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const INVESTORISH = /\b(ventures?|capital|partners|vc|fund|funds|invest\w*|holdings|equity|seed|angels?|family offices?)\b/i;
const INSTITUTIONAL_LINK = /\b(about|who we are|approach|thesis|focus|strategy|sectors?|areas?|what we (?:do|invest|look for)|invest\w*|portfolio|companies|contact|pitch|submit|founders|apply|team|our story|mission)\b/i;

/** La propia empresa del brief nunca es un inversor (14-10: salían sus directivos como «inversores»). */
export function isSelf(url, brief = {}) {
  const label = orgKey(url).split('.')[0].replace(/[^a-z0-9]/g, '');
  const names = [brief.company, brief.organization].map((x) => String(x || '').toLowerCase().replace(/\b(inc|llc|ltd|corp|plc)\b\.?/g, '').replace(/[^a-z0-9]/g, '')).filter((n) => n.length >= 4);
  return names.some((n) => label === n || label.startsWith(n));
}

/** Resuelve nombres de inversionistas a su sitio por búsqueda. Se acepta un resultado si su dominio coincide con el nombre, o si el título lo nombra y suena a inversor. */
export async function resolveNames({ tools, names, brief, addCand, source }) {
  let resolved = 0; const log = [];
  await Promise.all(names.map(async (x) => {
    const r = await tools.search({ query: `"${x.name}" venture capital` }).catch(() => null);
    const core = nameCore(x.name); const rx = core.length >= 4 ? new RegExp(`\\b${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
    const rows = (r?.results || []).filter((row) => !isThirdParty(row.url) && !/\.(pdf|docx?|pptx?|xlsx?)(\?|$)/i.test(row.url) && !/^(assets|cdn|static|files|media|downloads?)\./i.test(hostOf(row.url) || ''));
    const hitRow = rows.find((row) => nameMatchesDomain(x.name, row.url)) || rows.find((row) => rx && rx.test(row.title || '') && (INVESTORISH.test(`${row.title} ${row.snippet}`) || INVESTORISH_LABEL.test(orgKey(row.url).split('.')[0])));
    log.push({ name: x.name, from: x.from, url: hitRow?.url || null });
    if (hitRow && !isSelf(hitRow.url, brief)) { resolved++; addCand(orgKey(hitRow.url), { name: x.name, url: hitRow.url, ref: hitRow.ref, source: `${source}:${orgKey(x.from)}`, via: 'news', snippet: `${hitRow.title} ${hitRow.snippet}` }); }
  }));
  return { resolved, log };
}

/* ── 1 · Cosecha ── */
export async function harvestInvestors({ tools, brief, today, trace = noopTrace, env = process.env, apolloRows = [] } = {}) {
  const maxQ = Number(env.ENGINE_INVESTOR_SEARCHES) || 15; const queries = investorQueries(brief, maxQ);
  const found = await Promise.all(queries.map((query) => tools.search({ query }).then((r) => ({ query, r })).catch((e) => ({ query, r: { error: String(e?.message || e) } }))));
  const cands = new Map(); const lists = []; const news = []; const errors = [];
  const addCand = (key, row) => {
    if (!key) return; const c = cands.get(key) || { key, names: [], urls: [], refs: [], sources: new Set(), via: new Set(), snippets: [] };
    if (row.name && !c.names.includes(row.name)) c.names.push(row.name); if (row.url && !c.urls.includes(row.url)) c.urls.push(row.url); if (row.ref) c.refs.push({ ref: row.ref, url: row.url });
    if (row.source) c.sources.add(row.source); if (row.via) c.via.add(row.via); if (row.snippet) c.snippets.push(clean(row.snippet).slice(0, 300)); cands.set(key, c);
  };
  let results = 0;
  for (const { query, r } of found) {
    if (r?.error) { errors.push({ query, error: r.error }); continue; }
    for (const row of r?.results || []) {
      results++; const role = roleOf({ url: row.url, title: row.title, snippet: row.snippet });
      if (role === 'list') lists.push({ ...row, query }); else if (role === 'news') news.push({ ...row, query });
      else if (role === 'org' && !isSelf(row.url, brief)) { if (isArticleUrl(row.url)) { news.push({ ...row, query }); continue; }   // nota en el sitio de una empresa («X raises $5M led by…»): fuente de nombres, nunca candidata (la financiada no es el inversor)
        addCand(orgKey(row.url), { name: clean(row.title).split(/\s[|–—-]\s/)[0].slice(0, 80), url: row.url, ref: row.ref, source: `search:${query}`, via: 'search', snippet: `${row.title} ${row.snippet}` }); }
    }
  }
  // Listas: sus enlaces externos son candidatos con dominio (sin resolver nombres ni pedirle al modelo que elija).
  const maxLists = Number(env.ENGINE_INVESTOR_LISTS) || 5; const maxNews = Number(env.ENGINE_INVESTOR_NEWS) || 6;
  const uniq = (rows) => { const seen = new Set(); return rows.filter((x) => !seen.has(x.url) && seen.add(x.url)); };
  const listPages = (await Promise.all(uniq(lists).slice(0, maxLists).map((x) => tools.open({ ref: x.ref })))).filter((p) => p?.ref);
  let fromLists = 0;
  for (const page of listPages) for (const c of candidatesFromList(page)) { if (isSelf(c.url, brief)) continue; fromLists++; addCand(c.key, { name: c.name, url: c.url, ref: c.ref, source: `list:${orgKey(page.url)}`, via: 'list', snippet: c.context || c.name }); }
  // Noticias de rondas: nombres por regla; se resuelven por búsqueda y solo se aceptan si el dominio coincide con el nombre.
  const newsPages = (await Promise.all(uniq(news).slice(0, maxNews).map((x) => tools.open({ ref: x.ref })))).filter((p) => p?.ref);
  const names = []; const pushName = (n, from) => { if (!names.some((x) => x.name.toLowerCase() === n.toLowerCase())) names.push({ name: n, from }); };
  for (const page of listPages) for (const n of namesFromHeadings(unpage(page.text))) pushName(n, page.url);   // «## Novo Holdings» (listas en prosa, sin enlaces)
  for (const p of newsPages) { for (const n of namesFromNews(unpage(p.text))) pushName(n, p.url); for (const l of linkedInvestors({ ...p, text: unpage(p.text) })) addCand(l.key, { name: l.name, url: l.url, ref: l.ref, source: `news:${orgKey(p.url)}`, via: 'news', snippet: l.name }); }
  const known = (n) => [...cands.values()].some((c) => c.names.some((x) => x.toLowerCase() === n.toLowerCase()) || nameMatchesDomain(n, `https://${c.key}`));
  const toResolve = names.filter((x) => !known(x.name)).slice(0, Number(env.ENGINE_INVESTOR_RESOLVE) || 14);
  for (const x of names) if (known(x.name)) { const c = [...cands.values()].find((c) => nameMatchesDomain(x.name, `https://${c.key}`) || c.names.some((y) => y.toLowerCase() === x.name.toLowerCase())); if (c) { c.sources.add(`news:${orgKey(x.from)}`); c.via.add('news'); } }
  const { resolved, log: resolveLog } = await resolveNames({ tools, names: toResolve, brief, addCand, source: 'news' });
  // Apollo: organizaciones por palabras clave del brief (ya pedidas antes del primer paso). Una pista, no evidencia.
  for (const row of apolloRows) if (row?.url && !isThirdParty(row.url) && !isSelf(row.url, brief)) addCand(orgKey(row.url), { name: row.name, url: row.url, ref: row.ref, source: 'apollo', via: 'apollo', snippet: `${row.name || ''} ${row.industry || ''} ${row.description || ''}` });
  const stats = { queries, results, lists_opened: listPages.length, list_candidates: fromLists, news_opened: newsPages.length, names_found: names.length, names_resolved: resolved, resolve_tried: toResolve.length, apollo_rows: apolloRows.length, errors };
  trace.event('investor_harvest', { ...stats, lists: listPages.map((p) => p.url), news: newsPages.map((p) => p.url), resolve: resolveLog, candidates_n: cands.size });
  return { cands, stats, addCand };
}

/** Orden de candidatos ANTES de abrir: solo evidencia de búsqueda, sin modelo. */
export function rankCandidates(cands, sector) {
  const rows = [...cands.values()].map((c) => {
    const label = `${c.names.join(' ')} ${c.key} ${c.snippets.join(' ')}`;
    const toks = new Set(contentTokens(c.snippets.join(' ')));
    const termHits = [...sector.tokens].filter((t) => toks.has(t)).length;
    const score = Math.min(4, c.sources.size) * 2 + (INVESTORISH.test(`${c.names.join(' ')} ${c.key}`) || INVESTORISH_LABEL.test(c.key.split('.')[0]) ? 2 : 0) + (INVESTORISH.test(label) ? 1 : 0) + (c.via.has('list') ? 1 : 0) + (c.via.has('news') ? 1 : 0) + (c.via.has('apollo') ? 1 : 0) + Math.min(2, termHits);
    return { ...c, score };
  });
  return rows.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/* ── 3 · Expediente: entrada + home + páginas institucionales del mismo dominio ── */
let refSeq = 0;
async function openUrl(tools, url, title = '') {
  const ref = `v${++refSeq}`; tools.refs?.set?.(ref, { url, title, snippet: '', markdown: '' });
  const page = await tools.open({ ref }).catch(() => null); return page?.ref ? page : null;
}
const pageOf = (p) => ({ url: p.url, title: p.title, text: unpage(p.text), links: p.links || [] });
const isHome = (u) => { try { const x = new URL(u); return x.pathname === '/' || x.pathname === ''; } catch { return false; } };
/** Fase A (barata): la página de entrada (resultado o enlace de la lista) y, si no era la home, la home. */
export async function openEntry(tools, cand, { extraPages = [] } = {}) {
  const pages = [...extraPages]; const seen = new Set(pages.map((p) => p.url));
  const entry = cand.refs.find((r) => !seen.has(r.url));
  const first = entry ? await tools.open({ ref: entry.ref }).catch(() => null) : null;
  if (first?.ref && !seen.has(first.url)) { pages.push(pageOf(first)); seen.add(first.url); }
  if (![...seen].some(isHome)) { const home = await openUrl(tools, `https://${cand.key}/`, cand.names[0]) || await openUrl(tools, `https://www.${cand.key}/`, cand.names[0]); if (home && !seen.has(home.url)) { pages.push(pageOf(home)); seen.add(home.url); } }
  return pages;
}
/** Fase B: hasta `maxSub` páginas institucionales del mismo dominio (enfoque/tesis primero, luego about y contacto). */
export async function openDeep(tools, cand, pages, { maxSub = 3 } = {}) {
  const seen = new Set(pages.map((p) => p.url)); const links = [];
  for (const p of pages) for (const l of p.links || []) if (orgKey(l.url) === cand.key && !seen.has(l.url) && INSTITUTIONAL_LINK.test(`${l.text || ''} ${(() => { try { return new URL(l.url).pathname; } catch { return ''; } })()}`) && !/\/(news|press|blog|media|events?|careers?|jobs?|privacy|terms|cookie|legal)(\/|$)/i.test(l.url)) links.push(l);
  const rank = (l) => (/\b(approach|thesis|focus|strategy|what we|invest)/i.test(`${l.text} ${l.url}`) ? 0 : /\b(about|who we are|mission)/i.test(`${l.text} ${l.url}`) ? 1 : /\b(contact|pitch|submit|founders|apply)/i.test(`${l.text} ${l.url}`) ? 2 : 3);
  const picks = []; for (const l of links.sort((a, b) => rank(a) - rank(b))) { if (picks.length >= maxSub) break; if (!picks.some((x) => x.url === l.url)) picks.push(l); }
  const more = await Promise.all(picks.map((l) => (l.ref ? tools.open({ ref: l.ref }).catch(() => null) : openUrl(tools, l.url, l.text))));
  const out = [...pages]; for (const p of more) if (p?.ref && !seen.has(p.url)) { out.push(pageOf(p)); seen.add(p.url); }
  return out;
}
export async function openOrg(tools, cand, { maxSub = 3, extraPages = [] } = {}) { return openDeep(tools, cand, await openEntry(tools, cand, { extraPages }), { maxSub }); }

/** Filtro rápido sobre la página de entrada (sin modelo): ¿se presenta como inversor y nombra el sector? Decide qué se profundiza. */
export function quickScreen(pages, sector, cand) {
  const ev = orgEvidence({ pages, sector, brief: {}, facts: { country: null }, today: null, org: { key: cand.key, names: cand.names } });
  const fundLike = INVESTORISH.test(`${cand.names.join(' ')} ${cand.key}`) || INVESTORISH_LABEL.test(cand.key.split('.')[0]); const thin = pages.reduce((n, p) => n + String(p.text || '').length, 0) < 2500;
  return (ev.investor.ok ? 3 : fundLike ? 1 : 0) + (!ev.investor.ok && fundLike && thin ? 2 : 0) + (ev.thesis.value === 'specific' ? 4 : ev.thesis.value === 'broad' ? 2 : 0) + (ev.directory ? -3 : 0) + cand.score / 10;
}

/* ── 5 · Clasificación ── */
export function classifyOrg({ cand, ev, facts, brief }) {
  const drop = isSelf(cand.urls[0] || `https://${cand.key}`, brief) ? 'self'
    : ev.chars < 150 ? 'not_evaluable'
      : ev.service ? 'service_firm'
      : ev.directory && !ev.investor.ok ? 'directory'
      : !ev.investor.ok ? (ev.investor.value === 'partnering' ? 'partnering_route' : 'not_investor')
        : !ev.thesis.ok ? 'no_sector_thesis' : null;
  const blockers = []; const conditions = [];
  if (!drop) {
    if (ev.thesis.value === 'broad') blockers.push(`Thesis names only a broad sector (${ev.thesis.terms.join(', ')}), not this brief's specific field`);
    if (ev.stage.value === 'not_stated') blockers.push('Investment stage not stated on the investor\'s pages');
    else if (ev.stage.value === 'brief_unknown') conditions.push({ check: 'stage', kind: 'applicant_unknown', text: `Invests at: ${ev.stage.investor_stages.join(', ')}; the brief does not state the round`, quote: ev.stage.quote, url: ev.stage.url });
    else if (ev.stage.value === 'no') blockers.push(`Stage mismatch: the investor says it invests only later than the brief's stage (${ev.stage.brief_stage})`);
    else if (ev.stage.value === 'doubtful') blockers.push(`Stage not confirmed for a ${ev.stage.brief_stage}-stage venture (investor states: ${ev.stage.investor_stages.join(', ')})`);
    if (ev.geography.value === 'not_stated') blockers.push('Geography not stated on the investor\'s pages');
    else if (ev.geography.value === 'applicant_unknown') conditions.push({ check: 'geography', kind: 'applicant_unknown', text: `Invests in: ${ev.geography.regions.join(', ')}; the brief does not confirm the applicant's country`, quote: ev.geography.quote, url: ev.geography.url });
    else if (ev.geography.value === 'no') blockers.push(`Geography excludes the applicant (${facts.country}): invests only in ${ev.geography.regions.join(', ')}`);
    else if (ev.geography.value === 'doubtful') blockers.push(`Geography not confirmed for ${facts.country} (investor states: ${ev.geography.regions.join(', ')})`);
    if (!ev.contact.ok) blockers.push('No way to pitch or contact found on the investor\'s pages');
    if (!ev.recent.ok) blockers.push('No sign of recent activity (no investment news from the last two years on the pages read)');
    if (facts.missing.length) blockers.push(`Applicant facts not confirmed in the brief: ${facts.missing.join(', ')}`);
  }
  const verified = { thesis_specific: ev.thesis.value === 'specific', stage: ev.stage.value === 'yes', geography: ev.geography.value === 'yes', contact: ev.contact.ok, recent: ev.recent.ok, applicant_confirmed: !facts.missing.length };
  const tier = drop ? 'drop' : Object.values(verified).every(Boolean) && !blockers.length && !conditions.length ? 'main' : 'verify';
  const score = drop ? -1 : (ev.thesis.value === 'specific' ? 6 : 2) + Math.min(3, ev.thesis.all_terms.length) + Math.min(2, ev.thesis.sentences - 1)
    + ({ yes: 3, brief_unknown: 1, doubtful: 0, not_stated: 0, no: -3 }[ev.stage.value] ?? 0) + ({ yes: 2, applicant_unknown: 1, doubtful: 0, not_stated: 0, no: -3 }[ev.geography.value] ?? 0)
    + (ev.contact.value === 'pitch' ? 2 : ev.contact.ok ? 1 : 0) + (ev.recent.ok ? 1 : 0) + Math.min(3, cand.sources.size) * 0.5;
  return { drop, tier, blockers, conditions, verified, score: Math.round(score * 10) / 10 };
}

function toFinding({ cand, ev, cls, facts, pages = [] }) {
  const name = orgDisplayName(cand, pages);
  const q = (c) => (c?.quote ? { quote: c.quote, url: c.url } : null);
  return {
    objective: 'investment', url: ev.thesis.url || ev.pages[0], title: name, name, query: 'investor_dossier', family: 'investor_dossier', providers: [...cand.via], model: null, keep: true, drop: null,
    status: 'n/a', deadline: null, daysLeft: null, eligible: facts.missing.length || cls.conditions.length ? 'conditional' : cls.tier === 'main' ? 'yes' : 'unclear', nonDilutive: 'no', money: 'equity', amount: null,
    pageType: { type: 'investor_about' }, read_contract: 'investor_dossier', tier: cls.tier, verdict: cls.tier === 'main' ? 'apply' : 'watch', flags: [], blockers: cls.blockers,
    conditions: cls.conditions.map((c) => `${c.text}${c.quote ? `: “${clean(c.quote).slice(0, 200)}”` : ''}`),
    quotes: { identity: ev.investor.quote, eligible: ev.thesis.quote, ...(ev.stage.quote ? { stage: ev.stage.quote } : {}), ...(ev.geography.quote ? { geography: ev.geography.quote } : {}), ...(ev.contact.quote ? { how_to_apply: ev.contact.quote } : {}), ...(ev.recent.quote ? { recent: ev.recent.quote } : {}) },
    evidence: { investor: q(ev.investor), thesis: { ...q(ev.thesis), level: ev.thesis.value, terms: ev.thesis.all_terms }, stage: { ...q(ev.stage), fit: ev.stage.value, investor_stages: ev.stage.investor_stages, brief_stage: ev.stage.brief_stage }, geography: { ...q(ev.geography), fit: ev.geography.value, regions: ev.geography.regions }, contact: { ...q(ev.contact), url: ev.contact.url || null, kind: ev.contact.value, link: ev.contact.link?.url || null }, recent: { ...q(ev.recent), year: ev.recent.value } },
    verified_by_code: cls.verified, fit: { topic: ev.thesis.value === 'specific' ? 'yes' : 'broad', reason: `Thesis terms: ${ev.thesis.all_terms.join(', ')}`, applicant_missing: facts.missing },
    org: { key: cand.key, sources: [...cand.sources], via: [...cand.via], pages: ev.pages, score: cls.score }, reasons: [], trace: { queries: [...cand.sources].filter((s) => s.startsWith('search:')).map((s) => ({ query: s.slice(7), family: 'investor_dossier' })) },
  };
}

/** Comprobación de seguridad: toda cita de un hallazgo retenido debe estar, literal, en la página que cita. */
export function auditQuotes(finding, pagesByUrl) {
  const bad = [];
  for (const [k, v] of Object.entries(finding.evidence || {})) {
    if (k === 'contact' && v?.link && !v.quote) { const p = pagesByUrl.get(v.url); if (!p || !(p.links || []).some((l) => l.url === v.link)) bad.push(k); continue; }
    if (!v?.quote || !v.url) continue; const p = pagesByUrl.get(v.url); if (!p || !literalIn(v.quote, p.text)) bad.push(k);
  }
  return bad;
}

/** Cosecha + apertura de los candidatos mejor ordenados, pensada para correr EN PARALELO al agente. */
export async function prefetchInvestors({ tools, brief, today, trace = noopTrace, env = process.env, apolloRows = [] } = {}) {
  const sector = sectorOf(brief);
  const { cands, stats, addCand } = await harvestInvestors({ tools, brief, today, trace, env, apolloRows });
  const screenN = Number(env.ENGINE_INVESTOR_SCREEN) || 40; const maxOrgs = Number(env.ENGINE_INVESTOR_ORGS) || 16; const conc = Number(env.ENGINE_INVESTOR_CONCURRENCY) || 6;
  const opened = new Map(); const screenedAll = [];
  const screenDeepen = async (batch, deepMax) => {
    const entries = await pool(batch, conc, async (c) => ({ c, pages: await openEntry(tools, c) }));
    const screened = entries.map((x) => ({ ...x, q: x.pages.length ? quickScreen(x.pages, sector, x.c) : -9 })).sort((a, b) => b.q - a.q);
    const deep = screened.filter((x) => x.q >= 2).slice(0, deepMax);
    const deepened = await pool(deep, conc, async (x) => [x.c.key, await openDeep(tools, x.c, x.pages, { maxSub: Number(env.ENGINE_INVESTOR_SUBPAGES) || 3 })]);
    for (const x of screened) opened.set(x.c.key, x.pages); for (const [k, pages] of deepened) opened.set(k, pages);
    screenedAll.push(...screened.map((x) => ({ key: x.c.key, q: Math.round(x.q * 10) / 10, deep: deep.includes(x) }))); return { entries, deep };
  };
  const r1 = await screenDeepen(rankCandidates(cands, sector).slice(0, screenN), maxOrgs);
  stats.screened = r1.entries.length; stats.deepened = r1.deep.length;
  // Segunda ronda: los fondos que pasaron el filtro nombran a sus co-inversores («co-led by X», «alongside Y») en sus noticias de cartera. Son candidatos nuevos, resueltos por búsqueda.
  const snowN = Number(env.ENGINE_INVESTOR_SNOWBALL); const maxSnow = Number.isFinite(snowN) ? snowN : 8;
  if (maxSnow > 0 && addCand) {
    const PORT = /\b(portfolio|news|press|announcements?|investments|companies)\b/i; const perFund = Number(env.ENGINE_INVESTOR_PORTFOLIO) || 2; const extra = new Map();
    await pool(r1.deep.slice(0, 8), conc, async (x) => {
      const have = opened.get(x.c.key) || []; const seenU = new Set(have.map((p) => p.url)); const ls = [];
      for (const p of have) for (const l of p.links || []) if (orgKey(l.url) === x.c.key && !seenU.has(l.url) && PORT.test(`${l.text || ''} ${(() => { try { return new URL(l.url).pathname; } catch { return ''; } })()}`) && !/\.(pdf|jpe?g|png|zip)(\?|$)/i.test(l.url) && !ls.some((y) => y.url === l.url)) ls.push(l);
      ls.sort((a, b) => Number(/portfolio|news|press/i.test(b.url + b.text)) - Number(/portfolio|news|press/i.test(a.url + a.text)));
      const got = await Promise.all(ls.slice(0, perFund).map((l) => (l.ref ? tools.open({ ref: l.ref }).catch(() => null) : openUrl(tools, l.url, l.text))));
      extra.set(x.c.key, got.filter((p) => p?.ref).map(pageOf));
    });
    const names = []; for (const x of r1.deep) for (const p of [...(opened.get(x.c.key) || []), ...(extra.get(x.c.key) || [])]) for (const n of namesFromNews(unpage(p.text))) { if (nameMatchesDomain(n, `https://${x.c.key}`)) continue; if (!names.some((y) => y.name.toLowerCase() === n.toLowerCase())) names.push({ name: n, from: p.url }); }
    const known = (n) => [...cands.values()].some((c) => c.names.some((y) => y.toLowerCase() === n.toLowerCase()) || nameMatchesDomain(n, `https://${c.key}`));
    const before = new Set(cands.keys()); const fresh = names.filter((x) => !known(x.name)).slice(0, maxSnow * 2);
    const { resolved, log } = await resolveNames({ tools, names: fresh, brief, addCand, source: 'portfolio' });
    const added = [...cands.values()].filter((c) => !before.has(c.key) && !opened.has(c.key));
    const r2 = added.length ? await screenDeepen(rankCandidates(new Map(added.map((c) => [c.key, c])), sector).slice(0, maxSnow), Math.max(4, Math.floor(maxOrgs / 2))) : { entries: [], deep: [] };
    stats.snowball = { names: names.length, tried: fresh.length, resolved, added: added.length, screened: r2.entries.length, deepened: r2.deep.length };
    trace.event('investor_harvest', { snowball: true, ...stats.snowball, resolve: log, candidates_n: cands.size });
  }
  trace.event('investor_screen', { screened: screenedAll });
  return { cands, stats, opened };
}

/**
 * Etapa completa. deps: { tools (search, open, refs), trace, env }.
 * input: { brief, today, agentPages: [{url,title,text,links}], apolloRows, prefetched? (de prefetchInvestors) }
 */
export async function runInvestorStage({ tools, brief, today, trace = noopTrace, env = process.env, agentPages = [], apolloRows = [], prefetched = null } = {}) {
  const t0 = Date.now(); const sector = sectorOf(brief); const facts = applicantFacts(brief);
  const pre = prefetched || { ...(await harvestInvestors({ tools, brief, today, trace, env, apolloRows })), opened: new Map() };
  const { cands, stats, opened: done } = pre;
  // Páginas que leyó el agente: si son de una organización (no prensa ni directorio) se suman a su expediente.
  const extra = new Map();
  for (const p of agentPages) { if (!p?.url || isThirdParty(p.url) || isSelf(p.url, brief)) continue; const key = orgKey(p.url); if (!cands.has(key)) cands.set(key, { key, names: [clean(p.title).split(/\s[|–—-]\s/)[0].slice(0, 80)], urls: [p.url], refs: [], sources: new Set(['agent']), via: new Set(['agent']), snippets: [clean(p.title)] }); else { cands.get(key).sources.add('agent'); cands.get(key).via.add('agent'); } if (!extra.has(key)) extra.set(key, []); extra.get(key).push({ url: p.url, title: p.title, text: unpage(p.text), links: p.links || [] }); }
  const ranked = rankCandidates(cands, sector);
  const maxOrgs = Number(env.ENGINE_INVESTOR_ORGS) || 16;
  // Lo ya abierto en paralelo se evalúa siempre; el resto del cupo, por orden.
  const rest = ranked.filter((c) => !done.has(c.key)); const restN = done.size ? Number(env.ENGINE_INVESTOR_AGENT_ORGS) || 8 : maxOrgs;
  const selected = [...ranked.filter((c) => done.has(c.key)), ...rest.filter((c) => c.via.has('agent')), ...rest.filter((c) => !c.via.has('agent'))].slice(0, done.size + restN);
  for (const c of ranked) if (!selected.includes(c)) trace.event('investor_org', { key: c.key, decision: 'not_selected', score: c.score, via: [...c.via] });
  const opened = await pool(selected, Number(env.ENGINE_INVESTOR_CONCURRENCY) || 6, async (c) => {
    const mine = extra.get(c.key) || [];
    if (done.has(c.key)) { const have = done.get(c.key); const urls = new Set(have.map((p) => p.url)); return { c, pages: [...have, ...mine.filter((p) => !urls.has(p.url))] }; }
    return { c, pages: await openOrg(tools, c, { maxSub: Number(env.ENGINE_INVESTOR_SUBPAGES) || 3, extraPages: mine }) };
  });
  const funnel = { ...stats, candidates: cands.size, by_via: {}, selected: selected.length, opened: 0, dropped: {}, kept: 0, main: 0, verify: 0, specific: 0, verified: { stage: 0, geography: 0, contact: 0, recent: 0 }, apollo: { candidates: 0, selected: 0, kept: 0 }, quote_audit_failed: 0 };
  for (const c of cands.values()) for (const v of c.via) funnel.by_via[v] = (funnel.by_via[v] || 0) + 1;
  funnel.apollo.candidates = [...cands.values()].filter((c) => c.via.has('apollo')).length; funnel.apollo.selected = selected.filter((c) => c.via.has('apollo')).length;
  const findings = []; const otherRoutes = []; const decisions = [];
  for (const { c, pages } of opened) {
    if (pages.length) funnel.opened++;
    const ev = orgEvidence({ pages, sector, brief, facts, today, org: { key: c.key, names: c.names } }); const cls = classifyOrg({ cand: c, ev, facts, brief });
    const row = { key: c.key, decision: cls.drop ? 'drop' : cls.tier, reason: cls.drop, decided_by: 'code', score: cls.score, via: [...c.via], pages: ev.pages, checks: { investor: ev.investor.value, thesis: ev.thesis.value, stage: ev.stage.value, geography: ev.geography.value, contact: ev.contact.value, recent: ev.recent.ok }, ...(cls.drop ? {} : { blockers: cls.blockers, conditions: cls.conditions.map((x) => x.check) }) };
    trace.event('investor_org', row); decisions.push(row);
    if (cls.drop) { funnel.dropped[cls.drop] = (funnel.dropped[cls.drop] || 0) + 1; if (cls.drop === 'partnering_route') otherRoutes.push({ org: c.key, route: 'partnering', quote: ev.investor.quote, url: ev.investor.url }); continue; }
    const f = toFinding({ cand: c, ev, cls, facts, pages });
    const bad = auditQuotes(f, new Map(pages.map((p) => [p.url, p])));
    if (bad.length) { funnel.quote_audit_failed++; trace.event('investor_org', { key: c.key, decision: 'drop', reason: 'quote_audit_failed', checks: bad }); funnel.dropped.quote_audit_failed = (funnel.dropped.quote_audit_failed || 0) + 1; continue; }
    findings.push(f);
  }
  { const better = (x, y) => (x.tier === 'main' ? 0 : 1) - (y.tier === 'main' ? 0 : 1) || y.org.score - x.org.score; const best = new Map();
    for (const f of [...findings].sort(better)) { const label = f.org.key.split('.')[0]; if (label.length >= 5 && best.has(label)) { best.get(label).org.also_domains = [...(best.get(label).org.also_domains || []), f.org.key]; funnel.dropped.duplicate_domain = (funnel.dropped.duplicate_domain || 0) + 1; continue; } best.set(label, f); }
    const keep = new Set(best.values()); for (let i = findings.length - 1; i >= 0; i--) if (!keep.has(findings[i])) findings.splice(i, 1); }
  findings.sort((a, b) => (a.tier === 'main' ? 0 : 1) - (b.tier === 'main' ? 0 : 1) || b.org.score - a.org.score);
  funnel.kept = findings.length; funnel.main = findings.filter((f) => f.tier === 'main').length; funnel.verify = funnel.kept - funnel.main; funnel.specific = findings.filter((f) => f.evidence.thesis.level === 'specific').length;
  for (const k of ['stage', 'geography', 'contact', 'recent']) funnel.verified[k] = findings.filter((f) => f.verified_by_code[k]).length;
  funnel.apollo.kept = findings.filter((f) => f.org.via.includes('apollo')).length; funnel.ms = Date.now() - t0;
  const statusLine = investorStatusLine(funnel, facts);
  trace.event('investor_summary', { funnel, status_line: statusLine, other_routes: otherRoutes, facts_missing: facts.missing });
  return { findings, funnel, decisions, otherRoutes, facts, statusLine };
}

export function investorStatusLine(f, facts) {
  const src = Object.entries(f.by_via).map(([k, v]) => `${k} ${v}`).join(', ');
  const drops = Object.entries(f.dropped).map(([k, v]) => `${k} ${v}`).join(', ');
  const core = `${f.candidates} organizaciones candidatas (${src || 'ninguna fuente'}) → ${f.opened} abiertas → ${f.kept} inversores con tesis verificada en su propio sitio (${f.specific} específica${f.specific === 1 ? '' : 's'})${drops ? `; descartes: ${drops}` : ''}.`;
  const tail = f.main ? ` ${f.main} listos para contactar.` : facts.missing.length ? ` Ninguno listo para contactar: el brief no confirma ${facts.missing.join(', ')}; geografía y etapa quedan como condición.` : ' Ninguno listo para contactar: faltan comprobaciones (ver bloqueos).';
  return `${core}${tail}`;
}
