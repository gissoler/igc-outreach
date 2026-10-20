import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { probeSet, runProbe, schemaLadder, summarizeProbes } from '../server/research/agentic/guidedProbe.mjs';

const page = { case: 'RD-04', run: 'runs', objective: 'grant', today: '2026-10-19', brief: { company: 'IGC', industry: 'Alzheimer imaging' }, url: 'https://example.org/c', title: 'Call', sha256: 'a'.repeat(64), text: 'Application deadline is December 15, 2026. '.repeat(40) };
const size = (s) => Object.keys(s.properties).length;

test('sonda guiada: la escalera añade campos del contrato ligero real y cada sonda cambia una sola cosa', () => {
  const ladder = schemaLadder(); const sizes = ladder.map(([, s]) => size(s));
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes, 'cada peldaño es igual o mayor');
  assert.equal(sizes[0], 2); assert.equal(ladder.at(-1)[1].properties.criteria != null, true);
  assert.equal(ladder.every(([, s]) => s.$id === undefined), true, 'sin $id: no choca con el esquema del motor');
  const probes = probeSet(page, { model: 'm', maxTokens: 300, backends: ['xgrammar'] }); const by = Object.fromEntries(probes.map((p) => [p.name, p.body]));
  assert.deepEqual(probes.map((p) => p.name), ['plain', 'json_object', 'ctl_json_object', 'ctl_schema_text', ...ladder.map(([n]) => n), 'L4@xgrammar']);
  assert.equal(by.plain.response_format, undefined); assert.equal(by.json_object.response_format.type, 'json_object');
  assert.deepEqual(by.plain.messages, by.json_object.messages, 'mismo prompt con y sin formato');
  assert.deepEqual(by.ctl_json_object.messages, by.ctl_schema_text.messages, 'el control solo cambia el formato');
  assert.equal(by.ctl_schema_text.response_format.json_schema.schema.required[0], 'text');
  assert.equal(probes.every((p) => p.body.max_tokens === 300), true); assert.equal(by['L4@xgrammar'].guided_decoding_backend, 'xgrammar');
  assert.deepEqual({ ...by['L4@xgrammar'], guided_decoding_backend: undefined }, { ...by.schema_L4_lite_completo, guided_decoding_backend: undefined });
});

test('sonda guiada: la medición usa el uso reportado, y un rechazo del servidor queda como error sin números inventados', async () => {
  const sse = async () => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); c.enqueue(e.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n\n`)); setTimeout(() => { c.enqueue(e.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'b' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 50 } })}\n\ndata: [DONE]\n\n`)); c.close(); }, 20); } }), { status: 200 });
  const ok = await runProbe({ name: 'e', url: 'http://e/v1', model: 'm' }, { name: 'p', body: {} }, { fetcher: sse });
  assert.equal(ok.ok, true); assert.equal(ok.completion_tokens, 50); assert.equal(ok.usage_reported, true); assert.equal(ok.tok_s_decode > 0, true);
  const bad = await runProbe({ name: 'e', url: 'http://e/v1', model: 'm' }, { name: 'L4@x', body: {} }, { fetcher: async () => new Response('unknown field guided_decoding_backend', { status: 400 }) });
  assert.equal(bad.ok, false); assert.match(bad.error, /HTTP 400/); assert.equal(bad.tok_s_decode, undefined);
  const s = summarizeProbes([{ probe: 'p', ok: true, completion_tokens: 10, ttft_ms: 5, tok_s_decode: 100 }, { probe: 'p', ok: true, completion_tokens: 30, ttft_ms: 7, tok_s_decode: 20 }, bad]);
  assert.equal(s.find((x) => x.probe === 'p').tok_s_min, 20); assert.equal(s.find((x) => x.probe === 'p').tok_s_max, 100); assert.equal(s.find((x) => x.probe === 'L4@x').tok_s_p50, null);
});

test('sonda guiada CLI: --dry no llama a nada; con el endpoint caído sale con código 2 y no escribe resultados', () => {
  const root = mkdtempSync(join(tmpdir(), 'probe-')); const dir = join(root, 'runs', 'RD-04'); mkdirSync(join(dir, 'pages'), { recursive: true });
  const sha = 'b'.repeat(64); writeFileSync(join(dir, 'pages', `${sha}.txt`), 'Deadline December 15, 2026.');
  writeFileSync(join(dir, 'events.jsonl'), [{ type: 'run_start', objective: 'grant', today: '2026-10-19', brief: { company: 'IGC' } }, { type: 'page', ref: 'p1', url: 'https://example.org/x', title: 'X', sha256: sha, path: `pages/${sha}.txt` }].map((e) => JSON.stringify(e)).join('\n'));
  const cwd = new URL('..', import.meta.url); const out = join(root, 'out');
  const dry = spawnSync(process.execPath, ['scripts/probe-guided.mjs', '--pipeline', root, '--runs', 'runs', '--dry', '--backends', 'xgrammar'], { cwd, encoding: 'utf8' });
  assert.equal(dry.status, 0); assert.match(dry.stdout, /9 sondas × 2 rondas = 18 llamadas/); assert.match(dry.stdout, /L4@xgrammar/);
  const down = spawnSync(process.execPath, ['scripts/probe-guided.mjs', '--pipeline', root, '--runs', 'runs', '--endpoint', 'x=http://127.0.0.1:9/v1#m', '--out', out], { cwd, encoding: 'utf8' });
  assert.equal(down.status, 2); assert.match(down.stderr, /no responde/); assert.equal(existsSync(out), false);
});
