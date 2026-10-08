#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createBenchCache } from '../agent/cache.mjs';
import { createFixtureTransport, createFixtureSearch, createFixtureFetch } from '../agent/fixtures.mjs';
import { createSearchTool } from '../agent/tools/search.mjs';
import { createFetchTool } from '../agent/tools/fetch.mjs';
import { createLlm } from '../agent/llm.mjs';
import { loadPrompt } from '../agent/prompts.mjs';
import { runCase } from '../agent/run.mjs';
import { validateCases, runAll } from './runAll.mjs';
import { poolBench } from './pool.mjs';
import { sampleCase, secondReviewRows, writeSample } from './sample.mjs';
import { importLabels } from './labels.mjs';
import { preannotateItems, sourceTextForItem } from './preannotate.mjs';
import { buildMetricsReport, decisionFromReport } from './metrics.mjs';
import { writeReport } from './report.mjs';

const repo = resolve(import.meta.dirname, '../..');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const fileSha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const currentCodeSha = () => {
  const git = process.env.GIT_BINARY || 'git';
  const sha = execFileSync(git, ['rev-parse', '--short=12', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const dirty = execFileSync(git, ['status', '--porcelain', '--', 'research', 'docs', 'prompts'], { cwd: repo, encoding: 'utf8' }).trim();
  return `${sha}${dirty ? '-dirty' : ''}`;
};
const argv = process.argv.slice(2), command = argv.shift();
const option = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
const requiredOption = name => { const value = option(name); if (!value) throw new Error(`--${name} is required`); return value; };
const assets = () => ({ catalog: json(resolve(repo, 'docs/contracts/criteria_catalog.grant.v1.json')), domainsCfg: json(resolve(repo, 'research/agent/config/official_domains.v1.json')) });

async function execute({ config, caseObj, profile, condition, seed, outDir, configPath, casePath, cache }) {
  const common = assets(); let transport, search, fetch;
  if (config.search.provider === 'fixture') {
    const F = dirname(configPath); transport = createFixtureTransport(F, { condition, profileId: profile.profile_id });
    search = createSearchTool({ provider: 'fixture', transport: createFixtureSearch(F), cache, resultsPerQuery: config.search.results_per_query, recency: config.search.recency, clock: () => 0 });
    fetch = createFetchTool({ transport: createFixtureFetch(F), cache, clock: () => 0 });
  } else {
    search = createSearchTool({ provider: config.search.provider, env: process.env, cache, resultsPerQuery: config.search.results_per_query, recency: config.search.recency === 'none' ? '' : config.search.recency });
    fetch = createFetchTool({ env: process.env, cache });
  }
  const hashes = { case_sha256: fileSha256(casePath), run_config_sha256: fileSha256(configPath) };
  return runCase({ caseObj, profile, condition, seed, config, deps: { transport, search, fetch, cache, ...common, hashes, codeSha: currentCodeSha() }, outDir });
}

async function main() {
  if (command === 'validate') {
    try { validateCases({ configPath: resolve(option('config')), casesDir: resolve(option('cases')) }); console.log('Valid'); return 0; }
    catch (error) { console.error(error.message); return 1; }
  }
  if (command === 'run') {
    const configPath = resolve(option('config')), casePath = resolve(option('case')), caseObj = json(casePath), config = json(configPath), profile = json(resolve(repo, caseObj.profile_path));
    const condition = option('condition'), seed = Number(option('seed')), runId = `${config.bench_id}__${caseObj.case_id}__${condition}__s${seed}`;
    const outDir = option('out') ? resolve(option('out')) : resolve(repo, 'research/bench/out', config.bench_id, 'runs', runId); mkdirSync(outDir, { recursive: true });
    const cache = createBenchCache({ path: resolve(repo, 'research/bench/out', config.bench_id, 'cache.sqlite'), namespace: config.cache_namespace });
    try { await execute({ config, caseObj, profile, condition, seed, outDir, configPath, casePath, cache }); return 0; }
    catch (error) { console.error(error.message); return /not configured|missing/i.test(error.message) ? 2 : 1; }
    finally { cache.close(); }
  }
  if (command === 'run-all') {
    const configPath = resolve(option('config')), config = json(configPath), conditions = (option('conditions') || 'B0,B1,B2').split(',');
    const cache = createBenchCache({ path: resolve(repo, 'research/bench/out', config.bench_id, 'cache.sqlite'), namespace: config.cache_namespace });
    try { await runAll({ configPath, casesDir: resolve(repo, 'research/bench/cases'), conditions, execute: x => execute({ ...x, configPath, casePath: resolve(repo, 'research/bench/cases', `${x.caseObj.case_id}.json`), cache }) }); return 0; }
    finally { cache.close(); }
  }
  if (command === 'pool') { poolBench({ benchDir: resolve(repo, 'research/bench/out', option('bench')), casesDir: resolve(repo, 'research/bench/cases') }); return 0; }
  if (command === 'preannotate') {
    const bench = option('bench'), base = resolve(repo, 'research/bench/out', bench), config = json(resolve(requiredOption('config')));
    if (config.agent_model.family === config.preannotator_model.family) throw new Error('Preannotator family must differ from agent family');
    const cache = createBenchCache({ path: resolve(base, 'cache.sqlite'), namespace: config.cache_namespace }), fetch = createFetchTool({ env: process.env, cache });
    const env = { ...process.env, ENGINE_LLM_URL: process.env[config.preannotator_model.base_url_env], ENGINE_LLM_MODEL: process.env[config.preannotator_model.model_env], ENGINE_LLM_API_KEY: process.env[config.preannotator_model.api_key_env] };
    const llm = createLlm({ env, role: 'engine', cache, family: config.preannotator_model.family });
    let append = false;
    for (const f of readdirSync(resolve(base, 'pool')).filter(x => x.endsWith('.json'))) {
      const caseId = f.replace('.json', ''), caseObj = json(resolve(repo, 'research/bench/cases', `${caseId}.json`)), profile = json(resolve(repo, caseObj.profile_path)), pool = json(resolve(base, 'pool', f));
      await preannotateItems({ benchId: bench, caseObj, profile, pool, llm, prompt: loadPrompt('preannotator', config.prompts.preannotator), catalog: assets().catalog, sourceText: item => sourceTextForItem(item, fetch), outDir: base, append, temperature: config.temperatures.preannotator, maxTokens: config.max_tokens.preannotator });
      append = true;
    }
    cache.close(); return 0;
  }
  if (command === 'sample') {
    const bench = option('bench'), base = resolve(repo, 'research/bench/out', bench), seed = Number(option('seed') || 7);
    for (const f of readdirSync(resolve(base, 'pool')).filter(x => x.endsWith('.json'))) {
      const caseId = f.replace('.json', ''), caseObj = json(resolve(repo, 'research/bench/cases', `${caseId}.json`)), profile = json(resolve(repo, caseObj.profile_path)), pool = json(resolve(base, 'pool', f));
      const prePath = resolve(base, 'labels/preannotations.jsonl'), pre = existsSync(prePath) ? readFileSync(prePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(x => x.case_id === caseId) : [];
      const runs = readdirSync(resolve(base, 'runs')).map(d => json(resolve(base, 'runs', d, 'result.json'))).filter(x => x.case_id === caseId), sample = sampleCase({ caseObj, profile, pool, preannotations: pre, runs, seed });
      writeSample({ outDir: resolve(base, 'labeling'), caseId, rows: sample.rows, key: sample.key, secondRows: secondReviewRows(sample.rows, sample.key, seed) });
    }
    return 0;
  }
  if (command === 'import-labels') {
    const bench = option('bench'), file = resolve(option('file')), role = option('role'), annotator = option('annotator'), base = resolve(repo, 'research/bench/out', bench);
    const caseIds = readdirSync(resolve(base, 'labeling')).filter(x => x.startsWith('key-')).map(x => x.slice(4, -5));
    const key = Object.assign({}, ...caseIds.map(id => json(resolve(base, 'labeling', `key-${id}.json`))));
    importLabels({ file, role, annotator, key, outFile: resolve(base, 'labels', `${role}.jsonl`) }); return 0;
  }
  if (command === 'metrics') {
    const bench = option('bench'), base = resolve(repo, 'research/bench/out', bench), configPath = resolve(requiredOption('config'));
    const report = buildMetricsReport({ benchId: bench, baseDir: base, configPath, casesDir: resolve(repo, 'research/bench/cases') }); writeReport(report, base); return 0;
  }
  if (command === 'decide') { const base = resolve(repo, 'research/bench/out', option('bench')), report = json(resolve(base, 'metrics_report.json')); report.decision = decisionFromReport(report, { baseDir: base }); writeFileSync(resolve(base, 'metrics_report.json'), `${JSON.stringify(report, null, 2)}\n`); writeReport(report, base); return 0; }
  console.error(`Unknown command ${command}`); return 1;
}

process.exitCode = await main();
