import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_MAX_TOKENS_DEFAULTS, agentMaxTokens, chatJSON } from '../server/analysis/fleet.mjs';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';

const understood = { product_one_line: 'x', who_pays: 'x', sector: 'x', neighbor_sectors: [], stage: 'x', geography: 'x', assumptions: [], doubts: [] };
const step = (tool, args) => ({ thought: 'next', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const traceOf = () => { const events = []; return { events, event: (type, data) => events.push({ type, ...data }) }; };
const tools = (trace) => ({
  search: async () => ({ results: [{ ref: 's1.1', url: 'https://example.org/a', title: 'a', snippet: '' }] }),
  open: async () => ({ ref: 'p1', url: 'https://example.org/a', title: 'A', chars: 10, text: '<page_data>Some page text.</page_data>', links: [] }),
  note: async () => ({ ok: true }), ask_user: async () => ({ answered: false }), finish: async () => ({ ok: true }), apollo: async () => ({ rows: [] }), entity_funding: async () => ({ rows: [] }), registry: async () => ({ rows: [] }),
  usage: () => ({ searches: 0, opens: 0, apollo_credits: 0 }), trace,
});

test('P0.2 defaults por propósito y variables de entorno para cambiarlos', () => {
  assert.deepEqual({ ...AGENT_MAX_TOKENS_DEFAULTS }, { understand: 500, step: 400, assess: 2000, judge: 900 });
  assert.equal(agentMaxTokens('assess', {}), 2000);
  assert.equal(agentMaxTokens('assess', { ENGINE_AGENT_ASSESS_MAX_TOKENS: '1200' }), 1200);
  assert.equal(agentMaxTokens('step', { ENGINE_AGENT_STEP_MAX_TOKENS: '0' }), 0, '"0" desactiva el tope del agente');
  assert.equal(agentMaxTokens('judge', { ENGINE_AGENT_JUDGE_MAX_TOKENS: '' }), 900, 'vacío vuelve al defecto');
  assert.equal(agentMaxTokens('judge', { ENGINE_AGENT_JUDGE_MAX_TOKENS: 'abc' }), 0);
  assert.equal(agentMaxTokens('unknown', {}), 0);
});

test('P0.2 el bucle envía max_tokens distinto por comprensión, paso, lectura y juez, y lo deja en la traza', async () => {
  const seen = {}; const trace = traceOf(); const steps = [step('open', { refs: ['s1.1'] }), step('finish', { reason: 'done', finalists: [] })];
  const chat = async (req) => {
    seen[req.name] ??= req.maxTokens;   // la primera llamada de cada propósito (el reintento mínimo usa su propio tope)
    if (req.name === 'understand') return { json: understood, model: 'fixture' };
    if (req.name === 'agent') return { json: steps.shift(), model: 'fixture' };
    if (req.name === 'assess') return { json: {}, model: 'fixture' };
    return { json: {}, model: 'fixture' };
  };
  const env = { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ENGINE_AGENT_STEP_MAX_TOKENS: '333', ENGINE_AGENT_ASSESS_MAX_TOKENS: '444' };
  await runAgentObjective('grant', { company: 'X' }, { chat, tools: tools(trace), trace, today: '2026-10-19', parallel: true, secondJudge: 0, env });
  assert.equal(seen.understand, 500); assert.equal(seen.agent, 333); assert.equal(seen.assess, 444);
  const call = trace.events.find((e) => e.type === 'model_call' && e.purpose === 'step');
  assert.equal(call.max_tokens, 333);
});

test('P0.2 sin tope configurado no se envía max_tokens', async () => {
  const seen = []; const trace = traceOf(); const steps = [step('finish', { reason: 'done', finalists: [] })];
  const chat = async (req) => { seen.push([req.name, 'maxTokens' in req]); return req.name === 'understand' ? { json: understood } : { json: steps.shift() }; };
  const env = { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ENGINE_AGENT_UNDERSTAND_MAX_TOKENS: '0', ENGINE_AGENT_STEP_MAX_TOKENS: '0' };
  await runAgentObjective('grant', { company: 'X' }, { chat, tools: tools(trace), trace, today: '2026-10-19', secondJudge: 0, env, maxSteps: 1 });
  assert.deepEqual(seen, [['understand', false], ['agent', false]]);
});

test('P0.2 chatJSON envía max_tokens y distingue una salida cortada por el tope (finish_reason=length) con su uso', async () => {
  const bodies = [];
  const fetcher = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ model: 'm', choices: [{ finish_reason: 'length', message: { content: '{"a": "trunc' } }], usage: { prompt_tokens: 50, completion_tokens: 700 } }), { status: 200 }); };
  const env = { COMPILER_LLM_URL: 'http://x/v1', COMPILER_LLM_MODEL: 'm' };
  await assert.rejects(chatJSON({ system: 's', user: 'u', role: 'compiler', maxTokens: 700 }, { env, fetcher }), (e) => {
    assert.equal(e.code, 'MODEL_TRUNCATED'); assert.equal(e.usage.completion_tokens, 700); assert.match(e.message, /700/); return true;
  });
  assert.equal(bodies[0].max_tokens, 700);
});
