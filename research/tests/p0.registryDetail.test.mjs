import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../server/research/agentic/tools.mjs';

const hits = [{ id: '360001', number: 'PAR-25-272', title: 'Brain Changes', agency: 'NIH', openDate: '05/08/2025', closeDate: '05/08/2027', oppStatus: 'posted' }, { id: '360002', number: 'X-1', title: 'Sin detalle', agency: 'ACL', openDate: '01/01/2026', oppStatus: 'forecasted' }];
const detail = { '360001': { errorcode: 0, data: { synopsis: { synopsisDesc: '<p>Funds research on <b>Alzheimer</b> imaging&nbsp;biomarkers.</p>', applicantEligibilityDesc: '<p>Small businesses and universities may apply.</p>', applicantTypes: [{ id: '22', description: 'Small businesses' }, { description: 'Public and State controlled institutions of higher education' }], awardCeiling: '500000' } } } };
function fetcherOf(calls) {
  return async (url, init) => {
    const body = JSON.parse(init.body); calls.push(url);
    if (url.endsWith('/search2')) return new Response(JSON.stringify({ errorcode: 0, data: { oppHits: hits } }), { status: 200 });
    const d = detail[String(body.opportunityId)]; return d ? new Response(JSON.stringify(d), { status: 200 }) : new Response('boom', { status: 500 });
  };
}

test('registry grants_gov trae el detalle oficial (quién puede aplicar, descripción) y lo deja en el texto de la ficha', async () => {
  const calls = []; const events = []; const tools = createTools({ env: {}, fetcher: fetcherOf(calls), trace: { event: (type, data) => events.push({ type, ...data }), page() {} } });
  const out = await tools.registry({ source: 'grants_gov', query: 'Alzheimer' });
  assert.equal(out.rows.length, 2); assert.equal(calls.filter((u) => u.endsWith('/fetchOpportunity')).length, 2);
  const page = await tools.open({ ref: out.rows[0].ref });
  assert.match(page.text, /Applicant types: Small businesses; Public and State controlled institutions of higher education\./);
  assert.match(page.text, /Applicant eligibility: Small businesses and universities may apply\./);
  assert.match(page.text, /Summary: Funds research on Alzheimer imaging biomarkers\./); assert.doesNotMatch(page.text, /<p>|&nbsp;/);
  assert.match(page.text, /Award ceiling: 500000/);
  assert.equal(events.find((e) => e.tool === 'registry').detail_n, 1, 'una ficha sin detalle conserva la básica y no rompe la búsqueda');
  const plain = await tools.open({ ref: out.rows[1].ref }); assert.match(plain.text, /Opportunity title: Sin detalle/); assert.doesNotMatch(plain.text, /Applicant eligibility/);
});

test('ENGINE_AGENT_REGISTRY_DETAIL=0 no pide el detalle', async () => {
  const calls = []; const tools = createTools({ env: { ENGINE_AGENT_REGISTRY_DETAIL: '0' }, fetcher: fetcherOf(calls), trace: { event() {}, page() {} } });
  await tools.registry({ source: 'grants_gov', query: 'Alzheimer' }); assert.equal(calls.some((u) => u.endsWith('/fetchOpportunity')), false);
});
