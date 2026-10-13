// Motor v9 = copia de engine.v8.mjs (que no se edita) con UN cambio, detrás de b2.model_candidates (config v9):
//  M (PROMPT-v11 + petición del 12-10): candidatos del modelo antes del planner. Un modelo (deps.nameCandidates: el LLM propio,
//     Claude o Gemini) propone hasta N fondos con nombre y dominio a partir del brief; cada uno se verifica en su sitio oficial con
//     resolveCandidateV9 (primero el dominio propuesto, si falla la búsqueda "<nombre>" venture capital con el emparejador v9).
//     La firma solo entra si su sitio oficial pasa el extractor con cita literal y el control de misma firma (regla sin cambios).
//     La fase tiene presupuesto propio; al terminar, los topes del descubrimiento y min_searches_before_stop suben en lo gastado,
//     así el planner conserva lo que tenía. Sin b2.model_candidates.enabled el motor es idéntico a engine.v8.mjs.
// --- encabezado original de engine.v8.mjs ---
// Motor v8 = copia de engine.v7.mjs (que no se edita) con UN cambio, detrás de b2.list_discovery (config v8):
//  D (PROMPT-v10) fase de listas antes del planner: se buscan N consultas de listas de fondos (list-discovery.v8.mjs, plantilla del
//      diagnóstico), se abren sus páginas, el extractor (sin cambios) devuelve hasta 10 firmas por página con cita literal, esos nombres
//      entran a la cola de candidatos y se resuelven a su sitio oficial con la resolución de siempre (la firma solo cuenta si el sitio
//      oficial pasa el extractor y la regla de cita). La fase tiene presupuesto propio (max_searches, max_fetches): al terminar, los
//      topes de búsquedas y fetches del descubrimiento y min_searches_before_stop se suben en lo gastado, de modo que el planner
//      conserva lo que tenía en v7. Sin b2.list_discovery.enabled el motor es idéntico a engine.v7.mjs.
// --- encabezado original de engine.v7.mjs ---
// Motor v7 = copia de engine.v2.mjs (que no se edita) con tres cambios, cada uno detrás de su clave de config v7:
//  C3 (H12) fetch_domain_skip: un dominio con ≥ after_failures fetches fallidos y ningún fetch bueno en la corrida no se vuelve
//      a pedir (descubrimiento, resolución y profundización); si el buscador trajo texto, se sigue usando ese texto.
//  C5 (H3) b2.min_searches_before_stop: en B2 no se acepta stop (ni un paso sin consultas) antes de ese número de búsquedas
//      (totals.searches, misma unidad que budgets.searches); se pide UN paso más al planner con el aviso en el estado.
//  C2 (H4) el extractor por defecto es extractor.v7 (en vivo lo inyecta external.v7.mjs).
// Sin esas claves el motor se comporta igual que engine.v2.mjs. B0/B1 no cambian.
// --- encabezado original de engine.v2.mjs ---
// Motor v2 (config v4, engine_v ≥ 2). El motor v1 (engine.mjs) no cambia y sigue sirviendo a v1–v3.
// FIX-05 resolución de candidatos · FIX-08 sector LLM · FIX-09 actividad · FIX-10 paciencia/dedupe/triage/denylist
// FIX-11b texto de búsqueda como respaldo · FIX-12 estado del planner, near-duplicates y candidatos por nombre.
import { dedupeInvestors, canonicalInvestorUrl } from './identity.mjs';
import { hasInvestmentEvidenceV2, sameDomain, investorHostname as host } from './extractor.mjs';
import { extractFixtureInvestorV7 as extractFixtureInvestorV2 } from './extractor.v7.mjs';
import { investorB0Queries, validatePlannerBatchV2 } from './conditions.mjs';
import { judgeInvestorV2, deterministicSectorFit, sectorQuotes } from './judge.mjs';
import { rankInvestors } from './ranking.mjs';
import { validateInvestor } from './contracts.mjs';
import { classifyActivity } from './activity.mjs';
import { loadNormalization } from './normalize.mjs';
import { resolveCandidate, candidateKey } from './resolve.mjs';
import { triageSearchResults } from './triage.mjs';
import { runDeepening } from './deepening.mjs';
import { listDiscoveryQueries } from './list-discovery.v8.mjs';
import { resolveCandidateV9 } from './resolve.v9.mjs';
import { nameMatchesDomainV9 } from './resolve-match.v9.mjs';

const FIRMISH = /\b(ventures?|capital|partners|fund|vc|investments?)\b|\.vc$/i;
const lc = v => String(v ?? '').toLowerCase();
const list = f => f?.value == null ? [] : Array.isArray(f.value) ? f.value : [f.value];

export function plannerCoverage(profile, executed) {
  const f = profile.fields, qs = executed.map(lc);
  const any = values => values.filter(Boolean).some(v => qs.some(q => q.includes(lc(v).replace(/_/g, ' '))));
  return {
    sector: any([f.sector.value]), subsector: any(list(f.subsectors)), geography: any([f.incorporation_country.value, ...list(f.operating_regions), ...list(f.target_markets)]),
    stage: any([f.funding_stage.value]), comparables: any(list(f.comparable_companies)), funding_news: qs.some(q => /rais|round|led by|funding/.test(q))
  };
}

export function deriveActivity(entity, { today, recencyDays }) {
  // V4-DBG-3: una nota de prensa en el dominio propio que describe inversión también es tesis de primera parte.
  const firstParty = s => s.source_kind === 'official' || (s.source_kind === 'news' && entity.official_domain && sameDomain(host(s.url), entity.official_domain));
  const officialThesis = entity.sources.some(s => firstParty(s) && s.quote && hasInvestmentEvidenceV2(s.quote));
  const recent = entity.sources.filter(s => s.published_on).map(s => ({ ...s, source_kind: s.source_kind === 'news' && entity.official_domain && sameDomain(host(s.url), entity.official_domain) ? 'official' : s.source_kind }));
  const active_status = classifyActivity({ explicitInactive: entity.active_status === 'inactive', currentOfficialThesis: officialThesis, recentEvidence: recent, asOf: today, recencyDays });
  const days = d => Math.floor((Date.parse(today) - Date.parse(d)) / 86400000);
  const recentOfficial = recent.filter(s => s.source_kind === 'official' && days(s.published_on) >= 0 && days(s.published_on) <= recencyDays);
  const keys = new Set(recentOfficial.map(s => s.url));
  return { active_status, recent_investment_evidence: entity.sources.filter(s => keys.has(s.url)).map(({ field_evidence, ...s }) => s) };
}

export async function runInvestorDiscoveryV9({ caseObj, profile, condition, config, templates, catalog, deps }) {
  const totals = { searches: 0, fetches: 0, planner_calls: 0, rejected_non_investors: 0, portfolio_companies_rejected: 0, nominal_cost: 0, tokens_nominal: 0, seconds_nominal: 0, latency_actual_ms: 0, latency_nominal_ms: 0 };
  const stats = { fetch_empty: 0, fetch_fallback_search_contents: 0, denied_urls: 0, deduped_urls: 0, skipped_empty_hosts: 0, reads: 0, resolutions: [], sector_llm_calls: 0, candidates_seen: 0, rejected_by_kind: {} };
  const seenQueries = new Set(), rawEntities = [], prefix_curve = [], actions_rejected = [], queryLog = [], hostsSeen = new Set(), seenUrls = new Set(), emptyHosts = new Map();
  const candidates = [], candidateKeys = new Set();
  const deny = new Set((config.fetch_denylist ?? []).map(lc));
  const denied = h => [...deny].some(d => h === d || h?.endsWith(`.${d}`));
  const patienceOn = (config.patience_conditions ?? ['B0', 'B1', 'B2']).includes(condition);
  let noNew = 0, stop_reason = null, order = 0, queryCounter = 0;
  const log = row => deps.log?.(row);
  const recordUsage = value => { totals.tokens_nominal += value?.tokens_nominal ?? 0; totals.seconds_nominal += value?.seconds_nominal ?? 0; totals.latency_actual_ms += value?.latency?.actual_ms ?? 0; totals.latency_nominal_ms += value?.latency?.nominal_ms ?? 0; };
  const resourceHit = () => totals.tokens_nominal >= config.budgets.tokens_nominal ? 'budget_tokens' : totals.seconds_nominal >= config.budgets.seconds_nominal ? 'budget_seconds' : null;
  const budgetHit = () => totals.searches >= config.budgets.searches ? 'budget_searches' : totals.fetches >= config.budgets.fetches ? 'budget_fetches' : resourceHit() ?? (totals.planner_calls >= config.budgets.planner_calls && condition === 'B2' ? 'budget_planner_calls' : null);
  const entityCount = () => dedupeInvestors(rawEntities, { v2: true }).length;
  const knownFirmHosts = () => [...new Set(rawEntities.map(e => e.official_domain).filter(Boolean))];
  if (config.triage?.enabled === true) stats.triage = { version: 'triage.v1', discarded: 0, demoted_opened: 0, demoted_skipped: 0, by_reason: {} };
  const knownNames = () => new Set(dedupeInvestors(rawEntities, { v2: true }).flatMap(e => [e.canonical_name, ...(e.aliases ?? [])].map(candidateKey)));

  const enqueue = (cand, origin, source_url = null, query_id = null) => {
    const key = candidateKey(cand.name); if (!key || candidateKeys.has(key) || knownNames().has(key)) return;
    candidateKeys.add(key); candidates.push({ ...cand, origin, source_url, query_id }); stats.candidates_seen++;
  };
  // V7-C3: memoria de fallos de fetch por dominio dentro de la corrida.
  const skipCfg = config.fetch_domain_skip?.enabled ? { after: config.fetch_domain_skip.after_failures ?? 2 } : null;
  const domainFails = new Map(), domainOk = new Set();
  const domainBlocked = h => Boolean(skipCfg) && (domainFails.get(h) ?? 0) >= skipCfg.after && !domainOk.has(h);
  if (skipCfg) Object.assign(stats, { fetch_skipped_domain: 0, skipped_failed_domain_results: 0, failed_domains: {} });
  const guardedFetch = async url => {
    const h = host(url);
    if (domainBlocked(h)) { stats.fetch_skipped_domain++; log({ event: 'fetch_skipped_domain', url, host: h, failures: domainFails.get(h) }); return { ok: false, text: '', title: '', via: 'skipped_failed_domain', skipped: true, error: { code: 'FETCH_SKIPPED_DOMAIN', message: 'domain failed repeatedly in this run' }, latency: { actual_ms: 0, nominal_ms: 0 } }; }
    const page = await deps.fetch(url);
    if (skipCfg) { if (page.ok === false || (page.text ?? '').length < 200) { domainFails.set(h, (domainFails.get(h) ?? 0) + 1); stats.failed_domains[h] = domainFails.get(h); } else domainOk.add(h); }
    return page;
  };
  const pageTexts = new Map(); // V5-3: texto de las páginas leídas, para los enlaces internos de la ronda de profundización.
  const fetchPage = async (url, fallbackText = null) => {
    seenUrls.add(canonicalInvestorUrl(url) ?? url);
    const page = await guardedFetch(url); if (!page.skipped) { totals.fetches++; totals.nominal_cost += page.nominal_cost ?? 1; recordUsage(page); }
    let text = page.text ?? '', via = page.via ?? null;
    if (text.length < 200) {
      if (fallbackText && fallbackText.length >= 400) { text = fallbackText; via = 'search_contents'; stats.fetch_fallback_search_contents++; log({ event: 'fetch_fallback', url, via, text_chars: text.length, ...(page.skipped ? { skipped_failed_domain: true } : {}) }); }
      else if (!page.skipped) { stats.fetch_empty++; const h = host(url); emptyHosts.set(h, (emptyHosts.get(h) ?? 0) + 1); }
    }
    if (config.deepening?.enabled && text.length >= 200) pageTexts.set(canonicalInvestorUrl(url) ?? url, text);
    return { ...page, text, via };
  };
  const extractDoc = async (document, firstSeen) => {
    const extracted = await (deps.extract ?? (input => extractFixtureInvestorV2({ ...input, extraction: input.extraction })))({ document, extraction: document.extraction, today: config.today, firstSeen });
    recordUsage(extracted);
    if (!extracted.entity) { totals.rejected_non_investors++; stats.rejected_by_kind[extracted.rejected_kind] = (stats.rejected_by_kind[extracted.rejected_kind] ?? 0) + 1; if (extracted.rejected_kind === 'portfolio_company') totals.portfolio_companies_rejected++; }
    return extracted;
  };

  const resolveSome = async () => {
    if (!config.resolution?.enabled) return;
    let done = 0;
    while (done < config.resolution.per_query && stats.resolutions.length < config.resolution.max_per_run && candidates.length && !budgetHit()) {
      const cand = candidates.shift();
      if (knownNames().has(candidateKey(cand.name))) continue;
      log({ event: 'resolution_start', name: cand.name, origin: cand.origin, domain_on_page: cand.domain_on_page ?? null });
      const ctx = {
        deps, config, canSearch: () => totals.searches < config.budgets.searches, canFetch: () => totals.fetches < config.budgets.fetches, remainingSearches: () => config.budgets.searches - totals.searches,
        onSearch: response => { totals.searches += response.searches_consumed ?? 1; totals.nominal_cost += response.nominal_cost ?? 1; recordUsage(response); },
        denied, seenUrl: url => seenUrls.has(canonicalInvestorUrl(url) ?? url), fetchPage: url => fetchPage(url),
        extract: document => extractDoc(document, { step: totals.planner_calls, search_index: Math.max(0, totals.searches - 1), order: order++, query_id: cand.query_id ?? null, origin: cand.origin === 'planner_candidate' ? 'planner_candidate' : 'resolution' })
      };
      const out = await resolveCandidate(cand, ctx);
      if (out.entity) rawEntities.push(out.entity);
      stats.resolutions.push({ name: cand.name, origin: cand.origin, outcome: out.outcome, url: out.url ?? null });
      log({ event: 'resolution_end', name: cand.name, origin: cand.origin, outcome: out.outcome, url: out.url ?? null });
      done++;
    }
  };

  const runQuery = async action => {
    const before = budgetHit(); if (before) { stop_reason = before; return; }
    const query_id = `q${String(queryCounter++).padStart(3, '0')}`;
    const foundBefore = entityCount();
    // V5-2: con config.triage.enabled el triage se calcula sobre la respuesta y queda en el evento search_end (vía options.triage).
    const isList = action.origin === 'list_discovery';   // V8-D: las consultas de listas no pasan por el triage (descartaría listas y agregadores, que son lo que se busca)
    const triageOn = config.triage?.enabled === true && !isList;
    const triageFn = triageOn ? results => triageSearchResults(results, { knownFirmHosts: knownFirmHosts() }) : null;
    const response = await deps.search(action.query, { remainingSearches: config.budgets.searches - totals.searches, ...(triageFn ? { triage: triageFn } : {}) }); totals.searches += response.searches_consumed ?? 1; totals.nominal_cost += response.nominal_cost ?? 1; recordUsage(response);
    const afterSearch = resourceHit(); if (afterSearch) stop_reason = afterSearch;
    const results = (response.results ?? []).map((r, i) => ({ ...r, _i: i }));
    const usable = [];
    for (const r of results) {
      const h = host(r.url), key = canonicalInvestorUrl(r.url) ?? r.url;
      if (!h) continue;
      if (denied(h)) { stats.denied_urls++; continue; }
      if (seenUrls.has(key)) { stats.deduped_urls++; continue; }
      if ((emptyHosts.get(h) ?? 0) >= 2) { stats.skipped_empty_hosts++; continue; }
      if (domainBlocked(h) && String(r.text ?? '').length < 400) { stats.skipped_failed_domain_results++; continue; }   // V7-C3: sin texto del buscador no hay nada que leer
      usable.push(r);
    }
    let toOpen;
    if (triageFn) {
      const tri = response.triage ?? triageFn(response.results ?? []);
      const discarded = new Set(tri.discarded.map(x => x.i)), demoted = new Set(tri.demoted.map(x => x.i));
      stats.triage.discarded += usable.filter(r => discarded.has(r._i)).length;
      for (const x of tri.discarded) if (usable.some(r => r._i === x.i)) stats.triage.by_reason[x.reason] = (stats.triage.by_reason[x.reason] ?? 0) + 1;
      const kept = usable.filter(r => !discarded.has(r._i)), score = r => tri.scores[r._i] ?? 0;
      kept.sort((a, b) => (demoted.has(a._i) - demoted.has(b._i)) || (hostsSeen.has(host(a.url)) - hostsSeen.has(host(b.url))) || (score(b) - score(a)) || a._i - b._i);
      // Los bajados de prioridad solo rellenan huecos, y como mucho uno por consulta.
      const keeps = kept.filter(r => !demoted.has(r._i)), lows = kept.filter(r => demoted.has(r._i)).slice(0, 1);
      toOpen = stop_reason ? [] : [...keeps, ...lows].slice(0, config.default_fetch_per_search);
      stats.triage.demoted_opened += toOpen.filter(r => demoted.has(r._i)).length;
      stats.triage.demoted_skipped += kept.filter(r => demoted.has(r._i) && !toOpen.includes(r)).length;
    } else if (isList) {
      // V8-D: por puesto del buscador, como mucho 2 páginas por sitio, hasta list_discovery.fetch_per_query.
      const perHost = new Map();
      usable.sort((a, b) => a._i - b._i);
      toOpen = stop_reason ? [] : usable.filter(r => { const h = host(r.url), n = perHost.get(h) ?? 0; if (n >= 2) return false; perHost.set(h, n + 1); return true; }).slice(0, config.b2.list_discovery.fetch_per_query);
    } else {
      usable.sort((a, b) => (hostsSeen.has(host(a.url)) - hostsSeen.has(host(b.url))) || ((FIRMISH.test(b.title ?? '') || FIRMISH.test(host(b.url))) - (FIRMISH.test(a.title ?? '') || FIRMISH.test(host(a.url)))) || a._i - b._i);
      toOpen = stop_reason ? [] : usable.slice(0, config.default_fetch_per_search);
    }
    log({ event: 'search_opened', query_id, query: action.query, origin: action.origin ?? null, urls: results.map(x => x.url), opened: toOpen.map(x => x._i) });
    let read = false, fetched = 0, accepted = 0; const rejected_by_kind = {};
    for (const result of toOpen) {
      if (totals.fetches >= config.budgets.fetches) { stop_reason = 'budget_fetches'; break; }
      hostsSeen.add(host(result.url));
      const page = await fetchPage(result.url, result.text ?? null); fetched++;
      if ((page.text ?? '').length < 200) continue;
      read = true; stats.reads++;
      const extracted = await extractDoc({ url: result.url, title: result.title ?? page.title ?? result.url, text: page.text, extraction: page.extraction }, { step: totals.planner_calls, search_index: totals.searches - 1, order: order++, query_id, origin: 'search' });
      for (const c of extracted.candidates ?? []) enqueue(c, 'page_candidate', result.url, query_id);
      if (extracted.candidate) enqueue(extracted.candidate, 'page_candidate', result.url, query_id);
      if (!extracted.entity) { rejected_by_kind[extracted.rejected_kind] = (rejected_by_kind[extracted.rejected_kind] ?? 0) + 1; continue; }
      accepted++; rawEntities.push(extracted.entity);
      const hit = totals.fetches >= config.budgets.fetches ? 'budget_fetches' : resourceHit(); if (hit) { stop_reason = hit; break; }
    }
    queryLog.push({ q: action.query, results: results.length, fetched, accepted, rejected_by_kind });
    if (!stop_reason) await resolveSome();
    const foundAfter = entityCount();
    if (read) noNew = foundAfter > foundBefore ? 0 : noNew + 1;
    prefix_curve.push({ search_index: totals.searches - 1, stable_ids_so_far: dedupeInvestors(rawEntities, { v2: true }).map(x => x.stable_id), nominal_cost: totals.nominal_cost, searches: totals.searches, fetches: totals.fetches });
    if (patienceOn && noNew >= config.patience_n) stop_reason = 'patience';
  };

  const plannerState = () => {
    const entities = dedupeInvestors(rawEntities, { v2: true });
    return {
      queries: queryLog, hosts_seen: [...hostsSeen].slice(0, 60),
      entities: entities.map(x => ({ name: x.canonical_name, sectors: x.sectors, stages: x.stages, geographies: x.geographies, origin: x.first_seen?.origin ?? 'search' })),
      unresolved_candidates: candidates.map(c => c.name).slice(0, 20), coverage: plannerCoverage(profile, queryLog.map(x => x.q))
    };
  };
  const takePlannerCandidates = batch => { if (config.planner?.allow_candidate_names) for (const c of batch.candidate_firms ?? []) enqueue({ name: c.name, quote: null, domain_on_page: null }, 'planner_candidate'); };

  // V9-M — candidatos del modelo (solo B2 con b2.model_candidates.enabled y deps.nameCandidates).
  const MC = condition === 'B2' && config.b2?.model_candidates?.enabled && deps.nameCandidates ? config.b2.model_candidates : null;
  if (MC) {
    const base0 = { searches: config.budgets.searches, fetches: config.budgets.fetches, tokens: config.budgets.tokens_nominal }, baseMin0 = config.b2.min_searches_before_stop ?? 0;
    config = { ...config, budgets: { ...config.budgets, searches: base0.searches + MC.max_searches, fetches: base0.fetches + MC.max_fetches, tokens_nominal: base0.tokens + (MC.max_tokens ?? 0) } };
    let proposal;
    try { proposal = await deps.nameCandidates({ profile }); } catch (e) { proposal = { firms: [], error: String(e.message ?? e).slice(0, 300) }; }
    const mstats = { provider: proposal.provider ?? null, model: proposal.model ?? null, web: proposal.web ?? null, cached: proposal.cached ?? null, error: proposal.error ?? null, proposed: proposal.firms?.length ?? 0, tried: 0, accepted: 0, via_domain: 0, via_search: 0, outcomes: {}, searches: 0, fetches: 0, entities_found: 0 };
    log({ event: 'model_candidates', provider: mstats.provider, model: mstats.model, web: mstats.web, cached: mstats.cached, error: mstats.error, firms: (proposal.firms ?? []).map(f => ({ name: f.name, domain: f.domain })) });
    const s0 = { searches: totals.searches, fetches: totals.fetches }, e0 = entityCount();
    const ctx = () => ({
      deps, config, canSearch: () => totals.searches < config.budgets.searches, canFetch: () => totals.fetches < config.budgets.fetches, remainingSearches: () => config.budgets.searches - totals.searches,
      onSearch: response => { totals.searches += response.searches_consumed ?? 1; totals.nominal_cost += response.nominal_cost ?? 1; recordUsage(response); },
      denied, seenUrl: url => seenUrls.has(canonicalInvestorUrl(url) ?? url), fetchPage: url => fetchPage(url),
      extract: document => extractDoc(document, { step: 0, search_index: Math.max(0, totals.searches - 1), order: order++, query_id: null, origin: 'resolution' })
    });
    const opts = { matcher: nameMatchesDomainV9, stripTail: true };
    for (const f of (proposal.firms ?? []).slice(0, MC.max_resolutions)) {
      if (resourceHit()) break;
      if (knownNames().has(candidateKey(f.name))) { mstats.outcomes.known = (mstats.outcomes.known ?? 0) + 1; continue; }
      mstats.tried++;
      log({ event: 'resolution_start', name: f.name, origin: 'model_candidate', domain_on_page: f.domain ?? null });
      let out = null, via = null;
      if (f.domain && MC.use_model_domain !== false && totals.fetches < config.budgets.fetches) { out = await resolveCandidateV9({ name: f.name, domain_on_page: f.domain }, ctx(), opts); via = 'domain'; }
      if ((!out || out.outcome !== 'accepted') && totals.searches < config.budgets.searches) { const o2 = await resolveCandidateV9({ name: f.name, domain_on_page: null }, ctx(), opts); if (!out || o2.outcome === 'accepted') { out = o2; via = 'search'; } }
      if (!out) out = { outcome: 'no_budget' };
      if (out.entity) { rawEntities.push(out.entity); mstats.accepted++; mstats[via === 'domain' ? 'via_domain' : 'via_search']++; }
      mstats.outcomes[out.outcome] = (mstats.outcomes[out.outcome] ?? 0) + 1;
      stats.resolutions.push({ name: f.name, origin: 'model_candidate', outcome: out.outcome, url: out.url ?? null });
      log({ event: 'resolution_end', name: f.name, origin: 'model_candidate', outcome: out.outcome, url: out.url ?? null, via });
    }
    const used = { searches: totals.searches - s0.searches, fetches: totals.fetches - s0.fetches };
    Object.assign(mstats, used, { entities_found: entityCount() - e0 });
    config = { ...config, budgets: { ...config.budgets, searches: base0.searches + totals.searches, fetches: base0.fetches + totals.fetches }, b2: { ...config.b2, min_searches_before_stop: baseMin0 + totals.searches }, resolution: { ...config.resolution, max_per_run: (config.resolution?.max_per_run ?? 0) + stats.resolutions.length } };
    noNew = 0; if (stop_reason && stop_reason !== 'budget_tokens' && stop_reason !== 'budget_seconds') stop_reason = null;
    stats.model_phase = mstats;
    log({ event: 'model_phase_end', ...mstats });
  }

  // V8-D — fase de listas (solo B2 con b2.list_discovery.enabled).
  const LD = condition === 'B2' && config.b2?.list_discovery?.enabled ? config.b2.list_discovery : null;
  if (LD) {
    const base = { searches: config.budgets.searches, fetches: config.budgets.fetches }, baseRes = { ...config.resolution }, baseMin = config.b2.min_searches_before_stop ?? 0;
    config = { ...config, budgets: { ...config.budgets, searches: base.searches + LD.max_searches, fetches: base.fetches + LD.max_fetches }, resolution: { ...config.resolution, enabled: true, per_query: LD.resolve_per_query, max_per_run: LD.max_resolutions } };
    const queries = listDiscoveryQueries(profile, LD.queries);
    const before = { entities: entityCount(), candidates: 0 };
    log({ event: 'list_phase_start', queries, max_searches: LD.max_searches, max_fetches: LD.max_fetches, max_resolutions: LD.max_resolutions });
    for (const q of queries) { seenQueries.add(lc(q)); await runQuery({ query: q, origin: 'list_discovery' }); if (stop_reason) break; }
    // La fase termina con las resoluciones de su cupo; lo que queda en la cola sigue para la resolución normal.
    while (!stop_reason && candidates.length && stats.resolutions.length < LD.max_resolutions && !budgetHit()) { const n = stats.resolutions.length; await resolveSome(); if (stats.resolutions.length === n) break; }
    const used = { searches: totals.searches, fetches: totals.fetches };
    config = { ...config, budgets: { ...config.budgets, searches: base.searches + used.searches, fetches: base.fetches + used.fetches }, b2: { ...config.b2, min_searches_before_stop: baseMin + used.searches }, resolution: { ...baseRes, max_per_run: baseRes.max_per_run + stats.resolutions.length } };
    noNew = 0;
    if (stop_reason === 'patience') stop_reason = null;
    stats.list_phase = { queries, searches: used.searches, fetches: used.fetches, resolutions: stats.resolutions.length, entities_found: entityCount() - before.entities, candidates_seen: stats.candidates_seen, candidates_pending: candidates.length };
    log({ event: 'list_phase_end', ...stats.list_phase });
  }

  if (condition === 'B0') {
    for (const action of investorB0Queries(profile, templates, config.today)) { await runQuery(action); if (stop_reason) break; }
    stop_reason ??= budgetHit() ?? 'queries_exhausted';
  } else {
    const limit = condition === 'B1' ? config.budgets.searches : config.b2.initial_batch;
    const first = await deps.plan({ mode: 'initial_batch', profile, state: plannerState(), limit }); totals.planner_calls++; recordUsage(first);
    let batch = validatePlannerBatchV2({ ...first, mode: 'initial_batch' }, seenQueries, limit); actions_rejected.push(...batch.rejected); takePlannerCandidates(batch);
    if (budgetHit() && budgetHit() !== 'budget_planner_calls') stop_reason = budgetHit();
    for (const action of batch.accepted) { if (stop_reason) break; await runQuery(action); }
    if (condition === 'B1') { if (!stop_reason) await resolveSome(); stop_reason ??= budgetHit() ?? 'queries_exhausted'; }
    while (condition === 'B2' && !stop_reason) {
      const hit = budgetHit(); if (hit) { stop_reason = hit; break; }
      const out = await deps.plan({ mode: 'adaptive_step', profile, state: plannerState(), limit: Math.min(config.b2.max_searches_per_step, config.budgets.searches - totals.searches) }); totals.planner_calls++; recordUsage(out);
      batch = validatePlannerBatchV2({ ...out, mode: 'adaptive_step' }, seenQueries, config.b2.max_searches_per_step); actions_rejected.push(...batch.rejected); takePlannerCandidates(batch);
      const minS = config.b2?.min_searches_before_stop ?? 0;
      if ((batch.stop || batch.accepted.length === 0) && totals.searches < minS) {
        // V7-C5: stop antes del mínimo → un paso más con el aviso en el estado (cuenta como llamada al planner).
        stats.stop_rejected = (stats.stop_rejected ?? 0) + 1;
        log({ event: 'planner_stop_rejected', searches: totals.searches, min_searches_before_stop: minS, stop: batch.stop, accepted: batch.accepted.length });
        const hit2 = budgetHit(); if (hit2) { stop_reason = hit2; break; }
        const notice = { searches_done: totals.searches, min_searches_before_stop: minS, note: 'Stopping is not accepted yet. Propose new queries for dimensions not yet covered.' };
        const out2 = await deps.plan({ mode: 'adaptive_step', profile, state: { ...plannerState(), stop_not_accepted: notice }, limit: Math.min(config.b2.max_searches_per_step, config.budgets.searches - totals.searches) }); totals.planner_calls++; recordUsage(out2);
        batch = validatePlannerBatchV2({ ...out2, mode: 'adaptive_step' }, seenQueries, config.b2.max_searches_per_step); actions_rejected.push(...batch.rejected); takePlannerCandidates(batch);
        log({ event: 'planner_stop_retry', accepted: batch.accepted.length, stop: batch.stop });
        if (batch.accepted.length === 0) { if (!stop_reason) await resolveSome(); stop_reason = 'no_more_actions'; break; }
      } else if (batch.stop || batch.accepted.length === 0) { if (!stop_reason) await resolveSome(); stop_reason = 'no_more_actions'; break; }
      for (const action of batch.accepted) { await runQuery(action); if (stop_reason) break; }
    }
  }

  // Post-descubrimiento: actividad (FIX-09), sector LLM (FIX-08), juez v2 (FIX-06/07).
  const normalization = loadNormalization(config.normalization ?? 'normalization.v1');

  // V4-DBG-2 — enriquecimiento: a las firmas aceptadas que siguen sin etapa, geografía o tipo se les busca UNA página
  // propia más (tesis/enfoque) dentro del mismo presupuesto. Solo cuenta una página del dominio oficial de la firma.
  if (config.enrichment?.enabled) {
    const pre = dedupeInvestors(rawEntities, { v2: true });
    const targets = pre.map(entity => ({ entity, j: judgeInvestorV2({ entity, profile, catalog, normalization }) }))
      .filter(({ entity, j }) => entity.official_domain && j.hard_eligibility !== 'ineligible' && j.sector_fit !== 'off' && ['INV-STAGE', 'INV-GEO', 'INV-TYPE'].some(id => j.criteria.find(c => c.criterion_id === id)?.state === 'unknown'))
      .sort((a, b) => a.entity.first_seen.order - b.entity.first_seen.order).slice(0, config.enrichment.max_per_run);
    for (const { entity } of targets) {
      if (totals.searches >= config.budgets.searches || totals.fetches >= config.budgets.fetches || resourceHit()) break;
      const response = await deps.search(`"${entity.canonical_name}" ${config.enrichment.suffix}`, { remainingSearches: config.budgets.searches - totals.searches });
      totals.searches += response.searches_consumed ?? 1; totals.nominal_cost += response.nominal_cost ?? 1; recordUsage(response);
      const hit = (response.results ?? []).find(r => { const h = host(r.url); return h && sameDomain(h, entity.official_domain) && !seenUrls.has(canonicalInvestorUrl(r.url) ?? r.url); });
      let outcome = 'no_first_party_result';
      if (hit) {
        const page = await fetchPage(hit.url, hit.text ?? null);
        if ((page.text ?? '').length >= 200) {
          const extracted = await extractDoc({ url: hit.url, title: hit.title ?? page.title ?? hit.url, text: page.text, extraction: page.extraction }, { ...entity.first_seen, order: order++ });
          if (extracted.entity && sameDomain(host(`https://${extracted.entity.official_domain}`), entity.official_domain)) { rawEntities.push(extracted.entity); outcome = 'merged'; }
          else outcome = `rejected:${extracted.rejected_kind ?? 'other_firm'}`;
        } else outcome = 'fetch_empty';
      }
      (stats.enrichments ??= []).push({ name: entity.canonical_name, outcome, url: hit?.url ?? null });
      log({ event: 'enrichment_end', name: entity.canonical_name, outcome, url: hit?.url ?? null });
    }
  }

  const discovered = dedupeInvestors(rawEntities, { v2: true });
  // V5-3 — ronda de profundización con presupuesto propio (config.deepening); no consume los topes del descubrimiento
  // y se cuenta aparte en v2_stats.deepening. Sin deepening.enabled el motor es idéntico a v4.
  let deepeningStats = null;
  if (config.deepening?.enabled) {
    const activity = e => deriveActivity(e, { today: config.today, recencyDays: config.activity?.recency_days ?? 540 });
    const io = {
      search: (q, options) => deps.search(q, options),
      fetch: async (url, fallbackText) => {
        const page = await guardedFetch(url); let text = page.text ?? '', via = page.via ?? null;
        if (text.length < 200 && fallbackText && fallbackText.length >= 400) { text = fallbackText; via = 'search_contents'; log({ event: 'fetch_fallback', url, via, text_chars: text.length, phase: 'deepening' }); }
        return { ...page, text, via };
      },
      extract: async document => {
        const entity = discovered.find(e => document.url && e.official_domain && sameDomain(host(document.url), e.official_domain));
        return (deps.extract ?? (input => extractFixtureInvestorV2({ ...input, extraction: input.extraction })))({ document, extraction: document.extraction, today: config.today, firstSeen: entity?.first_seen ?? { step: 0, search_index: 0, order: 0, query_id: null } });
      },
      seen: url => seenUrls.has(canonicalInvestorUrl(url) ?? url), markSeen: url => seenUrls.add(canonicalInvestorUrl(url) ?? url),
      pageTexts, log, deriveActivity: activity
    };
    deepeningStats = (await runDeepening({ entities: discovered, profile, catalog, normalization, config, io })).stats;
  }
  const entities = discovered.map(e => ({ ...e, ...deriveActivity(e, { today: config.today, recencyDays: config.activity?.recency_days ?? 540 }) }));
  const sectorFits = new Map();
  for (const entity of entities) {
    if (!deps.sectorFit || stats.sector_llm_calls >= (config.judge?.max_llm_calls ?? 0)) break;
    if (deterministicSectorFit(profile, entity) === 'on' || !sectorQuotes(entity)) continue;
    const answer = await deps.sectorFit({ entity, profile, quotes: sectorQuotes(entity) }); stats.sector_llm_calls++; recordUsage(answer);
    sectorFits.set(entity.stable_id, answer); log({ event: 'sector_fit', stable_id: entity.stable_id, sector_fit: answer.sector_fit, guard: answer.guard ?? null });
  }
  const judgments = entities.map(entity => judgeInvestorV2({ entity, profile, catalog, sectorFit: sectorFits.get(entity.stable_id) ?? null, normalization }));
  const ranked = rankInvestors(entities, judgments);
  const abstained = !ranked.some(x => x.gain >= 2);
  const abstention_reason = !abstained ? null : !judgments.length ? 'no_candidates' : judgments.every(j => j.hard_eligibility === 'ineligible' || j.overall_relevance === 'irrelevant') ? 'all_hard_not_met' : 'insufficient_evidence';
  if (deepeningStats) return validateInvestor('investor_run_result.v3', { schema_version: 'investor_run_result/3', case_id: caseObj.case_id, condition, stop_reason, abstained, abstention_reason, ranked, entities, judgments, totals, prefix_curve, actions_rejected, v2_stats: { ...stats, candidates_pending: candidates.length, deepening: deepeningStats } });
  return validateInvestor('investor_run_result.v2', { schema_version: 'investor_run_result/2', case_id: caseObj.case_id, condition, stop_reason, abstained, abstention_reason, ranked, entities, judgments, totals, prefix_curve, actions_rejected, v2_stats: { ...stats, candidates_pending: candidates.length } });
}
