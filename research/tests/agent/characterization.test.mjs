/**
 * Caracteriza el comportamiento observable de grants antes del refactor.
 * No prueba calidad comercial ni cobertura exhaustiva; congela decisiones del fixture.
 * Contratos: run_result/1, log_entry/1 y planner_input/1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCase } from '../../agent/run.mjs';
import { createFixtureTransport, createFixtureSearch, createFixtureFetch } from '../../agent/fixtures.mjs';
import { createSearchTool } from '../../agent/tools/search.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { createBenchCache } from '../../agent/cache.mjs';
import { validate } from '../../agent/contracts.mjs';
import { behaviorDigest, digestSha } from './helpers/digest.mjs';

const F = resolve(import.meta.dirname, 'fixtures/world-v1');
const root = resolve(import.meta.dirname, '../../..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const caseObj = json(resolve(F, 'case.json'));
const profile = json(resolve(F, 'profile.json'));
const config = json(resolve(F, 'run_config.json'));
const E = json(resolve(F, 'expected.json'));
const catalog = json(resolve(root, 'docs/contracts/criteria_catalog.grant.v1.json'));
const domainsCfg = json(resolve(root, 'research/agent/config/official_domains.v1.json'));
const expectedDigests = {
  B0: 'c59bd43512ddfd633f1e69a2dcd876db610433f4871b358341792295d9904f13',
  B1: 'e5eed2554c7c12539757476f28ff8e1d058fc0db0162ecf7439696336cc8ce85',
  B2: '4f6e3ef667d333fab8529bde3f7f29a22cbce6e73b9d2b2d67eeaa48d51bb39a',
};

async function runForDigest(condition) {
  const cache = createBenchCache({ path: ':memory:', namespace: `char-${condition}` });
  const plannerInputs = [];
  const outDir = mkdtempSync(resolve(tmpdir(), 'char-'));
  const result = await runCase({
    caseObj, profile, condition, seed: 101, config, outDir,
    deps: {
      transport: createFixtureTransport(F, { condition, profileId: profile.profile_id }),
      search: createSearchTool({ provider: 'fixture', transport: createFixtureSearch(F), cache, resultsPerQuery: 10, recency: 'none', clock: () => 0 }),
      fetch: createFetchTool({ transport: createFixtureFetch(F), cache, clock: () => 0 }),
      cache, catalog, domainsCfg,
      hashes: {
        case_sha256: 'd2e46658d93bccd2a2f073a09e0ec0e252990667dcf2d476a1a1c456a2295bf1',
        run_config_sha256: 'e4b48626dba6da6e56315ef80f3dbedd06fcc5528acb1174551e8733d5a29095',
      },
      clock: () => '2026-10-20T00:00:00.000Z',
      onPlannerInput: input => plannerInputs.push(structuredClone(input)),
    },
  });
  const logs = readFileSync(resolve(outDir, 'steps.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  cache.close();
  return { result, logs, plannerInputs };
}

function expectedSearches(condition) {
  return E.conditions[condition].searches_log.map(({ search_index, result_pages, ...entry }) => entry);
}

function actualSearches(logs) {
  return logs.filter(log => log.kind === 'search').map(log => ({
    query: log.data.query,
    origin: log.data.origin,
    result_ids: log.data.results.map(result => result.result_id),
    new_unique_docs: log.data.signals.new_unique_docs,
    duplicates: log.data.signals.duplicates,
    new_official_opportunities: log.data.signals.new_official_opportunities,
    searches_without_new_official: log.data.signals.searches_without_new_official,
  }));
}

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => (
    ['judgment', 'eligibility_class', 'recommendable'].includes(key) || containsForbiddenKey(child)
  ));
}

for (const condition of ['B0', 'B1', 'B2']) {
  test(`ACC-50 grants behavior digest ${condition}`, async () => {
    const run = await runForDigest(condition);
    assert.equal(digestSha(behaviorDigest(run)), expectedDigests[condition]);
  });

  test(`ACC-51 characterization details ${condition}`, async () => {
    const run = await runForDigest(condition);
    assert.deepEqual(actualSearches(run.logs), expectedSearches(condition));
    assert.deepEqual(run.result.entities.map(entity => entity.stable_id), E.conditions[condition].entities_in_registration_order);
    const sensitiveLogs = run.logs.filter(log => ['planner_call', 'search', 'fetch'].includes(log.kind));
    assert.equal(sensitiveLogs.some(containsForbiddenKey), false);
    if (condition === 'B0') {
      assert.deepEqual(run.logs.filter(log => log.kind === 'search').map(log => log.data.query), E.b0_queries.slice(0, 8).map(q => q.query));
    } else {
      assert.deepEqual(run.logs.filter(log => log.kind === 'planner_call').map(log => log.data.actions_rejected), E.conditions[condition].planner_rejected);
    }
    if (condition === 'B2') {
      const input = run.plannerInputs.find(item => item.step === 1);
      assert.deepEqual(input.gaps.map(gap => gap.gap_id), E.conditions.B2.gaps_offered_at_call_1);
      validate('planner_input', input);
    }
  });
}
