import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildReplayRequest, checkEndpoint, loadReplayCorpus, measureOnce, parseEndpoints, sampleCorpus, summarizeReplay, quantile, REPLAY_VARIANTS, DEFAULT_REPLAY_VARIANTS } from '../server/research/agentic/replay.mjs';
import { AGENT_CRITERIA, assessPrompt } from '../server/research/agentic/prompts.v14.mjs';

const ids = AGENT_CRITERIA.grant;
function pipelineFixture() {
  const root = mkdtempSync(join(tmpdir(), 'p01-pipeline-'));
  const profile = { company: 'IGC', oneLiner: 'MRI classifier', industry: 'Alzheimer imaging', fundingTypes: ['grant'] };
  mkdirSync(join(root, 'profiles')); writeFileSync(join(root, 'profiles', 'RD-05-mri.json'), JSON.stringify(profile));
  for (const [caseId, n] of [['RD-05', 2], ['RD-06', 1]]) {
    const dir = join(root, 'runs', caseId); mkdirSync(join(dir, 'pages'), { recursive: true });
    const events = [{ type: 'run_start', objective: 'grant', today: '2026-10-19', brief: profile }];
    for (let i = 0; i < n; i++) { const sha = `${caseId}${i}`.padEnd(64, '0'); writeFileSync(join(dir, 'pages', `${sha}.txt`), `Official call ${caseId} ${i}. Application deadline is December 15, 2026.`); events.push({ type: 'page', ref: `p${i}`, url: `https://example.org/${caseId}/${i}`, title: `Call ${i}`, sha256: sha, path: `pages/${sha}.txt` }); }
    writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
  }
  return root;
}
const sse = (chunks, usage) => async () => new Response(new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const t of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ model: 'm', choices: [{ delta: { content: t } }] })}\n\n`)); c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`)); c.close(); } }), { status: 200 });
const liteJson = JSON.stringify({ ref: 'p1', page_type: 'call', about: 'Call', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: false, lead: null });

test('P0.1 corpus: páginas guardadas con su caso, perfil de profiles/, objetivo y fecha de la corrida; muestra repartida y determinista', () => {
  const root = pipelineFixture(); const corpus = loadReplayCorpus(root);
  assert.equal(corpus.length, 3); assert.equal(corpus[0].profile, 'RD-05-mri.json'); assert.equal(corpus[0].objective, 'grant'); assert.equal(corpus[0].today, '2026-10-19');
  assert.equal(corpus.find((p) => p.case === 'RD-06').profile, null, 'sin perfil usa el brief de run_start');
  const s = sampleCorpus(corpus, 2); assert.deepEqual(s.map((p) => p.case), ['RD-05', 'RD-06']); assert.deepEqual(sampleCorpus(corpus, 2), s);
});

test('P0.1 la petición usa las funciones reales de prompts.v14 y difiere solo en lo que define cada variante', () => {
  const page = loadReplayCorpus(pipelineFixture())[0];
  const full = buildReplayRequest(page, 'full', { model: 'm' }); const lite = buildReplayRequest(page, 'lite+mt700', { model: 'm', reasoningEffort: 'low' }); const json = buildReplayRequest(page, 'json', { model: 'm' });
  const expected = assessPrompt({ objective: 'grant', brief: page.brief, understood: { product_one_line: '', who_pays: '', sector: '', neighbor_sectors: [], stage: '', geography: '', assumptions: [], doubts: [] }, page: { url: page.url, title: page.title, text: page.text }, ref: 'p1', today: '2026-10-19' });
  assert.equal(full.body.messages[1].content, expected.user); assert.equal(full.body.response_format.json_schema.schema.$id, 'agent.assess/1'); assert.equal('max_tokens' in full.body, false);
  assert.equal(lite.body.response_format.json_schema.schema.$id, 'agent.assess_lite/1'); assert.equal(lite.body.max_tokens, 700); assert.equal(lite.body.reasoning_effort, 'low');
  assert.match(lite.body.messages[1].content, /Deterministic pre-read/);
  assert.deepEqual(json.body.response_format, { type: 'json_object' }); assert.equal(json.body.messages[1].content, buildReplayRequest(page, 'lite', { model: 'm' }).body.messages[1].content);
  assert.deepEqual(DEFAULT_REPLAY_VARIANTS, ['full', 'full+mt700', 'lite', 'lite+mt700', 'json', 'json+mt700']);
  const shape = buildReplayRequest(page, 'json-shape+mt1500', { model: 'm' });
  assert.deepEqual(shape.body.response_format, { type: 'json_object' }); assert.equal(shape.body.max_tokens, 1500);
  assert.match(shape.body.messages[1].content, /validates against this JSON Schema/); assert.match(shape.body.messages[1].content, /"page_type"/);
  assert.equal(json.body.messages[1].content.includes('validates against this JSON Schema'), false, 'json sin shape reproduce el prompt de producción');
  assert.equal(buildReplayRequest(page, 'lite+mt1500', { model: 'm' }).body.response_format.type, 'json_schema');
});

test('P0.1 medición: latencia, TTFT, tokens de entrada/salida, tokens/s y validez del contrato; un fallo deja el error sin números inventados', async () => {
  const page = loadReplayCorpus(pipelineFixture())[0]; const endpoint = { name: 'e', url: 'http://e/v1', model: 'm' };
  const half = Math.floor(liteJson.length / 2);
  const ok = await measureOnce(endpoint, page, 'lite', { fetcher: sse([liteJson.slice(0, half), liteJson.slice(half)], { prompt_tokens: 3000, completion_tokens: 120 }) });
  assert.equal(ok.ok, true); assert.equal(ok.json_ok, true); assert.equal(ok.contract_ok, true); assert.equal(ok.prompt_tokens, 3000); assert.equal(ok.completion_tokens, 120); assert.equal(ok.usage_reported, true);
  assert.equal(ok.finish_reason, 'stop'); assert.equal(typeof ok.ttft_ms, 'number'); assert.equal(ok.tok_s_e2e > 0, true);
  const bad = await measureOnce(endpoint, page, 'full', { fetcher: sse(['{"ref":"p1"}'], { prompt_tokens: 10, completion_tokens: 5 }) });
  assert.equal(bad.json_ok, true); assert.equal(bad.contract_ok, false); assert.equal(bad.contract_errors.length > 0, true);
  const down = await measureOnce(endpoint, page, 'lite', { fetcher: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.ok, false); assert.match(down.error, /ECONNREFUSED/); assert.equal(down.completion_tokens, undefined); assert.equal(down.tok_s_e2e, undefined);
  const s = summarizeReplay([ok, bad, down]); assert.equal(s.find((x) => x.variant === 'lite').errors, 1); assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

test('P0.1 endpoints: formato nombre=url#modelo; si no responde o no sirve el modelo, error claro', async () => {
  assert.deepEqual(parseEndpoints('a=http://x:1/v1/#m1,b=http://y/v1#m2'), [{ name: 'a', url: 'http://x:1/v1', model: 'm1' }, { name: 'b', url: 'http://y/v1', model: 'm2' }]);
  await assert.rejects(checkEndpoint({ name: 'a', url: 'http://x/v1', model: 'm' }, { fetcher: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } }), /no responde \(ECONNREFUSED\)/);
  await assert.rejects(checkEndpoint({ name: 'a', url: 'http://x/v1', model: 'm' }, { fetcher: async () => new Response(JSON.stringify({ data: [{ id: 'other' }] })) }), /no está servido/);
  assert.equal(await checkEndpoint({ name: 'a', url: 'http://x/v1', model: 'm' }, { fetcher: async () => new Response(JSON.stringify({ data: [{ id: 'm' }] })) }), 'm');
});

test('P0.1 CLI: sin endpoints sale con código 2, mensaje claro y sin escribir resultados; --dry no llama a nada', () => {
  const root = pipelineFixture(); const out = join(root, 'replay-out');
  const run = spawnSync(process.execPath, ['scripts/replay-assess.mjs', '--pipeline', root, '--endpoints', 'x=http://127.0.0.1:9/v1#m', '--out', out], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(run.status, 2); assert.match(run.stderr, /no responde/); assert.match(run.stderr, /No se ejecutó ninguna llamada/); assert.equal(existsSync(out), false);
  const dry = spawnSync(process.execPath, ['scripts/replay-assess.mjs', '--pipeline', root, '--dry'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(dry.status, 0); assert.match(dry.stdout, /llamadas previstas: 36/); assert.match(dry.stdout, /Dry run/);
});
