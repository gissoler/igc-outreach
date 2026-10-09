// V5-3 — Ronda de profundización ("rascar") por firma aceptada con criterios núcleo en unknown (config.deepening.enabled).
// Descubre páginas propias (Exa con includeDomains, enlaces internos, sitemap.xml, rutas habituales), las pasa por el extractor v3
// existente y fusiona por campo: un campo unknown solo pasa a conocido con cita literal verificada en el texto leído; un campo
// conocido no se sobrescribe (la contradicción se registra; solo gana una fuente propia con fecha más reciente). Nunca crea not_met.
import { judgeInvestorV2 } from './judge.mjs';
import { investorHostname as host, sameDomain, isLiteralEvidence, nameMatchesDomain } from './extractor.mjs';
import { canonicalInvestorUrl } from './identity.mjs';
import { candidateKey } from './resolve.mjs';

export const CORE = ['INV-SECTOR', 'INV-STAGE', 'INV-GEO', 'INV-TYPE'];
const FIELD = { 'INV-SECTOR': 'sectors', 'INV-STAGE': 'stages', 'INV-GEO': 'geographies', 'INV-TYPE': 'investor_type' };
const PHRASE = { 'INV-SECTOR': 'sectors', 'INV-STAGE': 'stages', 'INV-GEO': 'geographies (countries and regions)' };
const unique = xs => [...new Set(xs.filter(x => x != null && x !== ''))];
const state = (j, id) => j.criteria.find(c => c.criterion_id === id)?.state ?? 'unknown';

/** Criterios núcleo en unknown (con sector determinista: el LLM de sector corre después) y actividad derivada unknown. */
export function missingFor(entity, judgment) {
  const out = CORE.filter(id => state(judgment, id) === 'unknown');
  if ((entity.active_status ?? 'unknown') === 'unknown') out.push('INV-ACTIVE');
  return out;
}

/** Potencial: primero sector on|partial y tipo conocido; al final inelegibles o sector off. */
export function deepeningPotential(judgment) {
  return (['on', 'partial'].includes(judgment.sector_fit) ? 2 : 0) + (state(judgment, 'INV-TYPE') !== 'unknown' ? 1 : 0) - (judgment.hard_eligibility === 'ineligible' || judgment.sector_fit === 'off' ? 10 : 0);
}

/** Consulta en lenguaje natural que pregunta justo lo que falta. n = 1 (criterios) o 2 (página "about"/estrategia). */
export function deepeningQuery(name, missing, n = 1) {
  const parts = missing.filter(id => PHRASE[id]).map(id => PHRASE[id]);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const type = missing.includes('INV-TYPE') ? `what type of investor ${name} is (venture capital fund, corporate venture arm, public fund, angel network)` : null;
  if (n === 1) {
    if (list) return `${name} investment criteria: ${list} they invest in${type ? `, and ${type}` : ''}`;
    if (type) return `About ${name}: ${type}`;
    return `${name} recent investments and portfolio companies`;
  }
  const want = [list && `the ${list} it targets`, type && 'what kind of investor it is', missing.includes('INV-ACTIVE') && 'its recent investments'].filter(Boolean);
  return `Page describing ${name}'s investment strategy and focus: ${want.join(', ') || 'its investment focus'}`;
}

const DEEP_PATH = /\/(?:about|about-us|who-we-are|strategy|investment-strategy|investment-focus|investment-criteria|criteria|focus|thesis|approach|what-we-do|how-we-invest|invest|investing|funds?|portfolio|team|nosotros|quienes-somos|qui[eé]nes-somos|estrategia|enfoque|tesis|portafolio|sobre|sobre-nos|sobre-n[oó]s|estrat[eé]gia|foco|criterios)(?:\/|$|[-_.])/i;
const ITEM = /\/(?:portfolio|portafolio|company|companies|investments?|inversiones|startups?|news|blog|press|press-releases?|noticias|prensa|insights?|stories|articles?|events?|resources|thought-leadership|media-hub|updates)\/[^/]+\/?$/i;
const DATED = /\/(?:19|20)\d{2}\/\d{1,2}(?:\/|$)/;
const GUESSES = {
  en: ['/strategy', '/investment-focus', '/about', '/approach', '/focus', '/portfolio', '/team'],
  es: ['/estrategia', '/enfoque', '/nosotros', '/quienes-somos', '/portafolio', '/about', '/strategy'],
  pt: ['/estrategia', '/sobre', '/sobre-nos', '/foco', '/portfolio', '/about', '/strategy']
};
const lang = text => /\b(?:invertimos|fondo de|nosotros|inversión|etapa temprana)\b/i.test(text) ? 'es' : /\b(?:investimos|sobre nós|fundo de|investimento)\b/i.test(text) ? 'pt' : 'en';

/** Puntuación de una URL candidata según lo que falta (estrategia/foco para sector-etapa-geografía, about para tipo). */
export function rankDeepUrl(url, missing) {
  let path = '/'; try { path = new URL(url).pathname.toLowerCase(); } catch { return -9; }
  const onlyActive = missing.length > 0 && missing.every(id => id === 'INV-ACTIVE');
  if (DATED.test(path) || (ITEM.test(path) && path.split('/').filter(Boolean).length >= 2)) return onlyActive ? 1 : -1;
  let s = 0;
  if (/strategy|focus|thesis|approach|criteria|what-we-do|how-we-invest|invest|estrategia|enfoque|tesis|foco|criterios|estrat/.test(path) && missing.some(id => ['INV-SECTOR', 'INV-STAGE', 'INV-GEO'].includes(id))) s += 3;
  if (/about|who-we-are|nosotros|quienes|quiénes|sobre/.test(path)) s += missing.includes('INV-TYPE') ? 3 : 2;
  if (/portfolio|portafolio|funds?\b/.test(path)) s += missing.includes('INV-ACTIVE') || missing.includes('INV-SECTOR') ? 2 : 1;
  if (/team/.test(path)) s += 1;
  return s;
}

/** Enlaces internos del texto leído (markdown o URLs sueltas), dentro del dominio oficial. */
export function internalLinks(text, baseUrl, domain) {
  const out = [];
  const add = raw => { try { const u = new URL(raw, baseUrl); if (/^https?:$/.test(u.protocol) && sameDomain(host(u.href), domain)) out.push(u.href.replace(/#.*$/, '')); } catch { /* enlace inválido */ } };
  for (const m of String(text ?? '').matchAll(/\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) add(m[1]);
  for (const m of String(text ?? '').matchAll(/\bhttps?:\/\/[^\s)\]"'<>]+/g)) add(m[0]);
  for (const m of String(text ?? '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) add(m[1]);
  return unique(out);
}

const sameFirm = (fields, entity) => {
  const name = fields?.canonical_name; if (!name) return false;
  const k = candidateKey(name), names = [entity.canonical_name, ...(entity.aliases ?? [])].map(candidateKey).filter(Boolean);
  return names.some(n => n === k || n.includes(k) || k.includes(n)) || nameMatchesDomain(name, entity.official_domain) || (fields.aliases ?? []).some(a => names.includes(candidateKey(a)));
};

/**
 * Fusiona por campo lo extraído de una página propia. Muta `entity` y devuelve el detalle.
 * @returns {{outcome:string, filled:string[], contradictions:string[]}}
 */
export function mergeDeepening(entity, { url, title, text, extracted, today }, missing) {
  const g = extracted?.deepening_fields;
  if (!g || g.entity_kind !== 'institutional_investor') return { outcome: `rejected:${extracted?.rejected_kind ?? g?.entity_kind ?? 'no_fields'}`, filled: [], contradictions: [] };
  if (!sameFirm(g, entity)) return { outcome: 'rejected:different_firm', filled: [], contradictions: [] };
  const evidence = {}, filled = [], contradictions = [];
  const lit = ev => typeof ev === 'string' && isLiteralEvidence(text, ev);
  const firstPartyDates = f => entity.sources.filter(s => s.field_evidence?.[f] && s.source_kind === 'official').map(s => s.published_on);
  for (const id of CORE) {
    const f = FIELD[id], ev = g.field_evidence?.[f];
    const newVals = f === 'investor_type' ? (g.investor_type && g.investor_type !== 'unknown' ? [g.investor_type] : []) : g[f] ?? [];
    if (!newVals.length || !lit(ev)) continue;
    const isMissing = missing.includes(id);
    if (f === 'investor_type') {
      if (entity.investor_type === 'unknown' && isMissing) { entity.investor_type = g.investor_type; evidence[f] = ev; filled.push(id); }
      else if (entity.investor_type !== 'unknown' && entity.investor_type !== g.investor_type) contradictions.push(`investor_type: '${entity.investor_type}' vs '${g.investor_type}' (${url})`);
      continue;
    }
    if (isMissing) { entity[f] = unique([...(entity[f] ?? []), ...newVals]); evidence[f] = ev; filled.push(id); continue; }
    const overlap = newVals.some(v => (entity[f] ?? []).map(x => String(x).toLowerCase()).includes(String(v).toLowerCase()));
    if (!overlap) {
      contradictions.push(`${f}: [${(entity[f] ?? []).join(', ')}] vs [${newVals.join(', ')}] (${url})`);
      // Solo gana la fuente propia más reciente cuando ambas fechas son conocidas.
      const dates = firstPartyDates(f);
      if (g.published_on && dates.length && dates.every(d => d && d < g.published_on)) { entity[f] = unique(newVals); evidence[f] = ev; filled.push(`${id}:replaced_by_newer`); }
    }
  }
  const quote = missing.includes('INV-ACTIVE') && g.quote && lit(g.quote) ? g.quote : null;
  if (contradictions.length) entity.contradictions = unique([...(entity.contradictions ?? []), ...contradictions]);
  if (!Object.keys(evidence).length && !quote) return { outcome: 'no_new_data', filled, contradictions };
  // V5-DBG-1: una fuente que solo respalda un campo no puede contar como inversión reciente (deriveActivity exige cita); la fecha solo se guarda junto a una cita literal verificada.
  entity.sources = [...entity.sources, { url, title: title || url, source_kind: 'official', retrieved_on: today, published_on: quote ? (g.published_on ?? null) : null, quote, field_evidence: evidence }];
  return { outcome: 'merged', filled: quote ? [...filled, 'INV-ACTIVE:thesis_quote'] : filled, contradictions };
}

/**
 * Ronda completa. io: { search(q, opts), fetch(url, fallbackText), extract(document), seen(url), markSeen(url), pageTexts: Map, log, deriveActivity(entity) }.
 * Devuelve las entidades (mutadas) y estadísticas propias (búsquedas, fetches, tokens y firmas profundizadas, aparte del descubrimiento).
 */
export async function runDeepening({ entities, profile, catalog, normalization, config, io }) {
  const cfg = config.deepening, today = config.today;
  const stats = { enabled: true, max_firms_per_run: cfg.max_firms_per_run, max_queries_per_firm: cfg.max_queries_per_firm, max_fetches_per_firm: cfg.max_fetches_per_firm, firms: 0, searches: 0, fetches: 0, fetch_empty: 0, extract_calls: 0, tokens_nominal: 0, latency_actual_ms: 0, latency_nominal_ms: 0, fields_filled: { 'INV-SECTOR': 0, 'INV-STAGE': 0, 'INV-GEO': 0, 'INV-TYPE': 0, 'INV-ACTIVE': 0 }, contradictions: 0, per_firm: [] };
  const usage = v => { stats.tokens_nominal += v?.tokens_nominal ?? 0; stats.latency_actual_ms += v?.latency?.actual_ms ?? 0; stats.latency_nominal_ms += v?.latency?.nominal_ms ?? 0; };
  const judge = e => judgeInvestorV2({ entity: { ...e, ...io.deriveActivity(e) }, profile, catalog, normalization });
  const missingOf = e => missingFor({ ...e, ...io.deriveActivity(e) }, judge(e));
  const targets = entities.map((entity, idx) => ({ entity, idx, j: judge(entity) }))
    .filter(({ entity }) => entity.official_domain && missingOf(entity).length)
    .sort((a, b) => deepeningPotential(b.j) - deepeningPotential(a.j) || (a.entity.first_seen?.order ?? a.idx) - (b.entity.first_seen?.order ?? b.idx))
    .slice(0, cfg.max_firms_per_run);
  for (const { entity } of targets) {
    const domain = entity.official_domain, before = missingOf(entity);
    let missing = before, queries = 0, fetches = 0;
    const tried = [], queued = new Set();
    stats.firms++;
    io.log?.({ event: 'deepening_start', stable_id: entity.stable_id, name: entity.canonical_name, domain, missing_before: before });
    const canFetch = () => fetches < cfg.max_fetches_per_firm && missing.length > 0;
    const open = async (url, origin, fallbackText = null) => {
      if (!canFetch()) return;
      const page = await io.fetch(url, fallbackText); fetches++; stats.fetches++; usage(page);
      const text = page.text ?? '';
      if (text.length < 200) { stats.fetch_empty++; tried.push({ url, origin, outcome: 'fetch_empty', filled: [] }); return; }
      io.pageTexts.set(canonicalInvestorUrl(url) ?? url, text);
      const extracted = await io.extract({ url, title: page.title || url, text, extraction: page.extraction }); stats.extract_calls++; usage(extracted);
      const r = mergeDeepening(entity, { url, title: page.title || url, text, extracted, today }, missing);
      stats.contradictions += r.contradictions.length;
      tried.push({ url, origin, outcome: r.outcome, filled: r.filled, contradictions: r.contradictions });
      missing = missingOf(entity);
    };
    const queue = urls => urls.filter(u => { const k = canonicalInvestorUrl(u) ?? u; if (queued.has(k) || io.seen(u)) return false; queued.add(k); return sameDomain(host(u), domain); });
    const runList = async (rows, origin) => {
      for (const { url, text } of rows.sort((a, b) => rankDeepUrl(b.url, missing) - rankDeepUrl(a.url, missing))) {
        if (!canFetch()) break;
        if (rankDeepUrl(url, missing) < 0) continue;
        io.markSeen(url); await open(url, origin, text ?? null);
      }
    };
    const searchPhase = async n => {
      if (queries >= cfg.max_queries_per_firm || !canFetch()) return;
      const q = deepeningQuery(entity.canonical_name, missing, n);
      const response = await io.search(q, { includeDomains: [domain], remainingSearches: 1 }); queries++; stats.searches += response.searches_consumed ?? 1; usage(response);
      const rows = (response.results ?? []).filter(r => sameDomain(host(r.url), domain));
      const urls = new Set(queue(rows.map(r => r.url)));
      tried.push({ query: q, origin: `search${n}`, results: (response.results ?? []).length, in_domain: rows.length });
      await runList(rows.filter(r => urls.has(r.url)).map(r => ({ url: r.url, text: r.text ?? null })), `search${n}`);
    };
    const ownPages = [...io.pageTexts.entries()].filter(([u]) => sameDomain(host(u), domain));
    // (a) Exa dentro del dominio + (b) enlaces internos de las páginas propias ya leídas.
    // V5-DBG-1: sin ninguna página propia leída, la portada aporta la navegación (enlaces a estrategia/acerca) en vez de gastar lecturas en notas de prensa.
    const home = `https://${domain}/`;
    if (!ownPages.length && !io.seen(home) && !queued.has(home) && canFetch()) { queued.add(home); io.markSeen(home); await open(home, 'home'); }
    const linkRows = () => queue([...io.pageTexts.entries()].filter(([u]) => sameDomain(host(u), domain)).flatMap(([u, t]) => internalLinks(t, u, domain)).filter(u => { try { return DEEP_PATH.test(new URL(u).pathname); } catch { return false; } })).map(url => ({ url }));
    if (canFetch()) await runList(linkRows(), 'link');
    await searchPhase(1);
    if (canFetch()) await runList(linkRows(), 'link');
    await searchPhase(2);
    // sitemap.xml (si el lector lo devuelve) y, al final, rutas habituales en el idioma del sitio.
    if (canFetch()) {
      const sm = `https://${domain}/sitemap.xml`;
      if (!io.seen(sm) && !queued.has(sm)) {
        queued.add(sm); io.markSeen(sm);
        const page = await io.fetch(sm, null); fetches++; stats.fetches++; usage(page);
        const links = internalLinks(page.text ?? '', sm, domain).filter(u => { try { return DEEP_PATH.test(new URL(u).pathname); } catch { return false; } });
        tried.push({ url: sm, origin: 'sitemap', outcome: (page.text ?? '').length ? `links:${links.length}` : 'fetch_empty' });
        if (!(page.text ?? '').length) stats.fetch_empty++;
        await runList(queue(links).map(url => ({ url })), 'sitemap');
      }
    }
    if (canFetch()) {
      const l = lang([...io.pageTexts.entries()].filter(([u]) => sameDomain(host(u), domain)).map(([, t]) => t).join(' ').slice(0, 20000));
      await runList(queue(GUESSES[l].map(p => `https://${domain}${p}`)).map(url => ({ url })), 'guess');
    }
    const after = missing;
    for (const id of before) if (!after.includes(id)) stats.fields_filled[id]++;
    const row = { stable_id: entity.stable_id, name: entity.canonical_name, domain, missing_before: before, missing_after: after, queries, fetches, pages: tried };
    stats.per_firm.push(row);
    io.log?.({ event: 'deepening_end', ...row, urls: tried.filter(t => t.url).map(t => ({ url: t.url, origin: t.origin, outcome: t.outcome, filled: t.filled ?? [] })) });
  }
  return { entities, stats };
}
