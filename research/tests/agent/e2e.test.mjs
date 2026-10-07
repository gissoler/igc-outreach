/**
 * Verifica el agente completo con fixtures deterministas y sin red.
 * Congela presupuestos, procedencia y propagación de configuración del contrato v1.
 * Contratos: case/1, run_config/1, run_result/1 y log_entry/1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCase } from '../../agent/run.mjs';
import { createFixtureTransport, createFixtureSearch, createFixtureFetch } from '../../agent/fixtures.mjs';
import { createSearchTool } from '../../agent/tools/search.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { createBenchCache } from '../../agent/cache.mjs';
import { validate } from '../../agent/contracts.mjs';
import { loadPrompt } from '../../agent/prompts.mjs';
import { preannotateItems } from '../../bench/preannotate.mjs';

const fixtureDir = resolve(import.meta.dirname, 'fixtures/world-v1');
const root = resolve(import.meta.dirname, '../../..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const casePath = resolve(fixtureDir, 'case.json');
const configPath = resolve(fixtureDir, 'run_config.json');
const caseObj = json(casePath);
const profile = json(resolve(fixtureDir, 'profile.json'));
const config = json(configPath);
const expected = json(resolve(fixtureDir, 'expected.json'));
const catalog = json(resolve(root, 'docs/contracts/criteria_catalog.grant.v1.json'));
const domainsCfg = json(resolve(root, 'research/agent/config/official_domains.v1.json'));
const hashes = {
  case_sha256: 'd2e46658d93bccd2a2f073a09e0ec0e252990667dcf2d476a1a1c456a2295bf1',
  run_config_sha256: 'e4b48626dba6da6e56315ef80f3dbedd06fcc5528acb1174551e8733d5a29095',
};

async function run(condition, cache = createBenchCache({ path: ':memory:', namespace: `n-${condition}` }), options = {}) {
  const baseTransport = createFixtureTransport(fixtureDir, { condition, profileId: profile.profile_id });
  const transport = options.transport || baseTransport;
  const search = createSearchTool({ provider: 'fixture', transport: createFixtureSearch(fixtureDir), cache, resultsPerQuery: 10, recency: 'none' });
  const fetch = createFetchTool({ transport: createFixtureFetch(fixtureDir), cache });
  const out = mkdtempSync(resolve(tmpdir(), `e2e-${condition}-`));
  const result = await runCase({
    caseObj,
    profile,
    condition,
    seed: 101,
    config: options.config || config,
    deps: { transport, search, fetch, cache, catalog, domainsCfg, hashes, codeSha: options.codeSha, clock: () => '2026-10-20T00:00:00.000Z' },
    outDir: out,
  });
  return { result, out, cache, transport };
}

for (const [condition, acc] of [['B0', 'ACC-18'], ['B1', 'ACC-19'], ['B2', 'ACC-12 / ACC-20']]) {
  test(`${acc} fixture end-to-end ${condition}`, async () => {
    const { result, out, cache } = await run(condition);
    const ex = expected.conditions[condition];
    validate('run_result', result);
    assert.equal(result.stop_reason, ex.stop_reason);
    assert.equal(result.totals.searches, ex.searches);
    assert.equal(result.totals.fetches, ex.fetches);
    assert.equal(result.totals.planner_calls, ex.planner_calls);
    assert.equal(result.totals.tokens_discovery_nominal, ex.tokens_discovery_nominal);
    assert.equal(result.totals.tokens_judge_nominal, ex.tokens_judge_nominal);
    assert.deepEqual(result.ranked.map(item => item.stable_id), ex.ranked);
    assert.equal(result.abstained, false);
    for (const line of readFileSync(resolve(out, 'steps.jsonl'), 'utf8').trim().split('\n')) validate('log_entry', JSON.parse(line));
    cache.close();
  });
}

test('ACC-21 fixture runs are deterministic', async () => {
  const cache = createBenchCache({ path: ':memory:', namespace: 'shared' });
  const a = await run('B2', cache);
  const b = await run('B2', cache);
  const clean = value => JSON.parse(JSON.stringify(value), (key, item) => ['fetched_at', 'retrieved_at'].includes(key) ? 'TIME' : item);
  assert.deepEqual(clean(a.result), clean(b.result));
  cache.close();
});

test('ACC-22 budgets stop with valid partial result', async () => {
  for (const [key, value, reason] of [['searches', 3, 'budget_searches'], ['fetches', 2, 'budget_fetches'], ['tokens_nominal', 2000, 'budget_tokens']]) {
    const limited = structuredClone(config);
    limited.budgets[key] = value;
    const cache = createBenchCache({ path: ':memory:', namespace: key });
    const out = mkdtempSync(resolve(tmpdir(), 'budget-'));
    const result = await runCase({
      caseObj,
      profile,
      condition: 'B0',
      seed: 101,
      config: limited,
      deps: {
        transport: createFixtureTransport(fixtureDir, { condition: 'B0', profileId: profile.profile_id }),
        search: createSearchTool({ provider: 'fixture', transport: createFixtureSearch(fixtureDir), cache }),
        fetch: createFetchTool({ transport: createFixtureFetch(fixtureDir), cache }),
        cache, catalog, domainsCfg, hashes,
        clock: () => '2026-10-20T00:00:00.000Z',
      },
      outDir: out,
    });
    assert.equal(result.stop_reason, reason);
    validate('run_result', result);
    cache.close();
  }
});

test('fatal errors write a valid partial result before being rethrown', async () => {
  const out = mkdtempSync(resolve(tmpdir(), 'fatal-'));
  const transport = createFixtureTransport(fixtureDir, { condition: 'B0', profileId: profile.profile_id });
  await assert.rejects(() => runCase({
    caseObj,
    profile,
    condition: 'B0',
    seed: 101,
    config,
    deps: {
      transport,
      search: { search: async () => { throw new Error('fixture fatal'); } },
      fetch: { fetch: async () => { throw new Error('unused'); } },
      catalog, domainsCfg, hashes,
      clock: () => '2026-10-20T00:00:00.000Z',
    },
    outDir: out,
  }), /fixture fatal/);
  const result = json(resolve(out, 'result.json'));
  validate('run_result', result);
  assert.equal(result.stop_reason, 'fatal_error');
  assert.equal(JSON.parse(readFileSync(resolve(out, 'steps.jsonl'), 'utf8').trim().split('\n').at(-1)).kind, 'run_end');
});

test('ACC-58 propagates config and records exact provenance', async () => {
  const requests = [];
  const base = createFixtureTransport(fixtureDir, { condition: 'B0', profileId: profile.profile_id });
  const transport = async request => { requests.push(request.body); return base(request); };
  transport.modelKey = base.modelKey;
  transport.clock = base.clock;
  const configured = structuredClone(config);
  configured.temperatures.judge = 0.25;
  const { result, out } = await run('B0', undefined, { transport, config: configured, codeSha: 'abcdef123456' });
  const extractionCalls = requests.filter(body => body.response_format.json_schema.name === 'extraction');
  const judgeCalls = requests.filter(body => body.response_format.json_schema.name === 'judge_output');
  assert.ok(extractionCalls.length > 0);
  assert.equal(config.max_tokens.extractor, 3000);
  assert.ok(extractionCalls.every(body => body.max_tokens === 3000));
  assert.ok(judgeCalls.every(body => body.temperature === 0.25));
  assert.equal(result.versions.code_sha, 'abcdef123456');
  const start = readFileSync(resolve(out, 'steps.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).find(entry => entry.kind === 'run_start');
  assert.equal(start.data.case_sha256, hashes.case_sha256);
  assert.equal(start.data.run_config_sha256, hashes.run_config_sha256);
});

test('ACC-58 preannotator receives configured temperature and max tokens', async () => {
  let request;
  const llm = { call: async input => {
    request = input;
    return {
      modelId: 'fixture-preannotator',
      json: {
        status: 'open', deadline: null, identity_correct: true, scope: 'on', hard_eligibility: 'eligible', route: 'direct_apply',
        criteria: [], confidence: 'high', notes: '',
      },
    };
  } };
  const out = mkdtempSync(resolve(tmpdir(), 'preannotator-'));
  await preannotateItems({
    benchId: 'fixture',
    caseObj,
    profile,
    pool: [{ stable_id: expected.conditions.B0.ranked[0], names: ['Fixture item'], identifiers: [], urls: [] }],
    llm,
    prompt: loadPrompt('preannotator', 'v1'),
    catalog,
    sourceText: async () => '',
    outDir: out,
    temperature: 0.35,
    maxTokens: 1234,
  });
  assert.equal(request.temperature, 0.35);
  assert.equal(request.maxTokens, 1234);
});

test('ACC-58 frozen runs reject missing provenance', async () => {
  const frozen = structuredClone(config);
  frozen.status = 'frozen';
  const out = mkdtempSync(resolve(tmpdir(), 'frozen-'));
  await assert.rejects(() => runCase({ caseObj, profile, condition: 'B0', seed: 101, config: frozen, deps: {}, outDir: out }), error => error.code === 'CONTRACT');
});

test('ACC-58 expected_model_id mismatch writes a valid partial result', async () => {
  const mismatched = structuredClone(config);
  mismatched.agent_model.expected_model_id = 'other-model';
  const cache = createBenchCache({ path: ':memory:', namespace: 'model-mismatch' });
  const out = mkdtempSync(resolve(tmpdir(), 'model-mismatch-'));
  const transport = createFixtureTransport(fixtureDir, { condition: 'B0', profileId: profile.profile_id });
  await assert.rejects(() => runCase({
    caseObj,
    profile,
    condition: 'B0',
    seed: 101,
    config: mismatched,
    deps: {
      transport,
      search: createSearchTool({ provider: 'fixture', transport: createFixtureSearch(fixtureDir), cache }),
      fetch: createFetchTool({ transport: createFixtureFetch(fixtureDir), cache }),
      cache, catalog, domainsCfg, hashes,
    },
    outDir: out,
  }), error => error.code === 'CONTRACT' && /expected_model_id mismatch/.test(error.message));
  const result = json(resolve(out, 'result.json'));
  validate('run_result', result);
  assert.equal(result.stop_reason, 'fatal_error');
  cache.close();
});

test('ACC-58 CLI fixture timing is deterministic', () => {
  const cli = resolve(root, 'research/bench/cli.mjs');
  const execute = out => spawnSync(process.execPath, [cli, 'run', '--config', configPath, '--case', casePath, '--condition', 'B0', '--seed', '101', '--out', out], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9', GIT_BINARY: '/Library/Developer/CommandLineTools/usr/bin/git' },
  });
  const outA = mkdtempSync(resolve(tmpdir(), 'cli-a-'));
  const outB = mkdtempSync(resolve(tmpdir(), 'cli-b-'));
  const first = execute(outA);
  const second = execute(outB);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(json(resolve(outA, 'result.json')).totals.seconds_discovery_nominal, json(resolve(outB, 'result.json')).totals.seconds_discovery_nominal);
});
