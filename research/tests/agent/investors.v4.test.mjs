// Pruebas v4 del motor de inversionistas (FIX_SPEC-investors-v4). Fixtures sintéticos: ningún texto de firmas del pool v3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateInvestor } from '../../bench/investors/contracts.mjs';
import { loadInvestorPrompt } from '../../bench/investors/prompts.mjs';
import { runInvestorDiscovery, abstentionReason } from '../../bench/investors/engine.mjs';
import { describeInvestorExtraction, groundInvestorExtraction, extractFixtureInvestor } from '../../bench/investors/extractor.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { fixtureDeps, fixtureConfig } from './fixtures/investor-world-v0/world.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const F = resolve(import.meta.dirname, 'fixtures/investor-world-v0');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const profile = json(resolve(F, 'profile.json'));
const anchorCase = json(resolve(F, 'cases/case-anchor.json'));
const nullCase = json(resolve(F, 'cases/case-null.json'));
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const templates = loadInvestorPrompt('b0_templates').templates;

test('V4-FIX-13a engine_v2 result carries abstention_reason and validates investor_run_result.v2; engine_v1 unchanged', async () => {
  const logs = [];
  const deps = { ...fixtureDeps('B2'), log: row => logs.push(row) };
  const v2 = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B2', config: { ...fixtureConfig, engine_v: 2 }, templates, catalog, deps });
  assert.equal(v2.schema_version, 'investor_run_result/2');
  assert.ok(['no_candidates', 'all_hard_not_met', 'insufficient_evidence', null].includes(v2.abstention_reason));
  assert.equal(v2.abstention_reason === null, !v2.abstained);
  validateInvestor('investor_run_result.v2', v2);
  const opened = logs.filter(x => x.event === 'search_opened');
  assert.ok(opened.length > 0);
  for (const row of opened) { assert.ok(Array.isArray(row.urls)); assert.ok(row.opened.every(i => Number.isInteger(i) && i < row.urls.length)); }
  const v1 = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B2', config: fixtureConfig, templates, catalog, deps: fixtureDeps('B2') });
  assert.equal(v1.schema_version, 'investor_run_result/1'); assert.equal(Object.hasOwn(v1, 'abstention_reason'), false);
  const nul = await runInvestorDiscovery({ caseObj: nullCase, profile, condition: 'B1', config: { ...fixtureConfig, engine_v: 2 }, templates, catalog, deps: fixtureDeps('B1', { nullOnly: true }) });
  assert.equal(nul.abstention_reason, 'no_candidates');
});

test('V4-FIX-13b abstentionReason distinguishes hard failures from missing evidence', () => {
  assert.equal(abstentionReason([], []), 'no_candidates');
  assert.equal(abstentionReason([{ gain: 0 }], [{ hard_eligibility: 'ineligible', overall_relevance: 'irrelevant' }]), 'all_hard_not_met');
  assert.equal(abstentionReason([{ gain: 1 }], [{ hard_eligibility: 'undetermined', overall_relevance: 'weak' }]), 'insufficient_evidence');
  assert.equal(abstentionReason([{ gain: 2 }], [{ hard_eligibility: 'undetermined', overall_relevance: 'plausible' }]), null);
});

test('V4-FIX-13c extraction diagnostics report fields present/kept and quote/domain provenance', () => {
  const document = { url: 'https://kestrelfund.test/', title: 'Kestrel', text: 'Kestrel Fund is a venture capital firm. Kestrel Fund backs companies at seed in Chile. More text to pass the length guard of the gate here.' };
  const raw = { entity_kind: 'institutional_investor', canonical_name: 'Kestrel Fund', source_kind: 'official', aliases: [], canonical_url: null, contradictions: [], sectors: [], stages: ['seed'] };
  const grounded = groundInvestorExtraction({ document, extraction: raw });
  const { entity } = extractFixtureInvestor({ document, extraction: raw, today: '2026-10-08', firstSeen: { step: 0, search_index: 0, order: 0, query_id: 'q000' } });
  const d = describeInvestorExtraction({ document, raw, grounded, entity });
  assert.equal(d.kind, 'institutional_investor'); assert.equal(d.quote_source, 'fallback'); assert.equal(d.official_domain_source, 'host_match');
  assert.deepEqual(d.fields_present, ['canonical_name', 'stages']);
  assert.ok(d.fields_kept.includes('stages') && d.fields_kept.includes('quote') && d.fields_kept.includes('official_domain'));
  assert.equal(d.candidates, 0);
  const none = describeInvestorExtraction({ document, raw: { entity_kind: 'other', canonical_name: 'unknown' }, grounded: null, entity: null });
  assert.deepEqual(none.fields_kept, []); assert.equal(none.quote_source, 'none');
});

test('V4-FIX-13d fetch tool records each reader attempt without changing the outcome', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).startsWith('https://r.jina.ai/') ? new Response('{"code":402,"message":"Insufficient balance"}', { status: 402, headers: { 'content-type': 'application/json' } }) : new Response('<html><body><div id="root"></div></body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  try {
    const tool = createFetchTool({ env: { JINA_API_KEY: 'x' } });
    const page = await tool.fetch('https://spa-firm.test/');
    assert.equal(page.ok, false); assert.equal(page.error.code, 'FETCH_EMPTY');
    assert.deepEqual(page.reader_attempts.map(x => x.reader), ['direct', 'crawl4ai', 'jina']);
    assert.equal(page.reader_attempts[0].http_status, 200); assert.equal(page.reader_attempts[0].content_type, 'text/html');
    assert.equal(page.reader_attempts[1].skipped, 'CRAWL4AI_URL unset');
    assert.equal(page.reader_attempts[2].http_status, 402);
  } finally { globalThis.fetch = original; }
});
