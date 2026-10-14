import { applicationRoute, isProgramContact } from './applicationRoute.mjs';
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const unique = (items) => [...new Set(items.map(clean).filter(Boolean))];

/**
 * Produce consultas separadas para discovery de grants. La geografía y las
 * prioridades públicas se buscan como ejes independientes: no se añaden todas
 * a una sola frase restrictiva que pueda devolver cero resultados.
 */
export function grantQueries(brief, plan) {
  const topics = unique([
    plan.topic,
    ...(plan.terms || []).map((item) => item.term),
    ...String(brief.criteria || '').split(/[,;\n]/),
  ]).slice(0, 6);
  const geographies = unique(String(brief.geography || '').split(/[,;\/\n]/)).filter((x) => !/^(global|worldwide|international)$/i.test(x)).slice(0, 3);
  const queries = topics.map((query) => ({ query, dimension: 'topic', label: query }));
  for (const geography of geographies) {
    for (const topic of topics.slice(0, 2)) {
      queries.push({ query: `${topic} ${geography}`, dimension: 'geography', label: geography });
    }
  }
  return queries.slice(0, 8);
}

/** Round-robin por agencia para no gastar todo el presupuesto de lectura en el primer organismo. */
export function diversifyGrantHits(hits, limit = 16) {
  const groups = new Map();
  for (const hit of hits) {
    const key = clean(hit.agency || 'unknown');
    if (!groups.has(key)) groups.set(key, []);
    if (!groups.get(key).some((x) => x.id === hit.id)) groups.get(key).push(hit);
  }
  const out = [];
  let round = 0;
  while (out.length < limit) {
    let added = false;
    for (const group of groups.values()) if (group[round] && out.length < limit) { out.push(group[round]); added = true; }
    if (!added) break;
    round++;
  }
  return out;
}

export function finalizeSearchAudit(rows = [], leads = []) {
  return rows.map((row) => {
    const matched = leads.filter((lead) => (lead.foundBy || []).some((x) => x.provider === row.provider && x.query === row.query));
    return { ...row, discovered: row.discovered ?? matched.length, priority: matched.filter((x) => x.bucket === 'top').length, watch: matched.filter((x) => x.bucket === 'radar').length, discarded: matched.filter((x) => x.bucket === 'discarded').length };
  });
}

const questionFor = (lead, brief) => {
  // Solo si la convocatoria publica un contacto de programa/científico; nunca a un helpdesk técnico.
  if (!isProgramContact(lead.contact, lead)) return null;
  const venture = brief.venture || brief.company || 'our organization';
  const unresolved = lead.eligibility?.questions?.[0] || lead.missing?.[0];
  if (!unresolved) return null;
  return `Before we prepare an application for ${venture}, could you clarify: ${String(unresolved).replace(/[.?]+$/, '')}?`;
};

/** Convierte una convocatoria en una ficha de trabajo; no es un correo de fundraising. */
export function grantPlan(lead, brief = {}, today = new Date()) {
  if (lead.fundingType !== 'grant' || lead.kind !== 'opportunity') return null;
  const forecast = ['forecast', 'forecasted'].includes(String(lead.status || '').toLowerCase()) || lead.registry?.status === 'forecasted' || lead.registry?.isForecast === true;
  const estimatedDeadline = forecast ? (lead.estimatedDeadline || lead.registry?.forecastClose || null) : null;
  const todayIso = (today instanceof Date ? today : new Date(`${today}T12:00:00Z`)).toISOString().slice(0, 10);
  const estimatedDatePassed = Boolean(estimatedDeadline && estimatedDeadline < todayIso);
  const apply = applicationRoute(lead, brief, today);
  const portal = apply.portal?.name || 'the official program page';
  const firstStep = apply.steps.find((x) => !x.skip)?.label;
  const verdict = lead.eligibility?.verdict;
  const closed = !forecast && (lead.status === 'closed' || lead.eligibility?.closed === true || (lead.daysToDeadline != null && lead.daysToDeadline < 0));
  const urgent = !forecast && lead.daysToDeadline != null && lead.daysToDeadline < Math.max(14, Number(brief.minDays) || 30);
  let state = 'eligibility_review';
  let decision = 'review';
  let label = 'Review eligibility';
  let nextAction = `Check eligibility in the official notice, then apply on ${portal}. First step: ${firstStep || 'read the notice'}.`;
  if (lead.grantMatch?.verdict === 'mismatch') {
    state = 'not_pursuing'; decision = 'no_go'; label = 'Not a match';
    nextAction = 'Do not draft: the official call funds something else. Archive it.';
  } else if (closed || verdict === '✖') {
    state = 'not_pursuing'; decision = 'no_go'; label = 'Do not pursue';
    nextAction = closed ? 'Archive this cycle and monitor the program for the next notice.' : 'Record the blocking eligibility rule and do not start an application.';
  } else if (forecast) {
    state = 'watching'; decision = 'watch'; label = 'Watch';
    nextAction = estimatedDatePassed
      ? 'Estimated date already passed. Monitor for a revised or posted notice; do not start an application.'
      : `Monitor the forecast and prepare only reusable evidence until the official notice is posted${estimatedDeadline ? ` (estimated due date ${estimatedDeadline})` : ''}.`;
  } else if (apply.verdict === 'not_feasible') {
    state = 'watching'; decision = 'watch'; label = 'Next cycle';
    nextAction = `Not reachable for ${lead.deadline}: ${apply.message}${apply.nextDeadline ? '' : ' Watch for the next cycle.'} Start now: ${firstStep || 'confirm the steps on the official page'}.`;
  } else if (apply.verdict === 'tight') {
    state = 'decision_needed'; decision = 'conditional_go'; label = 'Tight deadline';
    nextAction = `${apply.message} Decide now; if you go, start today: ${firstStep || 'confirm the steps on the official page'}.`;
  } else if (verdict === '✔' && !urgent) {
    state = 'preparing'; decision = 'go'; label = 'Prepare application';
    nextAction = `Apply on ${portal}. Assign an owner and work backward from the deadline, starting with: ${firstStep || 'the application package'}.`;
  } else if (urgent) {
    state = 'decision_needed'; decision = 'conditional_go'; label = 'Urgent decision';
    nextAction = 'Make a go/no-go decision now; the remaining lead time is below your minimum.';
  }
  if (decision !== 'no_go' && lead.grantMatch?.verdict === 'weak') { state = 'eligibility_review'; decision = 'review'; label = 'Check topic fit'; nextAction = `${lead.grantMatch.summary} Confirm against the official objective before any draft.`; }
  const checklist = [
    { key: 'topic_fit', label: 'Topic matches the official objective', done: lead.grantMatch ? lead.grantMatch.verdict === 'match' : false },
    { key: 'official_notice', label: 'Official notice identified', done: Boolean(lead.externalId && lead.evidence?.some((e) => e.field === 'opportunity')) },
    { key: 'deadline', label: 'Deadline confirmed', done: Boolean(lead.deadline) },
    { key: 'eligibility', label: 'Eligibility resolved', done: verdict === '✔' },
    { key: 'budget', label: 'Award ceiling confirmed', done: Number(lead.amount) > 0 },
    { key: 'feasible', label: apply.verdict === 'feasible' ? 'Enough time for the required steps' : `Time for the required steps (~${apply.leadDays} days)`, done: apply.verdict === 'feasible' },
    ...apply.steps.filter((x) => !x.skip && x.days > 0).map((x) => ({ key: `step_${x.key}`, label: `${x.label} (~${x.days} days)`, done: false })),
  ];
  return {
    state, decision, label, nextAction, checklist,
    programNumber: /^web-opportunity:/.test(lead.externalId || '') ? null : (lead.externalId || null),
    agency: lead.org || null,
    deadline: forecast ? null : (lead.deadline || null),
    daysToDeadline: forecast ? null : (lead.daysToDeadline ?? null),
    estimatedDeadline,
    estimatedDatePassed,
    policyThemes: unique((lead.foundBy || []).map((x) => x.term || x.query)).slice(0, 5),
    geography: brief.geography || null,
    contactQuestion: questionFor(lead, brief),
    apply,
  };
}

export function attachGrantPlans(leads, brief) {
  return leads.map((lead) => {
    const plan = grantPlan(lead, brief);
    if (!plan) return lead;
    // Una convocatoria que ya cerró o tiene una regla que la excluye no puede quedar como prioridad.
    if (plan.decision === 'no_go' && lead.bucket !== 'discarded') {
      const passed = lead.daysToDeadline != null && lead.daysToDeadline < 0;
      const why = lead.grantMatch?.verdict === 'mismatch' ? lead.grantMatch.summary : passed ? `Closed: the deadline${lead.deadline ? ` (${lead.deadline})` : ''} has passed.`
        : lead.status === 'closed' || lead.eligibility?.closed === true ? 'Closed: the program is not accepting applications.'
        : lead.eligibility?.blocking ? `Not eligible: ${lead.eligibility.blocking.why}${lead.eligibility.blocking.quote ? ` (“${String(lead.eligibility.blocking.quote).slice(0, 160)}”)` : ''}`
        : 'Not eligible: a blocking rule in the official notice excludes ' + (brief.venture || brief.company || 'this venture') + '.';
      return { ...lead, bucket: 'discarded', discard: lead.discard || why, grantPlan: plan };
    }
    return { ...lead, grantPlan: plan };
  });
}
