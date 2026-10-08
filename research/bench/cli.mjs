#!/usr/bin/env node
/**
 * Expone los comandos reproducibles del benchmark.
 * No redefine métricas ni reglas de decisión.
 * Contratos: configuración, casos y artefactos del benchmark.
 */
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
const argv = process.argv.slice(2);
const command = argv.shift();
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const fileSha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function currentCodeSha() {
  const git = process.env.GIT_BINARY || 'git';
  const sha = execFileSync(git, ['rev-parse', '--short=12', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  const dirty = execFileSync(git, ['status', '--porcelain', '--', 'research', 'docs', 'prompts'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  return `${sha}${dirty ? '-dirty' : ''}`;
}

function option(name) {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? null : argv[index + 1];
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function assets() {
  return {
    catalog: json(resolve(repo, 'docs/contracts/criteria_catalog.grant.v1.json')),
    domainsCfg: json(resolve(repo, 'research/agent/config/official_domains.v1.json')),
  };
}

async function execute({ config, caseObj, profile, condition, seed, outDir, configPath, casePath, cache }) {
  const common = assets();
  let transport;
  let search;
  let fetch;
  if (config.search.provider === 'fixture') {
    const fixtureRoot = dirname(configPath);
    transport = createFixtureTransport(fixtureRoot, {
      condition,
      profileId: profile.profile_id,
    });
    search = createSearchTool({
      provider: 'fixture',
      transport: createFixtureSearch(fixtureRoot),
      cache,
      resultsPerQuery: config.search.results_per_query,
      recency: config.search.recency,
      clock: () => 0,
    });
    fetch = createFetchTool({
      transport: createFixtureFetch(fixtureRoot),
      cache,
      clock: () => 0,
    });
  } else {
    search = createSearchTool({
      provider: config.search.provider,
      env: process.env,
      cache,
      resultsPerQuery: config.search.results_per_query,
      recency: config.search.recency === 'none' ? '' : config.search.recency,
    });
    fetch = createFetchTool({ env: process.env, cache });
  }
  const hashes = {
    case_sha256: fileSha256(casePath),
    run_config_sha256: fileSha256(configPath),
  };
  return runCase({
    caseObj,
    profile,
    condition,
    seed,
    config,
    deps: {
      transport,
      search,
      fetch,
      cache,
      ...common,
      hashes,
      codeSha: currentCodeSha(),
    },
    outDir,
  });
}

function validateCommand() {
  try {
    validateCases({
      configPath: resolve(option('config')),
      casesDir: resolve(option('cases')),
    });
    console.log('Valid');
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

async function runCommand() {
  const configPath = resolve(option('config'));
  const casePath = resolve(option('case'));
  const caseObj = json(casePath);
  const config = json(configPath);
  const profile = json(resolve(repo, caseObj.profile_path));
  const condition = option('condition');
  const seed = Number(option('seed'));
  const runId = `${config.bench_id}__${caseObj.case_id}__${condition}__s${seed}`;
  const outDir = option('out')
    ? resolve(option('out'))
    : resolve(repo, 'research/bench/out', config.bench_id, 'runs', runId);
  mkdirSync(outDir, { recursive: true });
  const cache = createBenchCache({
    path: resolve(repo, 'research/bench/out', config.bench_id, 'cache.sqlite'),
    namespace: config.cache_namespace,
  });
  try {
    await execute({ config, caseObj, profile, condition, seed, outDir, configPath, casePath, cache });
    return 0;
  } catch (error) {
    console.error(error.message);
    return /not configured|missing/i.test(error.message) ? 2 : 1;
  } finally {
    cache.close();
  }
}

async function runAllCommand() {
  const configPath = resolve(option('config'));
  const config = json(configPath);
  const conditions = (option('conditions') || 'B0,B1,B2').split(',');
  const cache = createBenchCache({
    path: resolve(repo, 'research/bench/out', config.bench_id, 'cache.sqlite'),
    namespace: config.cache_namespace,
  });
  try {
    await runAll({
      configPath,
      casesDir: resolve(repo, 'research/bench/cases'),
      conditions,
      execute: input => execute({
        ...input,
        configPath,
        casePath: resolve(repo, 'research/bench/cases', `${input.caseObj.case_id}.json`),
        cache,
      }),
    });
    return 0;
  } finally {
    cache.close();
  }
}

function poolCommand() {
  poolBench({
    benchDir: resolve(repo, 'research/bench/out', option('bench')),
    casesDir: resolve(repo, 'research/bench/cases'),
  });
  return 0;
}

async function preannotateCommand() {
  const bench = option('bench');
  const base = resolve(repo, 'research/bench/out', bench);
  const config = json(resolve(requiredOption('config')));
  if (config.agent_model.family === config.preannotator_model.family) {
    throw new Error('Preannotator family must differ from agent family');
  }
  const cache = createBenchCache({
    path: resolve(base, 'cache.sqlite'),
    namespace: config.cache_namespace,
  });
  const fetch = createFetchTool({ env: process.env, cache });
  const env = {
    ...process.env,
    ENGINE_LLM_URL: process.env[config.preannotator_model.base_url_env],
    ENGINE_LLM_MODEL: process.env[config.preannotator_model.model_env],
    ENGINE_LLM_API_KEY: process.env[config.preannotator_model.api_key_env],
  };
  const llm = createLlm({ env, role: 'engine', cache, family: config.preannotator_model.family });
  let append = false;
  for (const file of readdirSync(resolve(base, 'pool')).filter(value => value.endsWith('.json'))) {
    const caseId = file.replace('.json', '');
    const caseObj = json(resolve(repo, 'research/bench/cases', `${caseId}.json`));
    const profile = json(resolve(repo, caseObj.profile_path));
    const pool = json(resolve(base, 'pool', file));
    await preannotateItems({
      benchId: bench,
      caseObj,
      profile,
      pool,
      llm,
      prompt: loadPrompt('preannotator', config.prompts.preannotator),
      catalog: assets().catalog,
      sourceText: item => sourceTextForItem(item, fetch),
      outDir: base,
      append,
      temperature: config.temperatures.preannotator,
      maxTokens: config.max_tokens.preannotator,
    });
    append = true;
  }
  cache.close();
  return 0;
}

function sampleCommand() {
  const bench = option('bench');
  const base = resolve(repo, 'research/bench/out', bench);
  const seed = Number(option('seed') || 7);
  for (const file of readdirSync(resolve(base, 'pool')).filter(value => value.endsWith('.json'))) {
    const caseId = file.replace('.json', '');
    const caseObj = json(resolve(repo, 'research/bench/cases', `${caseId}.json`));
    const profile = json(resolve(repo, caseObj.profile_path));
    const pool = json(resolve(base, 'pool', file));
    const prePath = resolve(base, 'labels/preannotations.jsonl');
    const preannotations = existsSync(prePath)
      ? readFileSync(prePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
        .filter(value => value.case_id === caseId)
      : [];
    const runs = readdirSync(resolve(base, 'runs'))
      .map(dir => json(resolve(base, 'runs', dir, 'result.json')))
      .filter(value => value.case_id === caseId);
    const sample = sampleCase({ caseObj, profile, pool, preannotations, runs, seed });
    writeSample({
      outDir: resolve(base, 'labeling'),
      caseId,
      rows: sample.rows,
      key: sample.key,
      secondRows: secondReviewRows(sample.rows, sample.key, seed),
    });
  }
  return 0;
}

function importLabelsCommand() {
  const bench = option('bench');
  const file = resolve(option('file'));
  const role = option('role');
  const annotator = option('annotator');
  const base = resolve(repo, 'research/bench/out', bench);
  const caseIds = readdirSync(resolve(base, 'labeling'))
    .filter(value => value.startsWith('key-'))
    .map(value => value.slice(4, -5));
  const key = Object.assign({}, ...caseIds.map(caseId => (
    json(resolve(base, 'labeling', `key-${caseId}.json`))
  )));
  importLabels({
    file,
    role,
    annotator,
    key,
    outFile: resolve(base, 'labels', `${role}.jsonl`),
  });
  return 0;
}

function metricsCommand() {
  const bench = option('bench');
  const base = resolve(repo, 'research/bench/out', bench);
  const configPath = resolve(requiredOption('config'));
  const report = buildMetricsReport({
    benchId: bench,
    baseDir: base,
    configPath,
    casesDir: resolve(repo, 'research/bench/cases'),
  });
  writeReport(report, base);
  return 0;
}

function decideCommand() {
  const base = resolve(repo, 'research/bench/out', option('bench'));
  const reportPath = resolve(base, 'metrics_report.json');
  const report = json(reportPath);
  report.decision = decisionFromReport(report, { baseDir: base });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeReport(report, base);
  return 0;
}

const commands = {
  validate: validateCommand,
  run: runCommand,
  'run-all': runAllCommand,
  pool: poolCommand,
  preannotate: preannotateCommand,
  sample: sampleCommand,
  'import-labels': importLabelsCommand,
  metrics: metricsCommand,
  decide: decideCommand,
};

async function main() {
  const handler = commands[command];
  if (handler) return handler();
  console.error(`Unknown command ${command}`);
  return 1;
}

process.exitCode = await main();
