/* V15 · Regresión del caso RD-04 (MINT-AD Genomics, runs-v6) sin red.
   Mundo simulado con la forma real de las APIs: NIH Guide (doctext completo), Simpler.Grants.gov (summary anidado),
   buscador web y páginas de la Alzheimer's Association. Los textos son fixtures redactados para la prueba, con la
   estructura de los avisos reales (Key Dates, Section I, Section III); no son copia de los documentos. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { createTools } from '../server/research/agentic/tools.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';
import { applicantFacts, gateApplicant } from '../server/research/dossier/pipeline.mjs';
import { briefTerms } from '../server/research/dossier/terms.mjs';
import { buildDossiers } from '../server/research/dossier/dossier.mjs';

const brief = JSON.parse(readFileSync(new URL('./fixtures/v15/RD-04-mint-ad-genomics.json', import.meta.url), 'utf8'));
const TODAY = '2026-10-19';
const ids = AGENT_CRITERIA.grant;

const ELIG = 'Section III. Eligibility Information 1. Eligible Applicants Eligible Organizations Higher Education Institutions Public/State Controlled Institutions of Higher Education Nonprofits Other Than Institutions of Higher Education For-Profit Organizations Small Businesses For-Profit Organizations (Other than Small Businesses) Governments Foreign Organizations Non-domestic (non-U.S.) Entities (Foreign Organizations) are eligible to apply. Foreign components, as defined in the NIH Grants Policy Statement, are allowed. Applicant Organizations must complete registrations in SAM and eRA Commons. Section IV.';
const nihDoc = ({ docnum, title, ac, parent = false, expdate, purpose, section1, dates, ct = 'Not_Allowed', type = 'active' }) => ({ _source: {
  docnum, title, doctype: docnum.split('-')[0], filename: `${docnum}.html`, ac, parentFOA: parent ? 'Yes' : 'No', expdate: `${expdate}T00:00:00.000Z`, opendate: '2025-01-16T00:00:00.000Z', reldate: '2024-12-18T00:00:00.000Z',
  primaryIC: parent ? 'NIH' : 'NIA', sponsors: ['NIA'], clinicaltrials: ct, type, purpose,
  doctext: `Department of Health and Human Services Part 1. Overview Information Participating Organization(s) National Institutes of Health Funding Opportunity Title ${title} Activity Code ${ac.join(', ')} Notice of Funding Opportunity (NOFO) Number: ${docnum} Funding Opportunity Purpose ${purpose} Key Dates Posted Date December 18, 2024 Open Date (Earliest Submission Date) January 16, 2025 Letter of Intent Due Date(s) Not Applicable Application Due Dates Review and Award Cycles New Renewal / Resubmission / Revision (as allowed) AIDS Scientific Merit Review Advisory Council Review Earliest Start Date ${dates} Expiration Date ${expdate} Required Application Instructions It is critical that applicants follow the instructions. Part 2. Full Text of Announcement Section I. Notice of Funding Opportunity Description ${section1} Section II. Award Information Funding Instrument Grant. ${ELIG} Section IV. Application and Submission Information ...`,
} });
const R21_DATES = 'February 16, 2026 March 16, 2026 Not Applicable July 2026 October 2026 December 2026 June 16, 2026 July 16, 2026 Not Applicable November 2026 January 2027 April 2027 October 16, 2026 November 16, 2026 Not Applicable March 2027 May 2027 July 2027 February 16, 2027 March 16, 2027 Not Applicable July 2027 October 2027 December 2027';
const R01_DATES = 'February 05, 2026 March 05, 2026 Not Applicable July 2026 October 2026 December 2026 October 05, 2026 November 05, 2026 Not Applicable March 2027 May 2027 July 2027 February 05, 2027 March 05, 2027 Not Applicable July 2027 October 2027 December 2027';
const NIH = [
  nihDoc({ docnum: 'PA-25-304', title: 'NIH Exploratory/Developmental Research Project Grant (Parent R21 Clinical Trial Not Allowed)', ac: ['R21'], parent: true, expdate: '2028-01-08', purpose: 'The NIH Exploratory/Developmental Research Grant supports exploratory and developmental research projects by providing support for the early and conceptual stages of project development.', section1: 'The R21 is intended to encourage exploratory/developmental research by providing support for the early and conceptual stages of project development. Applications for R21 awards should describe projects distinct from those supported through the traditional R01 mechanism. Investigator-initiated research in the scientific mission areas of the participating NIH Institutes, including the National Institute on Aging, is supported.', dates: R21_DATES }),
  nihDoc({ docnum: 'PA-25-301', title: 'NIH Research Project Grant (Parent R01 Clinical Trial Not Allowed)', ac: ['R01'], parent: true, expdate: '2028-01-08', purpose: 'The Research Project Grant (R01) supports a discrete, specified, circumscribed project in areas representing the investigators specific interests and competencies, based on the mission of the NIH.', section1: 'The R01 supports investigator-initiated research in the mission areas of the participating Institutes, including the National Institute on Aging.', dates: R01_DATES }),
  nihDoc({ docnum: 'PAR-25-272', title: 'Measuring the Brain Over Time in Alzheimer\'s Disease and Related Dementias: Genetic and Genomic Approaches (R21 Clinical Trial Not Allowed)', ac: ['R21'], expdate: '2027-05-08', purpose: 'This NOFO supports exploratory studies that develop tools to measure brain change over time in Alzheimer\'s disease, including genetic and genomic approaches.', section1: 'Applications must contribute to measuring brain changes across time; genetics and genomics projects are responsive only when they contribute to longitudinal brain measurement. Risk-factor discovery alone is not responsive.', dates: 'February 16, 2026 March 16, 2026 Not Applicable July 2026 October 2026 December 2026 February 16, 2027 March 16, 2027 Not Applicable July 2027 October 2027 December 2027' }),
  nihDoc({ docnum: 'PAR-25-331', title: 'Alzheimer\'s Disease Genetics Consortium Follow-up (U01)', ac: ['U01'], expdate: '2026-09-01', purpose: 'Alzheimer\'s disease genetics follow-up studies.', section1: 'Genetic follow-up of Alzheimer risk loci.', dates: 'February 05, 2026 Not Applicable' }),
  nihDoc({ docnum: 'PAR-24-273', title: 'Advancing Healthcare for Older Adults from Populations that Experience Health Disparities (R01 Clinical Trial Optional)', ac: ['R01'], expdate: '2028-01-08', purpose: 'Advance the implementation of multi-level healthcare interventions for older adults, including those with Alzheimer\'s disease, from populations with health disparities.', section1: 'Healthcare delivery interventions for older adults.', dates: 'February 05, 2027 March 05, 2027 Not Applicable July 2027 October 2027 December 2027', ct: 'Optional' }),
];
const SIMPLER = [
  { opportunity_id: '7a4a9822-f39f-464d-8a1d-d941afaebcdf', opportunity_number: 'RFA-AG-27-005', opportunity_title: 'The NIA Genetics of Alzheimer\'s Disease Data Storage Site (NIAGADS)', agency_name: 'National Institutes of Health', opportunity_status: 'forecasted',
    summary: { summary_description: 'The National Institute on Aging (NIA) intends to publish a Notice of Funding Opportunity (NOFO) to solicit applications to develop, operate, and sustain a cloud-based data storage and computing platform that democratizes access to large-scale AD/ADRD genetic and genomic data. Applications are not being solicited at this time.', applicant_types: ['small_businesses', 'for_profit_organizations_other_than_small_businesses', 'public_and_state_institutions_of_higher_education'], applicant_eligibility_description: 'Non-domestic (non-U.S.) Entities (Foreign Institutions) are eligible to apply.', forecasted_close_date: '2026-11-01' } },
  { opportunity_id: 'b0b0', opportunity_number: 'PA-25-304', opportunity_title: 'NIH Exploratory/Developmental Research Project Grant (Parent R21 Clinical Trial Not Allowed)', agency_name: 'National Institutes of Health', opportunity_status: 'posted', summary: { summary_description: 'R21 parent announcement.', applicant_types: ['small_businesses'] } },
];
const GRANTS_GOV_STUB = { id: '362454', number: 'RFA-AG-27-005', title: 'The NIA Genetics of Alzheimer\'s Disease Data Storage Site (NIAGADS)', agency: 'National Institutes of Health', oppStatus: 'forecasted', openDate: '05/18/2026' };

const CATALOG = '<html><head><title>Types of Grants | Alzheimer\'s Association</title></head><body><h1>Types of grants</h1><p>The Alzheimer\'s Association funds research through several grant programs.</p><a href="https://www.alz.org/research/for_researchers/grants/types-of-grants/the_zenith_fellows_award_program_-zenith">Zenith Fellows Award Program</a><a href="https://www.alz.org/research/for_researchers/grants/types-of-grants/aarga">Alzheimer\'s Association Research Grant (AARG)</a><a href="https://www.alz.org/research/for_researchers/grants/types-of-grants/aarga-new-to-field">AARG New to the Field grant</a><a href="https://www.alz.org/research/for_researchers/grants/types-of-grants/bring-it">BRING IT program grant</a><a href="https://www.alz.org/news/2026/awardees">2026 grant recipients news</a></body></html>';
const ZENITH = '<html><head><title>The Zenith Fellows Award Program | Alzheimer\'s Association</title></head><body><h1>Zenith Fellows Award Program</h1><p>The Zenith program funds fundamental research on the etiology of Alzheimer\'s disease, including genetic risk factors, with awards up to $450,000.</p><p>Eligibility: applicants must be Associate Professor or above with an independent research program. For-profit entities are not eligible to apply as the applicant institution.</p><p>Letter of Intent deadline: December 1, 2026. Full proposal deadline: March 30, 2027. Applicants apply through the online portal.</p></body></html>';
const AARGA = '<html><head><title>AARG | Alzheimer\'s Association</title></head><body><h1>Alzheimer\'s Association Research Grant</h1><p>The AARG program funds research on Alzheimer\'s disease and related dementias, including genetics and risk factors.</p><p>Eligibility: investigators at academic or nonprofit institutions worldwide may apply.</p><p>Letters of intent are required. Letter of Intent deadline: August 14, 2026. Full application deadline: October 22, 2026, by invitation after an accepted letter of intent.</p></body></html>';
const HTML = { 'https://www.alz.org/research/for_researchers/grants/types-of-grants': CATALOG, 'https://www.alz.org/research/for_researchers/grants/types-of-grants/the_zenith_fellows_award_program_-zenith': ZENITH, 'https://www.alz.org/research/for_researchers/grants/types-of-grants/aarga': AARGA };

// Variante runs-v7: la API de búsqueda de la guía responde 403; las páginas públicas de los avisos sí cargan, y el registro
// trae los avisos «Parent» y un pronóstico viejo (fecha estimada ya pasada).
const guideHtml = (h) => `<html><head><title>${h._source.docnum}: ${h._source.title}</title></head><body>${h._source.doctext}</body></html>`;
const SIMPLER_V7 = [
  { opportunity_id: 'p21', opportunity_number: 'PA-25-304', opportunity_title: 'NIH Exploratory/Developmental Research Project Grant (Parent R21 Clinical Trial Not Allowed)', agency_name: 'National Institutes of Health', opportunity_status: 'posted', summary: { summary_description: 'Parent R21.', applicant_types: ['small_businesses'] } },
  { opportunity_id: 'p01', opportunity_number: 'PA-25-301', opportunity_title: 'NIH Research Project Grant (Parent R01 Clinical Trial Not Allowed)', agency_name: 'National Institutes of Health', opportunity_status: 'posted', summary: { summary_description: 'Parent R01.', applicant_types: ['small_businesses'] } },
  { opportunity_id: 'g23', opportunity_number: 'RFA-AG-26-023', opportunity_title: 'Illuminating AD/ADRD Genome to Enable Precision Genomic Medicine', agency_name: 'National Institutes of Health', opportunity_status: 'forecasted', summary: { summary_description: 'NIA intends to publish a NOFO that supports projects to understand the genomic underpinnings of Alzheimer genetic risk. Applications are not being solicited at this time.', applicant_types: ['small_businesses', 'public_and_state_institutions_of_higher_education'], applicant_eligibility_description: 'Foreign organizations are eligible.', forecasted_close_date: '2026-10-06' } },
  { opportunity_id: 'n272', opportunity_number: 'PAR-25-272', opportunity_title: NIH[2]._source.title, agency_name: 'National Institutes of Health', opportunity_status: 'posted', summary: { summary_description: 'Alzheimer genomic approaches to brain measurement.', applicant_types: ['small_businesses'] } },
];
function world({ v7 = false } = {}) {
  const calls = { nih: [], simpler: 0, grants_gov: 0, web: [], fetched: [] };
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (v7 && u.startsWith('https://search.grants.nih.gov/')) { calls.nih.push('403'); return new Response('Forbidden', { status: 403 }); }
    if (v7 && u.startsWith('https://grants.nih.gov/grants/guide/')) { calls.fetched.push(u); const h = NIH.find((x) => u.endsWith(`/${x._source.docnum}.html`)); return h ? new Response(guideHtml(h), { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('nf', { status: 404 }); }
    if (u.startsWith('https://search.grants.nih.gov/guide/api/data')) {
      const q = new URL(u).searchParams.get('query') || ''; calls.nih.push(q);
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = q.startsWith('Parent') ? NIH.filter((h) => h._source.parentFOA === 'Yes') : NIH.filter((h) => words.some((w) => `${h._source.title} ${h._source.purpose}`.toLowerCase().includes(w.replace(/s$/, ''))));
      return new Response(JSON.stringify({ statusCode: 200, data: { hits: { total: hits.length, hits } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u === 'https://api.simpler.grants.gov/v1/opportunities/search') { calls.simpler++; const q = JSON.parse(init.body).query || ''; const data = (v7 ? [...SIMPLER, ...SIMPLER_V7] : SIMPLER).filter((r) => q.toLowerCase().split(/\s+/).every((w) => `${r.opportunity_title} ${r.summary.summary_description}`.toLowerCase().includes(w.replace(/s$/, '')))); return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    if (u === 'https://api.grants.gov/v1/api/search2') { calls.grants_gov++; return new Response(JSON.stringify({ errorcode: 0, data: { oppHits: [GRANTS_GOV_STUB] } }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    if (u === 'https://api.grants.gov/v1/api/fetchOpportunity') return new Response(JSON.stringify({ errorcode: 0, data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    calls.fetched.push(u);
    if (HTML[u]) return new Response(HTML[u], { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('not found', { status: 404 });
  };
  const search = async (query) => {
    calls.web.push(query);
    const rows = [{ url: 'https://www.alz.org/research/for_researchers/grants/types-of-grants', title: 'Types of Grants | Alzheimer\'s Association', description: 'Alzheimer research grant programs', markdown: '' },
      { url: 'https://www.nia.nih.gov/news/nih-funds-alzheimers-genome', title: 'NIH funds next step in Alzheimer genome research (news)', description: 'news', markdown: 'NIH announced awards to research teams. '.repeat(10) }];
    return Object.assign(rows, { stats: {} });
  };
  return { fetcher, search, calls };
}

/** Modelo simulado y honesto: decide por el texto que ve (como lo haría un juez correcto), con citas literales. */
function fakeChat(seen) {
  let agentStep = 0;
  return async (req) => {
    seen.push(req.name);
    if (req.name === 'understand') return { json: { product_one_line: 'Alzheimer genomics risk-factor discovery', who_pays: 'grant agencies', sector: 'biomedical research', neighbor_sectors: [], stage: 'research', geography: 'unknown', assumptions: [], doubts: [] }, model: 'fake' };
    if (req.name === 'agent') {
      agentStep++;
      // El agente de RD-04: abre una vez y luego insiste en reabrir p1 (el bucle de runs-v6).
      const action = agentStep === 1 ? { tool: 'search', args: { queries: ['Alzheimer genetics grant'] }, from_lead: null } : { tool: 'open', args: { refs: ['p1'] }, from_lead: null };
      return { json: { thought: '', assessment: null, notes: [], action }, model: 'fake' };
    }
    if (req.name === 'assess') { const ref = String(req.user.match(/Page ref: (\S+?)\./)?.[1]); return { json: { ref, page_type: 'program_page', about: 'page', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: false, lead: null }, model: 'fake' }; }
    if (req.schema?.$id === 'dossier.shortlist/1') {
      const lines = [...req.user.matchAll(/^\[(\d+)\] (.+)$/gm)];
      return { json: { items: lines.map(([, n, line]) => ({ n: Number(n), fit: /Data Storage|Healthcare for Older Adults/.test(line) ? 'unrelated' : /genetic|genomic|Alzheimer/i.test(line) ? 'direct' : 'possible' })) }, model: 'fake' };
    }
    return { json: judge(req.user), model: 'fake' };
  };
}
const quoteIn = (text, rx) => { const m = text.match(rx); return m ? m[0] : null; };
function judge(user) {
  const text = (user.split('<page_data>')[1] || '').split('</page_data>')[0];
  const c = (verdict, quote, reason = 'fixture') => ({ verdict: quote || verdict === 'unknown' ? verdict : 'unknown', quote, reason, compiler: 'not_shown' });
  const crit = Object.fromEntries(ids.map((id) => [id, c('unknown', null)]));
  const dates = [];
  crit.official = c('yes', quoteIn(text, /Official dossier for one funding opportunity/));
  crit.non_dilutive = c('yes', quoteIn(text, /Funding Instrument Grant|Cooperative agreement|awards up to \$450,000/));
  const forProfit = quoteIn(text, /For-Profit Organizations Small Businesses/);
  if (forProfit) { crit.eligibility = c('yes', forProfit); crit.entity_type = c('yes', forProfit); crit.region = c('yes', quoteIn(text, /Non-domestic \(non-U\.S\.\) Entities \(Foreign Organizations\) are eligible to apply/)); }
  if (/cloud-based data storage/.test(text)) crit.topic_fit = c('no', quoteIn(text, /develop, operate, and sustain a cloud-based data storage and computing platform/), 'infrastructure, not discovery');
  else if (/Risk-factor discovery alone is not responsive/.test(text)) crit.topic_fit = c('unknown', null, 'only if longitudinal brain measurement');
  else if (/Investigator-initiated research in the scientific mission areas/.test(text)) crit.topic_fit = c('yes', quoteIn(text, /Investigator-initiated research in the scientific mission areas of the participating NIH Institutes, including the National Institute on Aging, is supported/));
  else if (/supports investigator-initiated research in the mission areas/.test(text)) crit.topic_fit = c('yes', quoteIn(text, /The R01 supports investigator-initiated research in the mission areas of the participating Institutes, including the National Institute on Aging/));
  else if (/Zenith program funds fundamental research/.test(text)) {
    crit.topic_fit = c('yes', quoteIn(text, /The Zenith program funds fundamental research on the etiology of Alzheimer's disease, including genetic risk factors/));
    crit.entity_type = c('no', quoteIn(text, /For-profit entities are not eligible to apply as the applicant institution/), 'for-profit cannot be the applicant institution');
    dates.push({ role: 'loi_deadline', date: '2026-12-01', estimated: false, quote: 'Letter of Intent deadline: December 1, 2026' }, { role: 'application_deadline', date: '2027-03-30', estimated: false, quote: 'Full proposal deadline: March 30, 2027' });
  } else if (/AARG program funds research/.test(text)) {
    crit.topic_fit = c('yes', quoteIn(text, /The AARG program funds research on Alzheimer's disease and related dementias, including genetics and risk factors/));
    dates.push({ role: 'loi_deadline', date: '2026-08-14', estimated: false, quote: 'Letter of Intent deadline: August 14, 2026' }, { role: 'application_deadline', date: '2026-10-22', estimated: false, quote: 'Full application deadline: October 22, 2026' });
  }
  const pageType = /Applications are not being solicited|forecasted/i.test(text) ? 'forecast_notice' : 'call';
  return { page_type: pageType, dates, criteria: crit, requirements: { applicant_types: [], quote: null, academic_institution_required: 'unknown', foreign_organizations: 'unknown', pi_requirement: null } };
}

async function runRd04(extraEnv = {}, opts = {}) {
  const { fetcher, search, calls } = world(opts); const seen = []; const events = [];
  const trace = { event: (type, data) => { events.push({ type, ...data }); }, page: () => ({}) };
  const env = { ENGINE_DOSSIER: '1', ENGINE_AGENT_STALL_GUARD: '1', SIMPLER_GRANTS_API_KEY: 'k', ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ENGINE_AGENT_STEPS: '12', ENGINE_AGENT_READ_WAIT_MS: '2000', ...extraEnv };
  const tools = createTools({ env, fetcher, trace, readers: { search }, limits: { searches: 12, opens: 30 } });
  const r = await runAgentObjective('grant', brief, { env, tools, fetcher, chat: fakeChat(seen), trace, today: TODAY, parallel: true, secondJudge: 0, maxSeconds: 600 });
  return { r, events, calls, seen };
}

test('V15-RD04 NIAGADS no sale: la preselección la marca ajena y, si llega al juez, se descarta por alcance con el texto completo', async () => {
  const { r, events } = await runRd04();
  assert.equal(r.findings.some((f) => /NIAGADS|RFA-AG-27-005/.test(`${f.title} ${f.call_id}`)), false, JSON.stringify(r.findings.map((f) => f.call_id)));
  assert.equal(events.find((e) => e.type === 'dossier' && e.id === 'RFA-AG-27-005').fit, 'unrelated');
  const judged = await runRd04({ ENGINE_DOSSIER_SHORTLIST: '0' });
  const d = judged.events.find((e) => e.type === 'dossier' && e.id === 'RFA-AG-27-005' && e.decided_by === 'judge');
  assert.ok(d, 'NIAGADS llegó al juez como expediente'); assert.equal(d.decision, 'drop'); assert.equal(d.reason, 'scope_mismatch');
  assert.equal(judged.r.findings.some((f) => f.call_id === 'RFA-AG-27-005'), false);
});

test('V15-RD04 la ficha de Grants.gov (257 caracteres) y el registro completo de Simpler son UN expediente; la evidencia completa manda', () => {
  const items = [
    { source: 'simpler', number: 'RFA-AG-27-005', url: 'https://simpler.grants.gov/opportunity/7a4a', title: 'NIAGADS', textKind: 'synopsis', text: `Official registry record (Simpler.Grants.gov). Applicant types: small businesses. Summary: ${SIMPLER[0].summary.summary_description}` },
    { source: 'grants_gov', number: 'RFA-AG-27-005', url: 'https://www.grants.gov/search-results-detail/362454', title: 'NIAGADS', textKind: 'stub', text: 'Official registry record (Grants.gov). Opportunity number: RFA-AG-27-005. Opportunity status: forecasted.' },
    { source: 'agent', url: 'https://www.grants.gov/search-results-detail/362454', title: 'NIAGADS', textKind: 'web', text: 'Official registry record (Grants.gov). Opportunity number: RFA-AG-27-005.' },
  ];
  const ds = buildDossiers(items); assert.equal(ds.length, 1);
  const [d] = ds; assert.equal(d.id, 'RFA-AG-27-005'); assert.equal(d.sufficiency.level, 'synopsis'); assert.equal(d.docs[0].source, 'simpler');
  assert.deepEqual(d.sources.sort(), ['agent', 'grants_gov', 'simpler']);
});

test('V15-RD04 aparecen las rutas generales y temáticas (R21, R01, PAR-25-272) y la fundación; la vencida no gasta juez', async () => {
  const { r, events } = await runRd04();
  const byId = Object.fromEntries(r.findings.map((f) => [f.call_id || f.url, f]));
  assert.ok(byId['PA-25-304'], 'Parent R21'); assert.ok(byId['PA-25-301'], 'Parent R01'); assert.ok(byId['PAR-25-272'], 'PAR-25-272');
  assert.ok(r.findings.some((f) => /zenith/i.test(f.url)), 'Zenith desde el catálogo');
  const expired = events.find((e) => e.type === 'dossier' && e.id === 'PAR-25-331');
  assert.equal(expired.decision, 'drop'); assert.equal(expired.reason, 'expired'); assert.equal(expired.decided_by, 'code');
  assert.equal(events.some((e) => e.type === 'dossier' && e.decided_by === 'judge' && e.id === 'PAR-24-273'), false, 'preselección: no relacionada no se juzga');
});

test('V15-RD04 fechas: la próxima fecha NUEVA del R21 es 16/02/2027 (no la de reenvío) y sale del texto oficial', async () => {
  const { r } = await runRd04();
  const r21 = r.findings.find((f) => f.call_id === 'PA-25-304');
  assert.equal(r21.status, 'open'); assert.equal(r21.deadline, '2027-02-16'); assert.equal(r21.deadlineSource, 'nih_key_dates');
  assert.equal(r.findings.find((f) => f.call_id === 'PA-25-301').deadline, '2027-02-05');
});

test('V15-RD04 elegibilidad: «admite empresas» no es «IGC cumple»; Zenith queda condicionada (no descartada) y AARGA sin LOI vigente sale', async () => {
  const { r, events } = await runRd04();
  assert.equal(r.findings.filter((f) => f.tier === 'main').length, 0, 'sin hechos del solicitante nada queda listo para aplicar');
  const r21 = r.findings.find((f) => f.call_id === 'PA-25-304');
  assert.equal(r21.eligible, 'conditional'); assert.ok(r21.conditions.some((c) => /For-Profit Organizations/.test(c)));
  assert.ok(r21.blockers.some((b) => /entity type/.test(b)));
  const zenith = r.findings.find((f) => /zenith/i.test(f.url));
  assert.equal(zenith.eligible, 'conditional'); assert.ok(zenith.conditions.some((c) => /^Restriction \(entity_type\)/.test(c)));
  assert.ok(events.some((e) => e.type === 'dossier' && /aarga$/.test(e.url) && e.reason === 'loi_closed'));
  assert.match(r.audit.status_line, /Ninguna lista para aplicar/);
});

test('V15-RD04 bucle: reabrir p1 ya no es un error y el código cambia de estrategia en vez de gastar los pasos', async () => {
  const { r, events } = await runRd04();
  assert.ok(r.audit.agent.reopened >= 3, 'las reaperturas son observaciones, no errores');
  assert.ok(r.audit.agent.rejected_ref <= 1, 'a lo sumo el p1 pedido antes de existir');
  assert.ok(events.some((e) => e.type === 'stall' && e.action === 'autopilot'));
  assert.ok(r.audit.agent.stall.max >= 3);
  assert.ok(['stuck', 'budget', 'time'].includes(r.audit.agent.stop_reason));
});

test('V15-RD04 embudo honesto: cuenta fuentes, expedientes, juzgados, pertinentes y lo que falta del solicitante', async () => {
  const { r } = await runRd04();
  const f = r.audit.dossier;
  assert.ok(f.by_source.nih_guide >= 5); assert.ok(f.by_source.simpler >= 1); assert.ok(f.dossiers >= 7);
  assert.ok(f.judged >= 5); assert.ok(f.pertinent >= 3); assert.equal(f.ready, 0);
  assert.deepEqual(r.audit.applicant_missing, ['entity type', 'country', 'principal investigator / affiliation']);
});

test('V15 applicantFacts y gateApplicant: un tipo de entidad declarado deja pasar el sí; desconocido lo vuelve condición', () => {
  const known = applicantFacts({ entityType: 'for_profit', country: 'US' });
  assert.equal(known.entity, 'for_profit'); assert.deepEqual(known.missing, []);
  const unknown = applicantFacts(brief); assert.equal(unknown.entity, null);
  const judgment = { page_type: 'call', dates: [], criteria: { eligibility: { verdict: 'yes', quote: 'For-Profit Organizations', reason: '' }, entity_type: { verdict: 'no', quote: 'Only universities', reason: '' }, region: { verdict: 'yes', quote: 'Foreign Organizations', reason: '' } } };
  const text = 'For-Profit Organizations ... Only universities ... Foreign Organizations';
  const g = gateApplicant(judgment, unknown, text);
  assert.equal(g.judgment.criteria.eligibility.verdict, 'unknown'); assert.equal(g.judgment.criteria.entity_type.verdict, 'unknown');
  assert.equal(g.conditions.length, 3); assert.equal(g.conditions.find((c) => c.criterion === 'entity_type').kind, 'restriction');
  assert.equal(gateApplicant(judgment, known, text).conditions.length, 0);
});

test('V15 términos y expedientes: consultas cortas sin relleno; ficha stub sola no es evaluable', () => {
  const t = briefTerms(brief);
  assert.ok(t.phrases.every((p) => p.split(/\s+/).length <= 3)); assert.ok(!t.phrases.some((p) => /\bgrant\b/i.test(p)));
  const [d] = buildDossiers([{ source: 'grants_gov', number: 'RFA-AG-27-005', url: 'https://www.grants.gov/search-results-detail/362454', title: 'NIAGADS', text: 'Official registry record (Grants.gov). Opportunity status: forecasted.', textKind: 'stub' }]);
  assert.equal(d.sufficiency.evaluable, false);
});

test('V15-RD04 (runs-v7) sin la API de la guía: el registro trae los Parent, la página pública del aviso da el texto completo y la fecha nueva', async () => {
  const { r, calls, events } = await runRd04({}, { v7: true });
  assert.ok(calls.nih.includes('403'));
  const r21 = r.findings.find((f) => f.call_id === 'PA-25-304'); assert.ok(r21, JSON.stringify(r.findings.map((f) => f.call_id)));
  assert.equal(r21.deadline, '2027-02-16'); assert.equal(r21.status, 'open'); assert.ok(r21.dossier.sources.includes('nih_guide'));
  assert.ok(r.findings.find((f) => f.call_id === 'PA-25-301'));
  assert.ok(events.some((e) => e.type === 'dossier_upgrade' && (e.added || e.added_docs) >= 1));
  const g23 = r.findings.find((f) => f.call_id === 'RFA-AG-26-023');
  assert.ok(g23, 'el pronóstico temático directo queda para vigilar'); assert.equal(g23.status, 'forecast');
  assert.ok(g23.blockers.some((b) => /out of date/.test(b)));
});
