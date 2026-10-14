import test from 'node:test';
import assert from 'node:assert/strict';
import { runObjective } from '../server/research/engine.mjs';
test('seedOnly (verificación del registro) no relanza el agente', async () => {
  let agentCalls = 0;
  const env = { ENGINE_AGENT: '1', ENGINE_AGENT_LLM_URL: 'http://x/v1', ENGINE_AGENT_LLM_MODEL: 'm' };
  const runner = async () => { agentCalls++; return { findings: [], leads: [], audit: {}, queries: [] }; };
  try { await runObjective('grant', { fundingTypes: ['grant'] }, { env, seedOnly: true, seedPages: [], agentRunner: runner, search: async () => [], chat: async () => ({ json: {} }) }); } catch {}
  assert.equal(agentCalls, 0);
  await runObjective('grant', { fundingTypes: ['grant'] }, { env, agentRunner: runner });
  assert.equal(agentCalls, 1);
});
