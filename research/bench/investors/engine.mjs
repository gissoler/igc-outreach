import { dedupeInvestors } from './identity.mjs';
import { extractFixtureInvestor } from './extractor.mjs';
import { investorB0Queries, validatePlannerBatch } from './conditions.mjs';
import { judgeInvestor } from './judge.mjs';
import { rankInvestors } from './ranking.mjs';
import { validateInvestor } from './contracts.mjs';

export async function runInvestorDiscovery({ caseObj, profile, condition, config, templates, catalog, deps }) {
  const totals = { searches: 0, fetches: 0, planner_calls: 0, rejected_non_investors: 0, portfolio_companies_rejected: 0, nominal_cost: 0, tokens_nominal: 0, seconds_nominal: 0, latency_actual_ms: 0, latency_nominal_ms: 0 };
  const seenQueries = new Set(), rawEntities = [], prefix_curve = [], actions_rejected = [];
  let noNew = 0, stop_reason = null, order = 0, queryCounter = 0;
  const recordUsage = value => { totals.tokens_nominal += value?.tokens_nominal ?? 0; totals.seconds_nominal += value?.seconds_nominal ?? 0; totals.latency_actual_ms += value?.latency?.actual_ms ?? 0; totals.latency_nominal_ms += value?.latency?.nominal_ms ?? 0; };
  const resourceHit = () => totals.tokens_nominal >= config.budgets.tokens_nominal ? 'budget_tokens' : totals.seconds_nominal >= config.budgets.seconds_nominal ? 'budget_seconds' : null;
  const budgetHit = () => totals.searches >= config.budgets.searches ? 'budget_searches' : totals.fetches >= config.budgets.fetches ? 'budget_fetches' : resourceHit() ?? (totals.planner_calls >= config.budgets.planner_calls && condition === 'B2' ? 'budget_planner_calls' : null);

  const runQuery = async action => {
    const before = budgetHit(); if (before) { stop_reason = before; return; }
    const query_id = `q${String(queryCounter++).padStart(3, '0')}`;
    const foundBefore = dedupeInvestors(rawEntities).length;
    const response = await deps.search(action.query, { remainingSearches: config.budgets.searches - totals.searches }); totals.searches += response.searches_consumed ?? 1; totals.nominal_cost += response.nominal_cost ?? 1; recordUsage(response);
    const afterSearch = resourceHit(); if (afterSearch) stop_reason = afterSearch;
    for (const result of (stop_reason ? [] : response.results ?? []).slice(0, config.default_fetch_per_search)) {
      if (totals.fetches >= config.budgets.fetches) { stop_reason = 'budget_fetches'; break; }
      const page = await deps.fetch(result.url); totals.fetches++; totals.nominal_cost += page.nominal_cost ?? 1; recordUsage(page);
      const extracted = await (deps.extract ?? extractFixtureInvestor)({ document: { url: result.url, title: result.title ?? page.title ?? result.url, text: page.text ?? '' }, extraction: page.extraction, today: config.today, firstSeen: { step: totals.planner_calls, search_index: totals.searches - 1, order: order++, query_id } });
      recordUsage(extracted);
      if (!extracted.entity) { totals.rejected_non_investors++; if (extracted.rejected_kind === 'portfolio_company') totals.portfolio_companies_rejected++; continue; }
      rawEntities.push(extracted.entity);
      const hit = totals.fetches >= config.budgets.fetches ? 'budget_fetches' : resourceHit(); if (hit) { stop_reason = hit; break; }
    }
    const entities = dedupeInvestors(rawEntities), foundAfter = entities.length;
    noNew = foundAfter > foundBefore ? 0 : noNew + 1;
    prefix_curve.push({ search_index: totals.searches - 1, stable_ids_so_far: entities.map(x => x.stable_id), nominal_cost: totals.nominal_cost, searches: totals.searches, fetches: totals.fetches });
    if (noNew >= config.patience_n) stop_reason = 'patience';
  };

  if (condition === 'B0') {
    for (const action of investorB0Queries(profile, templates, config.today)) { await runQuery(action); if (stop_reason) break; }
    stop_reason ??= budgetHit() ?? 'queries_exhausted';
  } else {
    const first = await deps.plan({ mode: 'initial_batch', profile, state: { queries: [], entities: [] }, limit: condition === 'B1' ? config.budgets.searches : config.b2.initial_batch }); totals.planner_calls++; recordUsage(first);
    let batch = validatePlannerBatch({ ...first, mode: 'initial_batch' }, seenQueries, condition === 'B1' ? config.budgets.searches : config.b2.initial_batch); actions_rejected.push(...batch.rejected);
    if (budgetHit() && !['budget_planner_calls'].includes(budgetHit())) stop_reason = budgetHit();
    for (const action of batch.accepted) { if (stop_reason) break; await runQuery(action); }
    if (condition === 'B1') stop_reason ??= budgetHit() ?? 'queries_exhausted';
    while (condition === 'B2' && !stop_reason) {
      const hit = budgetHit(); if (hit) { stop_reason = hit; break; }
      const entities = dedupeInvestors(rawEntities);
      const out = await deps.plan({ mode: 'adaptive_step', profile, state: { queries: [...seenQueries], entities: entities.map(x => ({ stable_id: x.stable_id, sectors: x.sectors, stages: x.stages, geographies: x.geographies })) }, limit: Math.min(config.b2.max_searches_per_step, config.budgets.searches - totals.searches) }); totals.planner_calls++; recordUsage(out);
      batch = validatePlannerBatch({ ...out, mode: 'adaptive_step' }, seenQueries, config.b2.max_searches_per_step); actions_rejected.push(...batch.rejected);
      if (batch.stop || batch.accepted.length === 0) { stop_reason = 'no_more_actions'; break; }
      for (const action of batch.accepted) { await runQuery(action); if (stop_reason) break; }
    }
  }
  const entities = dedupeInvestors(rawEntities), judgments = entities.map(entity => judgeInvestor({ entity, profile, catalog })), ranked = rankInvestors(entities, judgments);
  return validateInvestor('investor_run_result', { schema_version: 'investor_run_result/1', case_id: caseObj.case_id, condition, stop_reason, abstained: !ranked.some(x => x.gain >= 2), ranked, entities, judgments, totals, prefix_curve, actions_rejected });
}
