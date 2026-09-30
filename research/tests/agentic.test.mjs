import test from 'node:test';
import assert from 'node:assert/strict';
import { candidate, dedupe, evaluate, evidence } from '../server/research/core.mjs';
import { makeClient } from '../server/research/providers.mjs';
import { selectFunders, teamPagesFor } from '../server/research/followup.mjs';
import { verifyFunderFacts } from '../server/research/read.mjs';
import { assessSufficiency } from '../server/research/sufficiency.mjs';
import { nextQueries, runAgenticLoop } from '../server/research/loop.mjs';
import { createApp } from '../server/index.mjs';
import { createStore } from '../server/research/store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const brief = {
  name: 'Founder', company: 'Own Co', organization: 'Own Co', venture: 'Own Co',
  industry: 'data harmonization', description: 'Research data platform', product: 'Atlas',
  stage: 'prototype', round: 'pre-seed', geography: 'US', fundingTypes: ['investment'],
  exclusions: '', criteria: '', mode: 'financial', minDays: 0,
};
const source = (url = 'https://acme.vc/thesis') => evidence('Fixture', url, 'We invest in data harmonization companies.', 'title');
const fund = (patch = {}) => candidate({ externalId: 'fund:acme', org: 'acme.vc', title: 'Data fund', fundingType: 'investment', evidence: [source()], contact: { type: 'source', value: 'https://acme.vc/thesis' }, searchText: 'data harmonization', ...patch });

test('candidate attribution survives dedupe and expanded terms affect fit explanation', () => {
  const merged = dedupe([
    fund({ foundBy: [{ provider: 'Exa', term: 'data harmonization', objective: 'investment', query: 'q1' }] }),
    fund({ foundBy: [{ provider: 'Serper', term: 'data standardization', objective: 'investment', query: 'q2' }] }),
  ]);
  assert.equal(merged[0].foundBy.length, 2);
  const ranked = evaluate([fund({ searchText: 'data standardization' })], { ...brief, industry: 'biotech' }, new Set(), new Date(), [{ term: 'data standardization' }]);
  assert.ok(ranked[0].fit > 0);
  assert.match(ranked[0].why[0], /data standardization/);
});

test('HTTP client exposes calls, results, time, bytes and configurable cost by source', async () => {
  const client = makeClient({
    env: { COST_EXA_PER_CALL: '0.02', RESEARCH_TIMEOUT_MS: '1000' },
    fetcher: async (url) => new Response(JSON.stringify({ results: [{ url }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  }).scope('Exa');
  await Promise.all(['a.example', 'b.example', 'c.example'].map((host) => client.json(`https://${host}/search`)));
  const usage = client.usage().Exa;
  assert.equal(usage.calls, 3);
  assert.equal(usage.results, 3);
  assert.equal(usage.costUsd, 0.06);
  assert.ok(usage.bytes > 0 && usage.ms >= 0);
});

test('follow-up selects only external verified funders and respects page/robots failures', async () => {
  const selected = selectFunders([fund(), fund({ externalId: 'own', org: 'Own Co', contact: { type: 'source', value: 'https://own.example' } }), fund({ externalId: 'no-evidence', org: 'other.vc', evidence: [] })], brief, { max: 2 });
  assert.deepEqual(selected.map((item) => item.host), ['acme.vc']);
  const calls = [];
  const pages = await teamPagesFor(selected[0], {
    env: { FIRECRAWL_API_KEY: 'x' }, maxPages: 2,
    search: async () => [{ url: 'https://acme.vc/team', title: 'Team' }, { url: 'https://acme.vc/people', title: 'People' }],
    client: { page: async (url) => { calls.push(url); if (url.endsWith('/team')) throw new Error('Read skipped by robots.txt.'); return 'Jane Roe General Partner '.repeat(10); } },
  });
  assert.equal(pages.pages.length, 2);
  assert.ok(pages.pages.every((page) => !page.url.endsWith('/team')));
  assert.match(pages.errors[0], /robots/);
  assert.ok(calls.length <= 3);
});

test('read verification drops invented quotes and unsupported figures', () => {
  const text = 'Acme invests in data harmonization. Jane Roe is General Partner. Our first investment was announced on 2026-01-15.';
  const verified = verifyFunderFacts({
    funder_type: 'vc',
    invests_in: [{ text: 'data harmonization', quote: 'invests in data harmonization' }, { text: 'quantum', quote: 'invented quote' }],
    stages: [], geographies: [], ticket: [{ text: '$50 million', quote: 'Acme invests in data harmonization' }],
    last_activity: { date: '2026-01-15', quote: 'announced on 2026-01-15' },
    decision_makers: [{ name: 'Jane Roe', title: 'General Partner', quote: 'Jane Roe is General Partner' }],
  }, text);
  assert.equal(verified.facts.invests_in.length, 1);
  assert.equal(verified.facts.ticket.length, 0);
  assert.equal(verified.facts.decision_makers.length, 1);
  assert.ok(verified.dropped.length >= 2);
});

test('sufficiency keeps unknown dimensions explicit and detects contradictions', () => {
  const lead = fund({ facts: {
    funder_type: 'vc', invests_in: [{ text: 'data harmonization', quote: 'x' }], stages: [{ text: 'Series B', quote: 'x' }], geographies: [], ticket: [],
    last_activity: { date: '2026-01-15', quote: 'x' }, decision_makers: [{ name: 'Jane Roe', title: 'Partner', quote: 'x' }],
  } });
  const result = assessSufficiency(lead, brief, { now: new Date('2026-09-29'), terms: ['data harmonization'] });
  assert.equal(result.items.funds_space.status, 'confirmed');
  assert.equal(result.items.stage_fit.status, 'contradictory');
  assert.equal(result.items.geo_fit.status, 'unknown');
  assert.equal(result.verdict, 'contradictory');
});

test('controlled loop maps gaps to queries, records ledger and stops on stagnation', async () => {
  const initial = fund({ sufficiency: { gaps: ['decider'] } });
  assert.match(nextQueries([initial], brief)[0].query, /partners team/);
  let calls = 0;
  const result = await runAgenticLoop({
    leads: [initial], brief, terms: ['data harmonization'],
    env: { LOOP_MAX_ROUNDS: '2', LOOP_MAX_SEARCHES: '3', LOOP_BUDGET_MS: '10000' },
    search: async () => { calls++; return []; },
  });
  assert.equal(result.stopReason, 'stagnation');
  assert.ok(result.queryLedger.length > 0);
  assert.equal(result.queryLedger[0].round, 1);
  assert.ok(calls <= 3);
});

test('anonymous daily run N+1 is rejected with 429', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outreach-limit-'));
  const store = createStore(join(dir, 'research.sqlite'));
  const app = createApp({
    store, env: { RESEARCH_MAX_RUNS_PER_DAY: '1', RESEARCH_BROWSER: 'off' }, browser: null,
    pipeline: async (job, target) => { job.status = 'done'; job.finishedAt = new Date().toISOString(); target.save(job); },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const body = { ...brief, role: 'Founder', dataMode: 'live', useTeam: false, useApify: false, excludeCompetitors: false, strictTypes: false, amount: null, event: '' };
  const post = () => fetch(`http://127.0.0.1:${port}/api/research/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post()).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  const limited = await post();
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'DAILY_RUN_LIMIT');
  await app.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
