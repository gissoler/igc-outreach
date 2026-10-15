/* Bucle agentic V14: comprender, actuar con refs, evaluar páginas y juzgar finalistas. */
import { chatJSON } from '../../analysis/fleet.mjs';
import { literalIn } from '../verify.mjs';
import { auditPage, verifyDate } from '../judge/audit.v13.mjs';
import { judgePrompt } from '../judge/prompts.v13.mjs';
import { validateAssess, validateStep, validateUnderstand } from './contracts.v14.mjs';
import { AGENT_CRITERIA, assessPrompt, criterionHelp, stepPrompt, understandPrompt } from './prompts.v14.mjs';
import { createTools } from './tools.mjs';
import { runDiscovery } from './discovery.mjs';
import { contactStage } from './contacts.mjs';
import { deadlineDecision } from '../dates.mjs';
import { hostKind } from '../verify.mjs';
import { selfPage, shortName } from '../judge/funder.mjs';

const noopTrace = { event: () => null };
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const anySignal = (list) => { const l = list.filter(Boolean); return l.length < 2 ? l[0] : typeof AbortSignal.any === 'function' ? AbortSignal.any(l) : l[l.length - 1]; };
const unpage = (text) => String(text || '').replace(/^<page_data>|<\/page_data>$/g, '');
const tokens = (usage) => ({ prompt: Number(usage?.prompt_tokens) || 0, completion: Number(usage?.completion_tokens) || 0, ...(!usage ? { estimated: true } : {}) });
const validJudgment = (raw, ids) => Boolean(raw && typeof raw === 'object' && typeof raw.page_type === 'string' && Array.isArray(raw.dates) && raw.criteria && ids.every((id) => ['yes', 'no', 'unknown'].includes(raw.criteria[id]?.verdict)));
const compilerOf = (a) => ({
  page_type: a.page_type, identity: { name: a.about, org: null, kind: a.page_type === 'investor_about' ? 'investor' : 'program', quote: a.lead?.quote || a.about },
  dates: a.dates, eligibility: { applicant_types: [], applicant_types_quote: null, countries: [], countries_quote: null, stage: null, stage_quote: null, for_profit_allowed: 'unknown', for_profit_quote: null },
  amount: { text: a.lead?.amount || null, quote: a.lead?.quote || null }, how_to_apply_quote: null, relevant: true,
  official: a.criteria.official?.verdict === 'yes', money: 'unknown', non_dilutive: a.criteria.non_dilutive?.verdict || 'unknown', summary: a.about,
});

/** Comprensión del brief sin el resto del bucle: GPTR la lanza al empezar a buscar para no esperarla después. Devuelve null si falla. */
export async function understandBrief(objective, brief, { env = process.env, today, fetcher, signal, chat = chatJSON } = {}) {
  const prompt = understandPrompt({ brief, objective, today });
  for (let retry = 0; retry < 2; retry++) {
    try { const r = await chat({ system: prompt.system, user: prompt.user, schema: prompt.schema, name: 'understand', role: 'compiler' }, { env, fetcher, signal }); const checked = validateUnderstand(r?.json ?? r); if (checked.ok) return checked.value ?? (r?.json ?? r); }
    catch { if (signal?.aborted) return null; }
  }
  return null;
}

export async function runAgentObjective(objective, brief, opts = {}) {
  const env = opts.env || process.env; const today = opts.today || new Date().toISOString().slice(0, 10); const trace = opts.trace || noopTrace;
  const tools = opts.tools || createTools({ env, fetcher: opts.fetcher, signal: opts.signal, trace, limits: opts.limits || {
    searches: Number(env.ENGINE_AGENT_SEARCHES) || 20, opens: Math.max(Number(env.ENGINE_AGENT_OPENS) || 30, (opts.seedUrls || []).length),
    apolloCredits: Number(env.ENGINE_AGENT_APOLLO_CREDITS) || 25, exaUsdCap: opts.exaUsdCap,
  }, apollo: opts.apollo, readers: opts.readers });
  const chat = opts.chat || chatJSON; const maxSteps = Number(opts.maxSteps ?? env.ENGINE_AGENT_STEPS) || 40;
  // Modo paralelo (ENGINE_AGENT_PARALLEL=1): varias aperturas y búsquedas por paso, páginas evaluadas en paralelo por el modelo rápido, jueces en paralelo y tope de tiempo con entrega parcial.
  const parallel = opts.parallel === true || String(env.ENGINE_AGENT_PARALLEL || '') === '1';
  const maxSeconds = Number(opts.maxSeconds ?? env.ENGINE_AGENT_SECONDS) || (parallel ? 300 : 1200); const started = Date.now();
  const hardSeconds = parallel ? Math.max(maxSeconds, Number(opts.hardSeconds ?? env.ENGINE_AGENT_HARD_SECONDS) || 540) : maxSeconds;
  const reserveSeconds = parallel ? Number(opts.reserveSeconds ?? env.ENGINE_AGENT_JUDGE_RESERVE_SECONDS) || 60 : 0;
  const maxOpensPerStep = Number(env.ENGINE_AGENT_OPENS_PER_STEP) || 8; const maxSearchesPerStep = Number(env.ENGINE_AGENT_SEARCHES_PER_STEP) || 4;
  const seeded = Boolean(opts.seedUrls?.length);
  // Modo solo juez: no hay pasos del agente compitiendo por el modelo, así que se lee y juzga con más concurrencia por defecto.
  const assessConcurrency = Number(env.ENGINE_AGENT_ASSESS_CONCURRENCY) || (seeded ? 12 : 8); const judgeConcurrency = Number(env.ENGINE_AGENT_JUDGE_CONCURRENCY) || (seeded ? 12 : 8);
  // Plazo duro que pone quien llama (el pipeline): lo que no alcanzó a leerse o juzgarse antes se omite y se entrega lo demás.
  const deadlineAt = Number(opts.deadlineAt) || 0; const pastDeadline = (marginMs = 0) => Boolean(deadlineAt) && Date.now() > deadlineAt - marginMs;
  const skippedForTime = []; const droppedPages = []; let triageStats = null;
  const elapsed = () => (Date.now() - started) / 1000; let lastCandidateStep = 0;
  const ids = AGENT_CRITERIA[objective] || AGENT_CRITERIA.grant; const pages = new Map(); const candidates = new Map();
  const findings = []; const leads = []; const queries = []; const decisions = []; let invalidSteps = 0; let finishRefused = false; let questions = 0; let stopReason = ''; let stepsRun = 0;

  async function model(prompt, role, validate, pageRef = null) {
    for (let retry = 0; retry < 2; retry++) {
      const at = Date.now(); let response = null; let error = null;
      const callRole = role === 'understand' ? (parallel ? 'compiler' : 'agent') : role === 'assess' ? 'compiler' : role === 'coverage' ? 'agent' : role;
      const callSignal = anySignal([parallel && role !== 'judge' ? anySignal([opts.signal, AbortSignal.timeout(Math.max(5000, (hardSeconds - reserveSeconds) * 1000 - (Date.now() - started)))]) : opts.signal,
        deadlineAt ? AbortSignal.timeout(Math.max(1000, deadlineAt - Date.now())) : null]);
      if (pastDeadline()) return null;
      try { response = await chat({ system: prompt.system, user: prompt.user, schema: prompt.schema, name: role, role: callRole }, { env, fetcher: opts.fetcher, signal: callSignal }); }
      catch (e) { error = e; }
      const raw = response?.json ?? response; const checked = error ? { ok: false, errors: [error.message] } : validate(raw);
      trace.event('model_call', { role, model: response?.model || env[role === 'agent' || role === 'coverage' || (role === 'understand' && !parallel) ? 'ENGINE_AGENT_LLM_MODEL' : role === 'assess' || role === 'understand' ? 'COMPILER_LLM_MODEL' : 'JUDGE_LLM_MODEL'] || 'injected', prompt_version: prompt.version, tokens: tokens(response?.usage), ms_call: Date.now() - at, ok: checked.ok, invalid: !checked.ok, retry, page_ref: pageRef, ...(error ? { error: String(error.message || error) } : !checked.ok ? { error: 'INVALID: ' + (checked.errors || []).join('; ').slice(0, 500) } : {}) });
      if (checked.ok) return checked.value ?? raw;
    }
    return null;
  }

  function ingest(obs, assessment, step, nextTool) {
    const pageText = unpage(obs.text); const a = structuredClone(assessment);
    // modo solo juez (seeded): el compilador no decide qué llega al juez; toda página de convocatoria o programa pasa
    if (seeded && !a.candidate && ['call', 'program_page'].includes(a.page_type)) a.candidate = true;
    for (const c of Object.values(a.criteria || {})) if (c.verdict !== 'unknown' && !literalIn(c.quote, pageText)) c.verdict = 'unknown';
    const dates = [...new Map((a.dates || []).map((d) => [`${d.role}|${d.date}`, d])).values()].map((d) => verifyDate(d, pageText));
    const decision = { step, page_ref: a.ref, by: 'agent', verdict: a.candidate ? 'candidate' : 'none', reason: a.candidate ? 'agent_candidate' : 'agent_rejected', page_type: a.page_type, dates, criteria: a.criteria, days_left: null, next_action: nextTool || null };
    decisions.push(decision); trace.event('decision', decision); pages.set(a.ref, { ...obs, text: pageText, assessment: a });
    if (a.candidate && (seeded || !Object.values(a.criteria || {}).some((c) => c.verdict === 'no' && literalIn(c.quote, pageText)))) { candidates.set(a.ref, pages.get(a.ref)); lastCandidateStep = step; }
    let leadId = null;
    if (a.lead?.quote && literalIn(a.lead.quote, pageText)) {
      const lead = { id: `L${leads.length + 1}`, page_ref: a.ref, kind: a.lead.kind, funder: a.lead.funder, recipient: a.lead.recipient, amount: a.lead.amount, quote: a.lead.quote, url: obs.url, found_at_step: step, followups: [], produced: [] };
      leads.push(lead); trace.event('lead', lead); leadId = lead.id;
    }
    return { a, dates, leadId };
  }

  async function openMany(args, step, nextTool, understoodBrief, limit = maxOpensPerStep) {
    const wanted = [...new Set([...(Array.isArray(args.refs) ? args.refs : []), args.ref].filter(Boolean).map(String))].slice(0, limit);
    const opened = await Promise.all(wanted.map((ref) => tools.open({ ref })));
    return assessOpened(opened.map((r, i) => [wanted[i], r]), step, nextTool, understoodBrief);
  }
  async function assessOpened(pairs, step, nextTool, understoodBrief) {
    const out = { type: 'pages', pages: [], failed: [] };
    await pool(pairs, assessConcurrency, async ([ref, r]) => {
      if (!r?.ref) { out.failed.push({ ref, error: r?.error || 'open_failed' }); return; }
      if (pastDeadline(20000)) { skippedForTime.push(r.url); trace.event('drop', { url: r.url, page_ref: r.ref, reason: 'time_budget', decided_by: 'code', read: true }); return; }
      const obs = { type: 'page', ...r };
      const a = await model(assessPrompt({ objective, brief, understood: understoodBrief, page: { url: r.url, title: r.title, text: unpage(r.text) }, ref: r.ref, today }), 'assess', validateAssess, r.ref);
      if (!a) { out.failed.push({ ref: r.ref, error: 'assess_invalid' }); return; }
      a.ref = r.ref; const { dates, leadId } = ingest(obs, a, step, nextTool);
      out.pages.push({ ref: r.ref, url: r.url, title: r.title, chars: r.chars, about: a.about, page_type: a.page_type, candidate: candidates.has(r.ref), dates: dates.filter(Boolean).slice(0, 6), lead_id: leadId, links: (r.links || []).slice(0, 20).map((l) => ({ ref: l.ref, text: String(l.text || '').slice(0, 80) })) });
    });
    out.pages.sort((x, y) => Number(x.ref.slice(1)) - Number(y.ref.slice(1)));
    return out;
  }

  const DOC_FILE = /\.(pdf|docx?|rtf)(?:[?#]|$)/i;
  const CALL_DOC = /\b(rfa|rfp|nofo|foa|solicitation|guidelines?|request for (?:applications|proposals)|funding (?:opportunity|announcement)|program announcement|call for (?:proposals|applications)|application (?:guide|instructions|package|form)|notice of funding|bases|convocatoria|t[ée]rminos de referencia)\b/i;
  async function followDocs(rows, seen) {
    const perPage = Number(env.GPTR_DOCS_PER_PAGE) || 2; const max = env.GPTR_DOC_FOLLOW_MAX === undefined ? 12 : Number(env.GPTR_DOC_FOLLOW_MAX); if (!max) return [];
    const year = Number(String(today).slice(0, 4)); const picks = [];
    for (const x of rows) {
      let n = 0;
      for (const l of x.r?.links || []) {
        if (picks.length >= max || n >= perPage) break;
        const url = String(l.url || ''); let label = `${l.text || ''} ${url}`; try { label = decodeURIComponent(label); } catch { /* tal cual */ }
        if (!url || seen.has(url) || !CALL_DOC.test(label) || !(DOC_FILE.test(url) || /\b(rfa|rfp|nofo|solicitation|request for (?:applications|proposals))\b/i.test(String(l.text || '')))) continue;
        const years = [...label.matchAll(/(?:^|[^0-9])(20\d{2})(?![0-9])/g)].map((m) => +m[1]); if (years.length && Math.max(...years) < year) continue;   // RFA de años pasados
        seen.add(url); picks.push(l.ref); n++;
      }
    }
    if (!picks.length || pastDeadline(60000)) return [];
    const opened = await pool(picks, 8, (ref) => tools.open({ ref }));
    return picks.map((ref, i) => [ref, opened[i]]).filter(([, r]) => r?.ref);
  }

  async function searchMany(args, action) {
    const qs = [...new Set((args.queries || []).map((q) => String((q && typeof q === 'object' ? q.query ?? q.q ?? q.text ?? '' : q) || '').trim()).filter(Boolean))].slice(0, maxSearchesPerStep);
    for (const q of qs) queries.push({ query: q, family: 'agent', ...(action.from_lead ? { from_lead: action.from_lead } : {}) });
    const found = await Promise.all(qs.map((q) => tools.search({ query: q, ...(args.recency ? { recency: args.recency } : {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) })));
    const seen = new Set(); const results = [];
    for (const f of found) for (const row of f?.results || []) if (!seen.has(row.url)) { seen.add(row.url); results.push({ ...row, snippet: String(row.snippet || '').slice(0, 200) }); }
    return { type: 'tool', tool: 'search', result: { results, errors: found.map((f) => f?.error).filter(Boolean) } };
  }

  const uPrompt = understandPrompt({ brief, objective, today });
  // opts.understood: comprensión ya hecha en paralelo con la búsqueda de GPTR (no se repite la llamada al terminar la búsqueda).
  const early = opts.understood ? await Promise.resolve(opts.understood).catch(() => null) : null;
  const understood = early || await model(uPrompt, 'understand', validateUnderstand) || {
    product_one_line: '', who_pays: '', sector: '', neighbor_sectors: [], stage: '', geography: '', assumptions: [], doubts: [],
  };
  trace.event('understand', { output: understood });
  for (const [i, assumption] of (understood.assumptions || []).entries()) trace.event('brief_patch', {
    field: `assumptions[${i}]`, from: null, to: assumption, why: assumption, source: 'assumption',
  });
  const doubts = (understood.doubts || []).filter((d) => d.impact !== 'none').slice(0, 3);
  if (doubts.length) { questions = doubts.length; await tools.ask_user({ questions: doubts.map((d) => ({ q: d.question, options: d.options })) }); }

  let observation = opts.initialObservation || { type: 'start', understood }; let finalRefs = [];
  // Descubrimiento (ENGINE_DISCOVERY=1): búsqueda ligera, plan de cobertura por niveles de financiador y abanico de consultas en paralelo, antes del primer paso.
  let coverage = null; let discoveryQueries = 0;
  if (!opts.initialObservation && !opts.seedUrls?.length && (opts.discovery === true || String(env.ENGINE_DISCOVERY || '') === '1')) {
    const d = await runDiscovery({ brief, understood, objective, today, model, searchMany, tools, trace, env });
    coverage = d.plan; discoveryQueries = d.queries.length;
    if (d.observation?.result?.results?.length) observation = d.observation;
  }
  // Modo solo juez (opts.seedUrls): otro motor trajo las URLs; aquí solo se abren, se leen en paralelo y pasan por juez, segundo juez y auditoría.
  const seedUrls = (opts.seedUrls || []).map((u) => (typeof u === 'string' ? { url: u } : u)).filter((u) => u?.url);
  const seedReg = new Map(seedUrls.filter((u) => u.registry).map((u) => [u.url, u.registry]));
  if (seedUrls.length) {
    // Una semilla puede traer su texto (registro oficial): se lee tal cual, sin descargar nada.
    const refs = seedUrls.map((u, i) => { const ref = `seed${i + 1}`; tools.refs.set(ref, { url: u.url, title: u.title || '', ...(u.text ? { markdown: u.text, official: Boolean(u.registry) } : {}) }); return ref; });
    const cap = Number(opts.assessMax) || refs.length;
    const hasEmbeddedRegistry = seedUrls.some((seed) => seed.text && seed.registry);
    if (refs.length <= cap && !hasEmbeddedRegistry) await openMany({ refs }, 1, 'finish', understood, refs.length);
    else {
      // El texto de un registro oficial ya es la página fuente. Se evalúa primero y fuera de la cola de descargas:
      // una tanda grande de URLs lentas no puede impedir que el compilador y el juez vean estas oportunidades.
      const registryMax = Math.max(1, Number(env.GPTR_REGISTRY_JUDGE_MAX) || 10);
      const embeddedAll = refs.map((ref, i) => ({ ref, i, seed: seedUrls[i] })).filter((x) => x.seed.text && x.seed.registry);
      const embedded = embeddedAll.slice(0, Math.min(cap, registryMax));
      const embeddedPairs = embedded.map(({ ref, seed }) => [ref, { ref, url: seed.url, title: seed.title || '', chars: String(seed.text).length, text: `<page_data>${String(seed.text).slice(0, 12000)}</page_data>`, links: [], via: 'registry' }]);
      // Simpler ya entrega un registro oficial estructurado. Mandarlo antes al compilador duplicaba
      // el trabajo y, con 15 avisos, consumía todo el plazo antes de que empezara el juez. Para estas
      // páginas el código solo arma la candidatura; el juez sigue verificando elegibilidad, tema y fecha
      // contra el texto oficial completo.
      for (const [ref, r] of embeddedPairs) {
        const seed = seedUrls[refs.indexOf(ref)];
        const criteria = Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null, reason: 'Pending verification against the official registry text.' }]));
        ingest({ type: 'page', ...r, text: unpage(r.text) }, {
          ref,
          about: seed?.registry?.title || seed?.title || 'Official grant opportunity',
          page_type: 'call',
          candidate: true,
          dates: [],
          criteria,
          lead: null,
        }, 1, 'finish');
        trace.event('note', { kind: 'registry_direct_to_judge', page_ref: ref, url: r.url });
      }
      for (const x of embeddedAll.slice(embedded.length)) trace.event('drop', { url: x.seed.url, page_ref: x.ref, reason: 'registry_judge_cap', decided_by: 'code', read: true });
      const embeddedRefs = new Set(embedded.map((x) => x.ref));
      const webAll = refs.map((ref, i) => ({ ref, i })).filter((x) => !embeddedRefs.has(x.ref) && !seedUrls[x.i]?.registry);
      // Si quedan menos de ocho minutos, se entregan primero los grants oficiales. La cola web es
      // complementaria y no puede volver a convertir 15 resultados de Simpler en "0 candidates".
      const webMinRemainingMs = Math.max(60_000, Number(env.GPTR_WEB_MIN_REMAINING_MS) || 480_000);
      const web = embeddedPairs.length && deadlineAt && deadlineAt - Date.now() < webMinRemainingMs ? [] : webAll;
      if (!web.length && webAll.length) trace.event('note', { kind: 'web_deferred_for_registry', count: webAll.length, remaining_ms: Math.max(0, deadlineAt - Date.now()) });
      const webCap = Math.max(0, cap - embeddedPairs.length);
      // Triage por código antes del modelo: se abren todas (barato) y se evalúan primero las que traen un plazo futuro según el
      // lector de fechas (dates.mjs), luego las sin fecha y al final las que el código ya ve cerradas. Las del registro van siempre.
      const opened = await pool(web, Number(env.GPTR_OPEN_CONCURRENCY) || 24, (x, i) => (pastDeadline(60000) ? null : tools.open({ ref: x.ref, ...(i >= webCap ? { cheap: true } : {}) })));
      const RANK = { open: 3, upcoming: 3, rolling: 2, unknown: 1, closed: 0 };
      const rows = web.map(({ ref, i }, j) => {
        const r = opened[j]; if (!r?.ref) return { ref, r, i, score: -1, status: 'unread' };
        const status = deadlineDecision(unpage(r.text), { today }).status;
        return { ref, r, i, status, score: RANK[status] ?? 1 };
      }).sort((a, b) => b.score - a.score || a.i - b.i);
      const chosen = rows.slice(0, webCap).filter((x) => x.score >= 0); const left = rows.filter((x) => !chosen.includes(x));
      for (const x of left) if (x.r?.ref) trace.event('drop', { url: x.r.url, page_ref: x.r.ref, reason: `triage_${x.status}`, decided_by: 'code', read: true });
      const byStatus = rows.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] || 0) + 1 }), { ...(embeddedPairs.length ? { registry: embeddedPairs.length } : {}) });
      triageStats = { opened: embeddedPairs.length + rows.filter((x) => x.score >= 0).length, assessed: embeddedPairs.length + chosen.length, by_status: byStatus };
      trace.event('tool_call', { tool: 'triage', args: { opened: triageStats.opened, assessed: triageStats.assessed }, results_n: triageStats.assessed, ms_call: 0, counts: byStatus });
      // Documentos enlazados (14-10): muchas convocatorias publican el plazo y la elegibilidad solo en un PDF/DOC (RFA, solicitud, guía).
      // De las páginas elegidas se siguen hasta 2 enlaces por página a documentos de convocatoria del año, y se leen como páginas propias.
      const docs = await followDocs(chosen.filter((x) => x.status !== 'registry' && x.status !== 'closed'), new Set(rows.map((x) => x.r?.url).filter(Boolean)));
      if (docs.length) { triageStats.docs = docs.length; trace.event('tool_call', { tool: 'triage', args: { docs_followed: docs.length }, results_n: docs.length, ms_call: 0 }); }
      await assessOpened([...chosen.sort((a, b) => a.i - b.i).map((x) => [x.ref, x.r]), ...docs], 1, 'finish', understood);
    }
    stopReason = 'seeded'; trace.event('finish', { reason: 'seeded' });
  }
  for (let step = 1; step <= maxSteps && !seedUrls.length && (elapsed() < maxSeconds - reserveSeconds || (parallel && lastCandidateStep >= step - 1 && elapsed() < hardSeconds - reserveSeconds)); step++) {
    stepsRun = step;
    const used = tools.usage?.() || {};
    const state = { today, objective, brief, understood, leads, queries, step, budget_left: { steps: maxSteps - step + 1, searches: (Number(env.ENGINE_AGENT_SEARCHES) || 20) - (used.searches || 0), opens: (Number(env.ENGINE_AGENT_OPENS) || 30) - (used.opens || 0), seconds: Math.max(0, Math.round(maxSeconds - reserveSeconds - elapsed())) },
      ...(coverage ? { coverage: coverage.levels.map((l) => ({ level: l.level, why: l.why, queries: l.queries })) } : {}),
      ...(parallel ? { parallel: true } : {}), judged_pages: [...pages.values()].slice(-30).map((p) => ({ ref: p.assessment.ref, about: p.assessment.about, page_type: p.assessment.page_type, candidate: p.assessment.candidate })), candidates: candidates.size };
    const prompt = stepPrompt({ state, observation });
    const value = await model(prompt, 'agent', (raw) => validateStep(raw, { lastObservation: observation?.type }), observation?.ref || null);
    if (!value) { invalidSteps++; observation = { type: 'invalid_step' }; continue; }
    if (value.assessment && observation?.type === 'page') ingest(observation, value.assessment, step, value.action?.tool);
    const action = value.action;
    if (action.tool === 'finish' && !finishRefused && candidates.size === 0 && (used.opens || 0) < 5 && step < maxSteps / 2) { finishRefused = true; trace.event('tool_call', { tool: 'finish', args: action.args || {}, results_n: 0, ms_call: 0, error: 'refused_early' }); observation = { type: 'finish_refused', message: 'No candidate yet and most of the budget is unused. Search with different queries or open more results before finishing.' }; continue; }
    if (action.tool === 'finish') { finalRefs = action.args?.finalists || []; stopReason = action.args?.reason || 'agent'; await tools.finish(action.args); break; }
    const args = { ...(action.args || {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) };
    if (parallel && (action.tool === 'open' || (action.tool === 'search' && Array.isArray(args.queries)))) {
      if (action.from_lead) { const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.followups.push(step); trace.event('lead_followup', { lead_id: action.from_lead, action: action.tool, step }); }
      observation = action.tool === 'open' ? await openMany(args, step, action.tool, understood) : await searchMany(args, action);
      if (action.from_lead) { const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.produced.push(...(action.tool === 'open' ? observation.pages.map((p) => p.ref) : observation.result.results.map((p) => p.ref)).filter(Boolean)); }
      continue;
    }
    if (action.tool === 'search') queries.push({ query: String(args.query || ''), family: 'agent', ...(action.from_lead ? { from_lead: action.from_lead } : {}) });
    if (action.from_lead) {
      const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.followups.push(step);
      trace.event('lead_followup', { lead_id: action.from_lead, action: action.tool, step });
    }
    const result = await tools[action.tool](args);
    if (action.from_lead) { const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.produced.push(...(result?.results || []).map((x) => x.ref).filter(Boolean)); }
    observation = action.tool === 'open' && result?.ref ? { type: 'page', ...result } : { type: 'tool', tool: action.tool, result };
  }
  if (!stopReason) { stopReason = parallel && elapsed() >= maxSeconds - reserveSeconds ? 'time' : 'budget'; trace.event('budget', { left: { steps: 0 } }); trace.event('finish', { reason: stopReason }); }

  const selected = (finalRefs.length ? finalRefs : [...candidates.keys()]).filter((ref) => candidates.has(ref));
  let judgeCalls = 0; let secondCalls = 0; let changed = 0; const firstJudgments = new Map();
  // El segundo juez ciego solo mide acuerdo (no cambia hallazgos): en modo solo juez se apaga por defecto para no restar GPU al primero.
  const secondMax = opts.secondJudge !== undefined && opts.secondJudge !== null ? Number(opts.secondJudge) : Number(env.ENGINE_AGENT_JUDGE_SECOND ?? (seeded ? 0 : 10));
  const secondRefs = selected.slice(0, Math.max(0, secondMax));
  const judgeFirst = (ref) => { const row = candidates.get(ref); const a = row.assessment; const page = { url: row.url, title: row.title, text: row.text };
    const prompt = judgePrompt({ objective, brief, page, today, claims: a, blind: String(env.ENGINE_JUDGE_BLIND || '') === '1', criteriaIds: ids, help: criterionHelp });
    return { prompt, page, a, run: () => model(prompt, 'judge', (raw) => ({ ok: validJudgment(raw, ids), value: raw }), ref) }; };
  const judgeSecond = (ref) => { const row = candidates.get(ref); const prompt = judgePrompt({ objective, brief, page: row, today, blind: true, criteriaIds: ids, help: criterionHelp });
    return () => model(prompt, 'judge', (raw) => ({ ok: validJudgment(raw, ids), value: raw }), ref); };
  const [preFirst, preSecond] = parallel ? await Promise.all([pool(selected, judgeConcurrency, (ref) => judgeFirst(ref).run()), pool(secondRefs, judgeConcurrency, (ref) => judgeSecond(ref)())]) : [null, null];
  for (const [idx, ref] of selected.entries()) {
    const { prompt, page, a, run: runFirst } = judgeFirst(ref);
    const judgment = preFirst ? preFirst[idx] : await runFirst(); judgeCalls++; firstJudgments.set(ref, judgment);
    if (!judgment && pastDeadline()) { skippedForTime.push(page.url); trace.event('drop', { url: page.url, page_ref: ref, reason: 'time_budget', decided_by: 'code', read: true }); continue; }
    const reg = seedReg.get(page.url);
    const registryForecast = reg && (reg.isForecast || reg.status === 'forecasted') ? { estimated: reg.forecastClose || null } : null;
    const audit = auditPage({ objective, page, today, compilation: compilerOf(a), judgment, failure: judgment ? {} : { judge: 'invalid' }, blind: prompt.blind, criteriaIds: ids, requireCall: seeded, registryForecast });
    // Directorios y agregadores (Instrumentl, etc.) nunca son la convocatoria: en modo GPTR no salen como hallazgo (14-10 10:09).
    if (seeded && !audit.dropReason && hostKind(page.url) === 'aggregator') audit.dropReason = 'aggregator';
    // La página de la propia empresa o producto del brief no es un inversor (14-10: salían sus directivos como «inversores»).
    if (seeded && !audit.dropReason && objective !== 'grant') { const me = selfPage(page, brief); if (me.self) audit.dropReason = 'not_a_funder:self'; }
    trace.event('decision', { page_ref: ref, by: 'judge', verdict: audit.dropReason ? 'drop' : audit.mainOk ? 'keep' : 'verify', reason: audit.dropReason || (audit.mainOk ? 'audited' : 'blocked'), page_type: audit.pageType?.judge || a.page_type, dates: audit.dates?.judge || [], criteria: audit.criteria, days_left: audit.daysLeft, blocked_by: audit.mainOk ? [] : Object.entries(audit.criteria || {}).filter(([, v]) => v?.verdict !== 'yes').map(([k, v]) => `${k}:${v?.verdict || 'unknown'}`), next_action: null });
    if (audit.dropReason) {
      trace.event('drop', { url: page.url, page_ref: ref, reason: audit.dropReason, decided_by: 'judge', read: true });
      // Para el asistente («¿por qué descartaste X?»): motivo y la cita que lo sostiene, sin el texto de la página.
      const why = audit.dropReason === 'closed' ? audit.deadlineQuote : Object.values(audit.criteria || {}).find((c) => c.verdict === 'no' && c.quoteOk)?.quote;
      droppedPages.push({ url: page.url, title: String(page.title || a.about || '').slice(0, 160), reason: audit.dropReason, quote: String(why || '').slice(0, 300), deadline: audit.deadline || null });
      continue;
    }
    const eligible = ['eligibility', 'region', 'entity_type', 'stage'].some((id) => audit.criteria[id]?.verdict === 'no') ? 'no' : audit.criteria.eligibility?.verdict === 'yes' ? 'yes' : 'unclear';
    const identity = a.lead?.quote && literalIn(a.lead.quote, page.text) ? a.lead.quote : a.about;
    findings.push({ objective, url: page.url, title: page.title, name: reg ? [reg.number, reg.title].filter(Boolean).join(' · ') : shortName(a.about, page.url), ...(reg ? { registry: { number: reg.number, agency: reg.agency, closeDate: reg.closeDate, forecastClose: reg.forecastClose, status: reg.status, url: reg.url, moreInfoUrl: reg.moreInfoUrl, via: reg.source } } : {}),
      ...(reg?.contactEmail ? { contacts: [{ name: reg.contactText || 'Agency contact', title: 'Contact listed in the official registry', organization: reg.agency, email: reg.contactEmail, linkedin_url: null, source: 'registry' }] } : {}), query: 'agent', family: 'agent', providers: ['agent'], model: env.ENGINE_AGENT_LLM_MODEL || 'injected', keep: true, drop: null, status: audit.state, deadline: audit.deadline, daysLeft: audit.daysLeft, ...(audit.state === 'forecast' ? { forecast: true, estimatedDeadline: audit.estimatedDeadline } : {}), eligible, nonDilutive: a.criteria.non_dilutive?.verdict || 'unknown', amount: a.lead?.amount || null, pageType: { type: a.page_type }, quotes: { identity, ...(audit.deadlineQuote ? { deadline: audit.deadlineQuote } : {}), ...(audit.criteria.eligibility?.quote ? { eligible: audit.criteria.eligibility.quote } : {}) }, tier: audit.mainOk ? 'main' : 'verify', verdict: audit.mainOk ? 'apply' : 'watch', flags: audit.flags || [], blockers: audit.blockers || [], reasons: [], trace: { queries },
      // El tema lo decide el juez con su cita; sin esto, el filtro de palabras de evaluate() descartaba convocatorias ya auditadas (14-10).
      scopeFit: (() => { const tf = audit.criteria.topic_fit || {}; return { verdict: tf.verdict === 'yes' ? 'fits' : tf.verdict === 'no' ? 'does_not_fit' : 'unclear', reason: tf.reason || '', fundsQuote: tf.verdict === 'yes' ? tf.quote : null, excludesQuote: tf.verdict === 'no' ? tf.quote : null, source: 'judge' }; })() });
  }
  for (const [idx, ref] of secondRefs.entries()) {
    const second = preSecond ? preSecond[idx] : await judgeSecond(ref)(); secondCalls++;
    const first = firstJudgments.get(ref);
    if (!second || !first || ids.some((id) => second.criteria[id]?.verdict !== first.criteria[id]?.verdict)) changed++;
  }
  // Apollo en código: contactos de los financiadores que sobrevivieron al juez (el modelo ya no decide si se gasta).
  const contacts = pastDeadline() ? { orgs: 0, people: 0, credits: 0, skipped: 'time_budget', domains: [] } : await contactStage({ findings, objective, tools, trace, env, configured: Boolean(env.APOLLO_API_KEY || opts.apollo) });
  const usage = tools.usage?.() || {};
  return { findings, leads, audit: { objective, search: 'agent', queries: queries.length, pages: usage.opens || 0, read: usage.opens || 0, unread: 0, dropped: {}, kept: findings.length, errors: skippedForTime.length ? [`TIME_BUDGET: ${skippedForTime.length} pages not judged before the run deadline`] : [], skipped_for_time: skippedForTime.length, dropped_pages: droppedPages.slice(0, 120), triage: triageStats, agent: { on: true, ready: true, steps: stepsRun, invalid_steps: invalidSteps, seconds: Math.round((Date.now() - started) / 1000), stop_reason: stopReason, questions, assumptions: (understood.assumptions || []).length, ...usage }, discovery: { on: Boolean(coverage), levels: coverage ? coverage.levels.length : 0, queries: discoveryQueries }, contacts, judge: { finalists: selected.length, calls: judgeCalls, second_blind_calls: secondCalls, second_call_changed: changed }, decisions }, queries };
}
