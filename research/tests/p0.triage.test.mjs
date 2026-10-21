import test from 'node:test';
import assert from 'node:assert/strict';
import { triagePage, triageBanners, triageDates, triageStructure, triageNote } from '../server/research/agentic/triage.mjs';
import { assessContractOf, assessLiteSchema, liftAssess, validateAssess, validateAssessLite, validateAssessMin } from '../server/research/agentic/contracts.v14.mjs';
import { AGENT_CRITERIA, assessLitePrompt, assessPrompt, assessPromptFor } from '../server/research/agentic/prompts.v14.mjs';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';

const ids = AGENT_CRITERIA.grant;

test('P0.3 triage: fechas con etiqueta cercana y marca de pasado contra hoy, sin modelo', () => {
  const text = 'Key Dates. Letter of Intent Due Date: November 4, 2026. Application Due Date: February 9, 2027. Earliest start date: July 1, 2027. Posted: January 3, 2020.';
  const d = triageDates(text, '2026-10-19');
  const loi = d.find((x) => x.date === '2026-11-04'); const app = d.find((x) => x.date === '2027-02-09');
  assert.equal(loi.role, 'loi_deadline'); assert.equal(loi.past, false); assert.match(loi.quote, /Letter of Intent/);
  assert.equal(app.role, 'application_deadline');
  assert.equal(d.find((x) => x.date === '2020-01-03').past, true);
  assert.equal(d[0].role.endsWith('deadline'), true, 'los plazos van primero');
});

test('P0.3 triage: IDs de convocatoria del texto y de los enlaces (foaIdsIn) y hub de convocatorias', () => {
  const links = ['PAR-25-272', 'PAR-25-374', 'RFA-AG-27-005'].map((id, i) => ({ ref: `p1.l${i + 1}`, text: `${id} New approaches`, url: `https://grants.nih.gov/grants/guide/pa-files/${id}.html` }));
  const t = triagePage({ url: 'https://www.nia.nih.gov/research/grants-funding/announcements', title: 'NIA Funding Announcements', text: 'See PAR-25-272 and others.', links, today: '2026-10-19' });
  assert.deepEqual(t.foa_ids, ['PAR-25-272']); assert.deepEqual(t.linked_foa_ids, ['PAR-25-272', 'PAR-25-374', 'RFA-AG-27-005']);
  assert.equal(t.structure.hub, true); assert.equal(t.structure.kind, 'list');
});

test('P0.3 triage: avisos EXPIRED / CLOSED / no longer accepting con cita literal; la palabra suelta en minúscula no basta', () => {
  assert.equal(triageBanners({ title: 'EXPIRED: NOT-AG-24-043 Notice', text: '' })[0].kind, 'expired');
  assert.equal(triageBanners({ title: 'x', text: 'Status: EXPIRED. This notice will not be reissued.' })[0].kind, 'expired');
  const nl = triageBanners({ title: 'Grant', text: 'We are no longer accepting applications for the 2026 cycle.' });
  assert.equal(nl.length >= 1, true); assert.equal(nl[0].kind, 'not_accepting'); assert.match(nl[0].quote, /no longer accepting/);
  assert.equal(triageBanners({ title: 'Grant', text: 'Applications are now closed.' })[0].kind, 'closed');
  assert.deepEqual(triageBanners({ title: 'Grant', text: 'The program closed a gap in care. Reviews are expired-proof.' }).filter((b) => b.kind === 'expired'), []);
});

test('P0.3 triage: forma de la página por señales estructurales (ruta, comunicado, densidad de enlaces), no por tema', () => {
  assert.equal(triageStructure({ url: 'https://example.com/news/series-b', title: 'X raises', text: 'NEW YORK — X today announced a Series B.' }).kind, 'news');
  assert.equal(triageStructure({ url: 'https://fund.example/portfolio', title: 'Portfolio', text: 'Our companies' }).kind, 'portfolio');
  const many = Array.from({ length: 30 }, (_, i) => ({ ref: `p1.l${i}`, text: `item ${i}`, url: `https://x.org/${i}` }));
  assert.equal(triageStructure({ url: 'https://x.org/resources', title: 'Resources', text: 'a'.repeat(2000), links: many }).kind, 'list');
  assert.equal(triageStructure({ url: 'https://x.org/program', title: 'Program', text: 'Apply now. Application deadline December 1, 2026.' }).kind, 'page');
  // El mismo texto con otro tema no cambia la forma: el triage no decide relevancia.
  const a = triagePage({ url: 'https://x.org/program', title: 'P', text: 'Alzheimer research grant. Apply now.', today: '2026-10-19' });
  const b = triagePage({ url: 'https://x.org/program', title: 'P', text: 'Oceanography research grant. Apply now.', today: '2026-10-19' });
  assert.deepEqual(a.structure, b.structure);
});

test('P0.3 contrato ligero: veredicto + cita corta, sin reason, solo plazos de aplicación/LOI (máx. 6), claves fijas', () => {
  const lite = { ref: 'p1', page_type: 'call', about: 'Program', dates: [{ role: 'loi_deadline', date: '2026-11-04', estimated: false, quote: 'LOI due November 4, 2026' }], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: true, lead: null };
  assert.equal(validateAssessLite(lite, ids).ok, true);
  assert.equal(validateAssessLite({ ...lite, criteria: { ...lite.criteria, topic_fit: { verdict: 'yes', quote: 'x', reason: 'r' } } }, ids).ok, false, 'reason no está en el contrato');
  assert.equal(validateAssessLite({ ...lite, dates: [{ role: 'award', date: '2027-01-01', estimated: false, quote: 'x' }] }, ids).ok, false, 'solo plazos');
  assert.equal(validateAssessLite({ ...lite, dates: Array.from({ length: 7 }, () => lite.dates[0]) }, ids).ok, false, 'máximo 6 fechas');
  const { [ids[0]]: _, ...missing } = lite.criteria;
  assert.equal(validateAssessLite({ ...lite, criteria: missing }, ids).ok, false, 'todas las claves del objetivo');
  assert.equal(assessLiteSchema(ids).properties.criteria.additionalProperties, false);
  const full = liftAssess(lite, 'lite', ids);
  assert.equal(validateAssess(full.contract ? (({ contract, ...x }) => x)(full) : full).ok, true, 'lo ligero se eleva a agent.assess/1');
  assert.equal(full.criteria[ids[0]].reason, '');
});

test('P0.3 el contrato actual sigue disponible por bandera y el ligero es el defecto', () => {
  assert.equal(assessContractOf({}), 'lite'); assert.equal(assessContractOf({ ENGINE_AGENT_ASSESS_CONTRACT: 'full' }), 'full');
  const args = { objective: 'grant', brief: { company: 'X' }, page: { url: 'u', title: 't', text: 'x' }, ref: 'p1', today: '2026-10-19' };
  assert.equal(assessPromptFor('full', args).version, assessPrompt(args).version);
  assert.equal(assessPromptFor('full', args).user, assessPrompt(args).user, 'el prompt actual no cambia');
  assert.equal(assessPromptFor('lite', args).schema.$id, 'agent.assess_lite/1');
  assert.match(assessLitePrompt({ ...args, triageNote: 'page shape (code): news' }).user, /Deterministic pre-read[\s\S]*page shape \(code\): news/);
  assert.equal(validateAssessMin({ ref: 'p1', page_type: 'call', about: 'x', candidate: false, deadline: null }).ok, true);
});

test('P0.3 el bucle hace triage antes de llamar al modelo, lo traza y lo pasa al prompt', async () => {
  const order = []; const events = []; const trace = { event: (type, data) => { events.push({ type, ...data }); if (type === 'triage') order.push('triage'); } };
  const steps = [{ thought: '', assessment: null, notes: [], action: { tool: 'open', args: { refs: ['s1.1'] }, from_lead: null } }, { thought: '', assessment: null, notes: [], action: { tool: 'finish', args: { reason: 'done', finalists: [] }, from_lead: null } }];
  let assessUser = '';
  const chat = async (req) => {
    if (req.name === 'understand') return { json: { product_one_line: '', who_pays: '', sector: '', neighbor_sectors: [], stage: '', geography: '', assumptions: [], doubts: [] } };
    if (req.name === 'agent') return { json: steps.shift() };
    order.push('assess'); assessUser = req.user;
    return { json: { ref: 'p1', page_type: 'other', about: 'x', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: false, lead: null } };
  };
  const tools = { open: async () => ({ ref: 'p1', url: 'https://grants.nih.gov/grants/guide/notice-files/NOT-AG-24-043.html', title: 'EXPIRED: NOT-AG-24-043', chars: 40, text: '<page_data>Notice NOT-AG-24-043. Expiration Date: March 1, 2025.</page_data>', links: [] }), finish: async () => ({ ok: true }), usage: () => ({}) };
  const r = await runAgentObjective('grant', { company: 'X' }, { chat, tools, trace, today: '2026-10-19', parallel: true, secondJudge: 0 });
  assert.deepEqual(order, ['triage', 'assess']);
  const t = events.find((e) => e.type === 'triage'); assert.equal(t.banners[0].kind, 'expired'); assert.deepEqual(t.foa_ids, ['NOT-AG-24-043']);
  assert.match(assessUser, /expired/); assert.equal(r.findings.length, 0);
  assert.equal(triageNote(triagePage({ url: 'https://x.org', title: 'x', text: '', today: '2026-10-19' })).startsWith('page shape'), true);
});
