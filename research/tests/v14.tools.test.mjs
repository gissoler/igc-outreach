import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrace } from '../server/research/trace.mjs';
import { createTools } from '../server/research/agentic/tools.mjs';

const make = (extra = {}) => {
  const trace = createTrace({ dir: mkdtempSync(join(tmpdir(), 'v14-tools-')), runId: 't', objective: 'grant' });
  const readers = { search: async () => [{ url: 'https://example.org/call', title: 'Call', description: 'Open', providers: ['fake'] }], open: async (url) => ({ url, title: 'Call', text: `Official page with enough text for reading. [Details](https://example.org/details) ${'x'.repeat(90)}` }) };
  return createTools({ trace, readers, limits: { searches: 2, opens: 2, apolloCredits: 25 }, ...extra });
};

test('F2.3 search numera resultados', async () => assert.equal((await make().search({ query: 'q' })).results[0].ref, 's1.1'));
test('F2.3 open guarda página y numera enlaces', async () => { const t = make(); await t.search({ query: 'q' }); const page = await t.open({ ref: 's1.1' }); assert.equal(page.ref, 'p1'); assert.equal(page.links[0].ref, 'p1.l1'); });
test('F2.3 open rechaza ref inventado', async () => assert.equal((await make().open({ ref: 'made-up' })).error, 'rejected_ref'));
test('F2.3 bloquea redes sociales', async () => { const t = make({ readers: { search: async () => [{ url: 'https://linkedin.com/company/x', title: 'x', providers: ['fake'] }] } }); const s = await t.search({ query: 'q' }); assert.equal((await t.open({ ref: s.results[0].ref })).error, 'blocked_social'); });
test('F2.3 respeta tope de búsquedas', async () => { const t = make(); await t.search({ query: '1' }); await t.search({ query: '2' }); assert.equal((await t.search({ query: '3' })).error, 'budget'); });
test('F2.3 Apollo pasa de 25 créditos', async () => {
  const fetcher = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ organizations: [] }) });
  const t = make({ env: { APOLLO_API_KEY: 'fixture' }, fetcher }); let last;
  for (let i = 0; i < 26; i++) last = await t.apollo({ op: 'organization', name: `Org ${i}` });
  assert.equal(last.error, 'APOLLO_RUN_CAP');
});
test('F2.3 ask_user sin usuario no responde', async () => assert.deepEqual(await make().ask_user({ questions: [{ q: 'Product?', options: ['A', 'B'] }] }), { answered: false }));
