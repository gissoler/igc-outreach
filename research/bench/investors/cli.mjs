#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateInvestor, investorRepoRoot as repo } from './contracts.mjs';
import { loadInvestorPrompt } from './prompts.mjs';
import { runInvestorDiscovery } from './engine.mjs';
import { buildInvestorPool } from './pool.mjs';
import { blindSample, sampleCsv } from './sample.mjs';
import { importInvestorLabelsFile } from './labels.mjs';
import { hitAt20, pooledRecallAt20, ndcgAt10, classificationMetrics, recallCostCurve, abstentionMetrics, compareConditions, agreement, seedDispersion, latencyMetrics } from './metrics.mjs';
import { proposedInvestorDecision } from './decide.mjs';
import { createBenchCache } from '../../agent/cache.mjs';
import { createSearchTool } from '../../agent/tools/search.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { createInvestorLlm, createLiveInvestorDeps } from './external.mjs';
import { createFailoverSearchTool } from './search-failover.mjs';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonl = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const option = (args, name) => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args[i + 1]; };

export function validateInvestorWorkspace({ configPath, casesDir }) {
  const rawConfig = json(configPath);
  const config = validateInvestor(rawConfig.schema_version === 'investor_run_config/2' ? 'investor_run_config.v2' : 'investor_run_config', rawConfig);
  const promptOpts = config.prompts.manifest ? { manifest: config.prompts.manifest } : {};
  if (config.agent_model.family === config.preannotator_model.family) throw new Error('Preannotator family must differ from agent family');
  if (config.status === 'frozen' && JSON.stringify(config).includes('TO-APPROVE')) throw new Error('Frozen config contains unapproved placeholders');
  const catalog = validateInvestor('investor_criteria_catalog', json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json')));
  for (const id of ['b0_templates','planner','extractor','judge','preannotator']) loadInvestorPrompt(id, config.prompts[id], promptOpts);
  const files = existsSync(casesDir) ? readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json') : [];
  for (const file of files) {
    const rawCase = json(resolve(casesDir, file)), item = validateInvestor(rawCase.schema_version === 'investor_case/2' ? 'investor_case.v2' : 'investor_case', rawCase), profilePath = resolve(repo, item.profile_path), bytes = readFileSync(profilePath);
    if (sha(bytes) !== item.profile_sha256) throw new Error(`Profile hash mismatch for ${item.case_id}`);
    const profile = validateInvestor('investor_profile', JSON.parse(bytes));
    if (config.status === 'frozen' && profile.status !== 'frozen') throw new Error(`Profile ${profile.profile_id} is not frozen`);
  }
  return { config, cases: files.length, prompts: 5 };
}

function fixtureDeps(world, condition) {
  const planCounts = { initial_batch: 0, adaptive_step: 0 };
  return {
    search: async query => ({ results: (world.searches[query.toLowerCase()] ?? []).map((url, i) => ({ rank: i + 1, url, title: world.pages[url]?.title ?? url })), nominal_cost: 1 }),
    fetch: async url => ({ ...world.pages[url], nominal_cost: 1 }),
    plan: async ({ mode }) => { const rows = world.plans[condition]?.[mode] ?? []; const row = rows[Math.min(planCounts[mode]++, Math.max(0, rows.length - 1))]; return row ?? { queries: [], stop: true }; }
  };
}

async function runAllCommand({ configPath, casesDir, worldPath }) {
  const { config } = validateInvestorWorkspace({ configPath, casesDir });
  if (config.status !== 'frozen') throw new Error('run-all requires status=frozen');
  const imported = config.search.provider === 'fixture' && worldPath.endsWith('.mjs') ? await import(pathToFileURL(worldPath)) : null;
  const world = config.search.provider === 'fixture' ? (imported ? { pages: imported.pages, searches: imported.searches, plans: imported.plans } : json(worldPath)) : null, templates = loadInvestorPrompt('b0_templates', config.prompts.b0_templates).templates, catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
  const base = resolve(repo, 'research/bench/investors/out', config.bench_id); mkdirSync(resolve(base, 'runs'), { recursive: true });
  const cache = createBenchCache({ path: resolve(base, 'cache.sqlite'), namespace: `investors-${config.bench_id}` });
  try {
    const live = config.search.provider !== 'fixture';
    const search = !live ? null : config.search.provider === 'failover' ? createFailoverSearchTool({ providers: config.search.providers, env: process.env, cache, resultsPerQuery: config.search.results_per_query }) : createSearchTool({ provider: config.search.provider, env: process.env, cache, resultsPerQuery: config.search.results_per_query }), fetch = live ? createFetchTool({ env: process.env, cache }) : null, llm = live ? createInvestorLlm({ env: process.env, cache, family: config.agent_model.family }) : null;
    for (const file of readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json')) {
      const caseObj = json(resolve(casesDir, file)), profile = json(resolve(repo, caseObj.profile_path));
      for (const condition of ['B0','B1','B2']) for (const seed of config.seeds) {
        const deps = world ? fixtureDeps(world, condition) : createLiveInvestorDeps({ search, fetch, llm, plannerPrompt: loadInvestorPrompt('planner'), extractorPrompt: loadInvestorPrompt('extractor'), config, seed });
        const result = await runInvestorDiscovery({ caseObj, profile, condition, config, templates, catalog, deps });
        const dir = resolve(base, 'runs', `${config.bench_id}__${caseObj.case_id}__${condition}__s${seed}`); mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, 'result.json'), `${JSON.stringify({ ...result, seed }, null, 2)}\n`);
      }
    }
  } finally { cache.close(); }
}

async function main(args = process.argv.slice(2)) {
  const command = args.shift();
  if (command === 'validate') { const result = validateInvestorWorkspace({ configPath: resolve(option(args, 'config')), casesDir: resolve(option(args, 'cases')) }); console.log(`Valid investor benchmark: ${result.cases} cases, ${result.prompts} verified prompts`); return; }
  if (command === 'run-all') { await runAllCommand({ configPath: resolve(option(args, 'config')), casesDir: resolve(option(args, 'cases')), worldPath: option(args, 'world') ? resolve(option(args, 'world')) : '' }); return; }
  const bench = option(args, 'bench'), base = resolve(repo, 'research/bench/investors/out', bench ?? '');
  if (command === 'pool') {
    const runs = readdirSync(resolve(base, 'runs')).map(dir => json(resolve(base, 'runs', dir, 'result.json'))), casesDir = resolve(repo, 'research/bench/investors/cases'); mkdirSync(resolve(base, 'pool'), { recursive: true });
    for (const file of readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json')) { const c = json(resolve(casesDir, file)), manualPath = resolve(base, 'manual', `${c.case_id}.json`), pool = buildInvestorPool({ runs: runs.filter(x => x.case_id === c.case_id), anchors: c.anchors, manual: existsSync(manualPath) ? json(manualPath) : [] }); writeFileSync(resolve(base, 'pool', `${c.case_id}.json`), `${JSON.stringify(pool, null, 2)}\n`); } return;
  }
  if (command === 'preannotate') { const fixture = resolve(option(args, 'fixture')), config = json(resolve(option(args, 'config') ?? resolve(repo, 'research/bench/investors/config/v0.json'))); if (config.agent_model.family === config.preannotator_model.family) throw new Error('Preannotator family must differ from agent family'); const rows = jsonl(fixture); if (rows.some(x => x.is_gold !== false)) throw new Error('Preannotations must declare is_gold=false'); mkdirSync(resolve(base, 'labels'), { recursive: true }); writeFileSync(resolve(base, 'labels/preannotations.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`); return; }
  if (command === 'sample') { const seed = Number(option(args, 'seed') ?? 7), out = resolve(base, 'labeling'); mkdirSync(out, { recursive: true }); for (const file of readdirSync(resolve(base, 'pool')).filter(x => x.endsWith('.json'))) { const caseId = basename(file, '.json'), pool = json(resolve(base, 'pool', file)), pre = jsonl(resolve(base, 'labels/preannotations.jsonl')).filter(x => x.case_id === caseId), sample = blindSample({ caseId, profileSummary: '', pool, preannotations: pre, seed }); writeFileSync(resolve(out, `${caseId}.csv`), sampleCsv(sample.rows)); writeFileSync(resolve(out, `key-${caseId}.json`), `${JSON.stringify(sample.key, null, 2)}\n`); } return; }
  if (command === 'import-labels') { const role = option(args, 'role'), annotator = option(args, 'annotator'), file = resolve(option(args, 'file')), caseId = basename(file, '.csv'), key = json(resolve(base, 'labeling', `key-${caseId}.json`)), labels = importInvestorLabelsFile({ file, key, role, annotator }); mkdirSync(resolve(base, 'labels'), { recursive: true }); writeFileSync(resolve(base, 'labels', `${role}.jsonl`), `${labels.map(JSON.stringify).join('\n')}\n`); return; }
  if (command === 'metrics') {
    const runs = readdirSync(resolve(base, 'runs')).map(dir => json(resolve(base, 'runs', dir, 'result.json'))), labels = jsonl(resolve(base, 'labels/adjudicator.jsonl')), second = jsonl(resolve(base, 'labels/second_reviewer.jsonl')), casesDir = resolve(repo, 'research/bench/investors/cases'), cases = readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json').map(x => json(resolve(casesDir, x)));
    const per_run = runs.map(run => { const ll = labels.filter(x => x.case_id === run.case_id), c = cases.find(x => x.case_id === run.case_id); return { case_id: run.case_id, condition: run.condition, seed: run.seed, hit_at_20: hitAt20(run.ranked, c?.anchors), pooled_recall_at_20: pooledRecallAt20(run.ranked, ll), ndcg_at_10: ndcgAt10(run.ranked, ll), ...classificationMetrics(run, ll), recall_cost_curve: recallCostCurve(run, ll) }; });
    const mean = values => { const clean = values.filter(Number.isFinite); return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null; }, metrics = ['hit_at_20','pooled_recall_at_20','ndcg_at_10','hard_false_positive_rate'];
    const per_case = cases.map(c => { const row = { case_id: c.case_id }; for (const condition of ['B0','B1','B2']) { const rr = per_run.filter(x => x.case_id === c.case_id && x.condition === condition); row[condition] = Object.fromEntries(metrics.map(metric => [metric, mean(rr.map(x => x[metric]))])); row[condition].seed_dispersion = Object.fromEntries(metrics.map(metric => [metric, seedDispersion(rr, metric)])); } return row; });
    const comparisons = []; for (const metric of ['pooled_recall_at_20','ndcg_at_10','hit_at_20']) for (const other of ['B0','B1']) comparisons.push(compareConditions(per_case, metric, other, metric === 'hit_at_20' ? 0 : metric === 'ndcg_at_10' ? 0.03 : 0.05));
    const abstention = abstentionMetrics(cases, runs), latency = Object.fromEntries(['B0','B1','B2'].map(condition => [condition, latencyMetrics(runs.filter(x => x.condition === condition))]));
    const recallComparison = other => comparisons.find(x => x.metric === 'pooled_recall_at_20' && x.b === other), b2Runs = per_run.filter(x => x.condition === 'B2'), ndcgDiffs = per_case.flatMap(x => ['B0','B1'].map(other => x.B2.ndcg_at_10 == null || x[other].ndcg_at_10 == null ? null : x.B2.ndcg_at_10 - x[other].ndcg_at_10)).filter(Number.isFinite);
    const report = { schema_version: 'investor_metrics_report/1', per_run, per_case, comparisons, labeling_agreement: agreement(labels, second), abstention, latency, decision_input: { comparisons: { vs_b0: recallComparison('B0'), vs_b1: recallComparison('B1') }, b2: { ndcg_delta_min: ndcgDiffs.length ? Math.min(...ndcgDiffs) : null, hard_false_positive_rate: mean(b2Runs.map(x => x.hard_false_positive_rate)), correct_null_abstentions: Number(abstention.B2.correct_abstentions.split('/')[0]) } } };
    writeFileSync(resolve(base, 'metrics_report.json'), `${JSON.stringify(report, null, 2)}\n`); return;
  }
  if (command === 'decide') { const config = json(resolve(repo, 'research/bench/investors/config/v0.json')), report = json(resolve(base, 'metrics_report.json')), input = report.decision_input; if (!input) throw new Error('metrics_report.json lacks decision_input; aggregate formal metrics after labels freeze'); const decision = proposedInvestorDecision({ ...input, thresholds: config.decision_rule }); writeFileSync(resolve(base, 'decision.json'), `${JSON.stringify(decision, null, 2)}\n`); return; }
  throw new Error(`Unknown investor command ${command}`);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
