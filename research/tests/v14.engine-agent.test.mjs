import test from 'node:test';
import assert from 'node:assert/strict';
import { runObjective } from '../server/research/engine.mjs';

const brief = { company: 'IGC', industry: 'Alzheimer data', stage: 'seed', fundingTypes: ['grant'] };
const search = async () => [];
const chat = async ({ name }) => name === 'plan'
  ? { json: { queries: [{ query: 'Alzheimer grants 2026', family: 'grant' }, { query: 'NIH Alzheimer 2026', family: 'NIH' }, { query: 'health challenge 2026', family: 'challenge' }] } }
  : { json: {} };

test('F2.5 sin bandera la salida permanece idéntica', async () => {
  const a = await runObjective('grant', brief, { env: {}, search, chat, rounds: 1 });
  const b = await runObjective('grant', brief, { env: { ENGINE_AGENT: '0' }, search, chat, rounds: 1 });
  assert.deepEqual(b, a);
});

test('F2.5 con bandera y rol usa el agente y devuelve leads', async () => {
  const expected = { findings: [], leads: [{ id: 'L1' }], audit: { objective: 'grant', agent: { on: true, ready: true } }, queries: [] };
  const agentRunner = async () => expected;
  const result = await runObjective('grant', brief, { env: { ENGINE_AGENT: '1', ENGINE_AGENT_LLM_URL: 'http://agent/v1', ENGINE_AGENT_LLM_MODEL: 'agent' }, agentRunner });
  assert.deepEqual(result, expected); assert.equal(result.audit.agent.ready, true);
});

test('F2.5 con bandera sin rol usa el motor actual y deja notice', async () => {
  const result = await runObjective('grant', brief, { env: { ENGINE_AGENT: '1' }, search, chat, rounds: 1 });
  assert.equal(result.findings.length, 0); assert.equal(result.audit.agent.on, true); assert.equal(result.audit.agent.ready, false);
  assert.match(result.audit.agent.notice, /not both configured/);
});
