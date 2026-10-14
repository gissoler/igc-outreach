/* Bucle agentic V14: comprender, actuar con refs, evaluar páginas y juzgar finalistas. */
import { chatJSON } from '../../analysis/fleet.mjs';
import { literalIn } from '../verify.mjs';
import { auditPage, verifyDate } from '../judge/audit.v13.mjs';
import { judgePrompt } from '../judge/prompts.v13.mjs';
import { validateStep, validateUnderstand } from './contracts.v14.mjs';
import { AGENT_CRITERIA, criterionHelp, stepPrompt, understandPrompt } from './prompts.v14.mjs';
import { createTools } from './tools.mjs';

const noopTrace = { event: () => null };
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
    apolloCredits: Number(env.ENGINE_AGENT_APOLLO_CREDITS) || 25,
  }, apollo: opts.apollo, readers: opts.readers });
  const chat = opts.chat || chatJSON; const maxSteps = Number(opts.maxSteps ?? env.ENGINE_AGENT_STEPS) || 40;
  const maxSeconds = Number(opts.maxSeconds ?? env.ENGINE_AGENT_SECONDS) || 1200; const started = Date.now();
  const ids = AGENT_CRITERIA[objective] || AGENT_CRITERIA.grant; const pages = new Map(); const candidates = new Map();
  const findings = []; const leads = []; const queries = []; const decisions = []; let invalidSteps = 0; let questions = 0; let stopReason = ''; let stepsRun = 0;

  async function model(prompt, role, validate, pageRef = null) {
    for (let retry = 0; retry < 2; retry++) {
      const at = Date.now(); let response = null; let error = null;
      const callRole = role === 'understand' ? 'agent' : role;
      try { response = await chat({ system: prompt.system, user: prompt.user, schema: prompt.schema, name: role, role: callRole }, { env, fetcher: opts.fetcher, signal: opts.signal }); }
      catch (e) { error = e; }
      const raw = response?.json ?? response; const checked = error ? { ok: false, errors: [error.message] } : validate(raw);
      trace.event('model_call', { role, model: response?.model || env[role === 'agent' ? 'ENGINE_AGENT_LLM_MODEL' : 'JUDGE_LLM_MODEL'] || 'injected', prompt_version: prompt.version, tokens: tokens(response?.usage), ms_call: Date.now() - at, ok: checked.ok, invalid: !checked.ok, retry, page_ref: pageRef, ...(error ? { error: String(error.message || error) } : {}) });
      if (checked.ok) return checked.value ?? raw;
    }
    return null;
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
  for (let step = 1; step <= maxSteps && (Date.now() - started) / 1000 < maxSeconds; step++) {
    stepsRun = step;
    const prompt = stepPrompt({ state: { objective, brief, understood, leads, queries, step }, observation });
    const value = await model(prompt, 'agent', (raw) => validateStep(raw, { lastObservation: observation?.type }), observation?.ref || null);
    if (!value) { invalidSteps++; observation = { type: 'invalid_step' }; continue; }
    if (value.assessment && observation?.type === 'page') {
      const pageText = unpage(observation.text); const a = structuredClone(value.assessment);
      for (const c of Object.values(a.criteria || {})) if (c.verdict !== 'unknown' && !literalIn(c.quote, pageText)) c.verdict = 'unknown';
      const dates = (a.dates || []).map((d) => verifyDate(d, pageText));
      const decision = { step, page_ref: a.ref, by: 'agent', verdict: a.candidate ? 'candidate' : 'none', reason: a.candidate ? 'agent_candidate' : 'agent_rejected', page_type: a.page_type, dates, criteria: a.criteria, days_left: null, next_action: value.action?.tool || null };
      decisions.push(decision); trace.event('decision', decision); pages.set(a.ref, { ...observation, text: pageText, assessment: a });
      if (a.candidate && !Object.values(a.criteria || {}).some((c) => c.verdict === 'no' && literalIn(c.quote, pageText))) candidates.set(a.ref, pages.get(a.ref));
      if (a.lead?.quote && literalIn(a.lead.quote, pageText)) {
        const lead = { id: `L${leads.length + 1}`, page_ref: a.ref, kind: a.lead.kind, funder: a.lead.funder, recipient: a.lead.recipient, amount: a.lead.amount, quote: a.lead.quote, url: observation.url, found_at_step: step, followups: [], produced: [] };
        leads.push(lead); trace.event('lead', lead);
      }
    }
    const action = value.action;
    if (action.tool === 'finish') { finalRefs = action.args?.finalists || []; stopReason = action.args?.reason || 'agent'; await tools.finish(action.args); break; }
    const args = { ...(action.args || {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) };
    if (action.tool === 'search') queries.push({ query: String(args.query || ''), family: 'agent', ...(action.from_lead ? { from_lead: action.from_lead } : {}) });
    if (action.from_lead) {
      const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.followups.push(step);
      trace.event('lead_followup', { lead_id: action.from_lead, action: action.tool, step });
    }
    const result = await tools[action.tool](args);
    if (action.from_lead) { const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.produced.push(...(result?.results || []).map((x) => x.ref).filter(Boolean)); }
    observation = action.tool === 'open' && result?.ref ? { type: 'page', ...result } : { type: 'tool', tool: action.tool, result };
  }
  if (!stopReason) { stopReason = 'budget'; trace.event('budget', { left: { steps: 0 } }); trace.event('finish', { reason: 'budget' }); }

  const selected = (finalRefs.length ? finalRefs : [...candidates.keys()]).filter((ref) => candidates.has(ref));
  let judgeCalls = 0; let secondCalls = 0; let changed = 0; const firstJudgments = new Map();
  for (const ref of selected) {
    const row = candidates.get(ref); const a = row.assessment; const page = { url: row.url, title: row.title, text: row.text };
    const prompt = judgePrompt({ objective, brief, page, today, claims: a, blind: String(env.ENGINE_JUDGE_BLIND || '') === '1', criteriaIds: ids, help: criterionHelp });
    const judgment = await model(prompt, 'judge', (raw) => ({ ok: validJudgment(raw, ids), value: raw }), ref); judgeCalls++; firstJudgments.set(ref, judgment);
    const audit = auditPage({ objective, page, today, compilation: compilerOf(a), judgment, failure: judgment ? {} : { judge: 'invalid' }, blind: prompt.blind, criteriaIds: ids });
    trace.event('decision', { page_ref: ref, by: 'judge', verdict: audit.dropReason ? 'drop' : audit.mainOk ? 'keep' : 'verify', reason: audit.dropReason || (audit.mainOk ? 'audited' : 'blocked'), page_type: audit.pageType?.judge || a.page_type, dates: audit.dates?.judge || [], criteria: audit.criteria, days_left: audit.daysLeft, next_action: null });
    if (audit.dropReason) { trace.event('drop', { url: page.url, page_ref: ref, reason: audit.dropReason, decided_by: 'judge', read: true }); continue; }
    const eligible = ['eligibility', 'region', 'entity_type', 'stage'].some((id) => audit.criteria[id]?.verdict === 'no') ? 'no' : audit.criteria.eligibility?.verdict === 'yes' ? 'yes' : 'unclear';
    const identity = a.lead?.quote && literalIn(a.lead.quote, page.text) ? a.lead.quote : a.about;
    findings.push({ objective, url: page.url, title: page.title, name: a.about, query: 'agent', family: 'agent', providers: ['agent'], model: env.ENGINE_AGENT_LLM_MODEL || 'injected', keep: true, drop: null, status: audit.state, deadline: audit.deadline, daysLeft: audit.daysLeft, eligible, nonDilutive: a.criteria.non_dilutive?.verdict || 'unknown', amount: a.lead?.amount || null, pageType: { type: a.page_type }, quotes: { identity, ...(audit.deadlineQuote ? { deadline: audit.deadlineQuote } : {}), ...(audit.criteria.eligibility?.quote ? { eligible: audit.criteria.eligibility.quote } : {}) }, tier: audit.mainOk ? 'main' : 'verify', verdict: audit.mainOk ? 'apply' : 'watch', flags: audit.flags || [], blockers: audit.blockers || [], reasons: [], trace: { queries } });
  }
  const secondMax = opts.secondJudge === undefined ? Number(env.ENGINE_AGENT_JUDGE_SECOND ?? 10) : Number(opts.secondJudge);
  for (const ref of selected.slice(0, Math.max(0, secondMax))) {
    const row = candidates.get(ref); const prompt = judgePrompt({ objective, brief, page: row, today, blind: true, criteriaIds: ids, help: criterionHelp });
    const second = await model(prompt, 'judge', (raw) => ({ ok: validJudgment(raw, ids), value: raw }), ref); secondCalls++;
    const first = firstJudgments.get(ref);
    if (!second || !first || ids.some((id) => second.criteria[id]?.verdict !== first.criteria[id]?.verdict)) changed++;
  }
  const usage = tools.usage?.() || {};
  return { findings, leads, audit: { objective, agent: { on: true, ready: true, steps: stepsRun, invalid_steps: invalidSteps, seconds: Math.round((Date.now() - started) / 1000), stop_reason: stopReason, questions, assumptions: (understood.assumptions || []).length, ...usage }, judge: { finalists: selected.length, calls: judgeCalls, second_blind_calls: secondCalls, second_call_changed: changed }, decisions }, queries };
}
