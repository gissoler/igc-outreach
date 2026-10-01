/* Fuentes de grants: inteligencia RePORTER/NSF, filtros de Grants.gov, SBIR, jurisdicción y portales. Sin red. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { foaIdsIn, eligibilityFilter, grantsGovSearch, reporterIntel, nsfIntel, grantIntel, intelQueries, intelNote, sbirLeads, sbir, portalsFor, portalSeeds, loadPortals } from '../server/research/grantSources.mjs';
import { grants } from '../server/research/providers.mjs';
import { validateBrief } from '../server/research/core.mjs';
import { runObjective } from '../server/research/engine.mjs';

const fake = (routes) => ({ json: async (url, body) => { for (const [k, fn] of routes) if (url.includes(k)) return fn(url, body); throw new Error(`no route ${url}`); } });
const plan = { query: 'digital mental health', topic: 'digital mental health', terms: [{ term: 'digital mental health' }] };
const project = (n, foa, amount, officer) => ({ appl_id: n, project_num: `R43MH${n}`, project_title: `Project ${n}`, award_amount: amount, full_foa: foa, organization: { org_name: `Org ${n}`, org_type_name: 'Small Business' }, agency_ic_admin: { name: 'NIMH' }, program_officers: officer ? [{ full_name: officer }] : [], abstract_text: 'PA-99-999 should not count as a field' });

test('foaIdsIn extrae identificadores de avisos', () => {
  assert.deepEqual(foaIdsIn('Funded under PA-25-301 and RFA-AG-26-005; also par-24-123.'), ['PA-25-301', 'RFA-AG-26-005', 'PAR-24-123']);
  assert.deepEqual(foaIdsIn('nothing here'), []);
});

test('reporterIntel agrupa por aviso, monto mediano y tipos de organización (el resumen no cuenta)', async () => {
  const client = fake([['reporter.nih.gov', () => ({ results: [project(1, 'PA-25-301', 300000, 'Ann PO'), project(2, 'PA-25-301', 500000, 'Ann PO'), project(3, 'RFA-MH-26-010', 250000)] })]]);
  const r = await reporterIntel(client, {}, plan);
  assert.equal(r.all.n, 3);
  assert.equal(r.notices[0].id, 'PA-25-301'); assert.equal(r.notices[0].projects, 2);
  assert.equal(r.notices[0].officers[0].name, 'Ann PO');
  assert.ok(!r.notices.some((n) => n.id === 'PA-99-999'));
  assert.equal(r.all.orgTypes[0].name, 'Small Business');
});

test('nsfIntel cuenta programas y falla con formato inesperado', async () => {
  const ok = fake([['api.nsf.gov', () => ({ response: { award: [{ fundProgramName: 'SBIR Phase I', fundsObligatedAmt: '275000' }, { fundProgramName: 'SBIR Phase I', fundsObligatedAmt: '300000' }, { fundProgramName: 'CogNeuro' }] } })]]);
  const r = await nsfIntel(ok, plan);
  assert.equal(r.programs[0].name, 'SBIR Phase I'); assert.equal(r.programs[0].count, 2);
  await assert.rejects(nsfIntel(fake([['api.nsf.gov', () => ({})]]), plan), /unexpected format/);
});

test('grantIntel: cada pieza falla por separado y se puede apagar', async () => {
  const x = await grantIntel({}, {}, plan, { reporter: async () => { throw new Error('boom'); }, nsf: async () => ({ n: 1, programs: [{ name: 'P', count: 1 }] }) });
  assert.equal(x.reporter, null); assert.equal(x.nsf.n, 1); assert.match(x.errors[0], /RePORTER: boom/);
  assert.equal((await grantIntel({}, {}, plan, { env: { GRANT_INTEL: 'off' } })).off, true);
});

test('intelQueries: avisos por número y programas NSF; intelNote los explica', () => {
  const intel = { reporter: { notices: [{ id: 'PA-25-301', projects: 2, medianAward: 400000, orgTypes: [{ name: 'Small Business', count: 2 }], institutes: [{ name: 'NIMH', count: 2 }], officers: [{ name: 'Ann PO', count: 2 }] }] }, nsf: { programs: [{ name: 'SBIR Phase I', count: 2 }] } };
  const q = intelQueries(intel);
  assert.equal(q[0].body.oppNum, 'PA-25-301'); assert.equal(q[1].query, 'SBIR Phase I');
  assert.match(intelNote(q[0].intel), /2 funded project.*\$400,000.*Small Business.*NIMH.*Ann PO/);
  assert.match(intelNote(q[1].intel), /SBIR Phase I/);
});

test('grantsGovSearch: filtro aceptado, y repetición sin filtro si lo rechazan', async () => {
  const bodies = [];
  const client = { json: async (_u, b) => { bodies.push(b); return b.eligibilities ? { errorcode: 1, msg: 'bad filter' } : { errorcode: 0, data: { oppHits: [{ id: '1' }] } }; } };
  const warnings = [];
  const r = await grantsGovSearch(client, { keyword: 'x', eligibilities: '22|23' }, { emit: (k, m) => warnings.push(k) });
  assert.equal(r.fellBack, true); assert.equal(r.hits.length, 1); assert.equal(bodies.length, 2); assert.ok(!('eligibilities' in bodies[1])); assert.deepEqual(warnings, ['warning']);
  assert.equal(eligibilityFilter({ entityType: 'for_profit' }), '22|23'); assert.equal(eligibilityFilter({}), null);
});

test('grants(): añade la búsqueda filtrada por tipo de solicitante y las del intel, y anota la inteligencia en la convocatoria', async () => {
  const seen = [];
  const client = { json: async (url, b) => {
    if (url.includes('search2')) { seen.push(b); return { errorcode: 0, data: { oppHits: b.oppNum ? [{ id: '77', number: b.oppNum, title: 'Notice from RePORTER', agency: 'HHS', oppStatus: 'posted', closeDate: '01/15/2027' }] : [] } }; }
    return { errorcode: 0, data: { synopsis: { synopsisDesc: 'x' } } };
  } };
  const intel = { reporter: { notices: [{ id: 'PA-25-301', projects: 2, medianAward: 400000, orgTypes: [], institutes: [], officers: [] }] }, nsf: null };
  const leads = await grants(client, { entityType: 'for_profit', geography: 'US', criteria: '' }, plan, () => {}, { intel });
  assert.ok(seen.some((b) => b.eligibilities === '22|23'));
  assert.ok(seen.some((b) => b.oppNum === 'PA-25-301'));
  const lead = leads.find((l) => l.externalId === 'PA-25-301');
  assert.ok(lead.evidence.some((e) => e.field === 'intel' && /funded project/.test(e.quote)));
  assert.ok(leads.searchAudit.some((a) => a.dimension === 'funded-similar'));
});

test('sbirLeads: solicitudes abiertas con la página oficial como lectura', async () => {
  const data = [{ solicitation_title: 'HHS SBIR 2027', solicitation_number: 'PHS-2027-1', agency: 'HHS', current_status: 'Open', close_date: '2027-01-05', solicitation_agency_url: 'https://grants.nih.gov/x', solicitation_topics: [{ topic_number: '001', topic_title: 'Digital therapeutics' }] }];
  const [l] = sbirLeads(data);
  assert.equal(l.status, 'open'); assert.equal(l.deadline, '2027-01-05'); assert.equal(l.facts.officialUrl, 'https://grants.nih.gov/x');
  assert.ok(l.evidence.some((e) => e.field === 'scope' && /Digital therapeutics/.test(e.quote)));
  assert.throws(() => sbirLeads({ nope: 1 }), /unexpected format/);
  const client = fake([['sbir.gov', () => data]]);
  assert.equal((await sbir(client, { entityType: 'for_profit' }, plan)).length, 1);
  assert.equal((await sbir(client, { entityType: 'nonprofit' }, plan)).length, 0);
});

test('portalsFor: estado, país y ciudad por nombre o código; sin jurisdicción no hay portales', () => {
  const portals = loadPortals();
  assert.equal(portalsFor({}, portals).length, 0);
  const ca = portalsFor({ country: 'US', state: 'CA' }, portals);
  assert.ok(ca.some((p) => /California Grants Portal/.test(p.name))); assert.ok(!ca.some((p) => p.state === 'New York'));
  assert.ok(portalsFor({ country: 'Estados Unidos', state: 'california' }, portals).length >= 1);
  const co = portalsFor({ country: 'Colombia', city: 'Medellín' }, portals);
  assert.ok(co.some((p) => /MinCiencias/.test(p.name)) && co.some((p) => /Ruta N/.test(p.name)));
  assert.ok(!portalsFor({ country: 'Colombia' }, portals).some((p) => /Ruta N/.test(p.name)));
  assert.equal(portalSeeds({ country: 'US', state: 'NY' }, portals)[0].family, 'portal');
});

test('el brief acepta estado y ciudad', () => {
  const b = validateBrief({ name: 'Gisel', role: 'Founder', company: 'X', product: 'Y', description: 'Something useful for research.', industry: 'Z', geography: 'US', stage: 'prototype', fundingTypes: ['grant'], dataMode: 'live', minDays: 30, state: 'California', city: 'San Diego', country: 'US' });
  assert.equal(b.state, 'California'); assert.equal(b.city, 'San Diego');
});

test('motor: los portales (mapSeeds) se recorren y sus enlaces entran a lectura como familia portal', async () => {
  const brief = { company: 'X', product: 'digital mental health', industry: 'mental health', geography: 'US', stage: 'prototype', fundingTypes: ['grant'], criteria: '' };
  const read = [];
  const chat = async ({ name, user }) => { if (name === 'finding') read.push(user); return { json: name === 'finding' ? { relevant: false } : { queries: [] } }; };
  const result = await runObjective('grant', brief, {
    env: { ENGINE_V2: '1' }, chat, search: async () => [], expand: false, rounds: 1,
    mapSeeds: [{ url: 'https://portal.example.gov/', title: 'Portal' }],
    snowball: async (seeds) => seeds.map((s) => ({ url: 'https://portal.example.gov/program-a', title: 'Program A', seed: s.url })),
    pageFetcher: async (u) => ({ text: `Program A page. ${'text '.repeat(200)}`, url: u }), reader: async () => null, crawl4aiReader: null, fallbackReader: null,
  });
  assert.equal(result.audit.portals.pages, 1);
  assert.ok(read.some((u) => u.includes('https://portal.example.gov/program-a')));
});
