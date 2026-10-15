import { addWarmPlans } from './warmPlan.mjs';
import { makePlan, evaluate, buildDraft } from './core.mjs';
import { expandTerms } from './expand.mjs';
import { demoLeads } from './demo.mjs';
import { addConnections, addOrgBridges, networkCandidates } from './network.mjs';
import { runEngine, runObjective, engineLeads, engineConfigured, ENGINE_SOURCE } from './engine.mjs';
import { multiSearch, searchApisConfigured } from './searchApis.mjs';
import { chatJSON, roleReachable, fleetReady } from '../analysis/fleet.mjs';
import { readOpportunity } from './readOpportunity.mjs';
import { crawl4aiRead, crawl4aiConfigured } from './crawl4ai.mjs';
import { fundingQuery } from './expand.mjs';
import { aiReasonerOn, ORCHESTRATOR, orchestrate, searchRowsToLeads, mergeLeads, confirmFromPages, templateQueries } from './orchestrator.mjs';
/** Grants buscados directo en las APIs de búsqueda cuando el motor con IA no está disponible. */
const GRANT_API_SOURCE = 'Grant search (web APIs)';
import { fetchPage } from './localSearch.mjs';
import { jinaRead, firecrawlRead } from './searchApis.mjs';
import { HUNTER_SOURCE, enrichWithHunter, hunterConfigured, leadDomain, makeHunter } from './hunter.mjs';
import { firecrawlConfigured, searchConfigured, grantWebOpportunities, webPeople, webConfigured, webMissing, GRANT_WEB_SOURCE, WEB_SOURCE } from './webscrape.mjs';
import { followUpPeople } from './followup.mjs';
import { readCandidates } from './read.mjs';
import { assessLeads } from './sufficiency.mjs';
import { runAgenticLoop } from './loop.mjs';
import { attachGrantPlans, finalizeSearchAudit } from './grantManager.mjs';
import { createRecorder } from './liveRun.mjs';
import { buildRunAudit } from './runAudit.mjs';
import { webSourcePlan } from './sourcePlan.mjs';
import { buildCapitalStrategyContext, capitalQueries, attachCapitalEvidence, recordCapitalToolResults } from '../../capital/strategy.mjs';
import { ApolloBudget, createApolloClient, sharedApolloCache } from '../../capital/apollo.mjs';
import { resolveApolloContacts } from '../../capital/resolver.mjs';
import { verifyRegistryLeads } from './registryVerify.mjs';
import { grantIntel, portalSeeds, sbir } from './grantSources.mjs';
import { applyJevDecisions, askJev, jevProvider } from './jev.mjs';
import {
  makeClient,
  teamFacts,
  teamFactsApply,
  openalex,
  clinicalTrials,
  grants,
  reporter,
  radar,
  webSearch,
  exaSearch,
  roundAnnouncements,
  searchFundingQuery,
} from './providers.mjs';
export async function runResearch(
  job,
  store,
  { env = process.env, fetcher = fetch, providers, hub = null, browser = null, frames = null, live, signal: externalSignal = null, enrichers = [] } = {},
) {
  // Registro legado (mensajes del resumen de resultados) + eventos estructurados del Live Agent Run.
  const emit = (phase, message) => {
    job.events.push({ phase, message, at: new Date().toISOString() });
    store.save(job);
  };
  live ||= createRecorder(job, { store, hub, env });
  const LEGACY_TO_LIVE = { searching: 'reading', reading: 'reading', warning: 'warning', error: 'error' };
  /** Mensajes emitidos desde dentro de una fuente: se conservan en ambos registros, con su proveedor. */
  const emitFor = (provider) => (phase, message) => {
    emit(phase, message);
    const livePhase = LEGACY_TO_LIVE[phase] || 'reading';
    live({ phase: livePhase, provider, status: livePhase === 'warning' ? 'warning' : livePhase === 'error' ? 'error' : 'running', title: livePhase === 'warning' ? 'Warning' : 'Processing', message });
  };
  // Con GPT Researcher el tope de 180-240 s (.env.example / por defecto) no alcanza: el motor le daba 60 s a GPTR y, al terminar,
  // ya había pasado el plazo para abrir páginas, así que ninguna llegaba al juez (15-10, MINT AD: 0 resultados). Piso: GPTR_RUN_TIMEOUT_MS.
  // Es un techo, no la duración: la corrida termina cuando el juez acaba. Búsqueda + 30 s de margen del informe + reserva del juez + reserva del pipeline.
  const gptrFloorMs = String(env.ENGINE_GPTR || '') === '1' ? Number(env.GPTR_RUN_TIMEOUT_MS) || ((Number(env.GPTR_SECONDS) || 270) + 30 + (Number(env.GPTR_RESERVE_SECONDS) || 210) + 60 + 20) * 1000 : 0;
  const runTimeoutMs = Math.max(1000, Number(env.RESEARCH_RUN_TIMEOUT_MS) || 240000, gptrFloorMs);
  const runStarted = Date.now();
  const timeoutSignal = AbortSignal.timeout(runTimeoutMs);
  const signal = externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
  const record = (url, data) => store.source(job.id, url, data);
  const jobFrames = frames && {
    canStore: () => frames.canStore(job.id),
    put: (buffer) => frames.put(job.id, buffer),
  };
  const client = makeClient({
    env,
    fetcher,
    signal,
    record,
    live,
    browser,
    frames: jobFrames,
  });
  const b = job.brief;
  job.status = 'running';
  // Entrega parcial: lo que cada fuente ya devolvió se guarda aquí; si el tope de tiempo corta la corrida, se evalúa y se entrega igual.
  let leads = [];
  const collected = [];
  // Plazo para el motor: termina (y entrega lo juzgado) antes del tope global, dejando margen para evaluar y guardar.
  const engineDeadlineAt = runStarted + runTimeoutMs - Math.max(20000, Number(env.PIPELINE_RESERVE_MS) || 60000);
  /** Ejecuta una fuente con eventos de inicio y fin reales (duración, resultados, error). */
  const runSource = async (name, run, parallel) => {
    signal.throwIfAborted();
    const started = Date.now();
    live({ phase: 'source_started', provider: name, status: 'running', title: 'Source started', message: parallel > 1 ? `${name}: query started (in parallel with ${parallel - 1} more sources).` : `${name}: query started.`, detail: { parallel } });
    try {
      const found = await run();
      live({ phase: 'source_completed', provider: name, status: 'success', title: 'Source finished', message: `${name}: ${found.length} candidates with provenance.`, resultCount: found.length, durationMs: Date.now() - started });
      return found;
    } catch (e) {
      if (signal.aborted) throw signal.reason || e;
      live({ phase: 'source_completed', provider: name, status: 'error', title: 'Source error', message: `${name}: ${e?.message || 'service unavailable'}`, resultCount: 0, durationMs: Date.now() - started });
      throw e;
    }
  };
  try {
    job.plan = makePlan(b);
    emit('planning', `Strategy: ${job.plan.summary}`);
    // Adjacent terms, each searched separately (feedback 28/09). No model call in demo mode.
    job.plan.terms = await expandTerms(b, job.mode === 'demo' || providers ? {} : env, fetcher);
    if (job.plan.terms.length > 1) {
      const list = job.plan.terms.map((t) => t.term).join(' · ');
      job.plan.items.unshift({ provider: 'Your need, expanded', query: list });
      emit('planning', `Searching ${job.plan.terms.length} phrasings separately: ${list}`);
    }
    if (env.CAPITAL_STRATEGY_CONTEXT === '1' && job.mode !== 'demo') {
      const name = 'Capital strategy context';
      live({ phase: 'planning', provider: name, status: 'running', title: 'Exploring capital strategies', message: 'Building evidence-seeking routes before discovery without changing the confirmed profile.' });
      job.capitalStrategyContext = await buildCapitalStrategyContext(b, {
        asOf: new Date().toISOString().slice(0, 10),
        maxRoutes: Number(env.CAPITAL_STRATEGY_MAX_ROUTES) || 6,
        maxQueries: Number(env.CAPITAL_STRATEGY_MAX_QUERIES) || 18,
        maxCalls: Number(env.CAPITAL_STRATEGY_MAX_CALLS) || 24,
        maxMs: Number(env.CAPITAL_STRATEGY_MAX_MS) || 120000,
        maxCostUsd: Number(env.CAPITAL_STRATEGY_MAX_COST_USD) || 1,
        available: { apollo: env.APOLLO_ENABLED === '1' && Boolean(env.APOLLO_API_KEY), authorized_network: true, official_grants: b.fundingTypes.includes('grant'), funding_round_sources: b.fundingTypes.includes('investment'), searxng: Boolean(env.SEARXNG_URL), page_reader: true, llm: fleetReady(env, 'engine') },
        plan: fleetReady(env, 'engine') ? async ({ system, input }) => (await chatJSON({ system, user: JSON.stringify(input), name: 'capital_strategy_context', role: 'engine' }, { env, fetcher, signal })).json : null,
      });
      live({ phase: 'planning', provider: name, status: 'success', title: 'Capital routes prepared', message: `${job.capitalStrategyContext.proposed_routes.length} routes and ${capitalQueries(job.capitalStrategyContext, { tools: ['searxng', 'official_grants', 'funding_round_sources'] }).length} concrete queries prepared. Adjacent routes remain hypotheses until evidence is found.`, resultCount: job.capitalStrategyContext.proposed_routes.length });
    }
    let sender = [];
    let team = null;
    let failures = 0;
    let followupResult = null;
    const searchAudit = [];
    const engineRuns = [];   // auditorías del motor (interpretación del brief, consultas, recorrido de descartes)
    const capitalFindings = [];
    const capitalExecutions = [];
    let authorizedNetwork = [];
    if (job.mode === 'demo') {
      live({ phase: 'planning', status: 'success', title: 'Search plan', message: job.plan.summary, detail: { kind: 'plan', items: job.plan.items, sources: [] } });
      live({ phase: 'warning', status: 'warning', title: 'Demo mode', message: 'EXPLICIT DEMO: fictional examples. No external sources or browser used.' });
      leads = demoLeads(b);
      emit(
        'demo',
        'EXPLICIT DEMO: fictional examples. No external sources used.',
      );
    } else {
      const grantsOnly = b.fundingTypes.length === 1 && b.fundingTypes[0] === 'grant';
      // El motor v2 necesita el modelo de IA para planear y leer. Si está configurado pero no responde
      // (túnel cerrado, g355 caído), NO se pierden las APIs de búsqueda: se usan directo, sin modelo.
      let engineOn = !providers && engineConfigured(env);
      if (engineOn && !(await roleReachable(env, 'engine', { fetcher }))) {
        engineOn = false;
        live({ phase: 'warning', provider: ENGINE_SOURCE, status: 'warning', title: 'AI model not reachable', message: 'The AI model did not respond; searching the web APIs directly (without AI planning or reading).' });
      }
      let intelPromise = null;
      const intelOnce = (c, e) => (intelPromise ||= grantIntel(c, b, job.plan, { emit: e, env }).then((x) => { job.intel = x; return x; }));
      const web = webSourcePlan({ fundingTypes: b.fundingTypes, engineOn, env, providers });
      const apiSearchOn = !providers && !engineOn && searchApisConfigured(env) && b.fundingTypes.includes('grant');
      const enabled = providers || [
        ...(b.fundingTypes.includes('partnering')
          ? [
              ['OpenAlex', (c) => openalex(c, b, job.plan, team, env)],
              ['ClinicalTrials.gov', (c) => clinicalTrials(c, b, job.plan)],
            ]
          : []),
        // Con el motor GPT Researcher, el registro federal (Simpler Grants / Grants.gov) se consulta DENTRO del motor y cada oportunidad
        // pasa por el mismo juez (ver registry/simplerGrants.mjs); aquí ya no se agregan punteros sin leer (14-10: pesca, mortinatos en Watch).
        ...(b.fundingTypes.includes('grant') && !(engineOn && String(env.ENGINE_GPTR || '') === '1')
          ? [
              // Inteligencia (RePORTER + NSF Awards) primero: sus avisos y programas alimentan las búsquedas de Grants.gov.
              ['Grants.gov', async (c, e) => grants(c, b, job.plan, e, { intel: await intelOnce(c, e) })],
              ['SBIR.gov', (c, e) => sbir(c, b, job.plan, { emit: e })],
            ]
          : []),
        ...(engineOn
          ? [[ENGINE_SOURCE, async () => { const portals = b.fundingTypes.includes('grant') ? portalSeeds(b) : []; if (portals.length) job.portals = portals.map((p) => ({ name: p.title, url: p.url }));
          // Con GPT Researcher, las rutas de capital van como hipótesis dentro del MISMO prompt: desde ce4e49d cada grupo lanzaba una
          // segunda corrida completa de GPTR sin plazo, que se comía el tope de la corrida y pisaba el log de la primera.
          const gptrMode = String(env.ENGINE_GPTR || '') === '1';
          const strategyQueries = job.capitalStrategyContext ? capitalQueries(job.capitalStrategyContext, { tools: ['searxng', 'official_grants', 'funding_round_sources'] }).slice(0, Math.max(1, Number(env.CAPITAL_STRATEGY_EXECUTE_MAX) || 6)) : [];
          const strategyObjective = (query) => (query.recommended_tool === 'official_grants' && b.fundingTypes.includes('grant') ? 'grant' : b.fundingTypes.includes('investment') ? 'investment' : b.fundingTypes.find((item) => ['grant', 'investment', 'debt', 'sponsorship', 'partnering'].includes(item)));
          const gptrQueriesBy = {};
          if (gptrMode) for (const query of strategyQueries) { const o = strategyObjective(query); if (o) (gptrQueriesBy[o] ||= []).push({ query: query.query, family: `capital_strategy:${query.route_id}` }); }
          const r = await runEngine(b, { env, fetcher, signal, mapSeedsBy: { grant: portals }, deadlineAt: engineDeadlineAt, plan: job.plan, ...(gptrMode ? { gptrQueriesBy } : {}) });
          engineRuns.push(...r.audits);
          // El registro federal corre dentro de GPT Researcher, pero debe aparecer como fuente
          // propia en la interfaz. Antes quedaba oculto bajo «Web research engine», por lo que
          // una corrida que sí usó Simpler.Grants.gov parecía no haberlo consultado.
          const registryRuns = r.audits.map((audit) => audit?.gptr?.registry).filter((registry) => registry?.on);
          if (registryRuns.length) {
            const allStats = registryRuns.flatMap((registry) => [registry.brief, registry.byNumber]).filter(Boolean);
            const via = [...new Set(allStats.flatMap((stats) => stats.via || []))];
            const provider = via.includes('simpler') ? 'Simpler.Grants.gov' : via.includes('grants.gov') ? 'Grants.gov' : 'Federal grants registry';
            const candidates = registryRuns.reduce((sum, registry) => sum + Number(registry.seeds || 0), 0);
            const errors = allStats.flatMap((stats) => stats.errors || []);
            live({
              phase: 'source_completed', provider,
              status: candidates || !errors.length ? 'success' : 'error',
              title: errors.length && !candidates ? 'Federal registry error' : 'Federal registry searched',
              message: candidates
                ? `${provider}: ${candidates} current opportunities sent to the same eligibility review as the web results.`
                : errors.length ? `${provider}: ${errors[0]}` : `${provider}: no current opportunities matched this brief.`,
              resultCount: candidates,
              detail: { via, errors: errors.slice(0, 3) },
            });
          }
          job.engineDrops = r.audits.flatMap((a) => (a.dropped_pages || []).map((d) => ({ ...d, objective: a.objective })));
          // Resumen por objetivo para el banco nocturno y el asistente: tiempos, URLs, triage, juez y créditos de Apollo.
          job.engineAudit = r.audits.map((a) => ({ objective: a.objective, gptr: a.gptr || null, triage: a.triage || null, judge: a.judge || null, contacts: a.contacts || null, seconds: a.agent?.seconds ?? null, opens: a.agent?.opens ?? a.pages ?? null, skipped_for_time: a.skipped_for_time || 0, errors: a.errors || [] }));
          if (job.capitalStrategyContext && gptrMode) {
            for (const query of strategyQueries) capitalExecutions.push({ query_id: query.query_id, new_evidence: 0, latency_ms: 0, error: null, merged_into: 'gptr_prompt' });
            job.capitalStrategyContext = recordCapitalToolResults(attachCapitalEvidence(job.capitalStrategyContext, capitalFindings), capitalExecutions);
          } else if (job.capitalStrategyContext) {
            const grouped = new Map();
            for (const query of strategyQueries) {
              const objective = strategyObjective(query);
              if (!objective) continue;
              grouped.set(objective, [...(grouped.get(objective) || []), { ...query, family: `capital_strategy:${query.route_id}` }]);
            }
            for (const [objective, queries] of grouped) {
              const started = Date.now();
              try {
                const extra = await runObjective(objective, b, { env, fetcher, signal, queries, rounds: 1, maxQueries: queries.length, expand: false, maxPages: Math.max(6, queries.length * 3) });
                engineRuns.push({ ...extra.audit, capitalStrategy: true }); capitalFindings.push(...extra.findings);
                for (const query of queries) capitalExecutions.push({ query_id: query.query_id, new_evidence: extra.findings.filter((finding) => String(finding.query || '').toLowerCase() === query.query.toLowerCase()).length, latency_ms: Date.now() - started, error: null });
              } catch (error) {
                for (const query of queries) capitalExecutions.push({ query_id: query.query_id, new_evidence: 0, latency_ms: Date.now() - started, error: error.message });
              }
            }
            job.capitalStrategyContext = recordCapitalToolResults(attachCapitalEvidence(job.capitalStrategyContext, capitalFindings), capitalExecutions);
          }
          const allFindings = [...r.findings, ...capitalFindings];
          return Object.assign(engineLeads(allFindings), { searchAudit: engineRuns.map((a) => ({ provider: a.capitalStrategy ? 'Capital strategy context' : ENGINE_SOURCE, query: `(${a.objective}) ${a.queries} queries · ${a.pages} pages · ${a.read} read`, dimension: a.capitalStrategy ? 'capital_strategy' : 'engine', returned: a.pages, discovered: a.kept, dropped: a.dropped, skipped: a.skipped })) }); }]]
          : []),
        // Grants por las APIs de búsqueda (Exa, Serper, Tavily, You, Jina, Linkup) sin depender del modelo:
        // una consulta por término («¿quién financia X?») + programas y fundaciones; las páginas se abren y confirman después.
        ...(apiSearchOn
          ? [[GRANT_API_SOURCE, async () => {
              const terms = (job.plan.terms?.length ? job.plan.terms.map((t) => t.term) : [b.industry || b.product]).filter(Boolean).slice(0, 4);
              const queries = [...terms.map((t) => fundingQuery(t, 'grant', b)), ...templateQueries('named_funders', b, { terms, n: 3 }).map((q) => q.query)].slice(0, Number(env.GRANT_API_QUERIES) || 6);
              const breaker = {}; const out = [];
              await Promise.all(queries.map(async (query) => {
                const rows = await multiSearch(query, { env, fetcher, signal, breaker });
                for (const [provider, stat] of Object.entries(rows.stats || {})) client.track(provider, { calls: 1, results: stat.returned, ms: stat.ms });
                searchAudit.push({ provider: GRANT_API_SOURCE, query, dimension: 'api', returned: rows.length, discovered: rows.length });
                out.push(...searchRowsToLeads(rows.slice(0, 10), b, { objective: 'grant', query }));
              }));
              return out;
            }]]
          : []),
        ...(grantsOnly && b.useApify && searchConfigured(env) && !engineOn
          ? [[GRANT_WEB_SOURCE, () => grantWebOpportunities(b, job.plan, { env, fetcher, signal, live: live.scope(GRANT_WEB_SOURCE), record, usageClient: client })]]
          : []),
        // «Official radar» tiene financiadores escritos en el código: queda apagado salvo OFFICIAL_RADAR=1 (regla: cero financiadores en código).
        ...(job.plan.alzheimer && env.OFFICIAL_RADAR === '1'
          ? [['Official radar', (c, e) => radar(c, b, job.plan, e)]]
          : []),
        ...(web.exa ? [['Exa', (c, e) => exaSearch(c, b, job.plan, env, e)]] : []),
        ...(web.rounds
          ? [[`Funding rounds (${env.EXA_API_KEY ? 'Exa' : 'Serper'})`, (c) => roundAnnouncements(c, b, job.plan, env)]]
          : []),
        ...(web.serper ? [['Web search (Serper)', (c) => webSearch(c, b, job.plan, env)]] : []),
      ];
      const TEAM_SOURCE = 'Sender public profile';
      const useTeamFacts = teamFactsApply(b);
      const useApify = web.legacy && b.useApify && webConfigured(env);
      live({
        phase: 'planning',
        status: 'success',
        title: 'Search plan',
        message: job.plan.summary,
        detail: { kind: 'plan', items: job.plan.items, sources: [...(useTeamFacts ? [TEAM_SOURCE] : []), ...enabled.map(([name]) => name), ...(useApify ? [WEB_SOURCE] : [])] },
      });
      if (!providers) {
        if (web.legacy && !env.EXA_API_KEY) {
          emit('configuration', 'Exa: missing EXA_API_KEY; semantic search skipped.');
          live({ phase: 'planning', status: 'pending', title: 'Source skipped', message: 'Exa: missing EXA_API_KEY; semantic search skipped.' });
        }
        if (web.legacy && !env.SERPER_API_KEY) {
          emit('configuration', 'Serper: no SERPER_API_KEY; broad web search skipped.');
          live({ phase: 'planning', status: 'pending', title: 'Source skipped', message: 'Serper: no SERPER_API_KEY; broad web search skipped.' });
        }
        if (web.legacy && b.useApify && !webConfigured(env)) live({ phase: 'planning', status: 'pending', title: 'Source skipped', message: `${WEB_SOURCE}: missing ${webMissing(env).join(' y ')}; research continues with available sources.` });
        if (grantsOnly && b.useApify && !searchConfigured(env)) live({ phase: 'planning', provider: GRANT_WEB_SOURCE, status: 'pending', title: 'Broader discovery skipped', message: 'FIRECRAWL_API_KEY is missing; official registries still run.' });
      }
      if (useTeamFacts) {
        try {
          ({ sender, team } = await runSource(TEAM_SOURCE, async () => {
            const facts = await teamFacts(client.scope(TEAM_SOURCE), b);
            return Object.assign([...facts.sender], facts);
          }, 1));
        } catch (e) {
          failures++;
          emit(
            'warning',
            `Public profile: ${e.message}. Draft with fields to complete.`,
          );
          live({ phase: 'warning', provider: TEAM_SOURCE, status: 'warning', title: 'Warning', message: `Public profile: ${e.message}. Draft with fields to complete.` });
        }
      }
      job.senderEvidence = sender;
      // A bounded set of providers; individual errors cannot erase successful results.
      // Una fuente que ignora la señal no puede colgar la corrida: al vencer el tope se sale con lo ya recogido (entrega parcial).
      const aborted = new Promise((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true }); });
      aborted.catch(() => {});
      const outcomes = await Promise.race([aborted, Promise.allSettled(
        enabled.map(async ([name, run]) => {
          emit('searching', `${name}: query started.`);
          const found = await runSource(name, () => run(client.scope(name), emitFor(name)), enabled.length);
          collected.push(...found.map((lead) => ({ ...lead, foundBy: lead.foundBy?.length ? lead.foundBy : [{ provider: name, term: '', objective: lead.fundingType || '', query: '' }] })));
          emit(
            'reading',
            `${name}: ${found.length} candidates with provenance.`,
          );
          return found;
        }),
      )]);
      signal.throwIfAborted();
      outcomes.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          const provider = enabled[i][0];
          const planned = job.plan.items.find((item) => provider.startsWith(item.provider.replace(/\s*\(.*/, '')));
          leads.push(...result.value.map((lead) => ({
            ...lead,
            foundBy: lead.foundBy?.length ? lead.foundBy : [{ provider, term: '', objective: lead.fundingType || '', query: planned?.query || '' }],
          })));
          if (Array.isArray(result.value.searchAudit)) searchAudit.push(...result.value.searchAudit);
        }
        else {
          failures++;
          emit(
            'warning',
            `${enabled[i][0]}: ${result.reason?.message || 'service unavailable'}`,
          );
          live({ phase: 'warning', provider: enabled[i][0], status: 'warning', title: 'Source returned nothing', message: `${enabled[i][0]}: ${result.reason?.message || 'service unavailable'}. Other sources continue.` });
        }
      });
      // Convocatorias de registros (Grants.gov, radar): punteros. Se leen con el mismo motor antes de decidir nada (ver registryVerify.mjs).
      if (engineOn && !providers && b.fundingTypes.includes('grant')) {
        try {
          const reg = await verifyRegistryLeads(leads, b, { env, fetcher, signal, engineRuns });
          leads = reg.leads; job.registryCheck = reg.stats;
          if (reg.stats.checked) live({ phase: 'reading', provider: 'Registry check', status: 'success', title: 'Registry calls read', message: `${reg.stats.checked} registry calls read like any web page: ${reg.stats.kept} kept, ${reg.stats.dropped} dropped${reg.stats.unread ? `, ${reg.stats.unread} unread` : ''}.` });
        } catch (error) {
          if (signal.aborted) throw error;
          emit('warning', `Registry check: ${error.message}. Registry results kept as they were.`);
        }
      }
      if (web.agentic && env.AGENTIC_FOLLOWUP === '1') {
        const name = 'Follow-up: funder → people';
        if (!webConfigured(env)) {
          emit('configuration', `${name}: missing ${webMissing(env).join(' and ')}; skipped.`);
          live({ phase: 'planning', provider: name, status: 'pending', title: 'Source skipped', message: `${name}: missing ${webMissing(env).join(' and ')}.` });
        } else {
          try {
            followupResult = await runSource(name, async () => {
              const result = await followUpPeople(leads, b, { env, fetcher, signal, record, live: live.scope(name), client: client.scope(name) });
              live({ phase: 'reading', provider: name, status: 'running', title: 'Funders followed', message: `Followed ${result.funders} funders → ${result.leads.length} people across ${result.pages} pages.` });
              return Object.assign([...result.leads], result);
            }, 1);
            leads.push(...followupResult.leads);
            emit('reading', `${name}: followed ${followupResult.funders} funders → ${followupResult.leads.length} people in ${followupResult.pages} pages.`);
          } catch (error) {
            failures++;
            emit('warning', `${name}: ${error.message}. Discovery results were kept.`);
          }
        }
      }
      if (useApify && !(followupResult?.funders > 0)) {
        if (!webConfigured(env)) {
          emit('configuration', `${WEB_SOURCE}: missing ${webMissing(env).join(' y ')}; research continues with available sources.`);
        } else {
          try {
            emit('searching', `${WEB_SOURCE}: finding fund and organization teams on public pages. May use credit.`);
            const result = await runSource(WEB_SOURCE, async () => {
              const found = await webPeople(leads, b, { env, fetcher, signal, record, live: live.scope(WEB_SOURCE), usageClient: client });
              live({ phase: 'reading', provider: WEB_SOURCE, status: 'running', title: 'People found', message: `${found.leads.length} verified people on ${found.pages} public pages (${found.queries.join(' · ')}).` });
              return Object.assign([...found.leads], found);
            }, 1);
            leads.push(...result.leads);
            emit('reading', `${WEB_SOURCE}: ${result.leads.length} verified people on ${result.pages} pages.`);
          } catch (e) {
            failures++;
            emit('warning', `${WEB_SOURCE}: ${e.message}. Other sources' results were kept.`);
            live({ phase: 'warning', provider: WEB_SOURCE, status: 'warning', title: 'Source returned nothing', message: `${WEB_SOURCE}: ${e.message}. Other sources' results were kept.` });
          }
        }
      }
      if (!providers && env.AGENTIC_READ === '1') {
        const name = 'Read and verify';
        const read = await readCandidates(leads, b, { env, fetcher, signal, client: client.scope(name) });
        leads = read.leads;
        live({ phase: read.skipped ? 'planning' : 'reading', provider: name, status: read.skipped ? 'pending' : 'success', title: read.skipped ? 'Reading skipped' : 'Pages verified', message: read.skipped ? `Read step skipped: ${read.reason}.` : `Read ${read.documents} pages; rejected ${read.dropped} unsupported extracted facts.`, resultCount: read.documents });
        if (read.skipped) emit('configuration', `${name}: ${read.reason}.`);
      }
      if (web.agentic && env.AGENTIC_LOOP === '1') {
        const name = 'Agentic research loop';
        const loop = await runAgenticLoop({
          leads, brief: b, terms: job.plan.terms, env, fetcher, signal, usage: client.usage,
          search: (query) => searchFundingQuery(client.scope(name), b, query, env),
          read: env.AGENTIC_READ === '1' ? (items) => readCandidates(items, b, { env, fetcher, signal, client: client.scope('Read and verify') }) : null,
        });
        leads = loop.leads;
        job.queryLedger = loop.queryLedger;
        job.loop = { stopReason: loop.stopReason, sufficient: loop.sufficient, partial: loop.partial };
        live({ phase: 'reading', provider: name, status: loop.partial ? 'warning' : 'success', title: 'Research loop finished', message: `${loop.queryLedger.length} follow-up queries; stopped by ${loop.stopReason}.`, resultCount: loop.queryLedger.length, detail: { kind: 'query_ledger', stopReason: loop.stopReason, queries: loop.queryLedger.slice(0, 12) } });
        if (loop.partial) failures++;
        if (env.AGENTIC_FOLLOWUP === '1' && webConfigured(env)) {
          const late = await followUpPeople(leads, b, { env, fetcher, signal, record, live: live.scope('Follow-up: funder → people'), client: client.scope('Follow-up: funder → people') });
          leads.push(...late.leads);
        }
      }
      if (env.AGENTIC_READ === '1' || env.AGENTIC_LOOP === '1') {
        leads = assessLeads(leads, b, { terms: job.plan.terms, activeWindowMonths: Number(env.ACTIVE_WINDOW_MONTHS) || 18 }).leads;
      }
      signal.throwIfAborted();
      // ── Orquestador: evalúa → reflexiona (OpenJev/Jev o reglas) → nueva estrategia → hasta 2 intentos más.
      //    Hunter: emails de las personas y personas con email en las organizaciones encontradas.
      if (!providers) {
        const memoryEarly = store.feedbackFor(b, job.userId);
        const rejectedEarly = new Set([...memoryEarly].filter(([, v]) => v.decision === 'reject').map(([key]) => key));
        const rank = (list) => evaluate(list, b, rejectedEarly, new Date(), job.plan.terms || []);
        const hunter = hunterConfigured(env) ? makeHunter({ env, fetcher, signal, usageClient: client }) : null;
        const hunterSeen = { domains: new Set(), people: new Set() };
        const hunterStats = { calls: 0, emailsAdded: 0, peopleAdded: 0, domains: 0, errors: [] };
        const findContacts = hunter ? async (ranked, { signal: s, wide = false } = {}) => {
          const r = await enrichWithHunter(ranked, b, { env, fetcher, signal: s || signal, hunter, seen: hunterSeen, ...(wide ? { maxDomains: Math.max(12, Number(env.HUNTER_MAX_DOMAINS) || 12) * 2 } : {}) });
          for (const k of ['emailsAdded', 'peopleAdded', 'domains']) hunterStats[k] += r.stats[k] || 0;
          hunterStats.calls = hunter.calls; hunterStats.errors.push(...r.stats.errors);
          const before = new Set(ranked.map((l) => l.id));
          return r.leads.filter((l) => !before.has(l.id) || l.hunter || (l.contacts?.length && l.contact?.type === 'email'));
        } : null;
        // Lector para confirmar pistas de snippet: descarga directa → Jina Reader → Firecrawl /scrape.
        // Lectores de páginas, en el orden de PAGE_READER_ORDER (por defecto: solo Crawl4AI si CRAWL4AI_URL está puesto; si no, firecrawl,direct,jina): de esa lectura parte todo el
        // análisis del modelo. Se pasa al siguiente solo si el anterior no está disponible o devuelve menos de 400 caracteres.
        // Ej.: PAGE_READER_ORDER=crawl4ai,direct para añadir la descarga directa como respaldo gratuito.
        const readPage = async (url, s = signal) => {
          const readers = {
            firecrawl: () => firecrawlRead(url, { env, fetcher, signal: s }),
            crawl4ai: () => (crawl4aiConfigured(env) ? crawl4aiRead(url, { env, fetcher, signal: s }) : null),
            direct: () => fetchPage(url, { fetcher, signal: s, timeoutMs: 8000 }),
            jina: () => jinaRead(url, { env, fetcher, signal: s }),
          };
          const order = String(env.PAGE_READER_ORDER || (crawl4aiConfigured(env) ? 'crawl4ai' : 'firecrawl,direct,jina')).split(',').map((x) => x.trim().toLowerCase()).filter((x) => readers[x]);
          let page = null;
          for (const name of order) {
            if (page && page.text.length >= 400) break;
            let next = null; try { next = await readers[name](); } catch { next = null; }
            if (next && next.text && next.text.length > (page?.text.length || 0)) page = { ...next, via: next.via || name };
          }
          return page;
        };
        // El modelo grande juzga cada convocatoria abierta (alcance, etapa, quién postula); GRANT_PAGE_MODEL=0 lo apaga.
        const modelRead = grantsOnly && env.GRANT_PAGE_MODEL !== '0' && fleetReady(env, 'chat') ? (page) => readOpportunity(page, b, { env, fetcher, signal }) : null;
        if (env.CONFIRM_SNIPPETS !== '0') {
          // Presupuesto propio: abrir pistas nunca se come el tiempo de los intentos del orquestador (más con lectura del modelo).
          const confirmSignal = AbortSignal.any([signal, AbortSignal.timeout(Number(env.CONFIRM_SNIPPETS_MS) || (modelRead ? 150000 : 40000))]);
          const confirm = await confirmFromPages(leads, b, { read: (url) => readPage(url, confirmSignal), max: Number(env.CONFIRM_SNIPPETS_MAX) || 15, signal: confirmSignal, modelRead });
          if (confirm.tried) live({ phase: 'reading', provider: 'Page check', status: 'success', title: 'Search leads opened', message: `Opened ${confirm.tried} search results that only had a snippet; ${confirm.confirmed} confirmed with a quote from the page.`, resultCount: confirm.confirmed });
        }
        const breaker = {};
        const runSearch = async (queries, { signal: s } = {}) => {
          const byObjective = new Map();
          for (const q of queries) byObjective.set(q.objective || b.fundingTypes[0], [...(byObjective.get(q.objective || b.fundingTypes[0]) || []), q]);
          const found = [];
          for (const [objective, list] of byObjective) {
            if (engineOn) {
              const r = await runObjective(objective, b, { env, fetcher, signal: s, queries: list.map((q) => ({ query: q.query, family: 'orchestrator' })), rounds: 1, breaker });
              engineRuns.push({ ...r.audit, attempt: 'orchestrator' });
              found.push(...engineLeads(r.findings));
            } else if (searchApisConfigured(env)) {
              await Promise.all(list.map(async (q) => {
                const rows = await multiSearch(q.query, { env, fetcher, signal: s, breaker });
                for (const [provider, stat] of Object.entries(rows.stats || {})) client.track(provider, { calls: 1, results: stat.returned, ms: stat.ms });
                found.push(...searchRowsToLeads(rows.slice(0, 8), b, { objective, query: q.query }));
              }));
            } else if (env.EXA_API_KEY || env.SERPER_API_KEY) {
              for (const q of list) found.push(...await searchFundingQuery(client.scope(ORCHESTRATOR), b, { query: q.query, objective }, env).catch(() => []));
            }
          }
          if (env.CONFIRM_SNIPPETS !== '0') await confirmFromPages(found, b, { read: (url) => readPage(url, s), max: Number(env.CONFIRM_SNIPPETS_MAX) || 15, signal: s, modelRead });
          return found;
        };
        // GPT Researcher ya hace planificación y búsquedas iterativas. No se apila el orquestador genérico: antes duplicaba
        // dos rondas y, por una condición de queries, las ejecutaba silenciosamente con el motor legado.
        const orchestratorOn = env.ORCHESTRATOR !== '0' && !(engineOn && String(env.ENGINE_GPTR || '') === '1') && (searchApisConfigured(env) || engineConfigured(env) || env.EXA_API_KEY || env.SERPER_API_KEY || hunter);
        if (orchestratorOn) {
          const provider = jevProvider(env);
          live({ phase: 'evaluating', provider: ORCHESTRATOR, status: 'running', title: 'Reviewing the results', message: `${aiReasonerOn(env) ? 'The AI model' : provider ? provider.name : 'Rules'} reviews what we found and decides whether to search again (up to ${Number(env.ORCHESTRATOR_MAX_ATTEMPTS ?? 2)} more attempts).` });
          try {
            const orch = await orchestrate({ leads, brief: b, terms: job.plan.terms || [], rank, runSearch, findContacts, env, fetcher, signal, deadline: runStarted + runTimeoutMs - Number(env.ORCHESTRATOR_RESERVE_MS || 40000), live: (event) => live({ provider: ORCHESTRATOR, ...event }) });
            leads = orch.leads;
            job.orchestrator = { attempts: orch.attempts, by: orch.attempts[0]?.by || orch.attempts[0]?.assessment?.by || provider?.name || 'rules' };
            for (const a of orch.attempts) if (a.queries?.length) searchAudit.push({ provider: ORCHESTRATOR, query: `(attempt ${a.attempt} · ${a.strategy}) ${a.queries.length} queries`, dimension: 'orchestrator', returned: a.added, discovered: a.added });
          } catch (error) {
            if (signal.aborted) throw error;
            failures++;
            emit('warning', `${ORCHESTRATOR}: ${error.message}. First-pass results were kept.`);
          }
        }
        if (findContacts) {
          try {
            leads = mergeLeads(leads, await findContacts(rank(leads), { signal }));
            live({ phase: 'reading', provider: HUNTER_SOURCE, status: hunterStats.errors.length && !(hunterStats.emailsAdded + hunterStats.peopleAdded) ? 'warning' : 'success', title: 'Emails found', message: `Hunter: ${hunterStats.emailsAdded} emails added and ${hunterStats.peopleAdded} new people across ${hunterStats.domains} organizations (${hunterStats.calls} calls).${hunterStats.errors.length ? ` Note: ${hunterStats.errors[0]}` : ''}`, resultCount: hunterStats.emailsAdded + hunterStats.peopleAdded });
            job.hunter = { ...hunterStats, errors: hunterStats.errors.slice(0, 5) };
          } catch (error) {
            if (signal.aborted) throw error;
            emit('warning', `${HUNTER_SOURCE}: ${error.message}. Results kept without new emails.`);
          }
        } else if (!grantsOnly) {
          live({ phase: 'planning', provider: HUNTER_SOURCE, status: 'pending', title: 'Emails pending', message: 'Hunter: missing HUNTER_API_KEY; no email lookup for people and organizations.' });
        }
      }
      if (['investment', 'debt'].some((t) => b.fundingTypes.includes(t)))
      {
        emit(
          'warning',
          'Limited equity/debt coverage: SEC placement agents aren\'t integrated. Other categories are marked adjacent.',
        );
        live({ phase: 'warning', status: 'warning', title: 'Limited coverage', message: 'Limited equity/debt coverage: SEC placement agents aren\'t integrated. Other categories are marked adjacent.' });
      }
      const network = store.network(b, job.userId);
      authorizedNetwork = network;
      const NETWORK_SOURCE = 'Your network (warm paths)';
      const networkStarted = Date.now();
      live({ phase: 'source_started', provider: NETWORK_SOURCE, status: 'running', title: 'Network match', message: network.length ? `Comparing ${leads.length} candidates with ${network.length} imported contacts.` : 'No imported contacts: warm paths can\'t be computed.', detail: { parallel: 1 } });
      const fromNetwork = networkCandidates(network, b);
      if (fromNetwork.length) live({ phase: 'reading', provider: NETWORK_SOURCE, status: 'running', title: 'Investors in your network', message: `${fromNetwork.length} of your contacts have investment roles and were added as candidates.` });
      leads = addOrgBridges(addConnections([...leads, ...fromNetwork], network, b), network, b);
      const withPaths = leads.filter((l) => l.paths?.length);
      live({
        phase: 'source_completed', provider: NETWORK_SOURCE, status: 'success', title: 'Match complete',
        message: `${withPaths.length} candidates with a documented path from your network or team.`,
        resultCount: withPaths.length, durationMs: Date.now() - networkStarted,
        detail: { kind: 'network', you: b.name, contacts: network.length, candidates: leads.length, paths: withPaths.slice(0, 4).map((l) => ({ nodes: (l.paths[0].nodes || []).slice(0, 4).map((n) => String(n).slice(0, 60)), target: String(l.person || l.org).slice(0, 80), strength: Math.round((l.paths[0].strength || 0) * 100) })) },
      });
    }
    emit(
      'evaluating',
      `Evaluating ${leads.length} candidates: evidence, duplicates, timing and feedback.`,
    );
    const evaluationStarted = Date.now();
    live({ phase: 'evaluating', status: 'running', title: 'Evaluation started', message: `Evaluating ${leads.length} candidates: evidence, duplicates, timing and feedback.`, resultCount: leads.length });
    const memory = store.feedbackFor(b, job.userId);
    const rejected = new Set(
      [...memory]
        .filter(([, v]) => v.decision === 'reject')
        .map(([key]) => key),
    );
    job.leads = evaluate(leads, b, rejected, new Date(), job.plan.terms || []);
    job.contactResolution = [];
    if (env.APOLLO_ENABLED === '1' && job.mode !== 'demo') {
      const selectedOrganizations = job.leads.filter((lead) => !lead.person && ['top', 'radar'].includes(lead.bucket) && leadDomain(lead)).slice(0, Math.max(1, Number(env.APOLLO_MAX_ORGS_PER_RUN) || 3));
      if (!env.APOLLO_API_KEY) {
        job.apollo = { status: 'not_configured', organizations: selectedOrganizations.length, message: 'Apollo is disabled for this run because APOLLO_API_KEY is not configured. Research continued without it.' };
        live({ phase: 'planning', provider: 'Apollo', status: 'pending', title: 'Apollo not configured', message: job.apollo.message });
      } else {
        sharedApolloCache.ttlMs = (Number(env.APOLLO_CACHE_TTL_HOURS) || 24) * 3600_000;
        const apollo = createApolloClient({
          apiKey: env.APOLLO_API_KEY, fetcher, timeoutMs: Number(env.APOLLO_TIMEOUT_MS) || 15000,
          cache: sharedApolloCache,
          budget: new ApolloBudget({ perRun: Number(env.APOLLO_MAX_CREDITS_PER_RUN) || 8, perOrganization: Number(env.APOLLO_MAX_CREDITS_PER_ORG) || 3, perDay: Number(env.APOLLO_MAX_CREDITS_PER_DAY) || 30 }),
        });
        for (const organization of selectedOrganizations) {
          const domain = leadDomain(organization);
          const result = await resolveApolloContacts({ organization_stable_id: organization.key || organization.externalId || organization.id, canonical_name: organization.org, official_domain: domain, target_roles: ['partner', 'principal', 'investment director', 'managing director'], as_of: new Date().toISOString().slice(0, 10) }, {
            client: apollo, maxPeople: Number(env.APOLLO_PEOPLE_PER_ORG) || 5,
            networkLookup: async ({ name }) => authorizedNetwork.filter((row) => ['linkedin_authenticated', 'linkedin_mutual_path'].includes(row.source) && String(row.name || row.path?.targetName || '').toLowerCase() === name.toLowerCase()).map((row) => ({ verified: true, evidence: [{ source: row.source, url: row.url || row.path?.targetUrl || '', quote: row.source === 'linkedin_mutual_path' ? 'Authorized shared-connection path; willingness to introduce is not established.' : 'Authorized first-degree network record; willingness to introduce is not established.', observed_at: new Date().toISOString().slice(0, 10) }] })),
          });
          job.contactResolution.push(result);
        }
        job.apollo = { status: job.contactResolution.some((item) => item.status === 'resolved') ? 'connected' : job.contactResolution.some((item) => item.status === 'partial') ? 'connected_limited' : job.contactResolution[0]?.status || 'connected_limited', organizations: selectedOrganizations.length, calls: apollo.stats.calls, creditsEstimated: apollo.stats.creditsEstimated, message: 'Apollo was used only after organization selection and did not change relevance or ranking.' };
        live({ phase: 'reading', provider: 'Apollo', status: job.apollo.status === 'connected' ? 'success' : 'warning', title: 'People and contact routes resolved', message: `${job.contactResolution.flatMap((item) => item.people).length} people found across ${selectedOrganizations.length} selected organizations. Public affiliations were not labeled as warm paths.`, resultCount: job.contactResolution.flatMap((item) => item.people).length });
      }
    }
    const jevP = jevProvider(env);
    if (job.mode !== 'demo' && jevP) {
      const jevStarted = Date.now();
      live({ phase: 'evaluating', provider: jevP.name, status: 'running', title: 'Structured decision', message: `${jevP.name} is scoring fit, evidence and next action.` });
      try {
        const jev = await askJev(job.leads, b, { env, fetcher, signal });
        job.leads = applyJevDecisions(job.leads, jev);
        live({ phase: 'evaluating', provider: jevP.name, status: 'success', title: `${jevP.name} decisions applied`, message: `${jevP.name} reviewed ${jev.decisions.length} candidates; uncertain ones go to radar for human review.`, resultCount: jev.decisions.length, durationMs: Date.now() - jevStarted, detail: { model: jev.model, usage: jev.usage } });
      } catch (error) {
        failures++;
        emit('warning', `${jevP.name}: ${error.message}. The rules ranking was kept.`);
        live({ phase: 'warning', provider: jevP.name, status: 'warning', title: `${jevP.name} unavailable`, message: `${error.message}. The rules ranking was kept.`, durationMs: Date.now() - jevStarted });
      }
    } else if (job.mode !== 'demo') {
      emit('configuration', 'OpenJev: missing OPENJEV_API_KEY; using rules ranking and human review.');
      live({ phase: 'planning', provider: 'OpenJev', status: 'pending', title: 'Decision layer pending', message: 'OpenJev/Jev is integrated but no key is set (OPENJEV_API_KEY). Rules ranking kept.' });
    }
    job.leads = job.leads.map((l) => ({
      ...l,
      feedback: memory.get(l.key) || null,
      draft: buildDraft(l, b, sender),
    }));
    const card = (l) => ({ name: String(l.person || l.org).slice(0, 90), org: String(l.org || '').slice(0, 90), title: String(l.title || '').slice(0, 140), score: l.score, why: String(l.why?.[0] || l.discard || '').slice(0, 160), bucket: l.bucket });
    const byBucket = (bucket, n) => job.leads.filter((l) => l.bucket === bucket).slice(0, n).map(card);
    live({ phase: 'evaluating', status: 'success', title: 'Candidates ranked', detail: { kind: 'ranking', top: byBucket('top', 8), radar: byBucket('radar', 2), discarded: byBucket('discarded', 3), counts: { top: job.leads.filter((l) => l.bucket === 'top').length, radar: job.leads.filter((l) => l.bucket === 'radar').length, discarded: job.leads.filter((l) => l.bucket === 'discarded').length } }, message: `${job.leads.filter((l) => l.bucket === 'top').length} priority, ${job.leads.filter((l) => l.bucket === 'radar').length} on radar and ${job.leads.filter((l) => l.bucket === 'discarded').length} discarded after de-duplication and scoring.`, resultCount: job.leads.length, durationMs: Date.now() - evaluationStarted });
    emit(
      'drafting',
      b.fundingTypes.length === 1 && b.fundingTypes[0] === 'grant' ? 'Grant work items built from official calls; no fundraising emails were created.' : 'Drafts built from templates and public facts; nothing is sent.',
    );
    // Warm path para todos: camino de la red cuando existe; si no, un plan para construirlo (consejo + updates).
    job.leads = addWarmPlans(job.leads, b);
    job.leads = attachGrantPlans(job.leads, b).map((lead) => lead.grantPlan ? { ...lead, draft: buildDraft(lead, b, sender) } : lead);
    job.searchAudit = finalizeSearchAudit(searchAudit, job.leads);
    if (env.AGENTIC_READ === '1' || env.AGENTIC_LOOP === '1') {
      job.leads = assessLeads(job.leads, b, { terms: job.plan.terms, activeWindowMonths: Number(env.ACTIVE_WINDOW_MONTHS) || 18 }).leads;
    }
    {
      const plans = job.leads.filter((l) => l.warmPlan);
      const built = plans.filter((l) => !l.warmPlan.built).length;
      const grantRun = b.fundingTypes.length === 1 && b.fundingTypes[0] === 'grant';
      live({ phase: 'evaluating', provider: grantRun ? 'Application plan' : 'Warm path plan', status: 'success', title: grantRun ? 'Application plans prepared' : 'Warm paths for every candidate', message: grantRun ? `${plans.length} opportunities converted into go/no-go work plans.` : `${plans.length - built} through your network; ${built} to build with advice and updates before the round.`, resultCount: plans.length });
    }
    // Enriquecimiento dentro de la corrida: elegibilidad de grants y fondos activos (tesis revelada).
    if (job.mode !== 'demo') for (const step of enrichers) {
      const started = Date.now();
      try {
        live({ phase: 'source_started', provider: step.name, status: 'running', title: 'Source started', message: `${step.name}: started.`, detail: { parallel: 1 } });
        const r = await step.run(job, { signal, live });
        live({ phase: 'source_completed', provider: step.name, status: r?.skipped ? 'pending' : 'success', title: r?.skipped ? 'Source skipped' : 'Source finished', message: r?.message || `${step.name}: done.`, resultCount: r?.count ?? 0, durationMs: Date.now() - started });
      } catch (e) {
        live({ phase: 'warning', provider: step.name, status: 'warning', title: 'Warning', message: `${step.name}: ${e.message}. The rest of the run was kept.`, durationMs: Date.now() - started });
        // Cierra siempre la fuente. Dejar solo el warning hacía que la UI la mostrara como
        // «The source didn't report completion», ocultando el error real.
        live({ phase: 'source_completed', provider: step.name, status: 'error', title: 'Source error', message: `${step.name}: ${e.message}`, resultCount: 0, durationMs: Date.now() - started });
      }
      store.save(job);
    }
    job.leads = attachGrantPlans(job.leads, b).map((lead) => lead.grantPlan ? { ...lead, draft: buildDraft(lead, b, sender) } : lead);
    // Auditoría de la corrida (qué entendió el motor, qué buscó, qué leyó, qué descartó y por qué; fecha de hoy usada).
    try {
      job.runAudit = buildRunAudit({ grantSources: b.fundingTypes.includes('grant') ? { intel: job.intel, portals: job.portals, jurisdiction: [b.city, b.state, b.country].filter(Boolean).join(', ') || null } : null, engineRuns, orchestrator: job.orchestrator, leads: job.leads, searchAudit: job.searchAudit || [], brief: b, today: new Date().toISOString().slice(0, 10) });
      const c = job.runAudit.counters; const why = Object.entries(c.discardReasons).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ');
      live({ phase: 'evaluating', provider: 'Run audit', status: 'success', title: 'Run audit', message: `${c.queries || job.runAudit.queries.length} queries · ${c.pagesRead} pages read by the AI · ${c.buckets.top} main list · ${c.buckets.radar} to verify · ${c.buckets.discarded} discarded${why ? ` (${why})` : ''}. Today used: ${job.runAudit.today}.`, resultCount: c.buckets.top });
    } catch (error) { job.runAudit = { error: error.message }; }
    const first = job.leads.find((l) => l.bucket === 'top') || job.leads[0];
    live({ phase: 'drafting', status: 'success', title: b.fundingTypes.length === 1 && b.fundingTypes[0] === 'grant' ? 'Grant work items ready' : 'Drafts written', detail: first ? { kind: 'draft', to: String(first.person || first.org).slice(0, 90), org: String(first.org || '').slice(0, 90), subject: String(first.draft?.subject || '').slice(0, 160), excerpt: String(first.draft?.body || '').slice(0, 420) } : undefined, message: b.fundingTypes.length === 1 && b.fundingTypes[0] === 'grant' ? `${job.leads.filter((lead) => lead.kind === 'opportunity').length} specific grant opportunities prepared for review.` : `${job.leads.length} drafts built from templates and public facts; nothing is sent.`, resultCount: job.leads.length });
    job.status =
      job.mode === 'demo'
        ? 'done'
        : failures || job.events.some((e) => e.phase === 'warning')
          ? 'partial'
          : 'done';
    job.finishedAt = new Date().toISOString();
    job.usage = client.usage();
    job.budget = {
      timeoutMs: runTimeoutMs,
      maxRounds: Number(env.LOOP_MAX_ROUNDS) || 2,
      maxSearches: Number(env.LOOP_MAX_SEARCHES) || 12,
      maxCostUsd: Number(env.LOOP_MAX_COST_USD) || null,
    };
    emit(
      'done',
      `${job.leads.filter((l) => l.bucket === 'top').length} candidates prioritized; ${job.leads.filter((l) => l.bucket === 'radar').length} on radar. ${job.mode === 'demo' ? 'All examples are fictional.' : 'Missing results are never filled with simulated data.'}`,
    );
  } catch (e) {
    const cancelled = externalSignal?.aborted;
    const partial = !cancelled && timeoutSignal.aborted ? (leads.length ? leads : collected) : [];
    if (partial.length) {
      // Tope de tiempo: no se pierde lo encontrado. Se evalúa sin red (reglas) y se entrega como parcial.
      try {
        const memory = store.feedbackFor(b, job.userId);
        const rejected = new Set([...memory].filter(([, v]) => v.decision === 'reject').map(([key]) => key));
        job.leads = attachGrantPlans(addWarmPlans(evaluate(partial, b, rejected, new Date(), job.plan?.terms || []), b), b).map((l) => ({ ...l, feedback: memory.get(l.key) || null, draft: buildDraft(l, b, []) }));
        job.status = 'partial'; job.finishedAt = new Date().toISOString(); job.usage = client.usage(); job.timedOut = true;
        const message = `Time limit (${Math.round(runTimeoutMs / 1000)} s) reached: showing the ${job.leads.length} candidates found so far.`;
        emit('warning', message);
        live({ phase: 'warning', status: 'warning', title: 'Partial results', message });
      } catch (inner) { job.status = 'failed'; emit('error', `Research couldn't finish: ${e.message} (partial delivery failed: ${inner.message})`); }
    } else {
      job.status = 'failed';
      const message = cancelled ? 'Stopped by the user.' : `Research couldn't finish: ${e.message}`;
      emit('error', message);
      live({ phase: 'error', status: 'error', title: cancelled ? 'Search stopped' : 'Research stopped', message });
    }
  }
  const top = job.leads.filter((l) => l.bucket === 'top').length;
  live({
    phase: 'completed',
    status: job.status === 'done' ? 'success' : job.status === 'partial' ? 'warning' : 'error',
    title: job.status === 'done' ? 'Run complete' : job.status === 'partial' ? 'Done with warnings' : 'Stopped',
    message: job.status === 'failed' ? 'Research stopped before finishing.' : `${top} candidates prioritized; ${job.leads.filter((l) => l.bucket === 'radar').length} on radar.`,
    resultCount: job.leads.length,
    detail: { jobStatus: job.status, usage: job.usage || {}, queryLedger: job.queryLedger || [] },
  });
  store.save(job);
  live.finish(job.status);
}
