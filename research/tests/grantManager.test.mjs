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
  const plan = grantPlan(lead, brief, new Date('2026-09-30'));
  assert.equal(plan.state, 'eligibility_review');
  // Sin contacto de programa publicado no se sugiere escribir: se aplica en el portal.
  assert.equal(plan.contactQuestion, null);
  const draft = buildDraft({ ...lead, grantPlan: plan }, brief);
  assert.equal(draft.status, 'grant work item');
  assert.match(draft.body, /Where to apply: Grants\.gov Workspace or NIH ASSIST/);
  assert.doesNotMatch(draft.body, /raising|20 minutes|fits your thesis/i);
  // Con un contacto de programa publicado, la pregunta es opcional.
  const withOfficer = opportunity({ person: 'Dana Ruiz', role: 'Program Officer', contact: { type: 'email', value: 'dana.ruiz@nih.gov', provenance: 'Published in the official call' }, eligibility: { verdict: '?', questions: ['Is a foreign component allowed?'] } });
  assert.match(grantPlan(withOfficer, brief, new Date('2026-09-30')).contactQuestion, /foreign component/i);
  // Un helpdesk técnico nunca cuenta como contacto de programa.
  const helpdesk = opportunity({ contact: { type: 'email', value: 'grantsgovsupport@nsf.gov', provenance: 'Published in the official call' }, eligibility: { verdict: '?', questions: ['x?'] } });
  assert.equal(grantPlan(helpdesk, brief, new Date('2026-09-30')).contactQuestion, null);
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

test('NSF 26-511 (SBIR): 35 días no alcanzan para Project Pitch + registro → siguiente ciclo realista', () => {
  const lead = opportunity({ externalId: '26-511', org: 'U.S. National Science Foundation', title: 'NSF Small Business Innovation Research / Small Business Technology Transfer Phase I, Phase II, Fast-Track Programs: A Pilot Emphasis on Scientific Instrumentation', deadline: '2026-11-04', contact: { type: 'email', value: 'grantsgovsupport@nsf.gov', provenance: 'Published in the official call' } });
  const plan = grantPlan(lead, brief, new Date('2026-09-30T12:00:00Z'));
  assert.equal(plan.apply.route, 'nsf_sbir');
  assert.equal(plan.apply.portal.name, 'Research.gov');
  assert.equal(plan.apply.verdict, 'not_feasible');
  assert.equal(plan.apply.nextDeadline, '2027-03-04'); // primer jueves de marzo, como publica NSF 26-511
  assert.equal(plan.label, 'Next cycle');
  assert.match(plan.nextAction, /Project Pitch/);
  assert.equal(plan.contactQuestion, null);
  const draft = buildDraft({ ...lead, grantPlan: plan }, brief);
  assert.match(draft.body, /Research\.gov/);
  assert.match(draft.body, /No need to write to anyone/);
  // Con la organización ya registrada sigue sin alcanzar: el Pitch solo ya son ~30 días + propuesta.
  assert.notEqual(grantPlan(lead, { ...brief, registered: true }, new Date('2026-09-30T12:00:00Z')).apply.verdict, 'feasible');
  // Con tiempo de sobra es factible.
  assert.equal(grantPlan({ ...lead, deadline: '2027-07-07' }, brief, new Date('2026-09-30T12:00:00Z')).apply.verdict, 'feasible');
});
