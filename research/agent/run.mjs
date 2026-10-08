/**
 * Coordina una corrida completa y materializa su resultado.
 * No implementa las políticas internas de búsqueda.
 * Contratos: case/1, run_config/1 y run_result/1.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validate } from './contracts.mjs';
import { ContractError } from './errors.mjs';
import { createRunLogger } from './logger.mjs';
import { runDiscovery } from './search_agent.mjs';
import { selectForJudging, judgeEntity } from './eligibility_judge.mjs';
import { rank } from './ranking.mjs';
import { loadPrompt } from './prompts.mjs';
import { createLlm } from './llm.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validateRunInputs(caseObj, profile, config, deps) {
  validate('case', caseObj);
  validate('profile', profile);
  validate('run_config', config);
  const missingFrozenProvenance = config.status === 'frozen' && (
    !deps.codeSha ||
    !deps.hashes?.case_sha256 ||
    !deps.hashes?.run_config_sha256
  );
  if (missingFrozenProvenance) {
    throw new ContractError('run_config', [{
      message: 'frozen runs require codeSha, case_sha256 and run_config_sha256',
    }]);
  }
}

function loadRunPrompts(config, supplied) {
  return supplied || {
    planner: loadPrompt('planner', config.prompts.planner),
    extractor: loadPrompt('extractor', config.prompts.extractor),
    eligibility_judge: loadPrompt('eligibility_judge', config.prompts.eligibility_judge),
    b0_templates: loadPrompt('b0_templates', config.prompts.b0_templates),
  };
}

function runVersions(condition, config, deps, prompts, codeSha) {
  const discoveryPrompts = condition === 'B0' ? [prompts.b0_templates] : [prompts.planner];
  return {
    model_id: deps.transport?.modelKey || 'pending',
    model_family: config.agent_model.family,
    prompts: [...discoveryPrompts, prompts.extractor, prompts.eligibility_judge].map(prompt => ({
      id: prompt.id,
      version: prompt.version,
      sha256: prompt.sha256,
    })),
    code_sha: codeSha,
    contracts_version: '1',
    catalog_version: config.catalog,
    official_domains_version: config.official_domains,
  };
}

function failedDiscovery() {
  return {
    registry: {
      finalize: () => [],
      entities: () => [],
      docs: () => [],
      evidenceFor: () => [],
    },
    stop_reason: 'fatal_error',
    totals: {
      searches: 0,
      fetches: 0,
      fetch_errors: 0,
      unique_docs: 0,
      official_opportunities: 0,
      tokens_discovery_nominal: 0,
      seconds_discovery_nominal: 0,
      planner_calls: 0,
    },
    prefix_curve: [],
  };
}

async function discover(input) {
  try {
    return { discovery: await runDiscovery(input), fatalError: null };
  } catch (fatalError) {
    return { discovery: failedDiscovery(), fatalError };
  }
}

async function judgeEntities({ entities, discovery, profile, catalog, llm, prompt, today, config, logger }) {
  const judgments = [];
  let tokens = 0;
  let seconds = 0;
  for (const entity of selectForJudging(entities, config.judge.max_opportunities)) {
    const judgment = await judgeEntity({
      entity,
      evidence: discovery.registry.evidenceFor(entity.stable_id),
      docs: discovery.registry.docs(),
      profile,
      catalog,
      llm,
      prompt,
      today,
      config,
    });
    judgments.push(judgment);
    tokens += judgment.judge_call.tokens.nominal_total;
    seconds += Math.ceil(judgment.judge_call.latency.nominal_ms / 1000);
    logger.log('judge', 999, {
      stable_id: entity.stable_id,
      eligibility_class: judgment.aggregate.eligibility_class,
      recommendable: judgment.aggregate.recommendable,
      overrides_count: judgment.criteria.reduce((count, criterion) => count + criterion.overrides.length, 0),
    }, {
      tokens: judgment.judge_call.tokens,
      latency: judgment.judge_call.latency,
    });
  }
  return { judgments, tokens, seconds };
}

function logRunEnd(logger, discovery, totals, entities, ranked, abstained) {
  logger.log('run_end', 999, {
    stop_reason: discovery.stop_reason,
    searches: totals.searches,
    fetches: totals.fetches,
    opportunities: entities.length,
    official_opportunities: entities.filter(entity => entity.official).length,
    recommendable: ranked.filter(item => item.recommendable).length,
    abstained,
  }, {
    budget_used: {
      searches: totals.searches,
      fetches: totals.fetches,
      tokens_nominal: totals.tokens_discovery_nominal,
      seconds_nominal: totals.seconds_discovery_nominal,
      planner_calls: totals.planner_calls,
    },
  });
}

/**
 * Ejecuta discovery, juicio y ranking con procedencia reproducible.
 * Efectos: usa dependencias inyectadas y escribe result.json y steps.jsonl.
 * Excepción de 60 líneas: ensambla run_result/1 y garantiza su escritura aun ante error fatal.
 * @param {object} input Caso, perfil, condición, semilla, configuración, dependencias y salida.
 * @returns {Promise<object>} Resultado validado de la corrida.
 */
export async function runCase({ caseObj, profile, condition, seed, config, deps, outDir }) {
  validateRunInputs(caseObj, profile, config, deps);
  const hashes = deps.hashes || {
    case_sha256: sha(caseObj),
    run_config_sha256: sha(config),
  };
  const codeSha = deps.codeSha || '0000000';
  const prompts = loadRunPrompts(config, deps.prompts);
  const versions = runVersions(condition, config, deps, prompts, codeSha);
  const run_id = `${config.bench_id}__${caseObj.case_id}__${condition}__s${seed}`;
  const logger = deps.logger || createRunLogger({
    dir: outDir,
    header: { run_id, case_id: caseObj.case_id, condition, seed, versions },
    clock: deps.clock,
  });
  logger.log('run_start', 0, {
    profile_id: profile.profile_id,
    profile_sha256: caseObj.profile_sha256,
    case_sha256: hashes.case_sha256,
    run_config_sha256: hashes.run_config_sha256,
    today: config.today,
    search_provider: config.search.provider,
    budgets: config.budgets,
    patience_n: config.patience_n,
  });
  const llm = deps.llm || createLlm({
    transport: deps.transport,
    cache: deps.cache,
    family: config.agent_model.family,
    expectedModelId: config.agent_model.expected_model_id,
    clock: deps.transport?.clock,
  });
  const { discovery, fatalError } = await discover({
    caseObj,
    profile,
    condition,
    seed,
    config,
    deps: { ...deps, llm, logger, prompts, catalog: deps.catalog, domainsCfg: deps.domainsCfg },
  });
  const entities = discovery.registry.finalize();
  const judged = await judgeEntities({
    entities,
    discovery,
    profile,
    catalog: deps.catalog,
    llm,
    prompt: prompts.eligibility_judge,
    today: config.today,
    config,
    logger,
  });
  versions.model_id = discovery.modelId && discovery.modelId !== 'pending'
    ? discovery.modelId
    : (deps.transport?.modelKey || 'pending');
  logger.setVersions(versions);
  const ranked = rank(entities, judged.judgments);
  const abstained = !ranked.some(item => item.recommendable);
  const totals = {
    ...discovery.totals,
    tokens_judge_nominal: judged.tokens,
    seconds_judge_nominal: judged.seconds,
  };
  logRunEnd(logger, discovery, totals, entities, ranked, abstained);
  const result = {
    schema_version: 'run_result/1',
    run_id,
    case_id: caseObj.case_id,
    condition,
    seed,
    today: config.today,
    versions,
    stop_reason: discovery.stop_reason,
    abstained,
    ranked,
    entities,
    judgments: judged.judgments,
    evidence: entities.flatMap(entity => discovery.registry.evidenceFor(entity.stable_id)),
    totals,
    prefix_curve: discovery.prefix_curve,
  };
  validate('run_result', result);
  writeFileSync(resolve(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (fatalError) throw fatalError;
  return result;
}
