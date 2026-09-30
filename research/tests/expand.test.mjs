import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrief } from '../server/research/core.mjs';
import { expandTerms, fundingQuery, modelTerms } from '../server/research/expand.mjs';
import { exaSearch, grants, webSearch } from '../server/research/providers.mjs';

const brief = (over = {}) => validateBrief({
  name: 'Gisel', role: 'Founder', company: 'IGC Pharma', product: 'Harmonization engine',
  description: 'We unify heterogeneous clinical datasets for research.', industry: 'data harmonization',
  stage: 'prototype', geography: 'US', fundingTypes: ['grant'], dataMode: 'live', minDays: 30, ...over,
});

test('expansión: la palabra del usuario primero y términos adyacentes, sin duplicados', async () => {
  const terms = await expandTerms(brief(), {});
  assert.equal(terms[0].term, 'data harmonization');
  assert.equal(terms[0].source, 'yours');
  const list = terms.map((t) => t.term);
  assert.ok(list.includes('data standardization'));
  assert.equal(new Set(list.map((t) => t.toLowerCase())).size, list.length);
  assert.ok(list.length <= 4);
});

test('expansión: el modelo local suma términos; si falla, no rompe', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '<think>x</think>{"terms":["dataset unification","FAIR data"]}' } }] }) });
  const terms = await expandTerms(brief(), { INTAKE_LLM_BASE_URL: 'http://m' }, ok);
  assert.deepEqual(terms.slice(1, 3).map((t) => [t.term, t.source]), [['dataset unification', 'model'], ['FAIR data', 'model']]);
  assert.deepEqual(await modelTerms(brief(), { INTAKE_LLM_BASE_URL: 'http://m' }, async () => { throw new Error('down'); }), []);
});

test('consulta "who is funding" por término y objetivo', () => {
  assert.match(fundingQuery('data standardization', 'grant', brief(), 2026), /^Who is funding data standardization in 2026\? Open grant programs/);
});

test('Exa, Grants.gov y Serper: una consulta separada por término adyacente', async () => {
  const plan = { query: 'data harmonization', topic: 'data harmonization', terms: [{ term: 'data harmonization' }, { term: 'data standardization' }, { term: 'data integration' }] };
  const exaCalls = [];
  await exaSearch({ json: async (u, body) => { exaCalls.push(body.query); return { results: [] }; } }, brief(), plan, { EXA_API_KEY: 'k' });
  assert.equal(exaCalls.length, 3);
  assert.match(exaCalls[1], /Who is funding data standardization/);
  const kw = [];
  await grants({ json: async (u, body) => { if (body.keyword) kw.push(body.keyword); return { errorcode: 0, data: { oppHits: [{ id: body.keyword, number: 'N', title: 't', agency: 'A', openDate: '01/01/2026', closeDate: '12/31/2030', oppStatus: 'posted' }] } }; } }, brief(), plan, () => {});
  assert.deepEqual(kw.slice(0, 3), ['data harmonization', 'data standardization', 'data integration']);
  assert.ok(kw.some((q) => /data harmonization US/.test(q)), 'grant discovery also tests geography separately');
  const qs = [];
  const web = await webSearch({ json: async (u, body) => { qs.push(body.q); return { organic: [{ link: 'https://a.example.com/x', title: 'x', snippet: 's' }] }; } }, brief(), plan, { SERPER_API_KEY: 's' });
  assert.equal(qs.length, 3);
  assert.equal(web.length, 1);
});
