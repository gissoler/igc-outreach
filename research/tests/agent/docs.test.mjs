import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeUrl, docIdOf, registrableDomain, officialBasisOf } from '../../agent/docs.mjs';
import { identifiersFromText, stableIdOf, urlIdentifier } from '../../agent/identifiers.mjs';
import { createSearchTool } from '../../agent/tools/search.mjs';

const F = resolve(import.meta.dirname, 'fixtures/world-v1'); const j = p => JSON.parse(readFileSync(p, 'utf8'));
const world = j(resolve(F, 'world.json')), llm = j(resolve(F, 'llm.json')), E = j(resolve(F, 'expected.json'));
const domains = j(resolve(import.meta.dirname, '../../agent/config/official_domains.v1.json'));

test('ACC-06 URL normalization, ids, registrable domains and official basis', () => {
  assert.equal(normalizeUrl('http://WWW.Example.org/a//b/?utm_source=x&b=2&a=1#frag'), 'https://example.org/a/b?a=1&b=2');
  assert.equal(normalizeUrl('https://grants.nih.gov:443/x/'), 'https://grants.nih.gov/x'); assert.equal(normalizeUrl('https://example.org'), 'https://example.org/');
  for (const p of world.pages) assert.equal(docIdOf(p.url), E.doc_ids[p.id]);
  for (const [h, d] of [['grants.nih.gov','nih.gov'],['www.alz.org','alz.org'],['minciencias.gov.co','minciencias.gov.co'],['foo.bar.co.uk','bar.co.uk'],['eic.ec.europa.eu','europa.eu']]) assert.equal(registrableDomain(h), d);
  for (const p of world.pages.filter(x => E.official[x.id])) assert.equal(officialBasisOf({ url: p.url, extraction: llm.extractor[p.id] }, domains), E.official[p.id]);
  const ex = { page_type: 'call', about: { issuer_domain: 'example.org', how_to_apply_quote: 'apply' }, evidence: [] };
  assert.equal(officialBasisOf({ url: 'https://www.example.org/x', extraction: ex }, domains), 'issuer_match');
  const unverified = { ...ex, about: { ...ex.about, how_to_apply_quote: null }, evidence: [{ criterion_id: 'G-ENTITY', quote: 'invented' }] };
  assert.equal(officialBasisOf({ url: 'https://www.example.org/x', extraction: unverified, acceptedEvidence: [] }, domains), 'none');
  assert.equal(officialBasisOf({ url: 'https://www.example.org/x', extraction: { ...ex, page_type: 'news' } }, domains), 'none');
  assert.equal(officialBasisOf({ url: 'https://www.fundsforngos.org/x', extraction: ex }, domains), 'none');
});

test('ACC-07 identifiers and stable ids', () => {
  assert.deepEqual(identifiersFromText('see RFA-AG-27-010 now'), [{ scheme: 'nih', value: 'RFA-AG-27-010' }]);
  assert.deepEqual(identifiersFromText('nsf 23-525'), [{ scheme: 'nsf', value: '23-525' }]);
  assert.deepEqual(identifiersFromText('PD 24-1699'), [{ scheme: 'nsf', value: 'PD-24-1699' }]);
  assert.deepEqual(identifiersFromText('https://www.grants.gov/search-results-detail/359740'), [{ scheme: 'grantsgov', value: '359740' }]);
  assert.deepEqual(identifiersFromText('HORIZON-EIC-2026-PATHFINDEROPEN-01'), [{ scheme: 'eu', value: 'HORIZON-EIC-2026-PATHFINDEROPEN-01' }]); assert.deepEqual(identifiersFromText('horizon-eic-2026'), []);
  assert.equal(stableIdOf([{scheme:'nih',value:'NOT-AG-26-001'},{scheme:'nih',value:'RFA-AG-27-010'},{scheme:'url',value:'x.org/a'}]), 'opp:nih:RFA-AG-27-010');
  assert.equal(stableIdOf([{scheme:'grantsgov',value:'359740'},{scheme:'nsf',value:'23-525'}]), 'opp:nsf:23-525');
  assert.deepEqual(urlIdentifier('https://www.alz.org/research/for_researchers/grants/part-the-cloud/'), {scheme:'url',value:'alz.org/research/for_researchers/grants/part-the-cloud'});
});

test('search tool only propagates ISO publication dates', async () => {
  const transport = async () => [
    { url: 'https://example.org/relative', published: '2 days ago' },
    { url: 'https://example.org/date', published: '2026-10-06' },
    { url: 'https://example.org/datetime', published: '2026-10-06T13:45:00Z' },
  ];
  const search = createSearchTool({ provider: 'fixture', transport });
  const { results, error } = await search.search('publication dates');
  assert.equal(error, null);
  assert.deepEqual(results.map(x => x.published), [null, '2026-10-06', '2026-10-06']);
});
