import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createBenchCache } from '../../agent/cache.mjs';
import { createLlm } from '../../agent/llm.mjs';
import { loadPrompt } from '../../agent/prompts.mjs';

const promptRef = loadPrompt('planner', 'v1');
const good = { assessment: 'ok', actions: [], stop: true };
const req = { promptRef, system: 's'.repeat(400), user: 'u'.repeat(400), schemaName: 'planner_output', temperature: 0.7, seed: 101, maxTokens: 500, meta: { x: 1 } };

test('ACC-04 client, cache, retry, token estimate and body/meta separation', async () => {
  const calls = []; let now = 0; const replies = [{ content: JSON.stringify(good), model: 'm-1', usage: { prompt_tokens: 10, completion_tokens: 5 }, latency_ms: 7 }];
  const tx = async x => { calls.push(x); now += 7; return replies.shift(); }; tx.modelKey = 'm-1';
  const cache = createBenchCache({ path: ':memory:', namespace: 'n' }); const llm = createLlm({ transport: tx, cache, clock: () => now });
  const a = await llm.call(req); assert.deepEqual(a.tokens, { prompt: 10, completion: 5, total: 15, nominal_total: 15, estimated: false, cached: false }); assert.equal(a.modelId, 'm-1');
  const b = await llm.call(req); assert.equal(b.tokens.cached, true); assert.equal(b.tokens.total, 0); assert.equal(b.tokens.nominal_total, 15); assert.equal(calls.length, 1);
  assert.equal(calls[0].body.seed, 101); assert.equal(calls[0].body.temperature, 0.7); assert.equal(calls[0].body.max_tokens, 500); assert.equal(calls[0].meta.x, 1); assert.equal('meta' in calls[0].body, false);
  cache.close();

  const retryCalls = []; const retryTx = async x => { retryCalls.push(x); return retryCalls.length === 1 ? { content: 'not json', model: 'm' } : { content: JSON.stringify(good), model: 'm' }; }; retryTx.modelKey = 'retry';
  const c = await createLlm({ transport: retryTx }).call(req); assert.equal(c.tokens.prompt, 400); assert.equal(c.tokens.estimated, true); assert.equal(retryCalls[1].body.messages.at(-1).content, 'Your previous reply was not valid JSON for the schema. Reply only with valid JSON.');
  const badTx = async () => ({ content: 'bad', model: 'm' }); badTx.modelKey = 'bad';
  await assert.rejects(() => createLlm({ transport: badTx }).call(req), e => e.code === 'LLM_BAD_JSON');
});

test('ACC-05 cache isolates namespaces and persists', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'bench-cache-')); const path = resolve(dir, 'c.sqlite');
  let a = createBenchCache({ path, namespace: 'a' }); a.put('search', 'k', { a: 1 }, { tokens: 5, latency_ms: 7 }); assert.deepEqual(a.get('search', 'k'), { value: { a: 1 }, meta: { tokens: 5, latency_ms: 7 } }); a.close();
  const b = createBenchCache({ path, namespace: 'b' }); assert.equal(b.get('search', 'k'), null); b.close();
  a = createBenchCache({ path, namespace: 'a' }); assert.deepEqual(a.get('search', 'k').value, { a: 1 }); a.close();
});
