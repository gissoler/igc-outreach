import test from 'node:test';
import assert from 'node:assert/strict';
import { attachGrantPlans, diversifyGrantHits, finalizeSearchAudit, grantPlan, grantQueries } from '../server/research/grantManager.mjs';
import { buildDraft, candidate, evidence, evaluate, makePlan } from '../server/research/core.mjs';

const brief = { company: 'Mentiva', venture: 'Mentiva', industry: 'mental health', geography: 'California, US', criteria: 'youth; public health policy', minDays: 30, fundingTypes: ['grant'], mode: 'financial', amount: null, exclusions: '', constraints: '', stage: 'prototype' };
const source = () => evidence('Grants.gov', 'https://www.grants.gov/search-results-detail/1', 'Youth mental health program', 'opportunity');
const opportunity = (patch = {}) => candidate({ externalId: 'NOFO-123', org: 'NIH', title: 'Youth mental health innovation', kind: 'opportunity', fundingType: 'grant', status: 'open', deadline: '2027-12-01', evidence: [source()], missing: [], foundBy: [{ provider: 'Grants.gov', term: 'public health policy', query: 'public health policy', objective: 'grant' }], ...patch });

test('grant discovery searches topic, geography and policy themes separately', () => {
  const q = grantQueries(brief, { query: 'mental health', topic: 'health', terms: [{ term: 'behavioral health' }] });
  assert.ok(q.some((x) => x.dimension === 'topic' && x.query === 'public health policy'));
  assert.ok(q.some((x) => x.dimension === 'geography' && /California/.test(x.query)));
  assert.ok(q.length <= 8);
});

test('grant-only plan uses official sources and does not schedule paid web enrichment', () => {
  const plan = makePlan({ ...brief, product: 'stress app', description: 'mental health support', stage: 'prototype', useApify: true });
  const providers = plan.items.map((x) => x.provider).join(' ');
  assert.match(providers, /Grants.gov/);
  assert.match(providers, /NIH RePORTER/);
  assert.match(providers, /Open web opportunities/);
  assert.doesNotMatch(providers, /ScrapeGraph|Exa|Serper/);
});

test('grant hits are diversified by agency before detail fetch', () => {
  const hits = [1, 2, 3, 4].map((id) => ({ id, agency: 'NIH' })).concat([{ id: 5, agency: 'NSF' }, { id: 6, agency: 'EU' }]);
  assert.deepEqual(diversifyGrantHits(hits, 4).map((x) => x.id), [1, 5, 6, 2]);
});

test('search audit shows which exact queries produced priority results', () => {
  const rows = finalizeSearchAudit([{ provider: 'Grants.gov', query: 'digital health', dimension: 'topic', returned: 15 }], [{ bucket: 'top', foundBy: [{ provider: 'Grants.gov', query: 'digital health' }] }]);
  assert.deepEqual(rows[0], { provider: 'Grants.gov', query: 'digital health', dimension: 'topic', returned: 15, discovered: 1, priority: 1, watch: 0, discarded: 0 });
});

test('grant plan is a go/no-go work item, never a fundraising pitch', () => {
  const lead = opportunity({ eligibility: { verdict: '?', questions: ['Is a foreign component allowed?'] }, daysToDeadline: 80 });
  const plan = grantPlan(lead, brief);
  assert.equal(plan.state, 'eligibility_review');
  assert.match(plan.contactQuestion, /foreign component/i);
  const draft = buildDraft({ ...lead, grantPlan: plan }, brief);
  assert.equal(draft.status, 'grant work item');
  assert.doesNotMatch(draft.body, /raising|20 minutes|fits your thesis/i);
});

test('closed and historical NIH records cannot become actionable grants', () => {
  assert.equal(grantPlan(opportunity({ status: 'closed', daysToDeadline: -2 }), brief).decision, 'no_go');
  const [past] = evaluate([candidate({ externalId: 'past', org: 'NIH', title: 'Funded project', kind: 'research', fundingType: 'grant', evidence: [source()] })], brief, new Set(), new Date('2026-09-29'));
  assert.equal(past.bucket, 'discarded');
  assert.match(past.discard, /Historical grant intelligence/);
  assert.equal(attachGrantPlans([past], brief)[0].grantPlan, undefined);
});

test('grant ranking does not require a warm path, person or public email', () => {
  const [lead] = evaluate([opportunity()], brief, new Set(), new Date('2026-09-29'));
  assert.equal(lead.bucket, 'top');
  assert.equal(lead.breakdown.find((x) => x.factor === 'path').max, 0);
  assert.ok(!lead.missing.includes('No named decision-maker'));
  assert.ok(!lead.missing.includes('No public email'));
});
