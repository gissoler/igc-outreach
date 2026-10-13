import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetConfig, fleetReady, chatJSON } from '../server/analysis/fleet.mjs';

const ENV = {
  COMPILER_LLM_URL: 'http://127.0.0.1:8017/v1/', COMPILER_LLM_MODEL: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
  JUDGE_LLM_URL: 'http://127.0.0.1:8016/v1', JUDGE_LLM_MODEL: 'openai/gpt-oss-120b', JUDGE_LLM_REASONING_EFFORT: 'medium', JUDGE_LLM_JSON_MODE: '0', JUDGE_LLM_TIMEOUT_MS: '300000',
};

test('V13-1 compiler and judge roles are read from COMPILER_LLM_* and JUDGE_LLM_*', () => {
  const r = fleetConfig(ENV).roles;
  assert.deepEqual([r.compiler.ready, r.compiler.url, r.compiler.model], [true, 'http://127.0.0.1:8017/v1', 'Qwen/Qwen3-30B-A3B-Instruct-2507']);
  assert.deepEqual([r.judge.ready, r.judge.jsonMode, r.judge.reasoningEffort, r.judge.timeoutMs], [true, false, 'medium', 300000]);
  assert.equal(r.compiler.jsonMode, true);
});

test('V13-2 without configuration the roles are not ready and nothing replaces them silently', () => {
  assert.equal(fleetReady({}, 'compiler'), false);
  // Con rol engine y chat listos, compiler y judge siguen sin estar listos: no hay respaldo implícito.
  const env = { ENGINE_LLM_URL: 'http://e/v1', ENGINE_LLM_MODEL: 'm', VLLM_CHAT_URL: 'http://c/v1', VLLM_CHAT_MODEL: 'c' };
  const r = fleetConfig(env).roles;
  assert.deepEqual([r.compiler.ready, r.judge.ready, r.compiler.fallback, r.judge.fallback], [false, false, null, null]);
});

test('V13-3 an explicit fallback is used only when requested and is recorded', () => {
  const env = { ENGINE_LLM_URL: 'http://e/v1', ENGINE_LLM_MODEL: 'big', JUDGE_LLM_FALLBACK: 'engine' };
  const r = fleetConfig(env).roles;
  assert.deepEqual([r.judge.ready, r.judge.model, r.judge.fallback], [true, 'big', 'engine']);
  assert.equal(r.compiler.ready, false);
  // Un fallback pedido a un rol que no está listo no lo activa.
  assert.equal(fleetConfig({ JUDGE_LLM_FALLBACK: 'chat' }).roles.judge.ready, false);
});

test('V13-4 chatJSON uses the per-role timeout and the role model, and engine behaviour is unchanged', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body), aborted: init.signal instanceof AbortSignal });
    return { ok: true, text: async () => JSON.stringify({ model: 'x', choices: [{ message: { content: '{"ok":true}' } }] }) };
  };
  const out = await chatJSON({ system: 's', user: 'u', name: 'judge', role: 'judge' }, { env: ENV, fetcher });
  assert.deepEqual(out.json, { ok: true });
  assert.equal(seen[0].url, 'http://127.0.0.1:8016/v1/chat/completions');
  assert.equal(seen[0].body.model, 'openai/gpt-oss-120b');
  assert.equal(seen[0].body.reasoning_effort, 'medium');
  assert.equal(seen[0].body.response_format, undefined);   // JUDGE_LLM_JSON_MODE=0
  await assert.rejects(chatJSON({ system: 's', user: 'u', role: 'judge' }, { env: {}, fetcher }), /role not configured: judge/);
});
