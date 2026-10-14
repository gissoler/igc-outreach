import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { engineLeads } from '../server/research/engine.mjs';

const understood = { product_one_line: 'Alzheimer risk software', who_pays: 'health systems', sector: 'health', neighbor_sectors: ['biotech'], stage: 'seed', geography: 'US', assumptions: [], doubts: [] };
const pageText = 'Official Program. Application deadline is December 15, 2026. Eligible for-profit companies in the United States. Funds Alzheimer research. This is a grant with no equity.';
const quote = { verdict: 'yes', quote: 'Eligible for-profit companies in the United States.', reason: 'stated' };
const assessment = { ref: 'p1', page_type: 'call', about: 'Official Program', dates: [{ role: 'application_deadline', date: '2026-12-15', estimated: false, quote: 'Application deadline is December 15, 2026.' }], date_missing_next: null, criteria: {
  deadline: { verdict: 'yes', quote: 'Application deadline is December 15, 2026.', reason: 'future' }, eligibility: quote, region: quote, entity_type: quote, stage: quote,
  topic_fit: { verdict: 'yes', quote: 'Funds Alzheimer research.', reason: 'fit' }, non_dilutive: { verdict: 'yes', quote: 'This is a grant with no equity.', reason: 'grant' }, official: { verdict: 'yes', quote: 'Official Program.', reason: 'official' },
}, candidate: true, lead: null };
const step = (action, a = null) => ({ thought: 'next', assessment: a, notes: [], action: { tool: action.tool, args: action.args || {}, from_lead: action.from_lead || null } });
const judgment = (topic = 'yes') => ({ page_type: 'call', dates: assessment.dates, criteria: Object.fromEntries(Object.entries(assessment.criteria).map(([id, c]) => [id, id === 'topic_fit' && topic === 'no' ? { verdict: 'no', quote: 'Funds Alzheimer research.', reason: 'not a fit', compiler: 'disagree' } : { ...c, compiler: 'agree' }])) });
const traceOf = () => { const events = []; return { events, event: (type, data) => events.push({ type, ...data }) }; };
const toolsOf = (trace) => ({
  search: async (args) => ({ results: [{ ref: 's1.1', url: 'https://example.org', title: args.query }] }), open: async () => ({ ref: 'p1', url: 'https://example.org', title: 'Program', text: `<page_data>${pageText}</page_data>`, links: [] }),
  note: async () => ({ ok: true }), ask_user: async () => ({ answered: false }), finish: async () => ({ ok: true }),
  apollo: async () => ({ rows: [] }), entity_funding: async () => ({ rows: [] }), registry: async () => ({ rows: [] }), usage: () => ({ searches: 1, opens: 1, apollo_credits: 0 }), trace,
});
const scripted = (items) => async () => ({ json: items.shift(), model: 'fixture', usage: { prompt_tokens: 1, completion_tokens: 1 } });
const initial = { type: 'page', ref: 'p1', url: 'https://example.org', title: 'Program', text: `<page_data>${pageText}</page_data>` };
const run = (items, extra = {}) => { const trace = traceOf(); return runAgentObjective('grant', { company: 'IGC' }, { chat: scripted(items), tools: toolsOf(trace), trace, today: '2026-10-12', secondJudge: 0, ...extra }).then((result) => ({ result, trace })); };

test('F2.4 sigue una pista y busca con from_lead', async () => {
  const lead = { ...assessment, candidate: false, lead: { kind: 'funding_news', funder: 'Funder', recipient: 'Company', amount: null, quote: 'Funds Alzheimer research.', next: ['similar funders'] } };
  const { result, trace } = await run([understood, step({ tool: 'search', args: { query: 'similar funders' }, from_lead: 'L1' }, lead), step({ tool: 'finish', args: { reason: 'done', finalists: [] } })], { initialObservation: initial });
  assert.equal(result.leads.length, 1); assert.equal(result.queries[0].from_lead, 'L1'); assert.equal(trace.events.some((e) => e.type === 'lead_followup'), true);
});
test('F2.4 para por tope de pasos', async () => { const { result, trace } = await run([understood, step({ tool: 'note', args: { text: 'x' } })], { maxSteps: 1 }); assert.equal(result.audit.agent.stop_reason, 'budget'); assert.equal(trace.events.some((e) => e.type === 'finish' && e.reason === 'budget'), true); });
test('F2.4 dos JSON inválidos cuentan un paso y continúa', async () => { const { result } = await run([understood, {}, {}, step({ tool: 'finish', args: { reason: 'done', finalists: [] } })], { maxSteps: 2 }); assert.equal(result.audit.agent.invalid_steps, 1); assert.equal(result.audit.agent.stop_reason, 'done'); });
test('F2.4 yes con cita inventada pasa a unknown', async () => { const bad = structuredClone(assessment); bad.candidate = false; bad.criteria.topic_fit.quote = 'invented quote'; const { result } = await run([understood, step({ tool: 'finish', args: { reason: 'done', finalists: [] } }, bad)], { initialObservation: initial }); assert.equal(result.audit.decisions[0].criteria.topic_fit.verdict, 'unknown'); });
test('F2.4 finalista pasa juez y auditor con fecha y días calculados', async () => { const { result } = await run([understood, step({ tool: 'finish', args: { reason: 'done', finalists: ['p1'] } }, assessment), judgment()], { initialObservation: initial }); assert.equal(result.findings.length, 1); assert.equal(result.findings[0].deadline, '2026-12-15'); assert.equal(result.findings[0].daysLeft, 64); });
test('F2.4 no con cita del juez descarta por judge', async () => { const { result, trace } = await run([understood, step({ tool: 'finish', args: { reason: 'done', finalists: ['p1'] } }, assessment), judgment('no')], { initialObservation: initial }); assert.equal(result.findings.length, 0); assert.equal(trace.events.some((e) => e.type === 'drop' && e.decided_by === 'judge'), true); });
test('F2.4 hallazgos conservan la forma de engineLeads', async () => { const { result } = await run([understood, step({ tool: 'finish', args: { reason: 'done', finalists: ['p1'] } }, assessment), judgment()], { initialObservation: initial }); assert.doesNotThrow(() => engineLeads(result.findings)); });
