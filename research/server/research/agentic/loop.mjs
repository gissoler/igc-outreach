/* Bucle agentic V14: comprender, actuar con refs, evaluar páginas y juzgar finalistas. */
import { agentMaxTokens, chatJSON } from '../../analysis/fleet.mjs';
import { hostKind, hostOf, literalIn } from '../verify.mjs';
import { resolveApolloContacts } from '../../../capital/resolver.mjs';
import { auditPage, verifyDate } from '../judge/audit.v13.mjs';
import { judgePrompt } from '../judge/prompts.v13.mjs';
import { assessContractOf, assessValidator, liftAssess, relaxForModel, validateStep, validateUnderstand } from './contracts.v14.mjs';
import { AGENT_CRITERIA, assessPromptFor, criterionHelp, mergeUnderstood, stepPrompt, understandFromBrief, understandPrompt } from './prompts.v14.mjs';
import { createTools } from './tools.mjs';
import { triageNote, triagePage } from './triage.mjs';
import { foaIdsIn } from '../grantSources.mjs';

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
/** Lo que el agente ve del triage determinista de una página (sin texto completo). */
const triageView = (t) => ({ shape: t.structure.kind, ...(t.structure.hub ? { hub: true } : {}), ...(t.banners.length ? { banners: t.banners.map((b) => b.kind) } : {}), ...(t.foa_ids.length ? { call_ids: t.foa_ids.slice(0, 6) } : {}) });
/** Enlaces que ve el agente (máx. 20). P0.6: los que llevan un ID oficial de convocatoria (foaIdsIn) van primero y lo
 *  muestran, para que en un hub de NIH el agente pueda abrir las convocatorias individuales. No es un filtro temático. */
const linksView = (links) => {
  const rows = (links || []).map((l, i) => ({ l, i, id: foaIdsIn(`${l.url || ''} ${l.text || ''}`)[0] || null }));
  rows.sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.i - b.i);
  return rows.slice(0, 20).map(({ l, id }) => ({ ref: l.ref, text: String(l.text || '').slice(0, 80), ...(id ? { call_id: id } : {}) }));
};
/** Consultas para sembrar el registro: los términos exactos que declara el brief («Exact search terms: a; b»), y si no hay,
 *  el campo de industria o la frase del producto. Se copian, no se inventan ni se filtran por tema. */
export function registryQueries(brief = {}, n = 2) {
  const exact = String(brief.constraints || '').match(/exact (?:search )?terms?\s*:\s*([^\n]+)/i)?.[1] || '';
  const terms = exact.split(/[;\n]/).map((t) => t.replace(/\.$/, '').replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 3);
  const base = terms.length ? terms : [brief.industry, brief.oneLiner || brief.product].map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(base.map((t) => t.slice(0, 100)))].slice(0, Math.max(0, n));
}
/** Registros y agregadores oficiales: su dominio no es la organización que financia (Apollo no aporta personas ahí). */
const APOLLO_SKIP_HOSTS = /(^|\.)(grants\.gov|sam\.gov|sbir\.gov|reporter\.nih\.gov)$/i;
const APOLLO_TITLES = { grant: ['program officer', 'program director', 'scientific program manager', 'grants manager'], sponsorship: ['partnerships manager', 'sponsorship manager'],
  investment: ['partner', 'principal', 'investment director', 'managing director'], partnering: ['business development', 'search and evaluation', 'licensing'], debt: ['partner', 'managing director'] };
/** Ejecuta como mucho `n` tareas a la vez, en orden de llegada. */
const limiter = (n) => { let active = 0; const q = []; const next = () => { if (active >= Math.max(1, n) || !q.length) return; active++; const { fn, res, rej } = q.shift(); Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); }); }; return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); }); };
/** Espera una promesa como mucho `ms` (sin rechazar ni dejar temporizadores vivos). */
const within = (promise, ms) => { if (!Number.isFinite(ms)) return promise; let t; return Promise.race([promise, new Promise((r) => { t = setTimeout(r, Math.max(0, ms)); })]).finally(() => clearTimeout(t)); };
const unpage = (text) => String(text || '').replace(/^<page_data>|<\/page_data>$/g, '');
const tokens = (usage) => ({ prompt: Number(usage?.prompt_tokens) || 0, completion: Number(usage?.completion_tokens) || 0, ...(!usage ? { estimated: true } : {}) });
/** Tokens de una llamada sin `usage` (cortada por tiempo): entrada estimada por caracteres (≈4 por token) y salida contada
 *  en streaming si el rol tiene *_LLM_STREAM=1; sin streaming el cliente no puede saber cuánto generó (limitación anotada). */
const cutTokens = (prompt, progress = {}) => ({ prompt: Math.round((String(prompt?.system || '').length + String(prompt?.user || '').length) / 4), completion: Number(progress.chunks) || 0, estimated: true,
  ...(progress.started ? { streamed: true, ...(progress.ttft_ms !== null && progress.ttft_ms !== undefined ? { ttft_ms: progress.ttft_ms } : {}) } : { completion_unknown: true }) });
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
  const apolloMode = String(env.ENGINE_AGENT_APOLLO_STAGE || '').trim().toLowerCase() === 'post_judge' ? 'post_judge' : 'tool';
  const ids = AGENT_CRITERIA[objective] || AGENT_CRITERIA.grant; const assessContract = assessContractOf(env); const pages = new Map(); const candidates = new Map();
  const findings = []; const leads = []; const queries = []; const decisions = []; const seenSearches = new Set(); let invalidSteps = 0; let finishRefused = false; let questions = 0; let stopReason = ''; let stepsRun = 0;

  /** Una llamada al modelo con tope local. `call`: { timeoutMs, maxTokens, signal, info } — `info.reason` recibe la causa del fallo. */
  async function model(prompt, role, validate, pageRef = null, call = {}) {
    const info = call.info || {};
    for (let retry = 0; retry < 2; retry++) {
      const at = Date.now(); let response = null; let error = null;
      const configuredRole = role === 'understand' ? String(env.ENGINE_AGENT_UNDERSTAND_ROLE || '') : role === 'assess' ? String(env.ENGINE_AGENT_ASSESS_ROLE || '') : '';
      const roleOverride = ['agent', 'compiler'].includes(configuredRole) ? configuredRole : null;
      const callRole = roleOverride || (role === 'understand' ? (parallel ? 'compiler' : 'agent') : role === 'assess' ? 'compiler' : role);
      const configuredMs = Number(call.timeoutMs) || Number(env[role === 'understand' ? 'ENGINE_AGENT_UNDERSTAND_TIMEOUT_MS' : role === 'assess' ? 'ENGINE_AGENT_ASSESS_TIMEOUT_MS' : role === 'agent' ? 'ENGINE_AGENT_STEP_TIMEOUT_MS' : 'ENGINE_AGENT_JUDGE_TIMEOUT_MS']) || (role === 'understand' ? 45_000 : role === 'assess' || role === 'agent' ? 60_000 : 100_000);
      const deadlineSeconds = role === 'judge' ? hardSeconds : hardSeconds - reserveSeconds;
      const remainingMs = parallel ? Math.max(1, deadlineSeconds * 1000 - (Date.now() - started)) : configuredMs;
      const timeoutMs = Math.max(1, Math.min(configuredMs, remainingMs)); const controller = new AbortController();
      const callSignal = anySignal([opts.signal, call.signal, controller.signal]); let timer;
      const relax = String(env.ENGINE_AGENT_SCHEMA_RELAX ?? '1').trim() !== '0';   // 0 = envía el esquema con maxLength (comparación)
      const purpose = role === 'agent' ? 'step' : role; const maxTokens = call.maxTokens ?? agentMaxTokens(purpose, env); const progress = {};
      try {
        response = await Promise.race([
          chat({ system: prompt.system, user: prompt.user, schema: relax ? relaxForModel(prompt.schema) : prompt.schema, name: role, role: callRole, ...(maxTokens ? { maxTokens } : {}) }, { env, fetcher: opts.fetcher, signal: callSignal, progress }),
          new Promise((_, reject) => { timer = setTimeout(() => { const e = new Error(`model_timeout_${role}_${timeoutMs}ms`); e.code = 'MODEL_TIMEOUT'; controller.abort(e); reject(e); }, timeoutMs); }),
          ...(call.signal ? [new Promise((_, reject) => { const stop = () => reject(Object.assign(new Error(`model_aborted_${role}`), { code: 'MODEL_ABORTED' })); if (call.signal.aborted) stop(); else call.signal.addEventListener('abort', stop, { once: true }); })] : []),
        ]);
      }
      catch (e) { error = e; }
      finally { clearTimeout(timer); }
      const raw = response?.json ?? response; const checked = error ? { ok: false, errors: [error.message] } : validate(raw);
      const modelKey = callRole === 'agent' ? 'ENGINE_AGENT_LLM_MODEL' : callRole === 'compiler' ? 'COMPILER_LLM_MODEL' : 'JUDGE_LLM_MODEL';
      trace.event('model_call', { role: callRole, purpose, model: response?.model || error?.model || env[modelKey] || 'injected', prompt_version: prompt.version, schema_relaxed: relax, tokens: response?.usage || error?.usage ? tokens(response?.usage || error?.usage) : cutTokens(prompt, progress), max_tokens: maxTokens || null, ...(response?.finish_reason || error?.finish_reason ? { finish_reason: response?.finish_reason || error?.finish_reason } : {}), ms_call: Date.now() - at, ok: checked.ok, invalid: !checked.ok, retry, page_ref: pageRef, ...(error ? { error: String(error.message || error) } : {}) });
      if (checked.ok) { info.reason = null; return checked.value ?? raw; }
      info.reason = error?.code === 'MODEL_TIMEOUT' ? 'timeout' : error?.code === 'MODEL_TRUNCATED' ? 'truncated' : error?.code === 'MODEL_ABORTED' ? 'aborted' : error ? 'error' : 'invalid';
      info.detail = String(error?.message || checked.errors?.[0] || '').slice(0, 200);
      if (error?.code === 'MODEL_TIMEOUT' || error?.code === 'MODEL_TRUNCATED' || error?.code === 'MODEL_ABORTED' || /abort|timeout/i.test(String(error?.message || error))) break;   // repetir con el mismo tope reproduce el corte
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

  /** Lectura de una página por el modelo con respaldo (P0.4): si falla, queda `unread_by_model` con su razón y su triage,
   *  y se reintenta UNA vez con el contrato mínimo si queda tiempo. Una página sin lectura exitosa nunca es candidata. */
  const unreadPages = new Map(); const readStats = { attempted: 0, ok: 0, ok_min: 0, retried: 0, unread: 0 };
  const retryMinMs = Number(env.ENGINE_AGENT_ASSESS_RETRY_MIN_MS) || 15_000; const retryTimeoutMs = Number(env.ENGINE_AGENT_ASSESS_RETRY_TIMEOUT_MS) || 30_000;
  const retryOn = String(env.ENGINE_AGENT_ASSESS_RETRY ?? '1') !== '0';
  const readWindowMs = () => (parallel ? (hardSeconds - reserveSeconds) * 1000 - (Date.now() - started) : Infinity);
  async function readPage(r, step, nextTool, understoodBrief, signal) {
    const obs = { type: 'page', ...r }; const text = unpage(r.text); const triage = r.triage || triagePage({ url: r.url, title: r.title, text, links: r.links || [], today });
    const args = { objective, brief, understood: understoodBrief, page: { url: r.url, title: r.title, text }, ref: r.ref, today, triageNote: triageNote(triage) };
    readStats.attempted++;
    const first = {}; let contract = assessContract;
    let raw = await model(assessPromptFor(contract, args), 'assess', assessValidator(contract, ids), r.ref, { info: first, signal });
    let retried = null;
    if (!raw && retryOn && first.reason !== 'aborted' && readWindowMs() >= retryMinMs && !signal?.aborted) {
      readStats.retried++; contract = 'min'; const second = {};
      raw = await model(assessPromptFor('min', args), 'assess', assessValidator('min', ids), r.ref, { info: second, signal, timeoutMs: Math.min(retryTimeoutMs, readWindowMs()), maxTokens: Number(env.ENGINE_AGENT_ASSESS_RETRY_MAX_TOKENS) || 300 });
      retried = { contract: 'min', ok: Boolean(raw), ...(raw ? {} : { reason: second.reason, detail: second.detail }) };
    }
    if (!raw) return markUnread(r, triage, signal?.aborted && typeof signal.reason === 'string' ? signal.reason : first.reason || 'invalid', first.detail, retried);
    const a = liftAssess(raw, contract, ids); a.ref = r.ref;
    if (contract === 'min') readStats.ok_min++; else readStats.ok++;
    const { dates, leadId } = ingest(obs, a, step, nextTool);
    return { ok: true, page: { ref: r.ref, url: r.url, title: r.title, chars: r.chars, about: a.about, page_type: a.page_type, candidate: candidates.has(r.ref), read: contract === 'min' ? 'min' : 'ok', dates: dates.filter(Boolean).slice(0, 6), lead_id: leadId, ...triageView(triage), links: linksView(r.links) } };
  }
  function markUnread(r, triage, reason, detail, retried) {
    readStats.unread++;
    const row = { page_ref: r.ref, url: r.url, title: r.title || '', reason, ...(detail ? { detail } : {}), retried: retried || null, triage: { structure: triage.structure, banners: triage.banners, foa_ids: triage.foa_ids, dates: triage.dates.slice(0, 6) } };
    unreadPages.set(r.ref, row); trace.event('page_unread', row);
    trace.event('decision', { page_ref: r.ref, by: 'code:loop.mjs#readPage', verdict: 'none', reason: 'unread_by_model', page_type: triage.structure.page_type_code, dates: [], criteria: {}, days_left: null, next_action: null });
    return { ok: false, failed: { ref: r.ref, error: reason === 'invalid' ? 'assess_invalid' : `assess_${reason}`, unread_by_model: true, url: r.url, title: r.title, ...triageView(triage), links: linksView(r.links) } };
  }

  // P0.5 · Lecturas sin bloqueo: cada página abierta se lee en segundo plano (tope de concurrencia global); el paso
  // espera como mucho ENGINE_AGENT_READ_WAIT_MS y lo que termine después llega en el siguiente paso como `late_reads`.
  // Al cerrar la ventana de acciones, una fase de drenaje deja terminar las lecturas ya lanzadas, con su propio tope y
  // nunca más allá de hardSeconds − reserveSeconds, para que el juez conserve su reserva y el tope duro no se rompa.
  const readSlot = limiter(assessConcurrency); const pendingReads = new Map();
  const readWaitMs = Number(env.ENGINE_AGENT_READ_WAIT_MS ?? 20_000);
  function startRead(r, step, nextTool, understoodBrief) {
    const controller = new AbortController(); const entry = { r, controller, done: false, delivered: false, result: null };
    entry.promise = readSlot(() => readPage(r, step, nextTool, understoodBrief, controller.signal))
      .catch((e) => markUnread(r, r.triage, 'error', String(e?.message || e), null))
      .then((res) => { entry.done = true; entry.result = res; return res; });
    pendingReads.set(r.ref, entry); return entry;
  }
  function collectLateReads() {
    const late = { pages: [], failed: [] };
    for (const e of pendingReads.values()) if (e.done && !e.delivered) { e.delivered = true; if (e.result.ok) late.pages.push(e.result.page); else late.failed.push(e.result.failed); }
    return late.pages.length || late.failed.length ? late : null;
  }
  async function drainReads() {
    const open = [...pendingReads.values()].filter((e) => !e.done); if (!open.length) return;
    const capMs = Math.max(0, Math.min(Number(env.ENGINE_AGENT_DRAIN_SECONDS ?? 60) * 1000, parallel ? (hardSeconds - reserveSeconds) * 1000 - (Date.now() - started) : Infinity));
    const t0 = Date.now(); await within(Promise.all(open.map((e) => e.promise)), capMs);
    const still = open.filter((e) => !e.done); for (const e of still) e.controller.abort('drain_timeout');
    await Promise.all(still.map((e) => e.promise));
    trace.event('drain', { pending: open.length, completed: open.length - still.length, aborted: still.length, ms: Date.now() - t0, cap_ms: Number.isFinite(capMs) ? capMs : null });
  }

  async function openMany(args, step, nextTool, understoodBrief) {
    const wanted = [...new Set([...(Array.isArray(args.refs) ? args.refs : []), args.ref].filter(Boolean).map(String))].slice(0, maxOpensPerStep);
    const opened = await Promise.all(wanted.map((ref) => tools.open({ ref })));
    const out = { type: 'pages', pages: [], failed: [] }; const mine = [];
    for (const [i, r] of opened.entries()) {
      if (!r?.ref) { out.failed.push({ ref: wanted[i], error: r?.error || 'open_failed' }); continue; }
      const text = unpage(r.text); r.triage = triagePage({ url: r.url, title: r.title, text, links: r.links || [], today });
      trace.event('triage', { page_ref: r.ref, url: r.url, version: r.triage.version, structure: r.triage.structure, banners: r.triage.banners, foa_ids: r.triage.foa_ids, dates: r.triage.dates.slice(0, 6) });
      mine.push(startRead(r, step, nextTool, understoodBrief));
    }
    const waitMs = Math.max(0, Math.min(readWaitMs, parallel ? (hardSeconds - reserveSeconds) * 1000 - (Date.now() - started) : Infinity));
    await within(Promise.all(mine.map((e) => e.promise)), waitMs);
    for (const e of mine) {
      if (e.done) { e.delivered = true; if (e.result.ok) out.pages.push(e.result.page); else out.failed.push(e.result.failed); }
      else (out.reading ||= []).push({ ref: e.r.ref, url: e.r.url, title: e.r.title, status: 'reading', ...triageView(e.r.triage), links: linksView(e.r.links) });
    }
    out.pages.sort((x, y) => Number(x.ref.slice(1)) - Number(y.ref.slice(1)));
    return out;
  }

  /* P0.8 · Apollo como etapa determinista posterior al juez (ENGINE_AGENT_APOLLO_STAGE=post_judge). Recorre los hallazgos
     (main antes que verify), toma el dominio oficial de la URL y resuelve personas con capital/resolver.mjs, con tope de
     créditos por corrida (ENGINE_AGENT_APOLLO_CREDITS, 25) y de organizaciones (ENGINE_AGENT_APOLLO_MAX_ORGS, 3). Cada
     hallazgo deja una traza apollo_stage con enabled, eligible_for_call, called, créditos y razón de no llamada. En el
     modo anterior ('tool') solo se resume lo que el agente gastó, para poder comparar. Apollo no cambia ranking ni veredicto. */
  async function apolloStage(found) {
    const enabled = env.APOLLO_ENABLED === '1'; const client = tools.apolloClient || null; const configured = Boolean(client && (env.APOLLO_API_KEY || opts.apollo));
    const cap = Number(env.ENGINE_AGENT_APOLLO_CREDITS) || 25; const maxOrgs = Number(env.ENGINE_AGENT_APOLLO_MAX_ORGS) || 3;
    const credits = () => Number(client?.stats?.creditsEstimated) || 0;
    if (apolloMode !== 'post_judge') {
      const spent = credits(); const row = { stage: 'tool', enabled, eligible_for_call: found.length > 0, called: spent > 0, credits: spent, reason_not_called: spent > 0 ? null : !enabled ? 'apollo_disabled' : !found.length ? 'no_findings' : 'agent_did_not_call' };
      trace.event('apollo_stage', row); return { stage: 'tool', enabled, configured, eligible: row.eligible_for_call ? 1 : 0, called: row.called ? 1 : 0, credits: spent, cap, reasons: row.reason_not_called ? { [row.reason_not_called]: 1 } : {} };
    }
    const summary = { stage: 'post_judge', enabled, configured, eligible: 0, called: 0, credits: 0, cap, reasons: {} };
    const note = (row) => { trace.event('apollo_stage', { stage: 'post_judge', enabled, ...row }); if (row.reason_not_called) summary.reasons[row.reason_not_called] = (summary.reasons[row.reason_not_called] || 0) + 1; };
    if (!found.length) { note({ eligible_for_call: false, called: false, credits: 0, reason_not_called: 'no_findings' }); return summary; }
    const ordered = [...found].sort((a, b) => (a.tier === 'main' ? 0 : 1) - (b.tier === 'main' ? 0 : 1)); const domains = new Set();
    for (const f of ordered) {
      const domain = hostOf(f.url);
      const reason = !enabled ? 'apollo_disabled' : !configured ? 'apollo_not_configured' : !domain ? 'no_domain' : APOLLO_SKIP_HOSTS.test(domain) ? 'registry_host'
        : hostKind(f.url) !== 'other' ? `${hostKind(f.url)}_host` : domains.has(domain) ? 'duplicate_domain' : summary.called >= maxOrgs ? 'org_cap' : credits() >= cap ? 'credit_cap' : null;
      if (reason) { note({ finding_url: f.url, domain: domain || null, eligible_for_call: false, called: false, credits: 0, reason_not_called: reason }); continue; }
      domains.add(domain); summary.eligible++; const before = credits();
      const result = await resolveApolloContacts({ organization_stable_id: domain, canonical_name: f.name || f.title || domain, official_domain: domain, target_roles: APOLLO_TITLES[objective] || APOLLO_TITLES.grant, as_of: today }, { client, maxPeople: Number(env.APOLLO_PEOPLE_PER_ORG) || 5 })
        .catch((e) => ({ status: 'error', people: [], errors: [String(e?.message || e)] }));
      const spent = credits() - before; summary.called++; summary.credits += spent;
      f.contacts = (result.people || []).map((p) => ({ name: p.name, title: p.title, organization: p.organization, route: 'public_affiliation', channel: p.channel || null }));
      note({ finding_url: f.url, domain, eligible_for_call: true, called: true, credits: spent, reason_not_called: null, status: result.status, people_n: f.contacts.length });
    }
    return summary;
  }

  async function seedRegistry() {
    const source = env.SIMPLER_GRANTS_API_KEY ? 'simpler' : 'grants_gov';
    const qs = registryQueries(brief, Number(env.ENGINE_AGENT_REGISTRY_SEED_QUERIES) || 2); const results = []; const seen = new Set(); const errors = [];
    for (const query of qs) {
      const out = await tools.registry({ source, query, n: Number(env.ENGINE_AGENT_REGISTRY_SEED_ROWS) || 10 });
      if (out?.error) { errors.push(out.error); continue; }
      for (const row of out?.rows || []) if (row.ref && !seen.has(row.url)) { seen.add(row.url); results.push(row); }
    }
    const seed = { source, queries: qs, results: results.slice(0, Number(env.ENGINE_AGENT_REGISTRY_SEED_MAX) || 12), ...(errors.length ? { errors } : {}) };
    trace.event('registry_seed', { source, queries: qs, results_n: seed.results.length, urls: seed.results.map((r) => r.url), ...(errors.length ? { errors } : {}) });
    return seed;
  }

  async function searchMany(args, action, step = null) {
    const planned = (args.queries || []).map((raw) => ({ raw: String(raw || '').trim(), query: normalizeAgentQuery(raw, objective, today) })).filter((x) => x.query);
    const qs = [];
    for (const item of planned) {
      const key = queryKey(item.query);
      if (!key || seenSearches.has(key)) { trace.event('query_skipped', { step, query: item.query, ...(item.raw !== item.query ? { original: item.raw } : {}), reason: 'duplicate' }); continue; }
      if (qs.length >= maxSearchesPerStep) { trace.event('query_skipped', { step, query: item.query, reason: 'per_step_cap' }); continue; }
      seenSearches.add(key); qs.push(item);
    }
    for (const item of qs) queries.push({ query: item.query, family: 'agent', ...(item.raw !== item.query ? { original: item.raw } : {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) });
    if (!qs.length) return { type: 'tool', tool: 'search', result: { results: [], errors: ['duplicate_queries'] } };
    const found = await Promise.all(qs.map((item) => tools.search({ query: item.query, ...(args.recency ? { recency: args.recency } : {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) })));
    const seen = new Set(); const results = [];
    for (const f of found) for (const row of f?.results || []) if (!seen.has(row.url)) { seen.add(row.url); results.push({ ...row, snippet: String(row.snippet || '').slice(0, 200) }); }
    return { type: 'tool', tool: 'search', result: { results, errors: found.map((f) => f?.error).filter(Boolean) } };
  }

  // P0.5 · La comprensión no bloquea el primer paso: el perfil da una lectura determinista inmediata y el modelo,
  // si se pide, corre en paralelo con un tope corto. Si falla, se sigue con el perfil y el brief en bruto (nota en la traza).
  const uPrompt = understandPrompt({ brief, objective, today });
  const requestedMode = String(env.ENGINE_AGENT_UNDERSTAND_MODE || '').trim().toLowerCase();
  const understandMode = ['profile', 'parallel', 'blocking'].includes(requestedMode) ? requestedMode : parallel ? 'parallel' : 'blocking';
  const fromProfile = understandFromBrief(brief); let understood = fromProfile; let understandSource = 'profile';
  const adoptUnderstood = async (value) => {
    understood = mergeUnderstood(fromProfile, value); understandSource = 'model';
    trace.event('understand', { output: understood, source: 'model', mode: understandMode });
    for (const [i, assumption] of (understood.assumptions || []).entries()) trace.event('brief_patch', {
      field: `assumptions[${i}]`, from: null, to: assumption, why: assumption, source: 'assumption',
    });
    const doubts = (understood.doubts || []).filter((d) => d.impact !== 'none').slice(0, 3);
    if (doubts.length) { questions = doubts.length; await tools.ask_user({ questions: doubts.map((d) => ({ q: d.question, options: d.options })) }); }
  };
  const uInfo = {}; const uController = new AbortController(); let understandTask = null;
  const understandFailed = () => trace.event('understand', { output: understood, source: 'profile', mode: understandMode, note: `model_understand_failed:${uInfo.reason || 'unknown'}; kept the profile view and the raw brief` });
  if (understandMode === 'blocking') { const v = await model(uPrompt, 'understand', validateUnderstand, null, { info: uInfo }); if (v) await adoptUnderstood(v); else understandFailed(); }
  else {
    trace.event('understand', { output: understood, source: 'profile', mode: understandMode, note: understandMode === 'parallel' ? 'model understanding runs in parallel; first steps use the profile and the raw brief' : 'deterministic from the profile (ENGINE_AGENT_UNDERSTAND_MODE=profile)' });
    if (understandMode === 'parallel') understandTask = model(uPrompt, 'understand', validateUnderstand, null, { info: uInfo, signal: uController.signal, timeoutMs: Number(env.ENGINE_AGENT_UNDERSTAND_TIMEOUT_MS) || 20_000 })
      .then((v) => (v ? adoptUnderstood(v) : understandFailed())).catch(() => understandFailed()).finally(() => { understandTask = null; });
  }

  // P0.6 · Grants: registros oficiales primero. Antes del primer paso se siembran convocatorias abiertas/forecast del
  // registro (Simpler.Grants.gov si hay clave; si no, Grants.gov) con las consultas declaradas en el brief. Son refs
  // abribles; abrirlas consume aperturas como cualquier otra página. No gasta búsquedas web.
  const registrySeed = objective === 'grant' && String(env.ENGINE_AGENT_REGISTRY_SEED ?? '1') !== '0' && typeof tools.registry === 'function' && !opts.initialObservation ? await seedRegistry() : null;
  let observation = opts.initialObservation || { type: 'start', understood, ...(registrySeed?.results.length ? { registry_seed: registrySeed } : {}) }; let finalRefs = [];
  for (let step = 1; step <= maxSteps && (elapsed() < maxSeconds - reserveSeconds || (parallel && lastCandidateStep >= step - 1 && elapsed() < hardSeconds - reserveSeconds)); step++) {
    stepsRun = step;
    const used = tools.usage?.() || {};
    const state = { objective, brief, understood, leads, queries, step, budget_left: { steps: maxSteps - step + 1, searches: (Number(env.ENGINE_AGENT_SEARCHES) || 20) - (used.searches || 0), opens: (Number(env.ENGINE_AGENT_OPENS) || 30) - (used.opens || 0), seconds: Math.max(0, Math.round(maxSeconds - reserveSeconds - elapsed())) },
      ...(parallel ? { parallel: true } : {}), ...(apolloMode === 'post_judge' ? { apollo_stage: 'post_judge' } : {}), judged_pages: [...pages.values()].slice(-30).map((p) => ({ ref: p.assessment.ref, about: p.assessment.about, page_type: p.assessment.page_type, candidate: p.assessment.candidate })), candidates: candidates.size };
    const late = collectLateReads(); if (late) observation = { ...observation, late_reads: late };   // lecturas que terminaron después de su paso
    const prompt = stepPrompt({ state, observation });
    const stepInfo = {};
    const value = await model(prompt, 'agent', (raw) => validateStep(raw, { lastObservation: observation?.type }), observation?.ref || null, { info: stepInfo });
    if (!value) {
      // P0.8 · Un paso que falla (timeout o JSON inválido) no borra lo observado: se repite la misma observación
      // (resultados de búsqueda, páginas, lecturas tardías) con una nota, en vez de sustituirla por `invalid_step`.
      invalidSteps++; const { retry_note: _drop, ...kept } = observation || {};
      observation = observation ? { ...kept, retry_note: `previous step failed (${stepInfo.reason || 'invalid'}); the same observation is repeated so its results are not lost` } : { type: 'invalid_step' };
      continue;
    }
    if (value.assessment && observation?.type === 'page') ingest(observation, value.assessment, step, value.action?.tool);
    const action = value.action;
    if (action.tool === 'finish' && !finishRefused && candidates.size === 0 && (used.opens || 0) < 5 && step < maxSteps / 2) { finishRefused = true; trace.event('tool_call', { tool: 'finish', args: action.args || {}, results_n: 0, ms_call: 0, error: 'refused_early' }); observation = { type: 'finish_refused', message: 'No candidate yet and most of the budget is unused. Search with different queries or open more results before finishing.' }; continue; }
    if (action.tool === 'finish') { finalRefs = action.args?.finalists || []; stopReason = action.args?.reason || 'agent'; await tools.finish(action.args); break; }
    const args = { ...(action.args || {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) };
    if (parallel && (action.tool === 'open' || (action.tool === 'search' && Array.isArray(args.queries)))) {
      if (action.from_lead) { const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.followups.push(step); trace.event('lead_followup', { lead_id: action.from_lead, action: action.tool, step }); }
      observation = action.tool === 'open' ? await openMany(args, step, action.tool, understood) : await searchMany(args, action, step);
      if (action.from_lead) { const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.produced.push(...(action.tool === 'open' ? observation.pages.map((p) => p.ref) : observation.result.results.map((p) => p.ref)).filter(Boolean)); }
      continue;
    }
    if (action.tool === 'search') {
      const original = String(args.query || '').trim(); const query = normalizeAgentQuery(original, objective, today); const key = queryKey(query);
      if (!key || seenSearches.has(key)) { trace.event('query_skipped', { step, query, ...(original !== query ? { original } : {}), reason: 'duplicate' }); observation = { type: 'tool', tool: 'search', result: { results: [], errors: ['duplicate_query'] } }; continue; }
      seenSearches.add(key); args.query = query; queries.push({ query, family: 'agent', ...(original !== query ? { original } : {}), ...(action.from_lead ? { from_lead: action.from_lead } : {}) });
    }
    if (action.from_lead) {
      const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.followups.push(step);
      trace.event('lead_followup', { lead_id: action.from_lead, action: action.tool, step });
    }
    if (action.tool === 'apollo' && apolloMode === 'post_judge') {   // P0.8 · con la etapa posterior al juez, el agente no gasta créditos
      trace.event('tool_call', { tool: 'apollo', args, results_n: 0, ms_call: 0, error: 'apollo_runs_after_judge' });
      observation = { type: 'tool', tool: 'apollo', result: { error: 'apollo_runs_after_judge', note: 'Apollo runs automatically after the judge on the final findings; do not call it.' } }; continue;
    }
    const result = await tools[action.tool](args);
    if (action.from_lead) { const lead = leads.find((x) => x.id === action.from_lead); if (lead) lead.produced.push(...(result?.results || []).map((x) => x.ref).filter(Boolean)); }
    observation = action.tool === 'open' && result?.ref ? { type: 'page', ...result } : { type: 'tool', tool: action.tool, result };
  }
  if (!stopReason) { stopReason = parallel && elapsed() >= maxSeconds - reserveSeconds ? 'time' : 'budget'; trace.event('budget', { left: { steps: 0 } }); trace.event('finish', { reason: stopReason }); }
  await drainReads();
  if (understandTask) { uController.abort('loop_finished'); await understandTask; }

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
    findings.push({ objective, url: page.url, title: page.title, name: a.about, query: 'agent', family: 'agent', providers: ['agent'], model: env.ENGINE_AGENT_LLM_MODEL || 'injected', keep: true, drop: null, status: audit.state, deadline: audit.deadline, daysLeft: audit.daysLeft, eligible, nonDilutive: a.criteria.non_dilutive?.verdict || 'unknown', amount: a.lead?.amount || null, pageType: { type: a.page_type }, read_contract: a.contract || 'full', quotes: { identity, ...(audit.deadlineQuote ? { deadline: audit.deadlineQuote } : {}), ...(audit.criteria.eligibility?.quote ? { eligible: audit.criteria.eligibility.quote } : {}) }, tier: audit.mainOk ? 'main' : 'verify', verdict: audit.mainOk ? 'apply' : 'watch', flags: audit.flags || [], blockers: audit.blockers || [], reasons: [], trace: { queries } });
  }
  for (const [idx, ref] of secondRefs.entries()) {
    const second = preSecond ? preSecond[idx] : await judgeSecond(ref)(); secondCalls++;
    const first = firstJudgments.get(ref);
    if (!second || !first || ids.some((id) => second.criteria[id]?.verdict !== first.criteria[id]?.verdict)) changed++;
  }
  const apollo = await apolloStage(findings);
  const usage = tools.usage?.() || {};
  return { findings, leads, audit: { apollo, ...(tools.disabledProviders ? { providers_disabled: tools.disabledProviders() } : {}), objective, search: 'agent', queries: queries.length, pages: usage.opens || 0, read: pages.size, unread: unreadPages.size, unread_by_model: [...unreadPages.values()], reads: { ...readStats }, candidates: candidates.size, dropped: {}, kept: findings.length, errors: [], agent: { on: true, ready: true, steps: stepsRun, invalid_steps: invalidSteps, seconds: Math.round((Date.now() - started) / 1000), stop_reason: stopReason, understand_source: understandSource, questions, assumptions: (understood.assumptions || []).length, ...usage }, judge: { finalists: selected.length, calls: judgeCalls, second_blind_calls: secondCalls, second_call_changed: changed }, decisions }, queries };
}
