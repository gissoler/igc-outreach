import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrace } from '../server/research/trace.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'v14-trace-'));
const clock = () => new Date('2026-10-13T12:00:00.000Z');

test('F1.1 un evento válido de cada tipo se escribe', () => {
  const root = dir(); const trace = createTrace({ dir: root, runId: 'r1', objective: 'grant', clock });
  const rows = [
    ['run_start', { brief: {}, brief_sha: 'a', today: '2026-10-12', flags: {}, models: {}, prompts: {}, git_commit: 'abc', limits: {} }],
    ['understand', { output: {} }], ['brief_patch', { field: 'x', from: null, to: 'y', why: 'z', source: 'assumption' }],
    ['model_call', { role: 'reader', model: 'm', prompt_version: 'p', tokens: { prompt: 1, completion: 1 }, ms_call: 1, ok: true }],
    ['tool_call', { tool: 'search', args: {}, results_n: 1, ms_call: 1 }],
    ['decision', { page_ref: 'p1', by: 'reader', verdict: 'keep', reason: 'ok' }],
    ['drop', { url: 'https://example.org', reason: 'closed', decided_by: 'judge+auditor', read: true }],
    ['lead', { id: 'L1', page_ref: 'p1', kind: 'funding_news', funder: null, recipient: null, quote: 'q' }],
    ['lead_followup', { lead_id: 'L1', action: 'search' }], ['ask_user', { questions: [], answered: false }],
    ['budget', { left: {} }], ['finish', { reason: 'done' }], ['run_end', { seconds: 1, totals: {} }],
  ];
  trace.page({ url: 'https://example.org/a', title: 'A', text: 'texto', via: 'fixture', found_by: { tool: 'search', query: 'q' }, read: true });
  for (const [type, data] of rows) trace.event(type, data);
  const written = readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(new Set(written.map((x) => x.type)), new Set(['page', ...rows.map(([type]) => type)]));
});

test('F1.1 un drop sin decided_by lanza error', () => {
  const trace = createTrace({ dir: dir(), runId: 'r2', objective: 'grant', clock });
  assert.throws(() => trace.event('drop', { url: 'https://example.org', reason: 'closed', read: true }), /TRACE_INVALID/);
});

test('F1.1 el mismo texto dos veces escribe un solo archivo en pages', () => {
  const root = dir(); const trace = createTrace({ dir: root, runId: 'r3', objective: 'grant', clock });
  trace.page({ url: 'https://example.org/a', text: 'igual', found_by: { tool: 'search' } });
  trace.page({ url: 'https://example.org/b', text: 'igual', found_by: { tool: 'search' } });
  assert.equal(readdirSync(join(root, 'pages')).length, 1);
  assert.equal(trace.summary().pages, 1);
});

test('F1.1 la traza nula no escribe nada', () => {
  const trace = createTrace(null);
  assert.equal(trace.event('run_start', {}), null);
  assert.deepEqual(trace.page({ url: 'https://example.org', text: 'x' }), { ref: null, sha256: null, path: null });
  assert.deepEqual(trace.close(), { events: 0, pages: 0 });
});
