/* Pruebas de los arreglos del 14-10 (diagnóstico MINT AD). Una prueba por bug, sin red. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { urlsFromRun, runGptr, gptrPrompt } from '../server/research/gptr.mjs';
import { auditPage } from '../server/research/judge/audit.v13.mjs';
import { validateAssess } from '../server/research/agentic/contracts.v14.mjs';
import { engineLeads } from '../server/research/engine.mjs';
import { contactStage } from '../server/research/agentic/contacts.mjs';
import { briefCountry, foreignHost } from '../server/research/geo.mjs';
import { fromSimpler, fromLegacy, opportunityPage, searchRegistry, noticeNumbers, stillOpen, applicantOk, registrySeeds, registryQueries } from '../server/research/registry/simplerGrants.mjs';
import { datesIn } from '../server/research/dates.mjs';

const TODAY = '2026-10-14';
const LOG = readFileSync(new URL('./fixtures/v14fix/gptr-log-mintad-20261014-013838.txt', import.meta.url), 'utf8');
const BRIEF = JSON.parse(readFileSync(new URL('../eval/briefs/jefe-igc-mint-ad-2026-10-12.json', import.meta.url), 'utf8'));

/* ── Bug 1: ranking. Con el ranking anterior el aviso vigente quedaba en la posición 70 y la RFA estatal en la 264 (fuera de las 40). ── */
test('BUG-1 ranking: el aviso federal vigente y la RFA estatal en PDF entran en las 40 que lee el juez (log real 14-10)', () => {
  const top = urlsFromRun({ log: LOG, max: 40, today: TODAY, brief: BRIEF }).map((u) => u.url);
  assert.equal(top.length, 40);
  assert.ok(top.some((u) => u.includes('PA-27-100')), 'PA-27-100 debe entrar');
  assert.ok(top.some((u) => u.includes('PA-27-101')), 'PA-27-101 debe entrar');
  assert.ok(top.some((u) => /Company%20Formation-RFA_FY2026/.test(u)), 'la RFA FY2026 del programa estatal debe entrar');
  assert.equal(top.some((u) => /PA-16-091|PAS-17-064|PAR-17-067/.test(u)), false, 'avisos vencidos (año fiscal viejo) no ocupan cupo');
});
test('BUG-1 ranking: tope por dominio (un solo sitio no llena el cupo) y blogs fechados abajo', () => {
  const top = urlsFromRun({ log: LOG, max: 40, today: TODAY, brief: BRIEF });
  const per = new Map(); for (const u of top) { const h = new URL(u.url).hostname.replace(/^www\./, ''); per.set(h, (per.get(h) || 0) + 1); }
  assert.ok(Math.max(...per.values()) <= 5, `máximo por dominio: ${JSON.stringify([...per])}`);
  const r = urlsFromRun({ log: ['https://ex.org/2026/08/09/some-grants-roundup', 'https://agency.gov/funding/rfa-2026'].map((x) => `Added source url to research: ${x}`).join('\n'), today: TODAY });
  assert.equal(r[0].url, 'https://agency.gov/funding/rfa-2026');
});
test('BUG-1 ranking: con país en el brief, dominios de otro país bajan (14-10: 16 de 31 páginas eran UE/RU para un brief de EE. UU.)', () => {
  assert.equal(briefCountry({ geography: 'US' }), 'US'); assert.equal(briefCountry({ country: 'Colombia' }), 'CO'); assert.equal(briefCountry({ geography: 'Global' }), null);
  assert.equal(foreignHost('apply-for-innovation-funding.service.gov.uk', 'US'), true); assert.equal(foreignHost('hadea.ec.europa.eu', 'US'), true); assert.equal(foreignHost('grants.nih.gov', 'US'), false); assert.equal(foreignHost('startup.io', 'US'), false);
  const log = ['https://apply-for-innovation-funding.service.gov.uk/competition/ai-grant-2026', 'https://agency.gov/opportunity/ai-grant-2026'].map((x) => `Added source url to research: ${x}`).join('\n');
  assert.equal(urlsFromRun({ log, today: TODAY, brief: { geography: 'US' } })[0].url, 'https://agency.gov/opportunity/ai-grant-2026');
});
test('BUG-1 prompt: geografía explícita, niveles genéricos, sin operadores site: y sin financiadores nombrados; inversores con su propio prompt', () => {
  const p = gptrPrompt({ brief: BRIEF, today: TODAY });
  assert.match(p, /based in Maryland, US/); assert.match(p, /state's economic development agency/); assert.match(p, /do not use operators such as site:/);
  assert.doesNotMatch(p, /NSF|NIH|TEDCO|SBIR|Maryland Innovation|MIPS/);
  const inv = gptrPrompt({ brief: BRIEF, objective: 'investment', today: TODAY });
  assert.match(inv, /investors/); assert.match(inv, /deal in the last 18 months/); assert.doesNotMatch(inv, /grant opportunities/);
});

/* ── Bug 2: el juez. Avisos vencidos quedaban «a verificar» porque el rol de la fecha no era application_deadline. ── */
const crit = (over = {}) => ({ deadline: { verdict: 'unknown', quote: null, reason: '' }, eligibility: { verdict: 'unknown', quote: null, reason: '' }, region: { verdict: 'unknown', quote: null, reason: '' }, entity_type: { verdict: 'unknown', quote: null, reason: '' }, stage: { verdict: 'unknown', quote: null, reason: '' }, topic_fit: { verdict: 'unknown', quote: null, reason: '' }, ...over });
test('BUG-2 juez: rol «deadline» con fecha pasada → cerrado (PAR-17-067 «Expiration Date September 6, 2019»)', () => {
  const page = { url: 'https://x.gov/par', title: 'Tools for care (R43/R44)', text: 'Posted Date December 2, 2016\nExpiration Date September 6, 2019\nSmall businesses may apply.' };
  const a = auditPage({ page, today: TODAY, judgment: { page_type: 'call', dates: [{ role: 'deadline', date: '2019-09-06', estimated: false, quote: 'Expiration Date September 6, 2019' }], criteria: crit() } });
  assert.equal(a.state, 'closed'); assert.equal(a.dropReason, 'closed');
});
test('BUG-2 juez: cita de cierre con varias fechas, todas pasadas → cerrado (PAS-17-064)', () => {
  const q = 'Expiration Date New Date January 24, 2018 per reissuance of FOA (Original Expiration Date: September 6, 2019)';
  const a = auditPage({ page: { url: 'u', title: 't', text: `x ${q} y` }, today: TODAY, judgment: { page_type: 'call', dates: [{ role: 'application_deadline', date: '2018-01-24', estimated: false, quote: q }], criteria: crit() } });
  assert.equal(a.dropReason, 'closed');
  const mixed = 'Due dates: September 5, 2025 and January 5, 2027';   // una futura: no se puede cerrar
  const b = auditPage({ page: { url: 'u', title: 't', text: mixed }, today: TODAY, judgment: { page_type: 'call', dates: [{ role: 'application_deadline', date: '2025-09-05', estimated: false, quote: mixed }], criteria: crit() } });
  assert.notEqual(b.dropReason, 'closed');
});
test('BUG-2 juez: «no» al plazo con cita literal de fechas pasadas, o título «Expired», cierran; nunca abren', () => {
  const page = { url: 'u', title: 'Program', text: 'Letters of Intent must be received by August 6, 2025.' };
  const a = auditPage({ page, today: TODAY, judgment: { page_type: 'call', dates: [], criteria: crit({ deadline: { verdict: 'no', quote: 'Letters of Intent must be received by August 6, 2025.', reason: 'past' } }) } });
  assert.equal(a.dropReason, 'closed');
  const b = auditPage({ page: { url: 'u', title: 'Expired PA-16-091: Small Business Research', text: 'Some text' }, today: TODAY, judgment: { page_type: 'call', dates: [], criteria: crit() } });
  assert.equal(b.dropReason, 'closed');
});
test('BUG-3 solo convocatorias: página ilegible o de programa sin plazo no es hallazgo con requireCall; convocatoria con plazo futuro sigue', () => {
  const unreadable = auditPage({ page: { url: 'u', title: 'Lock', text: 'Your session will expire.' }, today: TODAY, requireCall: true, judgment: { page_type: 'other', dates: [], criteria: crit() } });
  assert.equal(unreadable.dropReason, 'too_short');
  const prog = auditPage({ page: { url: 'u', title: 'About', text: 'We fund health. Small businesses welcome.' }, today: TODAY, requireCall: true, judgment: { page_type: 'program_page', dates: [], criteria: crit({ topic_fit: { verdict: 'yes', quote: 'We fund health.', reason: '' } }) } });
  assert.equal(prog.dropReason, 'not_a_call:program_page');
  const call = auditPage({ page: { url: 'u', title: 'RFA', text: 'Application close date: January 5, 2027\nWe fund health.' }, today: TODAY, requireCall: true, judgment: { page_type: 'call', dates: [{ role: 'application_deadline', date: '2027-01-05', estimated: false, quote: 'Application close date: January 5, 2027' }], criteria: crit({ topic_fit: { verdict: 'yes', quote: 'We fund health.', reason: '' } }) } });
  assert.equal(call.dropReason, null); assert.equal(call.state, 'open'); assert.equal(call.deadline, '2027-01-05');
  const old = auditPage({ page: prog.dates ? { url: 'u', title: 'About', text: 'We fund health.' } : null, today: TODAY, judgment: { page_type: 'program_page', dates: [], criteria: crit({ topic_fit: { verdict: 'yes', quote: 'We fund health.', reason: '' } }) } });
  assert.equal(old.dropReason, null, 'sin requireCall el comportamiento de siempre no cambia');
});
test('BUG-4 compilador: un texto más largo que el contrato se recorta en vez de perder la página (14-10: «reason must NOT have more than 500»)', () => {
  const raw = { ref: 'p1', page_type: 'call', about: 'x', dates: [], date_missing_next: null, criteria: { eligibility: { verdict: 'yes', quote: 'q', reason: 'r'.repeat(900) } }, candidate: true, lead: null };
  const v = validateAssess(raw); assert.equal(v.ok, true); assert.equal(v.value.criteria.eligibility.reason.length, 500);
});

/* ── Bug 5: contactos. engineLeads no copiaba finding.contacts: los de Apollo nunca llegaban a la interfaz. ── */
test('BUG-5 engineLeads conserva los contactos (Apollo y registro) y la ficha del registro', () => {
  const f = { objective: 'grant', url: 'https://simpler.grants.gov/opportunity/fixture', name: 'PA-27-100 · Omnibus', title: 'x', status: 'open', deadline: '2027-01-05', amount: null, quotes: { identity: 'x', deadline: 'Application close date: January 5, 2027' }, flags: [], blockers: [], eligible: 'yes', tier: 'main', verdict: 'apply',
    registry: { number: 'PA-27-100', agency: 'Agency', closeDate: '2027-01-05' },
    contacts: [{ name: 'Grants desk', title: 'Contact listed in the official registry', organization: 'Agency', email: 'desk@agency.test', source: 'registry' }, { source: 'apollo', name: 'Ana Ruiz', title: 'Program Director', organization: 'Agency', linkedin_url: 'https://linkedin.test/ana' }] };
  const [lead] = engineLeads([f]);
  assert.equal(lead.contacts.length, 2); assert.equal(lead.contacts[0].email, 'desk@agency.test'); assert.equal(lead.contacts[1].linkedin, 'https://linkedin.test/ana'); assert.equal(lead.contacts[1].role, 'Program Director');
  assert.equal(lead.registry.number, 'PA-27-100'); assert.equal(lead.foundBy[0].provider, 'Grants.gov');
});
test('BUG-5 Apollo no pisa el contacto oficial del registro ni busca personas en el dominio del registro', async () => {
  const calls = []; const tools = { usage: () => ({ apollo_credits: calls.length }), apollo: async (a) => { calls.push(a); return a.op === 'organization' ? { rows: [{ id: 'o' }] } : { rows: [{ first_name: 'Ana', last_name: 'R', title: 'Program Officer' }] }; } };
  const reg = { url: 'https://simpler.grants.gov/opportunity/x', registry: { moreInfoUrl: 'https://www.agency.gov/program' }, contacts: [{ name: 'Desk', email: 'd@agency.gov', source: 'registry' }], eligible: 'yes', status: 'open' };
  await contactStage({ findings: [reg], tools, env: {}, configured: true });
  assert.equal(calls[0].domain, 'agency.gov'); assert.equal(reg.contacts[0].source, 'registry'); assert.equal(reg.contacts[1].name, 'Ana R');
  const noInfo = { url: 'https://simpler.grants.gov/opportunity/y', registry: {}, eligible: 'yes', status: 'open' }; const before = calls.length;
  await contactStage({ findings: [noInfo], tools, env: {}, configured: true }); assert.equal(calls.length, before, 'sin enlace de la agencia no se gasta Apollo en grants.gov');
});

/* ── Tarea B: registro oficial como herramienta genérica. ── */
const SIMPLER_ROW = { opportunity_id: '00000000-0000-4000-8000-000000000100', opportunity_number: 'PA-27-100', opportunity_title: 'Fixture omnibus small business solicitation', agency_name: 'Fixture Agency', agency_code: 'FIX', opportunity_status: 'posted',
  summary: { close_date: '2027-01-05', post_date: '2026-05-29', award_ceiling: 300000, applicant_types: ['small_businesses'], applicant_eligibility_description: 'Only small business concerns are eligible.', summary_description: 'Supports research on dementia risk tools.', additional_info_url: 'https://www.agency.test/sbir', agency_email_address: 'help@agency.test', agency_contact_description: 'Grants help desk' } };
test('B registro: la oportunidad oficial se vuelve una página con fechas citables (una por línea) que el juez y el auditor pueden verificar', () => {
  const o = fromSimpler(SIMPLER_ROW); const page = opportunityPage(o);
  assert.equal(page.url, 'https://simpler.grants.gov/opportunity/00000000-0000-4000-8000-000000000100');
  const line = page.text.split('\n').find((l) => l.startsWith('Application close date'));
  assert.equal(line, 'Application close date: January 5, 2027'); assert.deepEqual(datesIn(line), ['2027-01-05']);
  assert.match(page.text, /Eligible applicant types: small businesses/); assert.match(page.text, /Agency contact: Grants help desk · help@agency.test/);
});
test('B registro: Simpler Grants con X-API-Key y filtros; sin clave cae a la API pública de Grants.gov', async () => {
  const seen = [];
  const fetcher = async (url, init) => { const body = JSON.parse(init.body); seen.push({ url, body, headers: init.headers });
    if (url.includes('simpler')) return { ok: true, json: async () => ({ data: [SIMPLER_ROW] }) };
    if (url.includes('search2')) return { ok: true, json: async () => ({ errorcode: 0, data: { oppHits: [{ id: '361000', number: 'FIX-26-001', title: 'Legacy fixture', agency: 'Fixture', oppStatus: 'posted', closeDate: '11/04/2026' }] } }) };
    return { ok: true, json: async () => ({ errorcode: 0, data: { synopsis: { responseDate: 'Nov 04, 2026 12:00:00 AM EST', applicantTypes: [{ id: '23', description: 'Small businesses' }], synopsisDesc: 'x' } } }) }; };
  const a = await searchRegistry({ query: 'dementia risk', applicantTypes: ['small_businesses'] }, { env: { SIMPLER_GRANTS_API_KEY: 'k' }, fetcher });
  assert.equal(a.via, 'simpler'); assert.equal(seen[0].headers['X-API-Key'], 'k'); assert.deepEqual(seen[0].body.filters.opportunity_status.one_of, ['posted', 'forecasted']);
  assert.ok(seen[0].body.filters.applicant_type.one_of.includes('small_businesses')); assert.equal(a.rows[0].closeDate, '2027-01-05');
  const b = await searchRegistry({ query: 'dementia risk', applicantTypes: ['small_businesses'] }, { env: {}, fetcher });
  assert.equal(b.via, 'grants.gov'); assert.equal(b.rows[0].closeDate, '2026-11-04'); assert.deepEqual(b.rows[0].applicantTypes, ['small_businesses']);
  assert.equal(seen.find((x) => x.url.includes('search2')).body.oppStatuses, 'posted|forecasted');
});
test('B registro: números de aviso, vigencia y tipo de solicitante', () => {
  assert.deepEqual(noticeNumbers(['https://files.x.gov/a/PA-27-100-Revised-Full-Announcement.html', 'RFA-AG-27-010 and NSF 26-511', 'files/2026-01/MII%20RFA.pdf']).sort(), ['NSF 26-511', 'PA-27-100', 'RFA-AG-27-010']);
  assert.equal(stillOpen({ closeDate: '2026-10-15' }, TODAY), true); assert.equal(stillOpen({ closeDate: '2026-09-05' }, TODAY), false);
  assert.equal(stillOpen({ isForecast: true, forecastClose: null }, TODAY), true); assert.equal(stillOpen({ status: 'posted' }, TODAY), true);
  assert.equal(applicantOk(['state_governments'], { entityType: 'for_profit' }), false); assert.equal(applicantOk(['unrestricted'], { entityType: 'for_profit' }), true); assert.equal(applicantOk([], { entityType: 'for_profit' }), true);
  const q = registryQueries(BRIEF); assert.ok(q.length >= 2); assert.doesNotMatch(q.join(' '), /NIH|NSF|TEDCO/);
});
test('B registro: semillas al juez — primero lo hallado por número, sin cerradas ni no elegibles, tope por agencia', async () => {
  const rows = [SIMPLER_ROW, { ...SIMPLER_ROW, opportunity_id: 'c', opportunity_number: 'OLD-25-001', summary: { ...SIMPLER_ROW.summary, close_date: '2026-01-01' } }, { ...SIMPLER_ROW, opportunity_id: 'g', opportunity_number: 'GOV-26-002', summary: { ...SIMPLER_ROW.summary, applicant_types: ['state_governments'] } }];
  const fetcher = async (url, init) => { const body = JSON.parse(init.body); return { ok: true, json: async () => ({ data: body.query === 'PA-27-100' ? [SIMPLER_ROW] : rows }) }; };
  const { seeds, stats } = await registrySeeds({ brief: { entityType: 'for_profit' }, queries: ['dementia'], numbers: ['PA-27-100'], today: TODAY, env: { SIMPLER_GRANTS_API_KEY: 'k' }, fetcher });
  assert.equal(seeds.length, 1); assert.equal(seeds[0].why, 'number:PA-27-100'); assert.equal(stats.closed, 1); assert.equal(stats.notEligible, 1);
});
test('B runGptr: el registro corre en paralelo, sus páginas van primero al juez con texto oficial y los números vistos por GPTR se resuelven', async () => {
  let seen = null; const asked = [];
  const registryFetcher = async (url, init) => { const body = JSON.parse(init.body); asked.push(body.query ?? body.oppNum ?? body.keyword); return { ok: true, json: async () => ({ data: body.query === 'PA-27-100' ? [SIMPLER_ROW] : [] }) }; };
  const r = await runGptr('grant', BRIEF, { env: { SIMPLER_GRANTS_API_KEY: 'k' }, today: TODAY, gptrRunner: async () => ({ early: true }), registryFetcher,
    logText: 'Added source url to research: https://files.simpler.grants.gov/o/x/PA-27-100-Revised-Full-Announcement.html\nAdded source url to research: https://agency.gov/funding/rfa-2026', reportText: '',
    judgeRunner: async (obj, brief, o) => { seen = o; return { findings: [], audit: { objective: obj } }; } });
  assert.ok(asked.includes('PA-27-100'));
  assert.equal(seen.seedUrls[0].registry.number, 'PA-27-100'); assert.match(seen.seedUrls[0].text, /Application close date: January 5, 2027/);
  assert.ok(seen.seedUrls.some((u) => u.url === 'https://agency.gov/funding/rfa-2026'));
  assert.equal(r.audit.gptr.registry.seeds, 1);
});
test('B runGptr: brief de otro país no consulta el registro federal de EE. UU.; inversión tampoco', async () => {
  let n = 0; const registryFetcher = async () => { n++; return { ok: true, json: async () => ({ data: [] }) }; };
  const judgeRunner = async (obj) => ({ findings: [], audit: { objective: obj } });
  await runGptr('grant', { country: 'Colombia' }, { env: { SIMPLER_GRANTS_API_KEY: 'k' }, today: TODAY, gptrRunner: async () => ({}), registryFetcher, logText: 'Added source url to research: https://a.gov.co/convocatoria-2026', reportText: '', judgeRunner });
  await runGptr('investment', BRIEF, { env: { SIMPLER_GRANTS_API_KEY: 'k' }, today: TODAY, gptrRunner: async () => ({}), registryFetcher, logText: 'Added source url to research: https://vc.example/portfolio', reportText: '', judgeRunner });
  assert.equal(n, 0);
});
test('B legacy: fetchOpportunity con pronóstico se marca como forecast con su fecha estimada', () => {
  const o = fromLegacy({ id: '1', number: 'F-27-1', title: 'x', oppStatus: 'forecasted', closeDate: '' }, { forecast: { estApplicationResponseDate: 'Mar 01, 2027', forecastDesc: 'y' } });
  assert.equal(o.isForecast, true); assert.equal(o.forecastClose, '2027-03-01'); assert.match(opportunityPage(o).text, /Estimated application due date: March 1, 2027/);
});

/* ── Bug 6: tope de tiempo. RESEARCH_RUN_TIMEOUT_MS abortaba todo y se perdía lo encontrado. ── */
import { runResearch } from '../server/research/pipeline.mjs';
import { createStore } from '../server/research/store.mjs';
import { candidate, evidence, validateBrief } from '../server/research/core.mjs';
test('BUG-6 tope de tiempo: lo que ya devolvieron las fuentes se evalúa y se entrega como parcial (aunque otra fuente se cuelgue)', async () => {
  const store = createStore(':memory:');
  const brief = validateBrief({ name: 'T', role: 'Founder', company: 'C', product: 'P', description: 'dementia risk software', industry: 'healthcare', stage: 'clinical_phase_2', geography: 'US', fundingTypes: ['partnering'], dataMode: 'live', useTeam: false, minDays: 30 });
  const job = { id: 'timeout', brief, mode: 'live', events: [], leads: [], senderEvidence: [] };
  const lead = candidate({ org: 'Example', title: 'dementia risk software partner', evidence: [evidence('Fixture', 'https://example.org/s', 'dementia risk software', 'title')], fundingType: 'partnering' });
  const keep = setInterval(() => {}, 100);   // AbortSignal.timeout no mantiene vivo el proceso de pruebas (en el servidor sí lo está)
  await runResearch(job, store, { env: { RESEARCH_RUN_TIMEOUT_MS: '1500' }, providers: [['fast', async () => [lead]], ['hangs', () => new Promise(() => {})]] });
  clearInterval(keep);
  assert.equal(job.status, 'partial'); assert.equal(job.timedOut, true); assert.equal(job.leads.length, 1);
  assert.ok(job.events.some((e) => /Time limit .* reached: showing the 1 candidates/.test(e.message)));
  store.close();
});
test('BUG-6 el motor recibe un plazo anterior al tope global (deja margen para evaluar)', async () => {
  let got = null;
  const { runObjective } = await import('../server/research/engine.mjs');
  await runObjective('grant', {}, { env: { ENGINE_GPTR: '1' }, deadlineAt: Date.now() + 600000, gptrRunner: async () => ({}), logText: 'Added source url to research: https://a.gov/rfa-2026', reportText: '', judgeRunner: async (o, b, x) => { got = x.deadlineAt; return { findings: [], audit: {} }; } });
  assert.ok(got > Date.now());
});
test('E inversores: el ranking de URLs para inversión prefiere las páginas propias del fondo (portafolio, tesis) sobre convocatorias', () => {
  const log = ['https://agency.gov/funding/rfa-2026', 'https://examplevc.com/portfolio', 'https://examplevc.com/team'].map((x) => `Added source url to research: ${x}`).join('\n');
  const r = urlsFromRun({ log, today: TODAY, objective: 'investment' });
  assert.equal(r[0].url, 'https://examplevc.com/portfolio');
});
