const DEFAULT_ENDPOINT = 'https://jevmodel.net/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const bounded = (value, max = 600) => String(value || '').slice(0, max);

function endpointFor(env) {
  const value = env.JEV_API_URL || DEFAULT_ENDPOINT;
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('JEV_API_URL must use HTTPS.');
  return url.href;
}

/**
 * Jev only receives the smallest public/professional state needed for triage.
 * Free-form notes, contact details, user identity and private network data are omitted.
 */
export function jevState(leads, brief) {
  return {
    objective: {
      venture: bounded(brief.venture || brief.company, 160),
      product: bounded(brief.product, 200),
      industry: bounded(brief.industry, 200),
      stage: bounded(brief.stage, 80),
      geography: bounded(brief.geography, 120),
      funding_types: (brief.fundingTypes || []).slice(0, 5),
    },
    candidates: leads.map((lead, index) => ({
      ref: `candidate_${index}`,
      person: bounded(lead.person, 160) || null,
      role: bounded(lead.role, 180) || null,
      organization: bounded(lead.org, 180),
      title: bounded(lead.title, 280),
      funding_type: bounded(lead.fundingType, 40),
      status: bounded(lead.status, 40),
      deterministic_score: Number(lead.score) || 0,
      verified_evidence: (lead.evidence || [])
        .filter((item) => item.verified)
        .slice(0, 5)
        .map((item) => ({ source: bounded(item.source, 100), field: bounded(item.field, 60), quote: bounded(item.quote, 500) })),
      known_gaps: (lead.missing || []).slice(0, 8).map((item) => bounded(item, 180)),
    })),
  };
}

export function jevQuestions(count) {
  const questions = {};
  for (let index = 0; index < count; index++) {
    const ref = `candidate_${index}`;
    questions[`${ref}_action`] = {
      type: 'choice',
      instructions: {
        candidate_ref: ref,
        question: 'What is the safest next research action for this candidate, using only documented evidence?',
      },
      criteria: {
        prioritize: 'Strong documented fit with the objective; enough evidence to place in the priority list.',
        investigate_more: 'Potential fit, but important mandate, eligibility, role, timing, or evidence is missing.',
        discard: 'Documented evidence clearly conflicts with the objective or requested funding type.',
      },
    };
    questions[`${ref}_fit`] = {
      type: 'score',
      instructions: {
        candidate_ref: ref,
        question: 'Rate the documented strategic fit for the stated objective. Do not assume facts absent from the evidence.',
      },
      criteria: [
        'No documented fit',
        'Weak or mostly adjacent fit',
        'Plausible fit with material gaps',
        'Strong documented fit',
        'Exceptional and directly documented fit',
      ],
    };
    questions[`${ref}_evidence`] = {
      type: 'noul',
      instructions: {
        candidate_ref: ref,
        question: 'Is the documented evidence sufficient to show this candidate to a human as actionable, without claiming they will invest, partner, or make an introduction?',
      },
      criteria: {
        true: 'The identity or opportunity and its relevant role, mandate, or eligibility are directly supported by current public evidence.',
        false: 'The fit depends on inference, missing mandate or eligibility, unclear identity, stale information, or unsupported assumptions.',
      },
    };
  }
  return questions;
}

const answersFrom = (body) => body?.result?.answers || body?.answers;

export async function askJev(leads, brief, {
  env = process.env,
  fetcher = fetch,
  signal,
} = {}) {
  const apiKey = env.JEV_API_KEY || env.TYPESAFE_API_KEY;
  if (!apiKey) return { configured: false, decisions: [], model: null, usage: null };
  const max = Math.max(1, Math.min(30, Number(env.JEV_MAX_CANDIDATES) || 15));
  const selected = leads.filter((lead) => lead.bucket !== 'discarded').slice(0, max);
  if (!selected.length) return { configured: true, decisions: [], model: env.JEV_MODEL || DEFAULT_MODEL, usage: null };
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1000, Number(env.JEV_TIMEOUT_MS) || 20000))])
    : AbortSignal.timeout(Math.max(1000, Number(env.JEV_TIMEOUT_MS) || 20000));
  const payload = {
    model: env.JEV_MODEL || DEFAULT_MODEL,
    state: jevState(selected, brief),
    questions: jevQuestions(selected.length),
  };
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetcher(endpointFor(env), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: requestSignal,
    });
    if (![429, 529].includes(response.status) || attempt === 2) break;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 250 * 2 ** attempt);
      requestSignal.addEventListener('abort', () => { clearTimeout(timer); reject(requestSignal.reason); }, { once: true });
    });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Jev returned ${response.status}${body?.error?.message ? `: ${bounded(body.error.message, 180)}` : ''}`);
  const answers = answersFrom(body);
  if (!answers || typeof answers !== 'object') throw new Error('Jev didn\'t return structured answers.');
  const decisions = selected.map((lead, index) => {
    const ref = `candidate_${index}`;
    const action = answers[`${ref}_action`] || {};
    const fit = answers[`${ref}_fit`] || {};
    const evidence = answers[`${ref}_evidence`] || {};
    const choice = ['prioritize', 'investigate_more', 'discard'].includes(action.choice) ? action.choice : 'investigate_more';
    return {
      leadId: lead.id,
      action: choice,
      actionConfidence: clamp01(action.confidence),
      actionProbabilities: Object.fromEntries(Object.entries(action.probabilities || {}).map(([key, value]) => [key, clamp01(value)])),
      strategicFit: Math.max(0, Math.min(4, Number(fit.score) || 0)),
      fitConfidence: clamp01(fit.confidence),
      evidenceSufficient: clamp01(evidence.noul),
    };
  });
  return { configured: true, decisions, model: body.model || payload.model, usage: body.usage || body.result?.usage || null };
}

export function applyJevDecisions(leads, result) {
  const decisions = new Map((result?.decisions || []).map((decision) => [decision.leadId, decision]));
  const routed = leads.map((lead) => {
    const decision = decisions.get(lead.id);
    if (!decision) return lead;
    let bucket = lead.bucket;
    const needsReview = decision.action === 'investigate_more'
      || decision.actionConfidence < 0.55
      || decision.evidenceSufficient < 0.65
      || decision.action === 'discard';
    // Jev may lower an otherwise eligible lead to review, but never overrides hard
    // deterministic exclusions and never autonomously deletes a candidate.
    if (lead.bucket === 'top' && needsReview) bucket = 'radar';
    const reason = decision.action === 'discard'
      ? 'Jev suggests discarding; needs human review first.'
      : decision.action === 'investigate_more'
        ? 'Jev recommends more evidence before prioritizing.'
        : decision.evidenceSufficient < 0.65
          ? 'Jev found insufficient evidence; needs review.'
          : null;
    return {
      ...lead,
      bucket,
      missing: reason ? [...new Set([...(lead.missing || []), reason])] : lead.missing,
      jev: { ...decision, model: result.model },
    };
  });
  const ranks = { top: 0, radar: 0, discarded: 0 };
  return routed
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((lead) => ({ ...lead, rank: ++ranks[lead.bucket] }));
}
