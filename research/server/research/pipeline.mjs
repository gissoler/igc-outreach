import { addWarmPlans } from './warmPlan.mjs';
import { makePlan, evaluate, buildDraft } from './core.mjs';
import { demoLeads } from './demo.mjs';
import { addConnections, addOrgBridges, networkCandidates } from './network.mjs';
import { webPeople, webConfigured, webMissing, WEB_SOURCE } from './webscrape.mjs';
import { createRecorder } from './liveRun.mjs';
import { applyJevDecisions, askJev } from './jev.mjs';
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
  const timeoutSignal = AbortSignal.timeout(180000);
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
    let leads = [];
    let sender = [];
    let team = null;
    let failures = 0;
    if (job.mode === 'demo') {
      live({ phase: 'planning', status: 'success', title: 'Search plan', message: job.plan.summary, detail: { kind: 'plan', items: job.plan.items, sources: [] } });
      live({ phase: 'warning', status: 'warning', title: 'Demo mode', message: 'EXPLICIT DEMO: fictional examples. No external sources or browser used.' });
      leads = demoLeads(b);
      emit(
        'demo',
        'EXPLICIT DEMO: fictional examples. No external sources used.',
      );
    } else {
      const enabled = providers || [
        ...(b.fundingTypes.includes('partnering')
          ? [
              ['OpenAlex', (c) => openalex(c, b, job.plan, team, env)],
              ['ClinicalTrials.gov', (c) => clinicalTrials(c, b, job.plan)],
            ]
          : []),
        ...(b.fundingTypes.some((t) =>
          ['grant', 'investment', 'debt'].includes(t),
        )
          ? [
              ['Grants.gov', (c, e) => grants(c, b, job.plan, e)],
              ['NIH RePORTER', (c) => reporter(c, b, job.plan)],
            ]
          : []),
        ...(job.plan.alzheimer
          ? [['Official radar', (c, e) => radar(c, b, job.plan, e)]]
          : []),
        ...(env.EXA_API_KEY ? [['Exa', (c, e) => exaSearch(c, b, job.plan, env, e)]] : []),
        ...(b.fundingTypes.includes('investment') && (env.EXA_API_KEY || env.SERPER_API_KEY)
          ? [[`Funding rounds (${env.EXA_API_KEY ? 'Exa' : 'Serper'})`, (c) => roundAnnouncements(c, b, job.plan, env)]]
          : []),
        ...(env.SERPER_API_KEY ? [['Web search (Serper)', (c) => webSearch(c, b, job.plan, env)]] : []),
      ];
      const TEAM_SOURCE = 'Sender public profile';
      const useTeamFacts = teamFactsApply(b);
      const useApify = !providers && b.useApify && webConfigured(env);
      live({
        phase: 'planning',
        status: 'success',
        title: 'Search plan',
        message: job.plan.summary,
        detail: { kind: 'plan', items: job.plan.items, sources: [...(useTeamFacts ? [TEAM_SOURCE] : []), ...enabled.map(([name]) => name), ...(useApify ? [WEB_SOURCE] : [])] },
      });
      if (!providers) {
        if (!env.EXA_API_KEY) {
          emit('configuration', 'Exa: missing EXA_API_KEY; semantic search skipped.');
          live({ phase: 'planning', status: 'pending', title: 'Source skipped', message: 'Exa: missing EXA_API_KEY; semantic search skipped.' });
        }
        if (!env.SERPER_API_KEY) {
          emit('configuration', 'Serper: no SERPER_API_KEY; broad web search skipped.');
          live({ phase: 'planning', status: 'pending', title: 'Source skipped', message: 'Serper: no SERPER_API_KEY; broad web search skipped.' });
        }
        if (b.useApify && !webConfigured(env)) live({ phase: 'planning', status: 'pending', title: 'Source skipped', message: `${WEB_SOURCE}: missing ${webMissing(env).join(' y ')}; research continues with available sources.` });
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
      const outcomes = await Promise.allSettled(
        enabled.map(async ([name, run]) => {
          emit('searching', `${name}: query started.`);
          const found = await runSource(name, () => run(client.scope(name), emitFor(name)), enabled.length);
          emit(
            'reading',
            `${name}: ${found.length} candidates with provenance.`,
          );
          return found;
        }),
      );
      signal.throwIfAborted();
      outcomes.forEach((result, i) => {
        if (result.status === 'fulfilled') leads.push(...result.value);
        else {
          failures++;
          emit(
            'warning',
            `${enabled[i][0]}: ${result.reason?.message || 'service unavailable'}`,
          );
          live({ phase: 'warning', provider: enabled[i][0], status: 'warning', title: 'Source returned nothing', message: `${enabled[i][0]}: ${result.reason?.message || 'service unavailable'}. Other sources continue.` });
        }
      });
      if (!providers && b.useApify) {
        if (!webConfigured(env)) {
          emit('configuration', `${WEB_SOURCE}: missing ${webMissing(env).join(' y ')}; research continues with available sources.`);
        } else {
          try {
            emit('searching', `${WEB_SOURCE}: finding fund and organization teams on public pages. May use credit.`);
            const result = await runSource(WEB_SOURCE, async () => {
              const found = await webPeople(leads, b, { env, fetcher, signal, record, live: live.scope(WEB_SOURCE) });
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
      signal.throwIfAborted();
      if (['investment', 'debt'].some((t) => b.fundingTypes.includes(t)))
      {
        emit(
          'warning',
          'Limited equity/debt coverage: SEC placement agents aren\'t integrated. Other categories are marked adjacent.',
        );
        live({ phase: 'warning', status: 'warning', title: 'Limited coverage', message: 'Limited equity/debt coverage: SEC placement agents aren\'t integrated. Other categories are marked adjacent.' });
      }
      const network = store.network(b, job.userId);
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
    job.leads = evaluate(leads, b, rejected);
    if (job.mode !== 'demo' && (env.JEV_API_KEY || env.TYPESAFE_API_KEY)) {
      const jevStarted = Date.now();
      live({ phase: 'evaluating', provider: 'Jev', status: 'running', title: 'Structured decision', message: 'Jev is scoring fit, evidence and next action.' });
      try {
        const jev = await askJev(job.leads, b, { env, fetcher, signal });
        job.leads = applyJevDecisions(job.leads, jev);
        live({ phase: 'evaluating', provider: 'Jev', status: 'success', title: 'Jev decisions applied', message: `Jev reviewed ${jev.decisions.length} candidates; uncertain ones go to radar for human review.`, resultCount: jev.decisions.length, durationMs: Date.now() - jevStarted, detail: { model: jev.model, usage: jev.usage } });
      } catch (error) {
        failures++;
        emit('warning', `Jev: ${error.message}. The rules ranking was kept.`);
        live({ phase: 'warning', provider: 'Jev', status: 'warning', title: 'Jev unavailable', message: `${error.message}. The rules ranking was kept.`, durationMs: Date.now() - jevStarted });
      }
    } else if (job.mode !== 'demo') {
      emit('configuration', 'Jev: missing JEV_API_KEY; using rules ranking and human review.');
      live({ phase: 'planning', provider: 'Jev', status: 'pending', title: 'Decision layer pending', message: 'Jev is integrated but JEV_API_KEY is missing. Rules ranking kept.' });
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
      'Drafts built from templates and public facts; nothing is sent.',
    );
    // Warm path para todos: camino de la red cuando existe; si no, un plan para construirlo (consejo + updates).
    job.leads = addWarmPlans(job.leads, b);
    {
      const plans = job.leads.filter((l) => l.warmPlan);
      const built = plans.filter((l) => !l.warmPlan.built).length;
      live({ phase: 'evaluating', provider: 'Warm path plan', status: 'success', title: 'Warm paths for every candidate', message: `${plans.length - built} through your network; ${built} to build with advice and updates before the round.`, resultCount: plans.length });
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
      }
      store.save(job);
    }
    const first = job.leads.find((l) => l.bucket === 'top') || job.leads[0];
    live({ phase: 'drafting', status: 'success', title: 'Drafts written', detail: first ? { kind: 'draft', to: String(first.person || first.org).slice(0, 90), org: String(first.org || '').slice(0, 90), subject: String(first.draft?.subject || '').slice(0, 160), excerpt: String(first.draft?.body || '').slice(0, 420) } : undefined, message: `${job.leads.length} drafts built from templates and public facts; nothing is sent.`, resultCount: job.leads.length });
    job.status =
      job.mode === 'demo'
        ? 'done'
        : failures || job.events.some((e) => e.phase === 'warning')
          ? 'partial'
          : 'done';
    job.finishedAt = new Date().toISOString();
    emit(
      'done',
      `${job.leads.filter((l) => l.bucket === 'top').length} candidates prioritized; ${job.leads.filter((l) => l.bucket === 'radar').length} on radar. ${job.mode === 'demo' ? 'All examples are fictional.' : 'Missing results are never filled with simulated data.'}`,
    );
  } catch (e) {
    job.status = 'failed';
    const cancelled = externalSignal?.aborted;
    const message = cancelled ? 'Stopped by the user.' : `Research couldn't finish: ${e.message}`;
    emit('error', message);
    live({ phase: 'error', status: 'error', title: cancelled ? 'Search stopped' : 'Research stopped', message });
  }
  const top = job.leads.filter((l) => l.bucket === 'top').length;
  live({
    phase: 'completed',
    status: job.status === 'done' ? 'success' : job.status === 'partial' ? 'warning' : 'error',
    title: job.status === 'done' ? 'Run complete' : job.status === 'partial' ? 'Done with warnings' : 'Stopped',
    message: job.status === 'failed' ? 'Research stopped before finishing.' : `${top} candidates prioritized; ${job.leads.filter((l) => l.bucket === 'radar').length} on radar.`,
    resultCount: job.leads.length,
    detail: { jobStatus: job.status },
  });
  store.save(job);
  live.finish(job.status);
}
