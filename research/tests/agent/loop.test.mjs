import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatience } from '../../agent/signals.mjs';
import { validateActions } from '../../agent/planner.mjs';
import { norm } from '../../server/research/core.mjs';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCase } from '../../agent/run.mjs';
import { createFixtureTransport, createFixtureSearch, createFixtureFetch } from '../../agent/fixtures.mjs';
import { createSearchTool } from '../../agent/tools/search.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { createBenchCache } from '../../agent/cache.mjs';
import { behaviorDigest, digestSha } from './helpers/digest.mjs';

test('ACC-11 patience counter resets only on new official opportunities',()=>{let p=createPatience(6);assert.deepEqual([2,1,0,0,0,0,0,0].map(x=>p.afterSearch(x)),[0,0,1,2,3,4,5,6]);assert.equal(p.exhausted,true);p=createPatience(6);assert.deepEqual([0,1,0].map(x=>p.afterSearch(x)),[1,0,1]);p=createPatience(6);[0,0,0,0].forEach(x=>p.afterSearch(x));assert.equal(p.value,4);assert.equal(p.afterExtraFetches(1),0);});
test('ACC-13 planner actions reject duplicates, limits, unknown and blocked refs',()=>{const input={gaps:[{gap_id:'g-12345678'}]},refs=new Map([['r001-01',{url:'https://x.org/a',normalized_url:'https://x.org/a',fetched:true}],['r001-02',{url:'https://fundsforngos.org/a',normalized_url:'https://fundsforngos.org/a',fetched:false}]]),output={actions:[{type:'search',query:'Hello, World!',targets:['coverage:anything']},{type:'search',query:'a',targets:[]},{type:'search',query:'b',targets:[]},{type:'search',query:'c',targets:[]},{type:'fetch',ref:'r999-01',targets:[]},{type:'fetch',ref:'r001-01',targets:[]},{type:'fetch',ref:'r001-02',targets:[]},{type:'search',query:'z',targets:['g-00000000']}]};const r=validateActions(output,input,'adaptive_step',{max_searches:2,max_fetches:1},{executedQueriesNorm:new Set([norm('hello world')]),fetchedNormUrls:new Set(),refs});assert.deepEqual(r.rejected.map(x=>x.reason),['duplicate_query','over_limit','unknown_ref','already_fetched','blocked_host','unknown_gap']);});

test('ACC-53 fetched links leave planner inputs and only declared digest paths change', async () => {
  const F = resolve(import.meta.dirname, 'fixtures/world-v1');
  const root = resolve(import.meta.dirname, '../../..');
  const json = path => JSON.parse(readFileSync(path, 'utf8'));
  const caseObj = json(resolve(F, 'case.json'));
  const profile = json(resolve(F, 'profile.json'));
  const config = json(resolve(F, 'run_config.json'));
  const catalog = json(resolve(root, 'docs/contracts/criteria_catalog.grant.v1.json'));
  const domainsCfg = json(resolve(root, 'research/agent/config/official_domains.v1.json'));
  const cache = createBenchCache({ path: ':memory:', namespace: 'acc-53' });
  const plannerInputs = [];
  const outDir = mkdtempSync(resolve(tmpdir(), 'acc-53-'));
  const result = await runCase({
    caseObj,
    profile,
    condition: 'B2',
    seed: 101,
    config,
    outDir,
    deps: {
      transport: createFixtureTransport(F, { condition: 'B2', profileId: profile.profile_id }),
      search: createSearchTool({ provider: 'fixture', transport: createFixtureSearch(F), cache, resultsPerQuery: 10, recency: 'none', clock: () => 0 }),
      fetch: createFetchTool({ transport: createFixtureFetch(F), cache, clock: () => 0 }),
      cache,
      catalog,
      domainsCfg,
      clock: () => '2026-10-20T00:00:00.000Z',
      onPlannerInput: input => plannerInputs.push(structuredClone(input)),
    },
  });
  const logs = readFileSync(resolve(outDir, 'steps.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  cache.close();
  assert.deepEqual(plannerInputs[2].links_unfetched, []);
  assert.deepEqual(plannerInputs[2].gaps.map(gap => gap.gap_id), ['g-6081c557', 'g-bca609ee', 'g-5eff6270']);
  assert.equal(logs.filter(log => log.kind === 'planner_call')[2].data.gaps_offered, 3);
  const current = behaviorDigest({ result, logs, plannerInputs });
  assert.equal(digestSha(current), '4f6e3ef667d333fab8529bde3f7f29a22cbce6e73b9d2b2d67eeaa48d51bb39a');
  const previous = structuredClone(current);
  previous.planner_gaps[2].gaps.push('g-e8e0f6f2');
  previous.planner_calls[2].gaps_offered = 4;
  assert.equal(digestSha(previous), 'ffc4bf0f22dabca69d88068d374bcdd27592fa285483cddb9885e05fe05b4423');
});
