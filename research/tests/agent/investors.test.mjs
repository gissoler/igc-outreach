import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateInvestor } from '../../bench/investors/contracts.mjs';
import { loadInvestorPrompt } from '../../bench/investors/prompts.mjs';
import { stableInvestorId, dedupeInvestors, investorIdentityKeys } from '../../bench/investors/identity.mjs';
import { classifyActivity } from '../../bench/investors/activity.mjs';
import { extractFixtureInvestor } from '../../bench/investors/extractor.mjs';
import { judgeInvestor, assertUnknownNeverMet } from '../../bench/investors/judge.mjs';
import { investorGain, rankInvestors } from '../../bench/investors/ranking.mjs';
import { investorB0Queries, validatePlannerBatch } from '../../bench/investors/conditions.mjs';
import { runInvestorDiscovery } from '../../bench/investors/engine.mjs';
import { buildInvestorPool } from '../../bench/investors/pool.mjs';
import { blindSample, ADJUDICATION_COLUMNS, sampleCsv } from '../../bench/investors/sample.mjs';
import { importInvestorLabels } from '../../bench/investors/labels.mjs';
import { hitAt20, pooledRecallAt20, ndcgAt10, classificationMetrics, recallCostCurve, compareConditions, agreement, abstentionMetrics, seedDispersion, latencyMetrics } from '../../bench/investors/metrics.mjs';
import { proposedInvestorDecision } from '../../bench/investors/decide.mjs';
import { preannotateInvestorItems } from '../../bench/investors/preannotate.mjs';
import { createInvestorLlm } from '../../bench/investors/external.mjs';
import { pages, searches, fixtureDeps, fixtureConfig } from './fixtures/investor-world-v0/world.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const F = resolve(import.meta.dirname, 'fixtures/investor-world-v0');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const profile = json(resolve(F, 'profile.json'));
const anchorCase = json(resolve(F, 'cases/case-anchor.json'));
const nullCase = json(resolve(F, 'cases/case-null.json'));
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const templates = loadInvestorPrompt('b0_templates').templates;
const firstSeen = (order = 0) => ({ step: 0, search_index: 0, order, query_id: 'q000' });
const entityAt = (url, order = 0) => extractFixtureInvestor({ document: { url, title: pages[url].title }, extraction: pages[url].extraction, today: '2026-10-07', firstSeen: firstSeen(order) }).entity;

function label(stable_id, overrides = {}) {
  return { schema_version: 'investor_label/1', case_id: anchorCase.case_id, stable_id, role: 'adjudicator', annotator: 'human-1', identity_correct: true, entity_kind: 'institutional_investor', active_status: 'active', sector_fit: 'on', stage_fit: 'met', geography_fit: 'met', check_fit: 'met', round_fit: 'met', business_model_fit: 'met', lead_fit: 'met', hard_eligibility: 'eligible', portfolio_conflict: 'none', overall_relevance: 'strong', confidence: 'high', criteria: [], evidence: [], labeled_on: '2026-10-07', notes: '', ...overrides };
}

test('INV-ACC-01 contracts accept profile, anchor/null cases, entities, labels and reject invented defaults', () => {
  validateInvestor('investor_profile', profile); validateInvestor('investor_case', anchorCase); validateInvestor('investor_case', nullCase);
  const entity = entityAt('https://alpha-ventures.test/thesis'); validateInvestor('investor_entity', entity); validateInvestor('investor_label', label(entity.stable_id));
  const missing = structuredClone(profile); delete missing.fields.revenue_or_traction;
  assert.throws(() => validateInvestor('investor_profile', missing), /required/);
  const unknown = structuredClone(profile); unknown.fields.revenue_or_traction.value = null; assert.equal(validateInvestor('investor_profile', unknown), unknown);
});

test('INV-ACC-02 all investor prompts are versioned and hash verified', () => {
  for (const id of ['b0_templates','planner','extractor','judge','preannotator']) assert.match(loadInvestorPrompt(id).sha256, /^[a-f0-9]{64}$/);
});

test('INV-ACC-02e external LLM composition validates investor-specific schemas without network', async () => {
  const prompt = loadInvestorPrompt('planner'), llm = createInvestorLlm({ family: 'fixture', transport: async () => ({ content: '{"queries":["health investors"],"stop":false}', usage: { prompt_tokens: 2, completion_tokens: 3 }, latency_ms: 4 }) });
  const result = await llm.call({ prompt, user: 'fixture', schemaName: 'investor_planner_output' }); assert.deepEqual(result.json, { queries: ['health investors'], stop: false }); assert.equal(result.tokens_nominal, 5);
});

test('INV-ACC-03 stable IDs and conservative dedup cover aliases, rename, domains, vehicles and similar names', () => {
  const alpha = entityAt('https://alpha-ventures.test/thesis', 0), vehicle = entityAt('https://alpha-ventures.test/seed-i', 1), renamed = entityAt('https://alpha-health.test/about', 2), similar = entityAt('https://alpha-capital.test/thesis', 3);
  assert.equal(stableInvestorId(alpha), 'inv:domain:alpha-ventures.test');
  assert.ok(investorIdentityKeys(renamed).has('regulatory:reg-alpha'));
  const merged = dedupeInvestors([alpha, vehicle, renamed, similar]); assert.equal(merged.length, 2);
  assert.equal(merged.find(x => x.stable_id === 'inv:domain:alpha-ventures.test').vehicles.length, 1);
  assert.ok(merged.some(x => x.stable_id === 'inv:domain:alpha-capital.test'));
});

test('INV-ACC-04 extraction rejects portfolio companies, individuals and accelerators without capital', () => {
  for (const [url, kind] of [['https://rival-health.test/about','portfolio_company'],['https://alex-angel.test/bio','individual'],['https://launch-school.test/program','accelerator_no_capital']]) {
    const out = extractFixtureInvestor({ document: { url, title: pages[url].title }, extraction: pages[url].extraction, today: '2026-10-07', firstSeen: firstSeen() }); assert.equal(out.entity, null); assert.equal(out.rejected_kind, kind);
  }
});

test('INV-ACC-05 activity requires evidence beyond website existence and uses injected date', () => {
  assert.equal(classifyActivity({ explicitInactive: true, currentOfficialThesis: true, recentEvidence: [], asOf: '2026-10-07', recencyDays: 548 }), 'inactive');
  assert.equal(classifyActivity({ currentOfficialThesis: true, recentEvidence: [], asOf: '2026-10-07', recencyDays: 548 }), 'possibly_active');
  assert.equal(classifyActivity({ currentOfficialThesis: false, recentEvidence: [{ source_kind: 'official', published_on: '2026-08-01' }], asOf: '2026-10-07', recencyDays: 548 }), 'active');
  assert.equal(classifyActivity({ currentOfficialThesis: false, recentEvidence: [], asOf: '2026-10-07', recencyDays: 548 }), 'unknown');
});

test('INV-ACC-06 judge covers hard failures, partial sector, conflicts, contradictions and unknown', () => {
  const urls = ['https://alpha-ventures.test/thesis','https://legacy-fund.test/closed','https://late-growth.test/thesis','https://euro-only.test/thesis','https://micro-check.test/thesis','https://broad-impact.test/thesis','https://conflict-fund.test/thesis','https://contradictory.test/thesis','https://unknown-fund.test/about'];
  const j = Object.fromEntries(urls.map((url, i) => [url, judgeInvestor({ entity: entityAt(url, i), profile, catalog })]));
  assert.equal(j[urls[0]].overall_relevance, 'plausible');
  assert.equal(j[urls[1]].hard_eligibility, 'ineligible');
  assert.equal(j[urls[2]].stage_fit, 'not_met'); assert.equal(j[urls[3]].geography_fit, 'not_met'); assert.equal(j[urls[4]].check_fit, 'not_met');
  assert.equal(j[urls[5]].sector_fit, 'partial');
  assert.equal(j[urls[6]].portfolio_conflict, 'direct'); assert.notEqual(j[urls[6]].hard_eligibility, 'ineligible');
  assert.equal(entityAt(urls[7]).contradictions.length, 1); assert.ok(j[urls[8]].unknown_count >= 5);
  assert.throws(() => assertUnknownNeverMet('unknown', 'met'), /unknown cannot become met/);
});

test('INV-ACC-07 ordinal gain and ranking implement the preregistered rules', () => {
  assert.equal(investorGain(label('inv:domain:x.test')), 3);
  assert.equal(investorGain(label('inv:domain:x.test', { overall_relevance: 'plausible', hard_eligibility: 'undetermined', stage_fit: 'unknown', geography_fit: 'unknown' })), 2);
  assert.equal(investorGain(label('inv:domain:x.test', { overall_relevance: 'weak', hard_eligibility: 'undetermined' })), 1);
  assert.equal(investorGain(label('inv:domain:x.test', { active_status: 'inactive' })), 0);
  const es = [entityAt('https://legacy-fund.test/closed', 0), entityAt('https://alpha-ventures.test/thesis', 1)], js = es.map(entity => judgeInvestor({ entity, profile, catalog })); assert.equal(rankInvestors(es, js)[0].stable_id, 'inv:domain:alpha-ventures.test');
});

test('INV-ACC-08 B0 templates cover required families without fund names and skip unavailable comparables', () => {
  const queries = investorB0Queries(profile, templates, '2026-10-07'); assert.deepEqual(queries.map(x => x.origin), ['b0:sector-vc','b0:stage-sector','b0:geo-sector','b0:thesis','b0:recent-active']);
  assert.ok(queries.every(x => !/alpha|legacy|conflict/i.test(x.query)));
});

test('INV-ACC-09 B0, B1 and B2 share execution while planner behavior differs', async () => {
  const b0 = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B0', config: fixtureConfig, templates, catalog, deps: fixtureDeps('B0') });
  const b1 = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B1', config: fixtureConfig, templates, catalog, deps: fixtureDeps('B1') });
  const b2 = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B2', config: fixtureConfig, templates, catalog, deps: fixtureDeps('B2') });
  assert.equal(b0.totals.planner_calls, 0); assert.equal(b1.totals.planner_calls, 1); assert.ok(b2.totals.planner_calls > 1);
  assert.ok(b0.entities.some(x => x.stable_id === 'inv:domain:alpha-ventures.test')); assert.ok(b2.entities.some(x => x.stable_id === 'inv:domain:alpha-ventures.test'));
  assert.equal(b2.entities.filter(x => x.regulatory_id === 'REG-ALPHA').length, 1); assert.equal(b2.totals.portfolio_companies_rejected, 0);
});

test('INV-ACC-10 budgets, patience, duplicate rejection and adaptive stopping are deterministic', async () => {
  const tiny = structuredClone(fixtureConfig); tiny.budgets.searches = 1;
  const budget = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B0', config: tiny, templates, catalog, deps: fixtureDeps('B0') }); assert.equal(budget.stop_reason, 'budget_searches'); assert.equal(budget.totals.searches, 1);
  const tokenConfig = structuredClone(fixtureConfig); tokenConfig.budgets.tokens_nominal = 1000; const baseDeps = fixtureDeps('B0'); baseDeps.search = async query => ({ ...(await fixtureDeps('B0').search(query)), tokens_nominal: 1000 });
  const tokenBudget = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B0', config: tokenConfig, templates, catalog, deps: baseDeps }); assert.equal(tokenBudget.stop_reason, 'budget_tokens'); assert.equal(tokenBudget.totals.fetches, 0);
  const seen = new Set(['same query']); const batch = validatePlannerBatch({ queries: ['Same, query!','new one','extra'], stop: false, mode: 'adaptive_step' }, seen, 1); assert.deepEqual(batch.rejected.map(x => x.reason), ['duplicate_query','over_limit']);
  const stopped = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B2', config: fixtureConfig, templates, catalog, deps: fixtureDeps('B2') }); assert.equal(stopped.stop_reason, 'no_more_actions');
});

test('INV-ACC-11 null fixture abstains and contains every required offline-world trap', async () => {
  const result = await runInvestorDiscovery({ caseObj: nullCase, profile, condition: 'B1', config: fixtureConfig, templates, catalog, deps: fixtureDeps('B1', { nullOnly: true }) });
  assert.equal(result.abstained, true); assert.equal(result.totals.rejected_non_investors, 3); assert.equal(result.totals.portfolio_companies_rejected, 1);
  assert.ok(Object.keys(pages).length >= 15); assert.ok(Object.values(pages).some(x => x.extraction.contradictions?.length)); assert.ok(Object.values(pages).some(x => x.extraction.active_status === 'unknown'));
});

test('INV-ACC-12 pool combines top-20, anchors and manual search by firm identity', () => {
  const alpha = entityAt('https://alpha-ventures.test/thesis'), run = { ranked: [{ stable_id: alpha.stable_id }], entities: [alpha] };
  const pool = buildInvestorPool({ runs: [run], anchors: anchorCase.anchors, manual: [entityAt('https://alpha-ventures.test/seed-i'), entityAt('https://alpha-capital.test/thesis')] }); assert.equal(pool.length, 2); assert.deepEqual(pool.find(x => x.stable_id === alpha.stable_id).origins.sort(), ['anchor','manual_search','system_top20']);
});

test('INV-ACC-13 sample is blind and CSV has the exact adjudication columns', () => {
  const pool = [{ stable_id: 'inv:domain:a.test', name: 'A', urls: ['https://a.test'], origins: ['anchor'] }, { stable_id: 'inv:domain:b.test', name: 'B', urls: ['https://b.test'], origins: ['system_top20'] }];
  const sample = blindSample({ caseId: anchorCase.case_id, profileSummary: 'health startup', pool, preannotations: [{ stable_id: 'inv:domain:b.test', gain: 0 }], seed: 7 }); const csv = sampleCsv(sample.rows);
  assert.equal(csv.split('\n')[0], ADJUDICATION_COLUMNS.join(',')); assert.doesNotMatch(csv, /B0|B1|B2|seed|rank|recommendable|eligibility_class/); assert.equal(Object.keys(sample.key).length, 2);
});

test('INV-ACC-14 label import validates enums, evidence, dates and opaque keys', () => {
  const itemKey = '0123456789abcdef', evidence = JSON.stringify([{ criterion_id: 'INV-SECTOR', state: 'met', url: 'https://a.test/thesis', quote: 'We invest in health.', retrieved_on: '2026-10-07' }]).replaceAll('"','""');
  const csv = `${ADJUDICATION_COLUMNS.join(',')}\n${itemKey},${anchorCase.case_id},p,A,https://a.test,true,institutional_investor,active,on,met,met,met,met,met,met,eligible,none,strong,high,"${evidence}",2026-10-07,ok\n`;
  const labels = importInvestorLabels({ csvText: csv, key: { [itemKey]: { case_id: anchorCase.case_id, stable_id: 'inv:domain:a.test' } }, role: 'adjudicator', annotator: 'h1' }); assert.equal(labels[0].criteria[0].state, 'met'); validateInvestor('investor_label', labels[0]);
});

test('INV-ACC-14p preannotation requires another model family and can never claim gold', async () => {
  await assert.rejects(() => preannotateInvestorItems({ caseId: anchorCase.case_id, profile, pool: [], agentFamily: 'same', preannotatorFamily: 'same', annotate: async () => ({}) }), /must differ/);
  const rows = await preannotateInvestorItems({ caseId: anchorCase.case_id, profile, pool: [{ stable_id: 'inv:domain:a.test' }], agentFamily: 'a', preannotatorFamily: 'b', annotate: async () => label('inv:domain:a.test') }); assert.equal(rows[0].is_gold, false); assert.equal(rows[0].gain, 3);
});

test('INV-ACC-15 ranking, error, agreement, cost and abstention metrics are reproducible', () => {
  const labels = [label('inv:domain:a.test'), label('inv:domain:b.test', { overall_relevance: 'plausible', hard_eligibility: 'undetermined', stage_fit: 'unknown', geography_fit: 'unknown' }), label('inv:domain:c.test', { active_status: 'inactive' })];
  const ranked = [{ stable_id: 'inv:domain:b.test' }, { stable_id: 'inv:domain:a.test' }]; assert.equal(hitAt20(ranked, [{ stable_id: 'inv:domain:a.test' }]), 1); assert.equal(pooledRecallAt20(ranked, labels), 1); assert.ok(ndcgAt10(ranked, labels) > 0.7);
  const run = { ranked: [{ stable_id: 'inv:domain:a.test', gain: 3 }], judgments: [{ stable_id: 'inv:domain:a.test', active_status: 'active', criteria: [{ criterion_id: 'INV-SECTOR', state: 'unknown' }] }], prefix_curve: [{ nominal_cost: 2, stable_ids_so_far: ['inv:domain:a.test'] }] };
  const human = label('inv:domain:a.test', { criteria: [{ criterion_id: 'INV-SECTOR', state: 'met' }] }); const cls = classificationMetrics(run, [human]); assert.equal(cls.identity_accuracy, 1); assert.equal(cls.unknown_rate, 1); assert.equal(recallCostCurve(run, [human])[0].pooled_recall_at_20, 1);
  const cmp = compareConditions([{ B2: { pooled_recall_at_20: 1 }, B0: { pooled_recall_at_20: 0 } }], 'pooled_recall_at_20', 'B0', 0); assert.equal(cmp.wins, 1); assert.deepEqual(agreement([human], [human]), { reviewed: 1, agreement_raw: 1, cohen_kappa: 1 }); assert.equal(seedDispersion([{ score: 0 }, { score: 1 }], 'score'), 0.5); assert.deepEqual(latencyMetrics([{ totals: { latency_actual_ms: 10, latency_nominal_ms: 20 } }]), { actual_ms_mean: 10, nominal_ms_mean: 20 });
  const abst = abstentionMetrics([anchorCase, nullCase], [{ case_id: anchorCase.case_id, condition: 'B2', abstained: false }, { case_id: nullCase.case_id, condition: 'B2', abstained: true }]); assert.deepEqual(abst.B2, { correct_abstentions: '1/1', false_abstentions: '0/1' });
});

test('INV-ACC-16 decision remains proposed and exposes every human threshold', () => {
  const decision = proposedInvestorDecision({ comparisons: { vs_b0: { mean_diff: .1, sign_test_p_one_sided: .01 }, vs_b1: { mean_diff: .08, sign_test_p_one_sided: .02 } }, b2: { ndcg_delta_min: -.01, hard_false_positive_rate: .05, correct_null_abstentions: 2 }, thresholds: fixtureConfig.decision_rule }); assert.equal(decision.status, 'proposed'); assert.equal(decision.passes_if_approved, true); assert.match(decision.note, /human approval/);
});

test('INV-ACC-17 investor implementation is isolated from grant contracts, paths and vocabulary', () => {
  const files = ['engine.mjs','judge.mjs','ranking.mjs','pool.mjs','metrics.mjs']; for (const file of files) { const text = readFileSync(resolve(repo, 'research/bench/investors', file), 'utf8'); assert.doesNotMatch(text, /criteria_catalog\.grant|deadline|grants\.gov|NIH|NSF|research\/bench\/out\//); }
});
