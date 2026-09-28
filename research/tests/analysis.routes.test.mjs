// Rutas de la capa de análisis a través del servidor real (sin red externa).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/research/store.mjs';
import { createApp } from '../server/index.mjs';
import { verifyDeal } from '../server/analysis/deals.mjs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('API de análisis: tesis revelada, acercamientos, grants e ICS, voz', async () => {
  const profilePath = join(tmpdir(), `igc-elig-${process.pid}.json`);
  rmSync(profilePath, { force: true });
  const store = createStore(':memory:');
  const page = { url: 'https://news.example.com/a', published: '2026-01-10', text: 'Acme Mind, a Colombian mental health startup, raised a $2.5M seed round led by Kaszek Ventures.' };
  store.analysis.saveDeal(verifyDeal({ startup: 'Acme Mind', lead_investors: ['Kaszek Ventures'], amount_text: '$2.5M', quote: page.text }, page).deal);
  const { server } = createApp({ store, env: { FUND_VEHICLES_PATH: '/nonexistent.json', EVAL_RESULTS_DIR: '/nonexistent', ELIGIBILITY_PROFILE_PATH: profilePath }, browser: null });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/research`;
  const call = (method, path, body) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    const st = await (await call('GET', '/analysis/status')).json();
    assert.equal(st.deals, 1); assert.equal(st.fleet.chat, null);
    assert.equal((await call('POST', '/analysis/revealed', {})).status, 400);
    const rv = await (await call('POST', '/analysis/revealed', { profile: 'seed mental health Colombia app', asOf: '2026-09-01' })).json();
    assert.equal(rv.funds[0].name, 'Kaszek Ventures');
    assert.match(rv.funds[0].explanation[0].text, /Led Acme Mind/);
    assert.equal(rv.method.similarity, 'lexical (TF-IDF, no fleet)');

    assert.equal((await call('POST', '/outreach', { fundName: 'Kaszek', channel: 'fax' })).status, 400);
    const e = await (await call('POST', '/outreach', { fundName: 'Kaszek', channel: 'intro_portafolio', arguments: ['traccion'], sentAt: '2026-09-01' })).json();
    const upd = await call('PUT', `/outreach/${e.id}`, { outcome: 'reunion' });
    assert.equal((await upd.json()).outcome, 'reunion');
    const list = await (await call('GET', '/outreach')).json();
    assert.match(list.byChannel.rows[0].meetingRate.label, /^1 of 1/);
    assert.equal(list.nextVariant, null);
    const imp = await (await call('POST', '/outreach/import', { csv: 'fondo,canal,resultado,fecha\nMagma,cold email,sin respuesta,2025-01-01\n' })).json();
    assert.equal(imp.imported, 1);
    assert.equal((await (await call('GET', '/outreach/network')).json()).cells.length, 0);

    const g = await (await call('POST', '/grants/evaluate', { opportunity: { id: 'o1', number: 'PA-1', title: 'SBIR', agency: 'NIH', url: 'https://www.grants.gov/search-results-detail/1', closeDate: '2099-01-01', applicantTypes: ['Small businesses'], applicantEligibilityDesc: 'Cost Sharing is not required.' } })).json();
    assert.equal(g.evaluations[0].verdict, '?');
    const ics = await call('GET', '/grants/calendar.ics');
    assert.match(await ics.text(), /BEGIN:VCALENDAR/);
    assert.equal((await call('PUT', '/grants/profile', { smallBusiness: true })).status, 200);
    assert.equal((await call('POST', '/voice/brief', { person: 'Nadie' })).status, 404);
    assert.equal((await call('GET', '/nope')).status, 404);
  } finally { await new Promise((r) => server.close(r)); store.close(); rmSync(profilePath, { force: true }); }
});
