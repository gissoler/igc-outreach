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
  const venture = brief.venture || brief.company || 'our organization';
  const unresolved = lead.eligibility?.questions?.[0] || lead.missing?.[0];
  if (!unresolved) return null;
  return `Before we prepare an application for ${venture}, could you clarify: ${String(unresolved).replace(/[.?]+$/, '')}?`;
};

/** Convierte una convocatoria en una ficha de trabajo; no es un correo de fundraising. */
export function grantPlan(lead, brief = {}) {
  if (lead.fundingType !== 'grant' || lead.kind !== 'opportunity') return null;
  const verdict = lead.eligibility?.verdict;
  const closed = lead.status === 'closed' || lead.eligibility?.closed === true || (lead.daysToDeadline != null && lead.daysToDeadline < 0);
  const forecast = lead.status === 'forecasted';
  const urgent = lead.daysToDeadline != null && lead.daysToDeadline < Math.max(14, Number(brief.minDays) || 30);
  let state = 'eligibility_review';
  let decision = 'review';
  let label = 'Review eligibility';
  let nextAction = 'Resolve the eligibility questions against the official notice before investing time in a draft.';
  if (closed || verdict === '✖') {
    state = 'not_pursuing'; decision = 'no_go'; label = 'Do not pursue';
    nextAction = closed ? 'Archive this cycle and monitor the program for the next notice.' : 'Record the blocking eligibility rule and do not start an application.';
  } else if (forecast) {
    state = 'watching'; decision = 'watch'; label = 'Watch';
    nextAction = 'Monitor the forecast and prepare only the reusable evidence until the official notice is posted.';
  } else if (verdict === '✔' && !urgent) {
    state = 'preparing'; decision = 'go'; label = 'Prepare application';
    nextAction = 'Assign an owner, confirm the application package, and work backward from the deadline.';
  } else if (urgent) {
    state = 'decision_needed'; decision = 'conditional_go'; label = 'Urgent decision';
    nextAction = 'Make a go/no-go decision now; the remaining lead time is below your minimum.';
  }
  const checklist = [
    { key: 'official_notice', label: 'Official notice identified', done: Boolean(lead.externalId && lead.evidence?.some((e) => e.field === 'opportunity')) },
    { key: 'deadline', label: 'Deadline confirmed', done: Boolean(lead.deadline) },
    { key: 'eligibility', label: 'Eligibility resolved', done: verdict === '✔' },
    { key: 'budget', label: 'Award ceiling confirmed', done: Number(lead.amount) > 0 },
    { key: 'contact', label: 'Official contact or application channel confirmed', done: Boolean(lead.contact) },
  ];
  return {
    state, decision, label, nextAction, checklist,
    programNumber: /^web-opportunity:/.test(lead.externalId || '') ? null : (lead.externalId || null),
    agency: lead.org || null,
    deadline: lead.deadline || null,
    daysToDeadline: lead.daysToDeadline ?? null,
    policyThemes: unique((lead.foundBy || []).map((x) => x.term || x.query)).slice(0, 5),
    geography: brief.geography || null,
    contactQuestion: questionFor(lead, brief),
  };
}

export function attachGrantPlans(leads, brief) {
  return leads.map((lead) => {
    const plan = grantPlan(lead, brief);
    if (!plan) return lead;
    // Una convocatoria que ya cerró o tiene una regla que la excluye no puede quedar como prioridad.
    if (plan.decision === 'no_go' && lead.bucket !== 'discarded') {
      const passed = lead.daysToDeadline != null && lead.daysToDeadline < 0;
      const why = passed ? `Closed: the deadline${lead.deadline ? ` (${lead.deadline})` : ''} has passed.`
        : lead.status === 'closed' || lead.eligibility?.closed === true ? 'Closed: the program is not accepting applications.'
        : 'Not eligible: a blocking rule in the official notice excludes Mentiva.'.replace('Mentiva', brief.venture || brief.company || 'this venture');
      return { ...lead, bucket: 'discarded', discard: lead.discard || why, grantPlan: plan };
    }
    return { ...lead, grantPlan: plan };
  });
}
