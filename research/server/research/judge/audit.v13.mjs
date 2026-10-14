/* V13 · Auditor por código del agente de compilación + agente juez.
   El MODELO asigna el rol de cada fecha y da el veredicto por criterio; el CÓDIGO audita:
     · la cita está literal en la página (literalIn);
     · la cita contiene la fecha y solo esa (la fecha se lee de la cita con el lector existente de dates.mjs; aquí NO hay patrones de fechas ni clasificación de fechas);
     · la resta contra HOY (daysBetween);
     · la regla de estado: closed | open | forecast | unknown.
   Falla cerrado: juez caído o inválido → nada entra a la lista principal. Compilador y juez en desacuerdo → «a verificar».
   Funciones puras (sin red, disco ni reloj). */
import { literalIn } from '../verify.mjs';
import { datesIn, daysBetween, todayIso } from '../dates.mjs';
import { criteriaFor, hasDeadline } from './prompts.v13.mjs';

export const JUDGE_AUDIT_VERSION = 'v13.1';
const CALL_TYPES = new Set(['call', 'forecast_notice']);
const pageClass = (type, dated) => (!dated ? 'other' : type === 'forecast_notice' ? 'forecast' : type === 'call' ? 'call' : 'other');

/** ¿Se puede sostener esta fecha? Cita literal en la página, que contenga la fecha pedida y ninguna otra. */
export function verifyDate(d, pageText) {
  const base = { role: d.role, date: d.date || null, estimated: Boolean(d.estimated), quote: String(d.quote || '') };
  if (!d.date) return { ...base, verified: false, why: 'no_date' };
  if (!literalIn(d.quote, pageText)) return { ...base, verified: false, why: 'quote_not_in_page' };
  const found = datesIn(d.quote);
  if (!found.includes(d.date)) return { ...base, verified: false, why: 'date_not_in_quote' };
  if (found.length > 1) return { ...base, verified: false, why: 'quote_has_several_dates' };
  return { ...base, verified: true, why: null };
}
/* El juez a veces etiqueta la fecha de cierre con otro nombre («deadline», «expiration»…): se normaliza a application_deadline.
   Diagnóstico 14-10: PAR-17-067 («Expiration Date September 6, 2019») quedó «a verificar» en vez de cerrado por el rol «deadline». */
const DEADLINE_ALIASES = /^(deadline|due|due_date|close|closes|closing|close_date|closing_date|expiration|expiration_date|expires|expiry|submission_deadline|application_due|application_due_date|application_close|proposal_deadline|full_proposal_deadline|end_date)$/i;
export const normRole = (d) => (d && DEADLINE_ALIASES.test(String(d.role || '').trim()) ? { ...d, role: 'application_deadline' } : d);
const auditDates = (list, pageText) => (Array.isArray(list) ? list : []).map(normRole).map((d) => verifyDate(d, pageText));
/** Una cita de cierre con VARIAS fechas no sirve para fijar un plazo, pero si TODAS son anteriores a hoy prueba que está cerrado. */
function pastOnly(d, pageText, today) {
  if (d.role !== 'application_deadline' || d.why !== 'quote_has_several_dates' || !literalIn(d.quote, pageText)) return d;
  const found = datesIn(d.quote); if (!found.length || !found.every((x) => x < today)) return d;
  return { ...d, date: found.includes(d.date) ? d.date : found.sort().at(-1), verified: true, why: null, past_only: true };
}
const appDatesOf = (dates) => dates.filter((d) => d.role === 'application_deadline' && d.verified);
const uniqSorted = (xs) => [...new Set(xs)].sort();

/** Veredicto por criterio con la cita auditada: un sí/no sin cita literal en la página queda en «unknown» y se anota. */
function auditCriteria(judgment, objective, pageText, flags, criteriaIds = null) {
  const out = {};
  for (const id of criteriaIds || criteriaFor(objective)) {
    const c = judgment?.criteria?.[id];
    if (!c) { out[id] = { verdict: 'unknown', claimed: null, quote: '', quoteOk: false, reason: 'The judge did not answer this criterion', compiler: 'not_shown', missing: true }; flags.push(`criterion_missing:${id}`); continue; }
    const quote = typeof c.quote === 'string' ? c.quote.trim() : '';
    const quoteOk = Boolean(quote) && literalIn(quote, pageText);
    let verdict = c.verdict;
    if (verdict !== 'unknown' && !quoteOk) { flags.push(quote ? `fake_quote:${id}` : `quote_missing:${id}`); verdict = 'unknown'; }
    out[id] = { verdict, claimed: c.verdict, quote: quoteOk ? quote : '', quoteOk, reason: String(c.reason || '').slice(0, 300), compiler: c.compiler || 'not_shown' };
  }
  return out;
}

/** Estado por código a partir de los roles de fecha del juez ya auditados. */
export function stateFrom({ judgeType, compilerType, judgeDates, compilerDates, today, dated }) {
  if (!dated) return { state: 'n/a', deadline: null, quote: '', daysLeft: null, estimatedDeadline: null };
  const app = appDatesOf(judgeDates);
  const anyEstimated = app.some((d) => d.estimated) || appDatesOf(compilerDates || []).some((d) => d.estimated);
  const forecast = judgeType === 'forecast_notice' || compilerType === 'forecast_notice' || anyEstimated;
  const first = (xs) => [...xs].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (forecast) { const e = app.length ? first(app) : null; return { state: 'forecast', deadline: null, quote: e?.quote || '', daysLeft: null, estimatedDeadline: e?.date || null }; }
  if (!app.length) return { state: 'unknown', deadline: null, quote: '', daysLeft: null, estimatedDeadline: null };
  const future = app.filter((d) => d.date >= today);
  if (!future.length) { const last = [...app].sort((a, b) => b.date.localeCompare(a.date))[0]; return { state: 'closed', deadline: last.date, quote: last.quote, daysLeft: null, estimatedDeadline: null }; }
  const next = first(future);
  // Aún no abre: el juez dio una fecha de apertura verificada posterior a hoy. Hay plazo firme, pero no se puede postular todavía.
  const opening = judgeDates.filter((d) => d.role === 'opens' && d.verified && !d.estimated && d.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (opening) return { state: 'upcoming', deadline: next.date, quote: next.quote, daysLeft: daysBetween(today, next.date), estimatedDeadline: null, opensOn: opening.date };
  return { state: 'open', deadline: next.date, quote: next.quote, daysLeft: daysBetween(today, next.date), estimatedDeadline: null };
}

/** Auditoría de una página. `compilation`/`judgment` son salidas ya validadas por contracts.v13 o null; `failure` explica por qué falta una. */
export function auditPage({ objective = 'grant', page, today, compilation = null, judgment = null, failure = {}, blind = false, window = null, criteriaIds = null, requireCall = false } = {}) {
  const now = todayIso(today); const text = String(page?.text || ''); const dated = hasDeadline(objective);
  const flags = []; const disagreements = []; const blockers = [];
  const base = { version: JUDGE_AUDIT_VERSION, objective, today: now, blind: Boolean(blind), compilerOk: Boolean(compilation), judgeOk: Boolean(judgment), compilerFailure: failure.compiler || null, judgeFailure: failure.judge || null };
  if (!judgment) {
    // Falla cerrado: sin juez no hay veredicto, ni estado, ni lista principal.
    return { ...base, state: 'unverified', deadline: null, deadlineQuote: '', daysLeft: null, estimatedDeadline: null, pageType: { judge: null, compiler: compilation?.page_type || null, agree: false }, dates: { judge: [], compiler: auditDates(compilation?.dates, text) }, criteria: {}, flags: ['judge_unavailable'], disagreements: [], blockers: [`Judge unavailable (${failure.judge || 'no answer'}): nothing verified by the second agent`], dropReason: null, mainOk: false };
  }
  const jDates = auditDates(judgment.dates, text).map((d) => pastOnly(d, text, now));
  const cDates = auditDates(compilation?.dates, text);
  for (const d of jDates) if (!d.verified && d.why !== 'no_date') flags.push(`date_${d.why}:${d.role}`);
  let st = stateFrom({ judgeType: judgment.page_type, compilerType: compilation?.page_type, judgeDates: jDates, compilerDates: cDates, today: now, dated });
  const criteria = auditCriteria(judgment, objective, text, flags, criteriaIds);
  // Sin plazo verificado, pero la página prueba que ya cerró: el juez dice «no» al plazo con una cita literal cuyas fechas son todas pasadas,
  // o el título lo marca como vencido. Nunca abre nada: solo puede cerrar.
  if (dated && st.state === 'unknown') {
    const dq = criteria.deadline; const qd = dq?.verdict === 'no' && dq.quoteOk ? datesIn(dq.quote) : [];
    const pastQuote = qd.length && qd.every((x) => x < now);
    const label = /^\s*(expired|closed|archived|inactive)\b/i.test(String(page?.title || ''));
    if (pastQuote || label) { st = { state: 'closed', deadline: pastQuote ? qd.sort().at(-1) : null, quote: pastQuote ? dq.quote : String(page.title), daysLeft: null, estimatedDeadline: null }; flags.push(pastQuote ? 'closed_by_deadline_quote' : 'closed_by_title'); }
  }

  // Desacuerdos: nunca suben a la lista principal.
  if (!compilation) disagreements.push(`Compiler unavailable (${failure.compiler || 'no answer'})`);
  else {
    if (pageClass(judgment.page_type, dated) !== pageClass(compilation.page_type, dated)) disagreements.push(`Page type: compiler ${compilation.page_type}, judge ${judgment.page_type}`);
    if (dated) {
      const a = uniqSorted(appDatesOf(cDates).map((d) => d.date)); const b = uniqSorted(appDatesOf(jDates).map((d) => d.date));
      if (a.join() !== b.join()) disagreements.push(`Application deadline: compiler ${a.join(', ') || 'none'}, judge ${b.join(', ') || 'none'}`);
      if (appDatesOf(cDates).some((d) => d.estimated) !== appDatesOf(jDates).some((d) => d.estimated) && a.length && b.length) disagreements.push('Estimated flag differs between compiler and judge');
    }
  }
  for (const [id, c] of Object.entries(criteria)) if (c.compiler === 'disagree') disagreements.push(`Criterion ${id}: the judge disagrees with the compiler`);
  const dl = criteria.deadline;
  if (dated && dl) {
    if (dl.verdict === 'yes' && st.state !== 'open') disagreements.push(`Judge says the deadline is open; dates audited as ${st.state}`);
    if (dl.verdict === 'no' && st.state === 'open') disagreements.push('Judge says the deadline is closed; dates audited as open');
  }

  // Razones de descarte: solo un «no» con cita literal en la página.
  const NO_TO_DROP = { eligibility: 'not_eligible', region: 'not_eligible', entity_type: 'not_eligible', stage: 'not_eligible', topic_fit: 'scope_mismatch', non_dilutive: 'equity_or_loan', official: 'not_official', recent_activity: 'scope_mismatch', contact_route: 'scope_mismatch' };
  const noWithQuote = Object.entries(criteria).find(([id, c]) => id !== 'deadline' && c.verdict === 'no' && c.quoteOk);
  const win = window && (window.from || window.to) ? { from: window.from || null, to: window.to || null } : null;
  const outsideWindow = Boolean(win && dated && (st.state === 'open' || st.state === 'upcoming') && st.deadline && ((win.from && st.deadline < win.from) || (win.to && st.deadline > win.to)));
  if (outsideWindow) flags.push('deadline_outside_window');
  let dropReason = st.state === 'closed' ? 'closed' : outsideWindow ? 'outside_window' : noWithQuote ? NO_TO_DROP[noWithQuote[0]] : null;
  // Modo «solo convocatorias» (motor GPT Researcher + juez): una página que el juez no pudo leer o que no es una convocatoria ni da plazo
  // no es un hallazgo; antes caía en «a verificar» y llenaba Watch con portadas, listados y páginas de programa sin fecha.
  if (requireCall && dated && !dropReason) {
    const known = Object.values(criteria).some((c) => c.verdict !== 'unknown') || jDates.some((d) => d.verified);
    if (!known) dropReason = 'too_short';
    else if (st.state === 'unknown' && !CALL_TYPES.has(judgment.page_type) && criteria.deadline?.verdict !== 'yes') dropReason = `not_a_call:${judgment.page_type || 'other'}`;
  }
  for (const [id, c] of Object.entries(criteria)) if (id !== 'deadline' && c.claimed === 'no' && c.verdict === 'unknown') blockers.push(`The judge says "no" for ${id} without a quote from the page`);

  const extraRequired = criteriaIds ? criteriaIds.filter((id) => ['non_dilutive', 'official', 'recent_activity', 'contact_route'].includes(id)) : [];
  const requiredYes = [...(dated ? ['eligibility', 'topic_fit'] : ['topic_fit']), ...extraRequired];
  for (const id of requiredYes) if (criteria[id]?.verdict !== 'yes') blockers.push(`${id === 'topic_fit' ? 'Topic fit' : 'Eligibility'} not confirmed by the judge with a quote from the page`);
  if (dated) {
    if (st.state === 'forecast') blockers.push(`Forecast notice: applications are not open yet${st.estimatedDeadline ? ` (estimated deadline ${st.estimatedDeadline})` : ''}`);
    else if (st.state === 'unknown') blockers.push('No application deadline verified on the page');
    else if (st.state === 'closed') blockers.push('All application deadlines on the page are before today');
    else if (st.state === 'upcoming') blockers.push(`Not open yet (opens ${st.opensOn})`);
    if (!CALL_TYPES.has(judgment.page_type)) blockers.push(`Judge reads the page as ${judgment.page_type}, not as a call`);
  }
  // Un plazo que el juez dio sin cita válida podría ser el que importa: no se ignora en silencio.
  if (dated && jDates.some((d) => d.role === 'application_deadline' && !d.verified && d.why !== 'no_date')) blockers.push('A deadline reported by the judge has no valid quote on the page');
  blockers.push(...disagreements);
  const mainOk = !dropReason && blockers.length === 0 && (!dated || st.state === 'open');
  return {
    ...base, state: st.state, deadline: st.deadline, deadlineQuote: st.quote, daysLeft: st.daysLeft, estimatedDeadline: st.estimatedDeadline, opensOn: st.opensOn || null,
    pageType: { judge: judgment.page_type, compiler: compilation?.page_type || null, agree: !compilation ? false : pageClass(judgment.page_type, dated) === pageClass(compilation.page_type, dated) },
    dates: { judge: jDates, compiler: cDates }, criteria, flags: [...new Set(flags)], disagreements, blockers, dropReason, mainOk, window: win,
  };
}

/** Lo que `verifyOpportunity` necesita para fijar estado y fecha desde la auditoría (null = no aplica o juez caído: estado desconocido). */
export function dateOverrideOf(audit) {
  if (!audit || audit.state === 'n/a') return null;
  const state = audit.state === 'unverified' ? 'unknown' : audit.state;
  return { state, deadline: audit.deadline, quote: audit.deadlineQuote, opensOn: audit.opensOn || null, reason: audit.state === 'unverified' ? 'Judge agent unavailable: no date verified' : `Audited reading of the judge agent: ${audit.state}${audit.deadline ? ` (${audit.deadline})` : audit.estimatedDeadline ? ` (estimated ${audit.estimatedDeadline})` : ''}` };
}

const OK_ELIGIBLE = { yes: 'yes', no: 'no', unknown: 'unclear' };
/** Registro con la forma de la lectura heredada (la que consume `verifyFinding`), armado con el compilador y los criterios YA auditados. */
export function legacyOut(compilation, audit) {
  const c = compilation || {}; const crit = audit?.criteria || {}; const el = c.eligibility || {};
  const noOne = ['eligibility', 'region', 'entity_type', 'stage'].map((id) => [id, crit[id]]).find(([, x]) => x?.verdict === 'no' && x.quoteOk);
  const elig = crit.eligibility;
  const eligible = noOne ? 'no' : elig ? OK_ELIGIBLE[elig.verdict] : 'unclear';
  const eligibleQuote = noOne ? noOne[1].quote : elig?.verdict === 'yes' ? elig.quote : '';
  const tf = crit.topic_fit;
  const judgeType = audit?.pageType?.judge || c.page_type || 'other';
  return {
    relevant: c.relevant !== false, kind: c.identity?.kind || '', name: c.identity?.name || '', official: c.official === true,
    status: 'unknown', deadline: null, eligible, non_dilutive: c.non_dilutive || 'unknown', money: c.money || 'unknown',
    amount: c.amount?.text || null, page_type: judgeType === 'forecast_notice' ? 'call' : judgeType,
    applicants: { entity_types: el.applicant_types || [], for_profit_allowed: el.for_profit_allowed || 'unknown', countries: el.countries || [], stage: el.stage || null },
    dates: (audit?.dates?.judge || []).map((d) => ({ label: d.role, date: d.date, quote: d.quote })),
    scope_fit: tf ? { verdict: tf.verdict === 'yes' ? 'fits' : tf.verdict === 'no' ? 'does_not_fit' : 'unclear', reason: tf.reason, funds_quote: tf.verdict === 'yes' ? tf.quote : null, excludes_quote: tf.verdict === 'no' ? tf.quote : null, work_type: 'other' } : undefined,
    summary: c.summary || '',
    quotes: { ...(c.identity?.quote ? { identity: c.identity.quote } : {}), ...(eligibleQuote ? { eligible: eligibleQuote } : {}), ...(c.how_to_apply_quote ? { how_to_apply: c.how_to_apply_quote } : {}) },
  };
}

/** Une el resultado de `verifyFinding(..., { dateOverride })` con la auditoría. El juez puede corregir fecha/estado, bajar de nivel o descartar con cita; nunca sube un caso que el resto del código no sostiene. */
export function applyAudit(v, audit) {
  const flags = new Set([...(v.flags || []), ...(audit.flags || []).map((f) => `judge:${f}`)]);
  let drop = v.drop || audit.dropReason || null;
  const reasons = [...(v.reasons || [])];
  if (drop && !reasons.includes(drop)) reasons.unshift(drop);
  const blockers = [...new Set([...(v.blockers || []), ...(audit.blockers || [])])];
  const tier = drop ? 'drop' : v.tier === 'main' && audit.mainOk ? 'main' : 'verify';
  const forecast = audit.state === 'forecast';
  return {
    ...v, keep: !drop, drop, tier, verdict: tier === 'drop' ? 'skip' : tier === 'main' ? 'apply' : 'watch', flags: [...flags], reasons, blockers,
    ...(forecast ? { forecast: true, estimatedDeadline: audit.estimatedDeadline } : {}), judge: audit,
  };
}

/** Configuración del modo juez: bandera, roles listos y aviso visible. */
export function judgeMode(env = process.env, fleet = null) {
  const on = String(env.ENGINE_JUDGE || '') === '1';
  if (!on) return { on: false, ready: false, notice: null };
  const roles = fleet?.roles || {};
  const missing = ['compiler', 'judge'].filter((r) => !roles[r]?.ready);
  return missing.length
    ? { on: true, ready: false, missing, notice: `ENGINE_JUDGE=1 but the role(s) ${missing.join(', ')} are not configured: the current behaviour is used and no page is checked by the compiler/judge agents` }
    : { on: true, ready: true, blind: String(env.ENGINE_JUDGE_BLIND || '') === '1', sameModel: roles.compiler.model === roles.judge.model && roles.compiler.url === roles.judge.url, notice: null };
}

const clip = (v, n = 220) => String(v || '').slice(0, n);
/** Lo que se guarda por página en la traza / Run audit: modelos, veredicto por criterio, citas, desacuerdos, tiempo y llamadas. */
export function slimJudge(jr) {
  const a = jr.audit || {};
  const dates = (list) => (list || []).slice(0, 12).map((d) => ({ role: d.role, date: d.date, estimated: d.estimated, verified: d.verified, why: d.why, quote: clip(d.quote) }));
  return {
    version: a.version, blind: Boolean(jr.blind), judgeSawClaims: Boolean(jr.judgeSawClaims), models: jr.models, failure: jr.failure,
    calls: { compiler: 1, judge: 1 }, ms: jr.ms,
    state: a.state, deadline: a.deadline || null, estimatedDeadline: a.estimatedDeadline || null, opensOn: a.opensOn || null, daysLeft: a.daysLeft ?? null, mainOk: Boolean(a.mainOk), dropReason: a.dropReason || null,
    pageType: a.pageType || null, dates: { compiler: dates(a.dates?.compiler), judge: dates(a.dates?.judge) },
    criteria: Object.fromEntries(Object.entries(a.criteria || {}).map(([k, c]) => [k, { verdict: c.verdict, claimed: c.claimed, quote: clip(c.quote), reason: clip(c.reason, 200), compiler: c.compiler }])),
    disagreements: a.disagreements || [], flags: a.flags || [], blockers: (a.blockers || []).slice(0, 8),
  };
}
