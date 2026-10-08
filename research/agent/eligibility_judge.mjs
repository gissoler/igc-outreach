/**
 * Aplica reglas y consolida juicios de elegibilidad.
 * Nunca convierte evidencia ausente en una afirmación.
 * Contratos: evidence/1, judgment/1 y criteria_catalog/1.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { render, sanitizePageText } from './prompts.mjs';
import { validate } from './contracts.mjs';

const getValue = (profile, path) => profile.fields?.[path]?.value;

/**
 * Limita el juez a las entidades prioritarias en orden estable.
 * Puro respecto de red, disco y reloj.
 * @param {object[]} entities Entidades consolidadas.
 * @param {number} max Máximo de entidades que puede juzgar.
 * @returns {object[]} Entidades seleccionadas.
 */
export function selectForJudging(entities, max) {
  return [...entities]
    .sort((left, right) => (
      Number(right.official) - Number(left.official) ||
      left.first_seen.search_index - right.first_seen.search_index ||
      left.first_seen.order - right.first_seen.order
    ))
    .slice(0, max);
}

/**
 * Evalúa criterios deterministas sin delegarlos al modelo.
 * Puro respecto de red, disco y reloj.
 * @param {string} id Identificador del criterio.
 * @param {object} input Vigencia, fecha, perfil y ruta.
 * @returns {'met'|'not_met'|'unknown'} Estado calculado.
 */
export function codeEval(id, { validity, today, profile, route }) {
  if (id === 'G-STATUS') {
    if (['closed', 'awarded'].includes(validity.status)) return 'not_met';
    if (
      ['open', 'rolling', 'upcoming'].includes(validity.status) ||
      (validity.closes_on && validity.closes_on >= today)
    ) return 'met';
    return 'unknown';
  }
  if (id === 'P-TIMELINE') {
    if (validity.status === 'rolling') return 'met';
    if (!validity.closes_on) return 'unknown';
    const days = (
      Date.parse(`${validity.closes_on}T00:00:00Z`) -
      Date.parse(`${today}T00:00:00Z`)
    ) / 864e5;
    return days >= Number(getValue(profile, 'preferences.min_prep_days') ?? 21) ? 'met' : 'not_met';
  }
  if (id === 'P-ROUTE') {
    const accepted = getValue(profile, 'funding.routes_accepted');
    if (!route || !accepted) return 'unknown';
    return accepted.includes(route) ? 'met' : 'not_met';
  }
  return 'unknown';
}

function applyEvidenceRules(state, evidenceIds, criterion, context, overrides) {
  const validIds = evidenceIds.filter(value => context.entityEvidenceIds.has(value));
  if (validIds.length !== evidenceIds.length) overrides.push('R7_foreign_evidence');
  if (['met', 'not_met'].includes(state) && !validIds.length) {
    state = 'unknown';
    overrides.push('R1_no_evidence');
  }
  if (state === 'conflict' && validIds.length < 2) {
    state = 'unknown';
    overrides.push('R2_conflict_needs_two');
  }
  const unknownProfile = (criterion.profile_fields || []).some(path => getValue(context.profile, path) == null);
  if (['met', 'not_met'].includes(state) && unknownProfile) {
    state = 'unknown';
    overrides.push('R3_profile_unknown');
  }
  if (state === 'not_applicable' && criterion.applicability === 'always') {
    state = 'unknown';
    overrides.push('R4a_na_forbidden');
  }
  if (state === 'not_applicable' && !validIds.length && !context.hasOfficialCallDoc) {
    state = 'unknown';
    overrides.push('R4b_na_needs_call_text');
  }
  return { state, evidenceIds: validIds };
}

/**
 * Reaplica R1–R7 y garantiza que ausencia o evidencia inválida no produzcan met.
 * Puro respecto de red, disco y reloj.
 * @param {object} raw Respuesta del modelo.
 * @param {object} context Entidad, evidencia, perfil, catálogo, fecha y ruta.
 * @returns {object[]} Estados finales con overrides auditables.
 */
export function applyRules(raw, context) {
  const rawById = new Map((raw?.criteria || []).map(item => [item.criterion_id, item]));
  const definitions = [...context.catalogById.values(), ...context.reqCriteria];
  return definitions.map(criterion => {
    const answer = rawById.get(criterion.criterion_id);
    let state = answer?.state ?? 'unknown';
    let llmState = answer?.state ?? null;
    let evidenceIds = [...(answer?.evidence_ids || [])];
    const overrides = [];
    if (criterion.evaluator === 'code') {
      state = codeEval(criterion.criterion_id, {
        validity: context.entity.validity,
        today: context.today,
        profile: context.profile,
        route: context.route,
      });
      llmState = null;
      evidenceIds = [];
      overrides.push('R5_code_criterion');
    } else if (!answer) {
      state = 'unknown';
      overrides.push('R6_missing_answer');
    }
    if (criterion.evaluator !== 'code') {
      const ruled = applyEvidenceRules(state, evidenceIds, criterion, context, overrides);
      state = ruled.state;
      evidenceIds = ruled.evidenceIds;
    }
    return {
      criterion_id: criterion.criterion_id,
      kind: criterion.kind,
      evaluator: criterion.evaluator,
      state,
      llm_state: llmState,
      evidence_ids: evidenceIds,
      evidence_dates: [],
      rationale: answer?.rationale || '',
      overrides,
    };
  });
}

/**
 * Resume estados duros y blandos sin ocultar conflictos o desconocidos.
 * Puro respecto de red, disco y reloj.
 * @param {object[]} criteria Criterios después de aplicar reglas.
 * @param {string|null} route Ruta propuesta por el juez.
 * @returns {object} Agregado usado por ranking y abstención.
 */
export function aggregate(criteria, route) {
  const hard = criteria.filter(criterion => criterion.kind === 'hard');
  const ids = state => hard.filter(criterion => criterion.state === state).map(criterion => criterion.criterion_id);
  const soft = criteria.filter(criterion => (
    criterion.kind === 'soft' && criterion.state !== 'not_applicable'
  ));
  const hard_not_met = ids('not_met');
  const hard_conflict = ids('conflict');
  const hard_unknown = ids('unknown');
  const eligibility_class = hard_not_met.length
    ? 'ineligible'
    : hard_conflict.length
      ? 'conflict'
      : hard_unknown.length
        ? 'eligible_pending'
        : 'eligible';
  const metSoft = soft.filter(criterion => criterion.state === 'met').length;
  const soft_score = Number((soft.length ? metSoft / soft.length : 0).toFixed(4));
  const state = id => criteria.find(criterion => criterion.criterion_id === id)?.state;
  const recommendable = ['eligible', 'eligible_pending'].includes(eligibility_class) &&
    state('G-SCOPE') === 'met' &&
    state('G-STATUS') === 'met' &&
    route != null &&
    route !== 'not_actionable';
  return {
    eligibility_class,
    hard_not_met,
    hard_conflict,
    hard_unknown,
    soft_score,
    recommendable,
  };
}

function requestData(entity, evidence, profile, catalog, today, config) {
  const reqIds = [...new Set(
    evidence.filter(item => item.criterion_id.startsWith('REQ-')).map(item => item.criterion_id),
  )].sort((left, right) => Number(left.slice(4)) - Number(right.slice(4))).slice(0, 8);
  const reqCriteria = reqIds.map(id => ({
    criterion_id: id,
    label: evidence.find(item => item.criterion_id === id)?.requirement_summary || id,
    kind: 'hard',
    evaluator: 'llm',
    applicability: 'conditional',
    profile_fields: [],
  }));
  const chosen = [...evidence].sort((left, right) => (
    Number(right.official) - Number(left.official) ||
    Number(right.binding) - Number(left.binding) ||
    left.step - right.step
  )).slice(0, config.judge.max_evidence_per_opportunity);
  const profileJson = Object.fromEntries(
    Object.entries(profile.fields).map(([key, value]) => [key, value.value ?? 'UNKNOWN']),
  );
  const criteria = [...catalog.criteria.filter(item => item.evaluator === 'llm'), ...reqCriteria].map(item => ({
    criterion_id: item.criterion_id,
    label: item.label,
    kind: item.kind,
    applicability: item.applicability,
    guidance: item.guidance,
    ...(item.requirement_text ? { requirement_text: item.requirement_text } : {}),
  }));
  const evidenceJson = chosen.map(item => ({
    evidence_id: item.evidence_id,
    criterion_id: item.criterion_id,
    official: item.official,
    url: item.url,
    retrieved_at: item.retrieved_at,
    quote: `<page_data>${sanitizePageText(item.quote)}</page_data>`,
  }));
  return { reqCriteria, profileJson, criteria, evidenceJson, today, entity };
}

function judgeUser(prompt, data) {
  return render(prompt.user, {
    today: data.today,
    profile_json: data.profileJson,
    opportunity_json: {
      name: data.entity.name,
      issuer: data.entity.issuer,
      official: data.entity.official,
      validity: {
        status: data.entity.validity.status,
        opens_on: data.entity.validity.opens_on,
        closes_on: data.entity.validity.closes_on,
        deadline_label: data.entity.validity.deadline_label,
      },
      instrument: data.entity.instrument,
      amount_text: data.entity.amount_text,
    },
    criteria_json: data.criteria,
    evidence_json: data.evidenceJson,
  });
}

function failedCall() {
  return {
    tokens: {
      prompt: 0,
      completion: 0,
      total: 0,
      nominal_total: 0,
      estimated: false,
      cached: false,
    },
    latency: { actual_ms: 0, nominal_ms: 0 },
  };
}

/**
 * Juzga una entidad y conserva un resultado válido aun cuando falle el modelo.
 * Efectos: realiza una llamada LLM mediante la dependencia inyectada.
 * Excepción de 60 líneas: ensambla el contrato judgment/1 completo para validarlo una sola vez.
 * @param {object} input Entidad, evidencia, documentos, perfil, catálogo y configuración.
 * @returns {Promise<object>} Judgment validado con metadatos estables.
 */
export async function judgeEntity({ entity, evidence, docs, profile, catalog, llm, prompt, today, config }) {
  const data = requestData(entity, evidence, profile, catalog, today, config);
  const user = judgeUser(prompt, data);
  let call;
  let raw;
  let error = null;
  try {
    call = await llm.call({
      promptRef: prompt,
      system: prompt.system,
      user,
      schemaName: 'judge_output',
      temperature: config.temperatures.judge,
      seed: 0,
      maxTokens: config.max_tokens.judge,
      meta: {
        promptId: 'eligibility_judge',
        stable_id: entity.stable_id,
        profile_id: profile.profile_id,
      },
    });
    raw = call.json;
  } catch (caught) {
    error = caught;
    call = failedCall();
    raw = { criteria: [], route: null, route_rationale: '' };
  }
  const criteria = applyRules(raw, {
    entity,
    entityEvidenceIds: new Set(evidence.map(item => item.evidence_id)),
    hasOfficialCallDoc: docs.some(doc => doc.official && doc.page_type === 'call'),
    profile,
    catalogById: new Map(catalog.criteria.map(item => [item.criterion_id, item])),
    reqCriteria: data.reqCriteria,
    today,
    route: raw.route,
  });
  for (const criterion of criteria) {
    criterion.evidence_dates = criterion.evidence_ids
      .map(id => evidence.find(item => item.evidence_id === id)?.retrieved_at)
      .filter(Boolean);
  }
  const computed = aggregate(criteria, raw.route);
  const aggregateResult = error
    ? { ...computed, eligibility_class: 'unjudged', recommendable: false }
    : computed;
  const stableTokens = { ...call.tokens, total: call.tokens.nominal_total, cached: false };
  const stableLatency = {
    actual_ms: call.latency.nominal_ms,
    nominal_ms: call.latency.nominal_ms,
  };
  return validate('judgment', {
    schema_version: 'judgment/1',
    stable_id: entity.stable_id,
    profile_id: profile.profile_id,
    as_of: today,
    criteria,
    route: raw.route,
    route_rationale: raw.route_rationale,
    aggregate: aggregateResult,
    judge_call: {
      ok: !error,
      tokens: stableTokens,
      latency: stableLatency,
      prompt: { id: prompt.id, version: prompt.version, sha256: prompt.sha256 },
      error: error ? { code: error.code || 'LLM_HTTP', message: error.message.slice(0, 300) } : null,
    },
  });
}
