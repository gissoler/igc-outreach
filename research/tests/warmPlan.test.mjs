import test from 'node:test';
import assert from 'node:assert/strict';
import { addWarmPlans, monthsToRound, planWarmPath } from '../server/research/warmPlan.mjs';

const now = new Date('2026-01-01T00:00:00Z');
test('monthsToRound reads quarters, months and years', () => {
  assert.equal(monthsToRound('Q2 2026', now), 3);
  assert.equal(monthsToRound('in 6 months', now), 6);
  assert.equal(monthsToRound('', now), null);
});
test('every non-discarded candidate gets a warm path; without a network path it is built with updates', () => {
  const brief = { name: 'Gisel', timeline: 'Q4 2026' };
  const [fund, grant, intro, gone] = addWarmPlans([
    { id: 'a', person: 'Trip Hofer', org: '.406 Ventures', fundingType: 'investment', bucket: 'top', paths: [] },
    { id: 'b', org: 'NIH', title: 'R21', kind: 'opportunity', fundingType: 'grant', bucket: 'top', paths: [], daysToDeadline: 90 },
    { id: 'c', person: 'Erin', org: 'Hopelab', fundingType: 'investment', bucket: 'top', paths: [{ nodes: ['Gisel', 'Andres', 'Erin'], strength: 0.6, hops: [] }] },
    { id: 'd', person: 'X', org: 'Y', bucket: 'discarded', paths: [] },
  ], brief, { now });
  assert.equal(fund.warmPlan.route, 'updates');
  assert.ok(fund.warmPlan.updates >= 2 && fund.warmPlan.cadenceDays);
  assert.match(fund.warmPlan.steps.at(-1).what, /meeting/);
  assert.equal(grant.warmPlan.route, 'program_officer');
  assert.equal(intro.warmPlan.route, 'intro');
  assert.equal(intro.warmPlan.via, 'Andres');
  assert.equal(gone.warmPlan, undefined);
  assert.equal(planWarmPath({ bucket: 'top', person: 'A', org: 'B', fundingType: 'partnering', paths: [] }, brief, { now }).route, 'advice');
});

test('no network path: the plan is dynamic, picked from the candidate evidence', async () => {
  const { findAngle } = await import('../server/research/warmPlan.mjs');
  const e = (id, quote) => ({ id, url: `https://example.com/${id}`, quote, source: 'web' });
  const brief = { name: 'Gisel', company: 'Mentiva', timeline: '6 months' };
  const talk = planWarmPath({ bucket: 'top', person: 'Ana Ruiz', org: 'Fund', fundingType: 'investment', paths: [], evidence: [e('E1', 'Ana Ruiz is a speaker at the Digital Health Summit 2026')] }, brief, { now });
  assert.equal(talk.route, 'event');
  assert.equal(talk.evidence.id, 'E1');
  assert.match(talk.steps[0].what, /talk/);
  const pod = planWarmPath({ bucket: 'top', person: 'Bo Li', org: 'Fund', fundingType: 'investment', paths: [], evidence: [e('E2', 'Bo Li on the Health Tech podcast episode about burnout')] }, brief, { now });
  assert.equal(pod.route, 'content');
  const portfolio = planWarmPath({ bucket: 'top', person: 'Cy', org: 'Fund', fundingType: 'investment', paths: [], evidence: [e('E3', 'Fund led the seed round of Calmly')] }, brief, { now });
  assert.equal(portfolio.route, 'portfolio_founder');
  const none = planWarmPath({ bucket: 'top', person: 'Di', org: 'Fund', fundingType: 'investment', paths: [], evidence: [e('E4', 'Di, Partner')] }, brief, { now });
  assert.equal(none.route, 'updates');
  assert.equal(findAngle({ affiliations: ['Stanford University'], evidence: [] }, { affiliations: ['Stanford'] }).route, 'shared_affiliation');
});

test('creative warm paths (AI) only replace the plan when they cite real evidence', async () => {
  const { createRunEnrichers } = await import('../server/analysis/routes.mjs');
  const store = { analysis: { dealCount: () => 0 }, get: () => null };
  const env = { VLLM_BASE: 'http://fleet/v1', VLLM_CHAT_MODEL: 'm' };
  const answers = [
    { route: 'content', label: 'Reply to her burnout essay', hook: 'She wrote about burnout in knowledge workers.', first_move: 'Reply to her essay with Mentiva pilot data.', second_move: 'Ask her one question.', why: 'Shared topic.', evidence_id: 'E1' },
    { route: 'event', label: 'Invented', hook: 'x', first_move: 'y', second_move: '', why: '', evidence_id: 'E999' },
  ];
  const fetcher = async () => { const body = JSON.stringify({ choices: [{ message: { content: JSON.stringify(answers.shift()) } }] }); return { ok: true, status: 200, text: async () => body }; };
  const step = createRunEnrichers({ store, env, fetcher }).find((x) => x.name === 'Creative warm paths');
  const mk = (id, score) => ({ id, person: `P${id}`, org: 'F', bucket: 'top', score, fundingType: 'investment', evidence: [{ id: 'E1', url: 'https://ex.com/a', quote: 'Essay on burnout', source: 'web' }], warmPlan: { route: 'updates', label: 'Build', built: false, why: '', steps: [{ when: null, what: 'Ask for feedback' }, { when: null, what: 'First investor update' }, { when: null, what: 'Ask for a meeting' }] } });
  const job = { brief: { name: 'G' }, leads: [mk('a', 90), mk('b', 80)] };
  const r = await step.run(job, {});
  assert.equal(r.count, 1);
  assert.equal(job.leads[0].warmPlan.source, 'ai');
  assert.equal(job.leads[0].warmPlan.route, 'content');
  assert.match(job.leads[0].warmPlan.steps[0].what, /essay/);
  assert.ok(job.leads[0].warmPlan.steps.some((s) => /meeting/.test(s.what)), 'keeps the updates and the final ask');
  assert.equal(job.leads[1].warmPlan.route, 'updates', 'uncited answer rejected');
});
