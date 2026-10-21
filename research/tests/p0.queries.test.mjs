import test from 'node:test';
import assert from 'node:assert/strict';
import { queryText, runAgentObjective } from '../server/research/agentic/loop.mjs';

const understood = { product_one_line: 'x', who_pays: 'x', sector: 'x', neighbor_sectors: [], stage: 'x', geography: 'x', assumptions: [], doubts: [] };
const step = (tool, args) => ({ thought: '', assessment: null, notes: [], action: { tool, args, from_lead: null } });

async function run(steps) {
  const users = []; const searched = []; const events = []; const queue = [...steps];
  const chat = async (req) => {
    if (req.name === 'understand') return { json: understood };
    if (req.name === 'agent') { users.push(req.user); return { json: queue.shift() ?? step('finish', { reason: 'done', finalists: [] }) }; }
    return { json: {} };
  };
  const tools = { open: async () => ({ error: 'none' }), search: async ({ query }) => { searched.push(query); return { results: [] }; }, finish: async () => ({ ok: true }), usage: () => ({ opens: 0, searches: searched.length }) };
  await runAgentObjective('investment', { company: 'X' }, { chat, tools, trace: { events, event: (type, data) => events.push({ type, ...data }) }, today: '2026-10-19', parallel: true, secondJudge: 0, env: { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ENGINE_AGENT_REGISTRY_SEED: '0' } });
  return { users, searched, events };
}

test('queryText lee texto u objetos y nunca produce "[object Object]"', () => {
  assert.equal(queryText('abc'), 'abc'); assert.equal(queryText({ query: 'a b' }), 'a b'); assert.equal(queryText({ q: 'z' }), 'z'); assert.equal(queryText(null), ''); assert.equal(queryText({}), '');
});

test('consultas enviadas como objetos se buscan con su texto y no se descartan como duplicadas', async () => {
  const { searched, events } = await run([step('search', { queries: [{ query: 'alpha beta' }, { query: 'gamma delta' }, 'epsilon zeta'] })]);
  assert.deepEqual(searched.sort(), ['alpha beta', 'epsilon zeta', 'gamma delta']);
  assert.equal(events.some((e) => e.type === 'query_skipped'), false);
});

test('una ronda de consultas repetidas devuelve al agente cuáles ya hizo y un aviso; el estado lista las consultas hechas', async () => {
  const { users, searched, events } = await run([step('search', { queries: ['alpha beta', 'gamma delta'] }), step('search', { queries: ['alpha beta', { query: 'Gamma  Delta' }] }), step('finish', { reason: 'done', finalists: [] })]);
  assert.equal(searched.length, 2, 'no se repite ninguna búsqueda');
  assert.equal(events.filter((e) => e.type === 'query_skipped').length, 2);
  const third = users[2]; assert.match(third, /already_searched/); assert.match(third, /Do not repeat them/); assert.match(third, /alpha beta/);
  assert.match(users[1], /"queries_done":\["alpha beta","gamma delta"\]/);
});

test('un paso inválido deja en la traza el texto crudo y los errores de validación', async () => {
  const { events } = await run([{ nonsense: true, text: 'x'.repeat(2000) }, step('finish', { reason: 'done', finalists: [] })]);
  const bad = events.find((e) => e.type === 'model_call' && e.purpose === 'step' && e.ok === false);
  assert.ok(bad, 'hay un paso inválido'); assert.match(bad.raw, /nonsense/); assert.equal(bad.raw.length <= 800, true);
  assert.equal(Array.isArray(bad.validation_errors) && bad.validation_errors.length > 0, true);
  assert.equal(events.filter((e) => e.type === 'model_call' && e.ok === true).every((e) => !('raw' in e)), true, 'las respuestas válidas no guardan texto crudo');
});
