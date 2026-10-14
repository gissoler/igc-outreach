import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'v14-ask-'));
mkdirSync(join(dir, 'pages')); mkdirSync(join(dir, 'coverage'));
writeFileSync(join(dir, 'pages', 'abc.txt'), 'page text');
writeFileSync(join(dir, 'coverage', 'v8.json'), JSON.stringify({ result: [{ url: 'file:///engine.mjs', functions: [{ ranges: [{ count: 1 }] }] }] }));
const base = { v: 'trace/1', run_id: 'test', ts: '2026-10-13T00:00:00.000Z', ms: 0, objective: 'grant' };
const rows = [
  { type: 'run_start', brief: {}, brief_sha: 'x', today: '2026-10-12', flags: {}, models: {}, prompts: {}, git_commit: 'abc', limits: {} },
  { type: 'understand', output: { product: 'test' } },
  { type: 'brief_patch', field: 'country', from: '', to: 'US', why: 'assumed', source: 'assumption' },
  { type: 'model_call', role: 'reader', model: 'm', prompt_version: 'p1', tokens: { prompt: 2, completion: 1 }, ms_call: 3, ok: true, page_ref: 'p1' },
  { type: 'tool_call', tool: 'search', provider: 'exa', args: { query: 'q' }, results_n: 1, ms_call: 4, cost_usd: 0.0089 },
  { type: 'page', ref: 'p1', url: 'https://example.org', host: 'example.org', title: 'Page', via: 'reader', chars: 9, sha256: 'abc', path: 'pages/abc.txt', found_by: { tool: 'search', query: 'q' }, read: true },
  { type: 'decision', page_ref: 'p1', by: 'reader', verdict: 'keep', reason: 'fit', dates: [{ role: 'deadline', value: '2026-12-01', quote: 'Dec 1' }], criteria: { eligible: { verdict: 'yes', quote: 'eligible' } }, days_left: 50 },
  { type: 'drop', url: 'https://drop.example', reason: 'aggregator', decided_by: 'code:verify.mjs#hostKind', read: false },
  { type: 'lead', id: 'l1', page_ref: 'p1', kind: 'news', funder: null, recipient: null, quote: 'funded' },
  { type: 'lead_followup', lead_id: 'l1', action: 'search' },
  { type: 'tool_call', tool: 'search', args: { query: 'lead' }, results_n: 1, ms_call: 2, from_lead: 'l1' },
  { type: 'ask_user', questions: ['Product?'], answered: false },
  { type: 'budget', left: { searches: 0 } },
  { type: 'finish', reason: 'done' },
  { type: 'run_end', seconds: 1, totals: { findings: 1 } },
  { type: 'model_call', role: 'judge', model: 'j', prompt_version: 'j1', tokens: { prompt: 2, completion: 1 }, ms_call: 3, ok: true, page_ref: 'p1' },
  { type: 'decision', page_ref: 'p1', by: 'judge', verdict: 'keep', reason: 'fit', criteria: {} },
  { type: 'model_call', role: 'compiler', model: 'c', prompt_version: 'c1', tokens: { prompt: 2, completion: 1 }, ms_call: 3, ok: true, page_ref: 'p1' },
  { type: 'decision', page_ref: 'p1', by: 'auditor', verdict: 'keep', reason: 'fit', criteria: {} },
  { type: 'tool_call', tool: 'note', args: {}, results_n: 0, ms_call: 1 },
].map((row, seq) => ({ ...base, seq, ...row }));
writeFileSync(join(dir, 'events.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
writeFileSync(join(dir, 'summary.json'), JSON.stringify({ model_calls: { reader: { calls: 1 } }, tools: { exa: { calls: 1 } } }));

for (let n = 1; n <= 12; n++) test(`F1.4 pregunta ${n} devuelve texto`, () => {
  const run = spawnSync(process.execPath, ['eval/v14/ask.mjs', dir, String(n)], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); assert.ok(run.stdout.trim()); assert.doesNotThrow(() => JSON.parse(run.stdout));
});
