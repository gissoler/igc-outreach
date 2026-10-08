/**
 * Posee el estado, los presupuestos y las operaciones del loop iterativo de búsqueda.
 * No decide políticas B0/B1/B2: conditions.mjs las ejecuta sobre este controlador.
 * Contratos: planner_input/1, log_entry/1 y las salidas validadas del extractor.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { createHash } from 'node:crypto';
import { norm } from '../server/research/core.mjs';
import { hostKind } from '../server/research/verify.mjs';
import { createRegistry } from './registry.mjs';
import { createPatience, searchSignals } from './signals.mjs';
import { runB0, runB1, runB2 } from './conditions.mjs';
import { buildPlannerInput, callPlanner, validateActions, inputSha } from './planner.mjs';
import { extractDocument } from './extractor.mjs';
import { docIdOf, normalizeUrl, registrableDomain, officialBasisOf } from './docs.mjs';
import { LlmError } from './errors.mjs';

/**
 * Expone vistas consistentes del presupuesto restante y consumido.
 * Puro respecto de red, disco y reloj; refleja el objeto totals recibido.
 * @param {object} config
 * @param {object} totals
 * @returns {{left: () => object, used: () => object}}
 */
export function createBudget(config, totals) {
  return {
    left: () => ({
      searches: config.budgets.searches - totals.searches,
      fetches: config.budgets.fetches - totals.fetches,
      tokens_nominal: config.budgets.tokens_nominal - totals.tokens_discovery_nominal,
      seconds_nominal: config.budgets.seconds_nominal - totals.seconds_discovery_nominal,
      planner_calls: config.budgets.planner_calls - totals.planner_calls,
    }),
    used: () => ({
      searches: totals.searches,
      fetches: totals.fetches,
      tokens_nominal: totals.tokens_discovery_nominal,
      seconds_nominal: totals.seconds_discovery_nominal,
      planner_calls: totals.planner_calls,
    }),
  };
}

/**
 * Aplica la regla de parada en el orden contractual de v1.
 * Puro respecto de red, disco y reloj.
 * @param {object} input
 * @returns {string|null}
 */
export function checkStop({ patience, totals, config, condition }) {
  if (patience.exhausted) return 'patience';
  if (totals.searches >= config.budgets.searches) return 'budget_searches';
  if (totals.fetches >= config.budgets.fetches) return 'budget_fetches';
  if (totals.tokens_discovery_nominal >= config.budgets.tokens_nominal) return 'budget_tokens';
  if (totals.seconds_discovery_nominal >= config.budgets.seconds_nominal) return 'budget_time';
  if (condition === 'B2' && totals.planner_calls >= config.budgets.planner_calls) return 'budget_planner_calls';
  return null;
}

function documentFromFetch(ref, result, config) {
  const normalizedUrl = normalizeUrl(ref.url);
  const hostname = new URL(ref.url).hostname;
  return {
    doc_id: docIdOf(ref.url),
    url: ref.url,
    normalized_url: normalizedUrl,
    host: hostname.replace(/^www\./, ''),
    registrable_domain: registrableDomain(hostname),
    host_kind: hostKind(ref.url),
    official: false,
    official_basis: 'none',
    fetched_at: `${config.today}T00:00:00.000Z`,
    fetch_via: result.via || 'direct',
    ok: result.ok,
    text_chars: (result.text || '').length,
    text_sha256: result.text ? createHash('sha256').update(result.text).digest('hex') : null,
    title: result.title || ref.title || '',
    published_date: ref.published || null,
    ...(result.http_status ? { http_status: result.http_status } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

function logFetchFailure(ctx, { ref, trigger, step, doc, result, errors }) {
  ctx.deps.logger.log(
    'fetch',
    step,
    { ref, trigger, document: doc },
    { latency: result.latency, errors, budget_used: ctx.budget.used() },
  );
}

function logExtraction(ctx, { ref, trigger, step, doc, result, extraction, delta }) {
  ctx.deps.logger.log(
    'fetch',
    step,
    { ref, trigger, document: doc },
    { latency: result.latency, budget_used: ctx.budget.used() },
  );
  ctx.deps.logger.log('extract', step, {
    doc_id: doc.doc_id,
    prompt: extraction.promptRef,
    page_type: extraction.extraction.page_type,
    about_stable_id: delta.stable_id,
    new_opportunity: delta.isNew,
    evidence_ids: delta.stable_id
      ? ctx.registry.evidenceFor(delta.stable_id).filter(item => item.doc_id === doc.doc_id).map(item => item.evidence_id)
      : [],
    quotes_rejected: extraction.rejected.quotes,
    identifiers_rejected: extraction.rejected.identifiers,
    mentions: extraction.mentions.length,
    official_links: extraction.officialLinks,
  }, {
    tokens: extraction.tokens,
    latency: extraction.latency,
    errors: [],
    budget_used: ctx.budget.used(),
  });
}

function synchronizeLinks(ctx) {
  for (const link of ctx.registry.links()) {
    const normalizedUrl = normalizeUrl(link.url);
    ctx.state.resultRefs.set(link.link_id, {
      ...link,
      ref: link.link_id,
      normalized_url: normalizedUrl,
      host_kind: hostKind(link.url),
      fetched: ctx.fetched.has(normalizedUrl),
    });
  }
}

async function extractFetchedDocument(ctx, doc, result, step) {
  try {
    return await extractDocument({
      doc,
      text: result.text,
      llm: ctx.deps.llm,
      prompt: ctx.deps.prompts.extractor,
      catalog: ctx.deps.catalog,
      today: ctx.config.today,
      step,
      fetchSeq: ctx.fetchSeq,
      maxChars: ctx.config.extract_max_chars,
      temperature: ctx.config.temperatures.extractor,
      maxTokens: ctx.config.max_tokens.extractor,
    });
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    return { error };
  }
}

/**
 * Descarga, extrae y registra un documento; un LlmError queda asociado al fetch.
 * Efectos: usa red inyectada, modelo, registro y logger; actualiza contadores.
 * @param {object} ctx
 * @param {string} ref
 * @param {string} trigger
 * @param {number} step
 * @param {number} searchIndex
 * @returns {Promise<object|null>}
 */
export async function fetchAndExtract(ctx, ref, trigger, step, searchIndex) {
  const reason = checkStop(ctx);
  if (reason) {
    ctx.stopReason = reason;
    return null;
  }
  const resultRef = ctx.state.resultRefs.get(ref) || ctx.registry.links().find(link => link.link_id === ref);
  if (!resultRef) return null;
  const result = await ctx.deps.fetch.fetch(resultRef.url);
  ctx.totals.fetches++;
  if (!result.ok) ctx.totals.fetch_errors++;
  ctx.totals.seconds_discovery_nominal += Math.ceil(result.latency.nominal_ms / 1000);
  const normalizedUrl = normalizeUrl(resultRef.url);
  ctx.fetched.add(normalizedUrl);
  ctx.registry.markFetchedUrl(normalizedUrl);
  resultRef.fetched = true;
  let doc = documentFromFetch(resultRef, result, ctx.config);
  if (!result.ok || doc.text_chars < 200) {
    logFetchFailure(ctx, { ref, trigger, step, doc, result, errors: result.error ? [result.error] : [] });
    return { ok: false, doc };
  }
  const extraction = await extractFetchedDocument(ctx, doc, result, step);
  if (extraction.error) {
    ctx.fetchSeq++;
    ctx.totals.fetch_errors++;
    logFetchFailure(ctx, {
      ref,
      trigger,
      step,
      doc,
      result,
      errors: [{ code: extraction.error.code, message: extraction.error.message, ref: doc.doc_id }],
    });
    return { ok: false, doc };
  }
  ctx.modelId = extraction.modelId;
  ctx.totals.tokens_discovery_nominal += extraction.tokens.nominal_total;
  ctx.totals.seconds_discovery_nominal += Math.ceil(extraction.latency.nominal_ms / 1000);
  const basis = officialBasisOf({
    url: doc.url,
    extraction: extraction.extraction,
    acceptedEvidence: extraction.evidenceDrafts,
  }, ctx.deps.domainsCfg);
  doc = { ...doc, official: basis !== 'none', official_basis: basis };
  const delta = ctx.registry.register({
    doc,
    extractionResult: extraction,
    ctx: { step, searchIndex, queryId: `q${String(searchIndex).padStart(3, '0')}` },
  });
  ctx.fetchSeq++;
  logExtraction(ctx, { ref, trigger, step, doc, result, extraction, delta });
  synchronizeLinks(ctx);
  return { ok: true, doc, delta };
}

function searchRows(ctx, results, searchIndex) {
  return results.map((result, index) => {
    const ref = `r${String(searchIndex).padStart(3, '0')}-${String(result.rank || index + 1).padStart(2, '0')}`;
    const normalizedUrl = normalizeUrl(result.url);
    const seenBefore = ctx.seen.has(normalizedUrl);
    ctx.seen.add(normalizedUrl);
    const stored = {
      ref,
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      published: result.published,
      rank: result.rank || index + 1,
      search_index: searchIndex,
      normalized_url: normalizedUrl,
      host: new URL(result.url).hostname.replace(/^www\./, ''),
      host_kind: hostKind(result.url),
      official_domain: false,
      fetched: ctx.fetched.has(normalizedUrl),
    };
    ctx.state.resultRefs.set(ref, stored);
    return { result_id: ref, rank: stored.rank, url: stored.url, title: stored.title, seen_before: seenBefore };
  });
}

async function fetchDefaultResults(ctx, rows, step, searchIndex) {
  const fetchResults = [];
  const registryDelta = [];
  for (const row of rows) {
    if (fetchResults.length >= ctx.config.default_fetch_per_search) break;
    const result = ctx.state.resultRefs.get(row.result_id);
    if (result.host_kind !== 'other' || ctx.fetched.has(result.normalized_url)) continue;
    if (ctx.totals.fetches >= ctx.config.budgets.fetches) {
      ctx.stopReason = 'budget_fetches';
      break;
    }
    const fetched = await fetchAndExtract(ctx, row.result_id, 'default', step, searchIndex);
    if (fetched) {
      fetchResults.push(fetched);
      if (fetched.delta) registryDelta.push(fetched.delta);
    }
  }
  return { fetchResults, registryDelta };
}

function recordSearch(ctx, { action, origin, step, search, rows, signals }) {
  const searchIndex = ctx.lastSearch;
  ctx.state.lastSignals = signals;
  ctx.state.queriesRun.push({
    query_id: `q${String(searchIndex).padStart(3, '0')}`,
    query: action.query,
    step,
    new_unique_docs: signals.new_unique_docs,
    new_official_opportunities: signals.new_official_opportunities.length,
  });
  ctx.totals.unique_docs = ctx.seen.size;
  ctx.totals.official_opportunities = ctx.registry.entities().filter(entity => entity.official).length;
  ctx.deps.logger.log('search', step, {
    search_index: searchIndex,
    query_id: `q${String(searchIndex).padStart(3, '0')}`,
    query: action.query,
    origin,
    targets: action.targets || [],
    results: rows,
    signals,
  }, {
    latency: search.latency,
    errors: search.error ? [search.error] : [],
    budget_used: ctx.budget.used(),
  });
  ctx.prefixCurve.push({
    search_index: searchIndex,
    stable_ids_so_far: ctx.registry.entities().map(entity => entity.stable_id),
    tokens_nominal: ctx.totals.tokens_discovery_nominal,
    searches: ctx.totals.searches,
    fetches: ctx.totals.fetches,
  });
  if (ctx.patience.exhausted) ctx.stopReason = 'patience';
}

/**
 * Ejecuta una búsqueda, sus descargas por defecto y las señales resultantes.
 * Efectos: usa herramientas inyectadas, registro y logger; actualiza el estado del loop.
 * @param {object} ctx
 * @param {object} action
 * @param {string} origin
 * @param {number} step
 * @returns {Promise<void>}
 */
export async function executeSearch(ctx, action, origin, step) {
  const seenBefore = new Set(ctx.seen);
  const search = await ctx.deps.search.search(action.query);
  const searchIndex = ctx.totals.searches++;
  ctx.lastSearch = searchIndex;
  ctx.executed.add(norm(action.query));
  ctx.totals.seconds_discovery_nominal += Math.ceil(search.latency.nominal_ms / 1000);
  const rows = searchRows(ctx, search.results, searchIndex);
  const { fetchResults, registryDelta } = await fetchDefaultResults(ctx, rows, step, searchIndex);
  ctx.patience.afterSearch(registryDelta.filter(delta => delta.newOfficial).length);
  const signals = searchSignals({
    resultsNormUrls: rows.map(row => normalizeUrl(row.url)),
    seenBefore,
    fetchResults,
    registryDelta,
    registry: ctx.registry,
    catalog: ctx.deps.catalog,
    patienceValue: ctx.patience.value,
    seenOfficialDomains: ctx.seenOfficialDomains,
  });
  for (const result of fetchResults) {
    if (result.doc?.official) ctx.seenOfficialDomains.add(result.doc.registrable_domain);
  }
  recordSearch(ctx, { action, origin, step, search, rows, signals });
}

/**
 * Construye el estado del planner, llama el modelo y filtra acciones no válidas.
 * Efectos: llama el LLM y escribe el ledger; un error del planner detiene la corrida.
 * @param {object} ctx
 * @param {string} mode
 * @param {number} step
 * @param {object} limits
 * @param {number} callIndex
 * Excepción de 60 líneas: registra en una sola unidad la llamada y su consumo de presupuesto.
 * @returns {Promise<object|null>}
 */
export async function plannerStep(ctx, mode, step, limits, callIndex) {
  const reason = checkStop(ctx);
  if (reason) {
    ctx.stopReason = reason;
    return null;
  }
  const input = buildPlannerInput({
    mode,
    state: ctx.state,
    limits,
    today: ctx.config.today,
    step,
    budgetLeft: ctx.budget.left(),
    patience: { n: ctx.config.patience_n, value: ctx.patience.value },
    profile: ctx.profile,
    catalog: ctx.deps.catalog,
  });
  ctx.deps.onPlannerInput?.(input);
  let call;
  try {
    call = await callPlanner({
      llm: ctx.deps.llm,
      prompt: ctx.deps.prompts.planner,
      input,
      seed: ctx.seed,
      temperature: ctx.config.temperatures.planner,
      maxTokens: ctx.config.max_tokens.planner,
      meta: { call_index: callIndex, condition: ctx.condition },
    });
  } catch {
    ctx.stopReason = 'planner_error';
    return null;
  }
  ctx.totals.planner_calls++;
  ctx.totals.tokens_discovery_nominal += call.tokens.nominal_total;
  ctx.totals.seconds_discovery_nominal += Math.ceil(call.latency.nominal_ms / 1000);
  ctx.modelId = call.modelId;
  const actions = validateActions(call.json, input, mode, limits, {
    executedQueriesNorm: ctx.executed,
    fetchedNormUrls: ctx.fetched,
    refs: ctx.state.resultRefs,
  });
  ctx.deps.logger.log('planner_call', step, {
    mode,
    prompt: {
      id: ctx.deps.prompts.planner.id,
      version: ctx.deps.prompts.planner.version,
      sha256: ctx.deps.prompts.planner.sha256,
    },
    input_sha256: inputSha(input),
    output: call.json,
    actions_accepted: actions.accepted.length,
    actions_rejected: actions.rejected,
    gaps_offered: input.gaps.length,
  }, {
    tokens: call.tokens,
    latency: call.latency,
    budget_used: ctx.budget.used(),
  });
  return { ...actions, output: call.json };
}

function createContext({ profile, condition, seed, config, deps }) {
  const registry = createRegistry({ today: config.today, catalog: deps.catalog });
  const totals = {
    searches: 0,
    fetches: 0,
    fetch_errors: 0,
    unique_docs: 0,
    official_opportunities: 0,
    tokens_discovery_nominal: 0,
    seconds_discovery_nominal: 0,
    planner_calls: 0,
  };
  return {
    profile,
    condition,
    seed,
    config,
    deps,
    registry,
    patience: createPatience(config.patience_n),
    state: { registry, queriesRun: [], resultRefs: new Map(), recentErrors: [], lastSignals: null },
    seen: new Set(),
    fetched: new Set(),
    executed: new Set(),
    seenOfficialDomains: new Set(),
    prefixCurve: [],
    totals,
    budget: createBudget(config, totals),
    fetchSeq: 0,
    stopReason: null,
    modelId: 'pending',
    lastSearch: 0,
  };
}

function conditionController(ctx) {
  return {
    totals: ctx.totals,
    patience: ctx.patience,
    checkStop: () => checkStop(ctx),
    budgetLeft: () => ctx.budget.left(),
    executeSearch: (...args) => executeSearch(ctx, ...args),
    fetchAndExtract: (...args) => fetchAndExtract(ctx, ...args),
    plannerStep: (...args) => plannerStep(ctx, ...args),
    getLastSearch: () => ctx.lastSearch,
    getStopReason: () => ctx.stopReason,
    setStopReason: reason => { ctx.stopReason = reason; },
  };
}

/**
 * Ejecuta el loop de descubrimiento compartido y delega solo la política de condición.
 * Contrato: devuelve registro, razón de parada, totales, curva prefija y modelo observado.
 * Efectos: usa buscador, fetcher, LLM y logger inyectados.
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function runDiscovery({ caseObj, profile, condition, seed, config, deps }) {
  const ctx = createContext({ caseObj, profile, condition, seed, config, deps });
  const controller = conditionController(ctx);
  if (condition === 'B0') {
    await runB0({ profile, templates: deps.prompts.b0_templates.templates, today: config.today, controller });
  } else if (condition === 'B1') {
    await runB1({ config, controller });
  } else {
    await runB2({ config, controller });
  }
  return {
    registry: ctx.registry,
    stop_reason: ctx.stopReason,
    totals: ctx.totals,
    prefix_curve: ctx.prefixCurve,
    modelId: ctx.modelId,
  };
}
