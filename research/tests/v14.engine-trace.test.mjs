import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runObjective } from '../server/research/engine.mjs';
import { createTrace } from '../server/research/trace.mjs';

const TODAY = '2026-10-12';
const brief = { company: 'IGC', industry: 'Alzheimer risk', stage: 'marketed', entityType: 'for_profit', country: 'US' };
const pages = [
  { url: 'https://funder.example.org/open', title: 'Open call', markdown: 'Alzheimer research grant. Applications are open to US for-profit companies. Application deadline is December 15, 2026. Cash grant with no equity.' },
  { url: 'https://funder.example.org/old', title: 'Old call', markdown: 'Alzheimer research grant. Applications were open to US for-profit companies. Application deadline was April 5, 2023. Cash grant with no equity.' },
];
const answers = {
  [pages[0].url]: { relevant: true, kind: 'program', name: 'Open', official: true, status: 'open', deadline: '2026-12-15', eligible: 'yes', non_dilutive: 'yes', money: 'grant', page_type: 'call', applicants: { entity_types: ['for-profit companies'], for_profit_allowed: 'yes', students_or_academic_only: 'no', countries: ['US'], stage: null }, dates: [], scope_fit: { verdict: 'fits', reason: 'Alzheimer research', funds_quote: 'Alzheimer research grant.', excludes_quote: null, work_type: 'applied_research' }, summary: 'Open call.', quotes: { identity: 'Alzheimer research grant.', deadline: 'Application deadline is December 15, 2026', eligible: 'open to US for-profit companies', status: 'Applications are open' } },
  [pages[1].url]: { relevant: true, kind: 'program', name: 'Old', official: true, status: 'closed', deadline: '2023-04-05', eligible: 'yes', non_dilutive: 'yes', money: 'grant', page_type: 'call', applicants: { entity_types: ['for-profit companies'], for_profit_allowed: 'yes', students_or_academic_only: 'no', countries: ['US'], stage: null }, dates: [], scope_fit: { verdict: 'fits', reason: 'Alzheimer research', funds_quote: 'Alzheimer research grant.', excludes_quote: null, work_type: 'applied_research' }, summary: 'Old call.', quotes: { identity: 'Alzheimer research grant.', deadline: 'Application deadline was April 5, 2023', eligible: 'open to US for-profit companies', status: 'Applications were open' } },
};
const search = async () => pages;
const chat = async ({ name, user }) => {
  if (name === 'plan') return { json: { queries: [{ query: 'Alzheimer research grants 2026', family: 'grants' }, { query: 'NIH Alzheimer small business 2026', family: 'NIH' }, { query: 'Maryland Alzheimer grants 2026', family: 'state' }] }, model: 'fixture', usage: { prompt_tokens: 2, completion_tokens: 3 } };
  const url = Object.keys(answers).find((value) => user.includes(value));
  return { json: answers[url], model: 'fixture', usage: { prompt_tokens: 4, completion_tokens: 5 } };
};
const run = async (withTrace) => {
  const root = mkdtempSync(join(tmpdir(), 'v14-engine-trace-'));
  const trace = withTrace ? createTrace({ dir: root, runId: 'fixture', objective: 'grant', clock: () => new Date('2026-10-13T12:00:00Z') }) : undefined;
  const result = await runObjective('grant', brief, { chat, search, today: TODAY, rounds: 1, maxPages: 5, trace });
  const events = withTrace ? readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { result, events };
};

test('F1.2 findings y descartes son idénticos con y sin traza', async () => {
  const plain = await run(false); const traced = await run(true);
  assert.deepEqual(traced.result.findings, plain.result.findings);
  assert.deepEqual(traced.result.audit.dropped, plain.result.audit.dropped);
});

test('F1.2 todo drop tiene decided_by conocido', async () => {
  const { events } = await run(true); const drops = events.filter((row) => row.type === 'drop');
  assert.ok(drops.length > 0);
  assert.ok(drops.every((row) => row.decided_by && !row.decided_by.startsWith('unknown:')));
});

test('F1.2 todas las líneas validan contra trace/1', async () => {
  const { events } = await run(true);
  const schema = JSON.parse(readFileSync(new URL('../eval/v14/events.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  for (const row of events) assert.equal(validate(row), true, JSON.stringify(validate.errors));
});

test('F1.2 el número de page coincide con las páginas vistas del audit', async () => {
  const { result, events } = await run(true);
  assert.equal(events.filter((row) => row.type === 'page').length, result.audit.pages);
});
