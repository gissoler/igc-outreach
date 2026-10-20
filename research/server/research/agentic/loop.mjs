/* Bucle agentic V14: comprender, actuar con refs, evaluar páginas y juzgar finalistas. */
import { chatJSON } from '../../analysis/fleet.mjs';
import { literalIn } from '../verify.mjs';
import { auditPage, verifyDate } from '../judge/audit.v13.mjs';
import { judgePrompt } from '../judge/prompts.v13.mjs';
import { validateAssess, validateStep, validateUnderstand } from './contracts.v14.mjs';
import { AGENT_CRITERIA, assessPrompt, criterionHelp, stepPrompt, understandPrompt } from './prompts.v14.mjs';
import { createTools } from './tools.mjs';

const noopTrace = { event: () => null };
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const anySignal = (list) => { const l = list.filter(Boolean); return l.length < 2 ? l[0] : typeof AbortSignal.any === 'function' ? AbortSignal.any(l) : l[l.length - 1]; };
const queryKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function normalizeAgentQuery(value, objective, today) {
  const query = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!['grant', 'sponsorship'].includes(objective)) return query;
  const year = Number(String(today || '').slice(0, 4));
  return Number.isInteger(year) ? query.replace(/\b(20\d{2})\b/g, (match) => Number(match) < year ? String(year) : match) : query;
}
const unpage = (text) => String(text || '').replace(/^<page_data>|<\/page_data>$/g, '');
const tokens = (usage) => ({ prompt: Number(usage?.prompt_tokens) || 0, completion: Number(usage?.completion_tokens) || 0, ...(!usage ? { estimated: true } : {}) });
const validJudgment = (raw, ids) => Boolean(raw && typeof raw === 'object' && typeof raw.page_type === 'string' && Array.isArray(raw.dates) && raw.criteria && ids.every((id) => ['yes', 'no', 'unknown'].includes(raw.criteria[id]?.verdict)));
const compilerOf = (a) => ({
  page_type: a.page_type, identity: { name: a.about, org: null, kind: a.page_type === 'investor_about' ? 'investor' : 'program', quote: a.lead?.quote || a.about },
  dates: a.dates, eligibility: { applicant_types: [], applicant_types_quote: null, countries: [], countries_quote: null, stage: null, stage_quote: null, for_profit_allowed: 'unknown', for_profit_quote: null },
  amount: { text: a.lead?.amount || null, quote: a.lead?.quote || null }, how_to_apply_quote: null, relevant: true,
  official: a.criteria.official?.verdict === 'yes', money: 'unknown', non_dilutive: a.criteria.non_dilutive?.verdict || 'unknown', summary: a.about,
});

export async function runAgentObjective(objective, brief, opts = {}) {
  const env = opts.env || process.env; const today = opts.today || new Date().toISOString().slice(0, 10); const trace = opts.trace || noopTrace;
  const tools = opts.tools || createTools({ env, fetcher: opts.fetcher, signal: opts.signal, trace, limits: opts.limits || {
    searches: Number(env.ENGINE_AGENT_SEARCHES) || 20, opens: Number(env.ENGINE_AGENT_OPENS) || 30,
    apolloCredits: Number(env.ENGINE_AGENT_APOLLO_CREDITS) || 25, exaUsdCap: opts.exaUsdCap,
  }, apollo: opts.apollo, readers: opts.readers });
  const chat = opts.chat || chatJSON; const maxSteps = Number(opts.maxSteps ?? env.ENGINE_AGENT_STEPS) || 40;
  // Modo paralelo (ENGINE_AGENT_PARALLEL=1): varias aperturas y búsquedas por paso, páginas evaluadas en paralelo por el modelo rápido, jueces en paralelo y tope de tiempo con entrega parcial.
  const parallel = opts.parallel === true || String(env.ENGINE_AGENT_PARALLEL || '') === '1';
  const maxSeconds = Number(opts.maxSeconds ?? env.ENGINE_AGENT_SECONDS) || (parallel ? 300 : 1200); const started = Date.now();
  const hardSeconds = parallel ? Math.max(maxSeconds, Number(opts.hardSeconds ?? env.ENGINE_AGENT_HARD_SECONDS) || 540) : maxSeconds;
  const reserveSeconds = parallel ? Number(opts.reserveSeconds ?? env.ENGINE_AGENT_JUDGE_RESERVE_SECONDS) || 60 : 0;
  const maxOpensPerStep = Number(env.ENGINE_AGENT_OPENS_PER_STEP) || 8; const maxSearchesPerStep = Number(env.ENGINE_AGENT_SEARCHES_PER_STEP) || 4;
  const assessConcurrency = Number(env.ENGINE_AGENT_ASSESS_CONCURRENCY) || 8; const judgeConcurrency = Number(env.ENGINE_AGENT_JUDGE_CONCURRENCY) || 8;
  const elapsed = () => (Date.now() - started) / 1000; let lastCandidateStep = 0;
  const ids = AGENT_CRITERIA[objective] || AGENT_CRITERIA.grant; const pages = new Map(); const candidates = new Map();
  const findings = []; const leads = []; const queries = []; const decisions = []; const seenSearches = new Set(); let invalidSteps = 0; let finishRefused = false; let questions = 0; let stopReason = ''; let stepsRun = 0;

  async function model(prompt, role, validate, pageRef = null) {
    for (let retry = 0; retry < 2; retry++) {
      const at = Date.now(); let response = null; let error = null;
      const configuredRole = role === 'understand' ? String(env.ENGINE_AGENT_UNDERSTAND_ROLE || '') : role === 'assess' ? String(env.ENGINE_AGENT_ASSESS_ROLE || '') : '';
      const roleOverride = ['agent', 'compiler'].includes(configuredRole) ? configuredRole : null;
      const callRole = roleOverride || (role === 'understand' ? (parallel ? 'compiler' : 'agent') : role === 'assess' ? 'compiler' : role);
      const configuredMs = Number(env[role === 'understand' ? 'ENGINE_AGENT_UNDERSTAND_TIMEOUT_MS' : role === 'assess' ? 'ENGINE_AGENT_ASSESS_TIMEOUT_MS' : role === 'agent' ? 'ENGINE_AGENT_STEP_TIMEOUT_MS' : 'ENGINE_AGENT_JUDGE_TIMEOUT_MS']) || (role === 'understand' ? 45_000 : role === 'assess' || role === 'agent' ? 60_000 : 100_000);
      const deadlineSeconds = role === 'judge' ? hardSeconds : hardSeconds - reserveSeconds;
      const remainingMs = parallel ? Math.max(1, deadlineSeconds * 1000 - (Date.now() - started)) : configuredMs;
      const timeoutMs = Math.max(1, Math.min(configuredMs, remainingMs)); const controller = new AbortController();
      const callSignal = anySignal([opts.signal, controller.signal]); let timer;
      try {
        response = await Promise.race([
          chat({ system: prompt.system, user: prompt.user, schema: prompt.schema, name: role, role: callRole }, { env, fetcher: opts.fetcher, signal: callSignal }),
          new Promise((_, reject) => { timer = setTimeout(() => { const e = new Error(`model_timeout_${role}_${timeoutMs}ms`); e.code = 'MODEL_TIMEOUT'; controller.abort(e); reject(e); }, timeoutMs); }),
        ]);
      }
      catch (e) { error = e; }
      finally { clearTimeout(timer); }
      const raw = response?.json ?? response; const checked = error ? { ok: false, errors: [error.message] } : validate(raw);
      const modelKey = callRole === 'agent' ? 'ENGINE_AGENT_LLM_MODEL' : callRole === 'compiler' ? 'COMPILER_LLM_MODEL' : 'JUDGE_LLM_MODEL';
      trace.event('model_call', { role: callRole, model: response?.model || env[modelKey] || 'injected', prompt_version: prompt.version, tokens: tokens(response?.usage), ms_call: Date.now() - at, ok: checked.ok, invalid: !checked.ok, retry, page_ref: pageRef, ...(error ? { error: String(error.message || error) } : {}) });
      if (checked.ok) return checked.value ?? raw;
      if (error?.code === 'MODEL_TIMEOUT' || /abort|timeout/i.test(String(error?.message || error))) break;
    }
    return null;
  }

  function ingest(obs, assessment, step, nextTool) {
    const pageText = unpage(obs.text); const a = structuredClone(assessment);
    for (const c of Object.values(a.criteria || {})) if (c.verdict !== 'unknown' && !literalIn(c.quote, pageText)) c.verdict = 'unknown';
    const dates = (a.dates || []).map((d) => verifyDate(d, pageText));
    const decision = { step, page_ref: a.ref, by: 'agent', verdict: a.candidate ? 'candidate' : 'none', reason: a.candidate ? 'agent_candidate' : 'agent_rejected', page_type: a.page_type, dates, criteria: a.criteria, days_left: null, next_action: nextTool || null };
    decisions.push(decision); trace.event('decision', decision); pages.set(a.ref, { ...obs, text: pageText, assessment: a });
    if (a.candidate && !Object.values(a.criteria || {}).some((c) => c.verdict === 'no' && literalIn(c.quote, pageText))) { candidates.set(a.ref, pages.get(a.ref)); lastCandidateStep = step; }
    let leadId = null;
    if (a.lead?.quote && literalIn(a.lead.quote, pageText)) {
      const lead = { id: `L${leads.length + 1}`, page_ref: a.ref, kind: a.lead.kind, funder: a.lead.funder, recipient: a.lead.recipient, amount: a.lead.amount, quote: a.lead.quote, url: obs.url, found_at_step: step, followups: [], produced: [] };
      leads.push(lead); trace.event('lead', lead); leadId = lead.id;
    }
    return { a, dates, leadId };
  }

  async function openMany(args, step, nextTool, understoodBrief) {
    const wanted = [...new Set([...(Array.isArray(args.refs) ? args.refs : []), args.ref].filter(Boolean).map(String))].slice(0, maxOpensPerStep);
    const opened = await Promise.all(wanted.map((ref) => tools.open({ ref })));
    const out = { type: 'pages', pages: [], failed: [] };
    await pool(opened.map((r, i) => [wanted[i], r]), assessConcurrency, async ([ref, r]) => {
      if (!r?.ref) { out.failed.push({ ref, error: r?.error || 'open_failed' }); return; }
      const obs = { type: 'page', ...r };
      const a = await model(assessPrompt({ objective, brief, understood: understoodBrief, page: { url: r.url, title: r.title, text: unpage(r.text) }, ref: r.ref, today }), 'assess', validateAssess, r.ref);
      if (!a) { out.failed.push({ ref: r.ref, error: 'assess_invalid' }); return; }
      a.ref = r.ref; const { dates, leadId } = ingest(obs, a, step, nextTool);
      out.pages.push({ ref: r.ref, url: r.url, title: r.title, chars: r.chars, about: a.about, page_type: a.page_type, candidate: candidates.has(r.ref), dates: dates.filter(Boolean).slice(0, 6), lead_id: leadId, links: (r.links || []).slice(0, 20).map((l) => ({ ref: l.ref, text: String(l.text || '').slice(0, 80) })) });
    });
    out.pages.sort((x, y) => Number(x.ref.slice(1)) - Number(y.ref.slice(1)));
    return out;
  }

  async function searchMany(args, action) {
    const planned = (args.queries || []).map((raw) => ({ raw: String(raw || '').trim(), query: normalizeAgentQuery(raw, objective, today) })).filter((x) => x.query);
    const qs = [];
    for (const item of planned) { const key = queryKey(item.query); if (!key || seenSearches.has(key)) continue; seenSearches.add(key); qs.push(item); if (qs.length >= maxSearchesPerStep) break; }
    for (const item of qs) queries.push({ query: item.query, family: 'agent', ...(item.raw !== item.query ? { original: item.raw } : {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) });
    if (!qs.length) return { type: 'tool', tool: 'search', result: { results: [], errors: ['duplicate_queries'] } };
    const found = await Promise.all(qs.map((item) => tools.search({ query: item.query, ...(args.recency ? { recency: args.recency } : {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) })));
    const seen = new Set(); const results = [];
    for (const f of found) for (const row of f?.results || []) if (!seen.has(row.url)) { seen.add(row.url); results.push({ ...row, snippet: String(row.snippet || '').slice(0, 200) }); }
    return { type: 'tool', tool: 'search', result: { results, errors: found.map((f) => f?.error).filter(Boolean) } };
  }

  const uPrompt = understandPrompt({ brief, objective, today });
  const understood = await model(uPrompt, 'understand', validateUnderstand) || {
    product_one_line: '', who_pays: '', sector: '', neighbor_sectors: [], stage: '', geography: '', assumptions: [], doubts: [],
  };
  trace.event('understand', { output: understood });
  for (const [i, assumption] of (understood.assumptions || []).entries()) trace.event('brief_patch', {
    field: `assumptions[${i}]`, from: null, to: assumption, why: assumption, source: 'assumption',
  });
  const doubts = (understood.doubts || []).filter((d) => d.impact !== 'none').slice(0, 3);
  if (doubts.length) { questions = doubts.length; await tools.ask_user({ questions: doubts.map((d) => ({ q: d.question, options: d.options })) }); }

  let observation = opts.initialObservation || { type: 'start', understood }; let finalRefs = [];
  for (let step = 1; step <= maxSteps && (elapsed() < maxSeconds - reserveSeconds || (parallel && lastCandidateStep >= step - 1 && elapsed() < hardSeconds - reserveSeconds)); step++) {
    stepsRun = step;
    const used = tools.usage?.() || {};
    const state = { objective, brief, understood, leads, queries, step, budget_left: { steps: maxSteps - step + 1, searches: (Number(env.ENGINE_AGENT_SEARCHES) || 20) - (used.searches || 0), opens: (Number(env.ENGINE_AGENT_OPENS) || 30) - (used.opens || 0), seconds: Math.max(0, Math.round(maxSeconds - reserveSeconds - elapsed())) },
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
    if (action.tool === 'search') {
      const original = String(args.query || '').trim(); const query = normalizeAgentQuery(original, objective, today); const key = queryKey(query);
      if (!key || seenSearches.has(key)) { observation = { type: 'tool', tool: 'search', result: { results: [], errors: ['duplicate_query'] } }; continue; }
      seenSearches.add(key); args.query = query; queries.push({ query, family: 'agent', ...(original !== query ? { original } : {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) });
    }
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
  const secondMax = opts.secondJudge === undefined ? Number(env.ENGINE_AGENT_JUDGE_SECOND ?? 10) : Number(opts.secondJudge);
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
    const audit = auditPage({ objective, page, today, compilation: compilerOf(a), judgment, failure: judgment ? {} : { judge: 'invalid' }, blind: prompt.blind, criteriaIds: ids });
    trace.event('decision', { page_ref: ref, by: 'judge', verdict: audit.dropReason ? 'drop' : audit.mainOk ? 'keep' : 'verify', reason: audit.dropReason || (audit.mainOk ? 'audited' : 'blocked'), page_type: audit.pageType?.judge || a.page_type, dates: audit.dates?.judge || [], criteria: audit.criteria, days_left: audit.daysLeft, next_action: null });
    if (audit.dropReason) { trace.event('drop', { url: page.url, page_ref: ref, reason: audit.dropReason, decided_by: 'judge', read: true }); continue; }
    const eligible = ['eligibility', 'region', 'entity_type', 'stage'].some((id) => audit.criteria[id]?.verdict === 'no') ? 'no' : audit.criteria.eligibility?.verdict === 'yes' ? 'yes' : 'unclear';
    const identity = a.lead?.quote && literalIn(a.lead.quote, page.text) ? a.lead.quote : a.about;
    findings.push({ objective, url: page.url, title: page.title, name: a.about, query: 'agent', family: 'agent', providers: ['agent'], model: env.ENGINE_AGENT_LLM_MODEL || 'injected', keep: true, drop: null, status: audit.state, deadline: audit.deadline, daysLeft: audit.daysLeft, eligible, nonDilutive: a.criteria.non_dilutive?.verdict || 'unknown', amount: a.lead?.amount || null, pageType: { type: a.page_type }, quotes: { identity, ...(audit.deadlineQuote ? { deadline: audit.deadlineQuote } : {}), ...(audit.criteria.eligibility?.quote ? { eligible: audit.criteria.eligibility.quote } : {}) }, tier: audit.mainOk ? 'main' : 'verify', verdict: audit.mainOk ? 'apply' : 'watch', flags: audit.flags || [], blockers: audit.blockers || [], reasons: [], trace: { queries } });
  }
  for (const [idx, ref] of secondRefs.entries()) {
    const second = preSecond ? preSecond[idx] : await judgeSecond(ref)(); secondCalls++;
    const first = firstJudgments.get(ref);
    if (!second || !first || ids.some((id) => second.criteria[id]?.verdict !== first.criteria[id]?.verdict)) changed++;
  }
  const usage = tools.usage?.() || {};
  return { findings, leads, audit: { objective, search: 'agent', queries: queries.length, pages: usage.opens || 0, read: usage.opens || 0, unread: 0, dropped: {}, kept: findings.length, errors: [], agent: { on: true, ready: true, steps: stepsRun, invalid_steps: invalidSteps, seconds: Math.round((Date.now() - started) / 1000), stop_reason: stopReason, questions, assumptions: (understood.assumptions || []).length, ...usage }, judge: { finalists: selected.length, calls: judgeCalls, second_blind_calls: secondCalls, second_call_changed: changed }, decisions }, queries };
}
