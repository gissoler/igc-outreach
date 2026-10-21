import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PREFLIGHT_EXIT, preflightBody, preflightTargets, runPreflight } from '../server/research/agentic/preflight.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const models = (id) => new Response(JSON.stringify({ data: [{ id }] }), { status: 200 });
/** Servidor simulado: /models y un stream SSE con dos fragmentos separados `gapMs` y el uso que se indique. */
const server = ({ id = 'm', gapMs = 100, completion = 500 } = {}) => async (url) => {
  if (url.endsWith('/models')) return models(id);
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ async start(c) {
    c.enqueue(enc.encode(`data: ${JSON.stringify({ model: id, choices: [{ delta: { content: '{"ref":"p1",' } }] })}\n\n`)); await sleep(gapMs);
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '"x":1}' }, finish_reason: 'stop' }] })}\n\n`));
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: completion } })}\n\ndata: [DONE]\n\n`)); c.close();
  } }), { status: 200 });
};

test('P0.7 preflight: inferencia real con el esquema de lectura y ~500 tokens de tope; pasa sobre el umbral', async () => {
  const body = preflightBody('openai/gpt-oss-120b'); assert.equal(body.max_tokens, 600); assert.equal(body.response_format.json_schema.schema.$id, 'agent.assess_lite/1'); assert.equal(body.reasoning_effort, 'low');
  assert.equal('reasoning_effort' in preflightBody('Qwen/Qwen3-30B-A3B-Instruct-2507'), false);
  const { rows, code } = await runPreflight([{ name: 'a', url: 'http://a/v1', model: 'm' }], { fetcher: server({ completion: 500, gapMs: 100 }), minToks: 80 });
  assert.equal(code, PREFLIGHT_EXIT.ok); assert.equal(rows[0].pass, true); assert.equal(rows[0].completion_tokens, 500); assert.equal(rows[0].tok_s_decode > 80, true);
});

test('P0.7 preflight: por debajo del umbral aborta con código 3; caído con 2; el umbral y la métrica son configurables', async () => {
  const slow = await runPreflight([{ name: 'a', url: 'http://a/v1', model: 'm' }], { fetcher: server({ completion: 10, gapMs: 200 }), minToks: 80 });
  assert.equal(slow.code, PREFLIGHT_EXIT.slow); assert.equal(slow.rows[0].pass, false); assert.equal(slow.rows[0].value < 80, true);
  const lenient = await runPreflight([{ name: 'a', url: 'http://a/v1', model: 'm' }], { fetcher: server({ completion: 10, gapMs: 200 }), minToks: 5, metric: 'e2e' });
  assert.equal(lenient.code, PREFLIGHT_EXIT.ok); assert.equal(lenient.rows[0].metric, 'e2e');
  const down = await runPreflight([{ name: 'a', url: 'http://a/v1', model: 'm' }], { fetcher: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.code, PREFLIGHT_EXIT.down); assert.match(down.rows[0].error, /no responde/);
  const wrong = await runPreflight([{ name: 'a', url: 'http://a/v1', model: 'm' }], { fetcher: server({ id: 'other' }) });
  assert.equal(wrong.code, PREFLIGHT_EXIT.down);
});

test('P0.7 objetivos por defecto: roles agent, compiler y judge configurados, sin duplicar url+modelo; CLI sale ≠ 0 sin endpoint', () => {
  const env = { ENGINE_AGENT_LLM_URL: 'http://g/v1', ENGINE_AGENT_LLM_MODEL: 'gpt', JUDGE_LLM_URL: 'http://g/v1', JUDGE_LLM_MODEL: 'gpt', COMPILER_LLM_URL: 'http://q/v1', COMPILER_LLM_MODEL: 'qwen' };
  assert.deepEqual(preflightTargets('', env).map((t) => [t.name, t.model]), [['agent', 'gpt'], ['compiler', 'qwen']]);
  const run = spawnSync(process.execPath, ['scripts/model-preflight.mjs', '--endpoints', 'x=http://127.0.0.1:9/v1#m'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(run.status, 2); assert.match(run.stderr, /no se crea ninguna corrida/);
  const sh = spawnSync('bash', ['-n', 'scripts/run-rd-cases.sh'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }); assert.equal(sh.status, 0, sh.stderr);
});
