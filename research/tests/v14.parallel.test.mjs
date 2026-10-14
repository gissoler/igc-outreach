import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';

const understood = { product_one_line: 'Alzheimer risk software', who_pays: 'health systems', sector: 'health', neighbor_sectors: [], stage: 'seed', geography: 'US', assumptions: [], doubts: [] };
const pageText = 'Official Program. Application deadline is December 15, 2026. Eligible for-profit companies in the United States. Funds Alzheimer research. This is a grant with no equity.';
const quoteOf = { deadline: 'Application deadline is December 15, 2026.', topic_fit: 'Funds Alzheimer research.', non_dilutive: 'This is a grant with no equity.', official: 'Official Program.' };
const criteria = Object.fromEntries(AGENT_CRITERIA.grant.map((id) => [id, { verdict: 'yes', quote: quoteOf[id] || 'Eligible for-profit companies in the United States.', reason: 'stated' }]));
const dates = [{ role: 'application_deadline', date: '2026-12-15', estimated: false, quote: 'Application deadline is December 15, 2026.' }];
const assessment = (ref) => ({ ref, page_type: 'call', about: 'Official Program', dates, date_missing_next: null, criteria, candidate: true, lead: null });
const judgment = { page_type: 'call', dates, criteria: Object.fromEntries(Object.entries(criteria).map(([id, c]) => [id, { ...c, compiler: 'agree' }])) };
const step = (tool, args) => ({ thought: 'next', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const traceOf = () => { const events = []; return { events, event: (type, data) => events.push({ type, ...data }) }; };

function setup() {
  const flight = { now: 0, max: 0 }; const calls = []; let n = 0;
  const hold = async () => { flight.now++; flight.max = Math.max(flight.max, flight.now); await new Promise((r) => setTimeout(r, 30)); flight.now--; };
  const trace = traceOf();
  const tools = {
    search: async (args) => { calls.push(['search', args.query]); await hold(); return { results: [{ ref: `s${calls.length}.1`, url: `https://example.org/${calls.length}`, title: args.query, snippet: 'x' }] }; },
    open: async (args) => { calls.push(['open', args.ref]); await hold(); const ref = `p${++n}`; return { ref, url: `https://example.org/p${n}`, title: 'Program', chars: pageText.length, text: `<page_data>${pageText}</page_data>`, links: [{ ref: `${ref}.l1`, text: 'More', url: 'https://example.org/more' }] }; },
    note: async () => ({ ok: true }), ask_user: async () => ({ answered: false }), finish: async () => ({ ok: true }), apollo: async () => ({ rows: [] }), entity_funding: async () => ({ rows: [] }), registry: async () => ({ rows: [] }),
    usage: () => ({ searches: calls.filter((c) => c[0] === 'search').length, opens: n, apollo_credits: 0 }), trace,
  };
  return { tools, trace, flight, calls };
}
const chatBy = (agentSteps, seen = []) => async (req) => {
  seen.push(req.name);
  if (req.name === 'understand') return { json: understood, model: 'fixture' };
  if (req.name === 'agent') return { json: agentSteps.shift(), model: 'fixture' };
  if (req.name === 'assess') return { json: assessment(String(req.user.match(/Page ref: (\S+?)\./)?.[1])), model: 'fixture' };
  return { json: judgment, model: 'fixture' };
};

test('F2.7 abre varias páginas y busca varias consultas a la vez, evalúa cada página y juzga en paralelo', async () => {
  const { tools, trace, flight, calls } = setup(); const seen = [];
  const steps = [step('search', { queries: ['a one', 'b two', 'c three'] }), step('open', { refs: ['s1.1', 's2.1', 's3.1'] }), step('finish', { reason: 'done', finalists: ['p1', 'p2', 'p3'] })];
  const result = await runAgentObjective('grant', { company: 'IGC' }, { chat: chatBy(steps, seen), tools, trace, today: '2026-10-12', parallel: true, secondJudge: 3, env: { ENGINE_AGENT_STEPS: '10' } });
  assert.equal(calls.filter((c) => c[0] === 'search').length, 3); assert.equal(calls.filter((c) => c[0] === 'open').length, 3);
  assert.equal(flight.max >= 3, true, 'las llamadas de herramienta salen a la vez');
  assert.equal(seen.filter((x) => x === 'assess').length, 3); assert.equal(seen.filter((x) => x === 'agent').length, 3);
  assert.equal(result.findings.length, 3); assert.equal(result.queries.length, 3); assert.equal(result.audit.judge.calls, 3); assert.equal(result.audit.judge.second_blind_calls, 3);
});

test('F2.7 el agente recibe resúmenes de páginas (qué es, tipo, candidata, enlaces) y no el texto completo', async () => {
  const { tools, trace } = setup(); const users = []; const base = chatBy([step('search', { queries: ['a one'] }), step('open', { refs: ['s1.1'] }), step('finish', { reason: 'done', finalists: [] })]);
  const chat = async (req) => { if (req.name === 'agent') users.push(req.user); return base(req); };
  await runAgentObjective('grant', { company: 'IGC' }, { chat, tools, trace, today: '2026-10-12', parallel: true, secondJudge: 0 });
  const last = users[users.length - 1]; assert.equal(users.length, 3);
  assert.match(last, /"type":"pages"/); assert.match(last, /Official Program/); assert.match(last, /"p1\.l1"/); assert.equal(last.includes('Funds Alzheimer research.'), false);
});

test('F2.7 sin parallel el comportamiento secuencial no cambia (open de un ref y evaluación del agente)', async () => {
  const { tools, trace } = setup(); const seen = [];
  const withAssessment = (ref) => ({ ...step('finish', { reason: 'done', finalists: ['p1'] }), assessment: assessment(ref) });
  const steps = [step('search', { query: 'a one' }), step('open', { ref: 's1.1' }), withAssessment('p1')]; 
  const result = await runAgentObjective('grant', { company: 'IGC' }, { chat: chatBy(steps, seen), tools, trace, today: '2026-10-12', secondJudge: 0 });
  assert.equal(seen.includes('assess'), false); assert.equal(result.findings.length, 1);
});

test('F2.7 al llegar el tope de tiempo cierra, juzga lo que hay y no pasa de la reserva', async () => {
  const { tools, trace } = setup();
  const steps = Array.from({ length: 20 }, () => step('search', { queries: ['x one'] }));
  const t0 = Date.now(); const result = await runAgentObjective('grant', { company: 'IGC' }, { chat: chatBy(steps), tools, trace, today: '2026-10-12', parallel: true, secondJudge: 0, maxSeconds: 1, hardSeconds: 1, reserveSeconds: 0 });
  assert.equal(result.audit.agent.stop_reason, 'time'); assert.equal(Date.now() - t0 < 5000, true);
});

test('F2.7 una página que el modelo rápido no devuelve válida se reporta como fallida sin romper el paso', async () => {
  const { tools, trace } = setup(); const agent = chatBy([step('search', { queries: ['a one'] }), step('open', { refs: ['s1.1'] }), step('finish', { reason: 'done', finalists: [] })]);
  const users = []; const chat = async (req) => { if (req.name === 'agent') users.push(req.user); return req.name === 'assess' ? { json: {}, model: 'fixture' } : agent(req); };
  const result = await runAgentObjective('grant', { company: 'IGC' }, { chat, tools, trace, today: '2026-10-12', parallel: true, secondJudge: 0 });
  assert.equal(result.findings.length, 0); assert.equal(trace.events.filter((x) => x.type === 'model_call' && x.role === 'assess' && x.invalid).length, 2);
  assert.equal(users.some((u) => u.includes("assess_invalid")), true);
});
