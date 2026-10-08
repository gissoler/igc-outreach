/**
 * Define las tres políticas experimentales y sus utilidades deterministas.
 * No busca, descarga ni llama modelos directamente: delega esas operaciones al núcleo.
 * Contratos: planner_output/1 y las entradas ya validadas de run_config/1.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { norm } from '../server/research/core.mjs';

/**
 * Materializa las consultas estáticas de grants sin repetir equivalentes normalizados.
 * Puro respecto de red, disco y reloj.
 * @param {object} profile
 * @param {object} data
 * @param {string} today
 * @returns {Array<{template_id:string, query:string}>}
 */
export function b0Queries(profile, data, today) {
  const fields = profile.fields;
  const value = key => fields[key]?.value;
  const work = {
    basic_research: 'basic research',
    applied_research: 'applied research',
    data_or_software_infrastructure: 'data infrastructure',
    product_development: 'product development',
    clinical: 'clinical research',
    training: 'training',
    other: null,
  }[value('project.work_type')];
  const entity = {
    for_profit: 'small business',
    nonprofit: 'nonprofit',
    academic: 'university',
    government: 'public agency',
    individual: 'individual',
  }[value('applicant.entity_type')] ?? null;
  const countryCode = value('applicant.country');
  const variables = {
    sector: value('project.sector')?.[0] ?? null,
    sector2: value('project.sector')?.[1] ?? null,
    work,
    entity,
    country: countryCode == null ? null : (data.COUNTRY_NAMES[countryCode] || countryCode),
    region: value('applicant.region'),
    year: String(today).slice(0, 4),
  };
  const seen = new Set();
  const queries = [];
  for (const template of data.templates) {
    if (template.requires && Object.entries(template.requires).some(([key, allowed]) => !allowed.includes(value(key)))) continue;
    const names = [...template.text.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    if (names.some(name => variables[name] == null)) continue;
    const query = template.text.replace(/\{(\w+)\}/g, (_, name) => variables[name]);
    const key = norm(query);
    if (!seen.has(key)) {
      seen.add(key);
      queries.push({ template_id: template.template_id, query });
    }
  }
  return queries;
}

/**
 * Ejecuta B0 con las consultas estáticas en su orden declarado.
 * Efectos: invoca búsquedas mediante el controlador del núcleo.
 * @param {object} input
 * @returns {Promise<string>}
 */
export async function runB0({ profile, templates, today, controller }) {
  for (const query of b0Queries(profile, templates, today)) {
    const reason = controller.getStopReason() || controller.checkStop();
    if (reason) {
      controller.setStopReason(reason);
      break;
    }
    await controller.executeSearch(
      { query: query.query, targets: [] },
      `b0:${query.template_id}`,
      controller.totals.searches + 1,
    );
    if (controller.getStopReason()) break;
  }
  if (!controller.getStopReason()) controller.setStopReason('no_more_actions');
  return controller.getStopReason();
}

/**
 * Ejecuta B1: una planificación inicial y ninguna adaptación posterior.
 * Efectos: invoca planner y búsquedas mediante el controlador del núcleo.
 * @param {object} input
 * @returns {Promise<string>}
 */
export async function runB1({ config, controller }) {
  const plan = await controller.plannerStep(
    'initial_batch',
    0,
    { batch_size: config.budgets.searches, max_searches: config.budgets.searches, max_fetches: 0 },
    0,
  );
  if (plan) {
    for (const action of plan.accepted.filter(item => item.type === 'search')) {
      const reason = controller.getStopReason() || controller.checkStop();
      if (reason) {
        controller.setStopReason(reason);
        break;
      }
      await controller.executeSearch(action, 'planner:initial_batch', controller.totals.searches + 1);
    }
  }
  if (!controller.getStopReason()) controller.setStopReason('no_more_actions');
  return controller.getStopReason();
}

/**
 * Ejecuta B2 alternando observación, planificación y acciones adaptativas.
 * Efectos: invoca planner, búsquedas y descargas mediante el controlador del núcleo.
 * @param {object} input
 * @returns {Promise<string>}
 */
export async function runB2({ config, controller }) {
  let callIndex = 0;
  let step = 0;
  let emptyCalls = 0;
  let plan = await controller.plannerStep(
    'initial_batch',
    0,
    { batch_size: config.b2.initial_batch, max_searches: config.b2.initial_batch, max_fetches: 0 },
    callIndex++,
  );
  while (plan && !controller.getStopReason()) {
    for (const action of plan.accepted.filter(item => item.type === 'search')) {
      const reason = controller.checkStop();
      if (reason) {
        controller.setStopReason(reason);
        break;
      }
      await controller.executeSearch(action, step === 0 ? 'planner:initial_batch' : 'planner:adaptive_step', step);
      if (controller.getStopReason()) break;
    }
    if (controller.getStopReason()) break;
    for (const action of plan.accepted.filter(item => item.type === 'fetch')) {
      const result = await controller.fetchAndExtract(action.ref, 'planner', step, controller.getLastSearch());
      if (result?.delta?.newOfficial) controller.patience.afterExtraFetches(1);
    }
    if (plan.output.stop && plan.accepted.length === 0) {
      controller.setStopReason('no_more_actions');
      break;
    }
    emptyCalls = plan.accepted.length ? 0 : emptyCalls + 1;
    if (emptyCalls >= 2) {
      controller.setStopReason('no_more_actions');
      break;
    }
    step++;
    const budget = controller.budgetLeft();
    plan = await controller.plannerStep(
      'adaptive_step',
      step,
      {
        batch_size: 0,
        max_searches: Math.min(config.b2.max_searches_per_step, budget.searches),
        max_fetches: Math.min(config.b2.max_extra_fetches_per_step, budget.fetches),
      },
      callIndex++,
    );
  }
  if (!controller.getStopReason()) controller.setStopReason('no_more_actions');
  return controller.getStopReason();
}

/**
 * Crea un generador pseudoaleatorio reproducible para muestreo y contrabalanceo.
 * Puro respecto de red, disco y reloj.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Contrabalancea el orden de B0, B1 y B2 de forma reproducible.
 * Puro respecto de red, disco y reloj.
 * @param {number} seed
 * @returns {string[]}
 */
export function conditionOrder(seed) {
  const conditions = ['B0', 'B1', 'B2'];
  const random = mulberry32(seed);
  for (let index = conditions.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [conditions[index], conditions[target]] = [conditions[target], conditions[index]];
  }
  return conditions;
}
