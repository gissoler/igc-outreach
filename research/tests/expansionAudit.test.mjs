import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunAudit } from '../server/research/runAudit.mjs';

test('Run audit: resumen de la expansión por objetivo', () => {
  const a = buildRunAudit({ engineRuns: [{ objective: 'grant', providers: {}, queryLog: [], traces: [], expand: { on: true, seeds: 3, pages: 9, snowball: 5, siteDive: 2, similar: 4, siteDiveVia: 'common_crawl', lateral: { openalex: 3, edgar: 0, ai: 4, errors: [] }, errors: ['site-dive: x'] } }], brief: { fundingTypes: ['grant'] } });
  assert.equal(a.expansion.length, 1);
  assert.deepEqual(a.expansion[0].lateral, { openalex: 3, edgar: 0, ai: 4 });
  assert.equal(a.expansion[0].pages, 9);
  assert.deepEqual(buildRunAudit({ engineRuns: [{ objective: 'grant', providers: {}, queryLog: [], traces: [] }], brief: {} }).expansion, []);
});
