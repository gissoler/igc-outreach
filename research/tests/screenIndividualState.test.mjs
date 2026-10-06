import test from 'node:test';
import assert from 'node:assert/strict';
import { applicantProfile, screenCall, usStateOf } from '../server/research/applicant.mjs';
import { classifyPage } from '../server/research/pageType.mjs';
import { verifyOpportunity } from '../server/research/verify.mjs';
import { grantGate } from '../server/research/core.mjs';

const igc = applicantProfile({ state: 'Maryland', city: 'Potomac', geography: 'Potomac, Maryland, USA', entityType: 'for-profit company' });
const ty = (url, title, text = '') => classifyPage({ url, title, text }).type;

test('estado de EE. UU. a partir de «Potomac, Maryland, USA»', () => { assert.equal(usStateOf('Potomac, Maryland, USA'), 'md'); assert.equal(usStateOf('Austin, TX'), 'tx'); assert.equal(usStateOf('Bogotá, Colombia'), null); assert.equal(igc.state, 'md'); });
test('beca postdoctoral (PRFB) se descarta para una empresa', () => {
  const s = screenCall({ url: 'https://www.nsf.gov/prfb', title: 'Postdoctoral Research Fellowships in Biology (PRFB)' }, igc);
  assert.equal(s.code, 'individual_only'); assert.match(s.reason, /Postdoctoral/);
  assert.equal(grantGate({ title: 'Postdoctoral Research Fellowships in Biology (PRFB)', contact: { value: 'https://www.nsf.gov/x' }, status: 'open' }, 300, igc).tier, 'drop');
});
test('SBIR y convocatorias reales no caen en la regla de individuos', () => {
  for (const title of ['PA-27-100: NIH, CDC and FDA Small Business Innovation Research Grant (Parent SBIR [R43/R44])', "PAR-25-297: Alzheimer's Drug-Development Program (U01 Clinical Trial Optional)", 'Part the Cloud Translational Research for Alzheimer’s Disease Program']) assert.equal(screenCall({ url: 'https://grants.nih.gov/x', title }, igc), null);
});
test('programa de otro estado (CIRM, California) se descarta; el federal y el propio estado no', () => {
  assert.equal(screenCall({ url: 'https://www.cirm.ca.gov/clin2/', title: 'Clinical Trial (CLIN2) Awards' }, igc).code, 'other_state');
  assert.equal(screenCall({ url: 'https://www.nih.gov/x', title: 'x' }, igc), null);
  assert.equal(screenCall({ url: 'https://www.va.gov/x', title: 'x' }, igc), null);
  assert.equal(screenCall({ url: 'https://commerce.maryland.gov/x', title: 'x' }, igc), null);
  assert.equal(screenCall({ url: 'https://dhcd.md.gov/x', title: 'x' }, igc), null);
  assert.equal(screenCall({ url: 'https://dhcd.ca.gov/x', title: 'x' }, igc).code, 'other_state');
  assert.equal(screenCall({ url: 'https://www.cirm.ca.gov/clin2/', title: 'x' }, applicantProfile({})), null);   // sin estado en el brief no se descarta
});
test('índices y listas: NIDDK, NCI, Labiotech, alerta de universidad, PDF de concepto', () => {
  assert.equal(ty('https://www.niddk.nih.gov/research-funding', 'Research & Funding - NIDDK'), 'directory');
  assert.equal(ty('https://dctd.cancer.gov/funding/announcements', 'Funding Announcements - NCI'), 'directory');
  assert.equal(ty('https://www.labiotech.eu/top-biotech-funding-programs/', 'Top biotech grants and campaigns'), 'blog');
  assert.equal(ty('https://www.uoguelph.ca/research/alerts/content/bill-melinda-gates-foundation-grand-challenges-explorations', 'Bill & Melinda Gates Foundation: Grand Challenges Explorations ...', 'Apply by December 1.'), 'news');
  assert.equal(ty('https://www.cirm.ca.gov/wp-content/uploads/2026/03/11d.-20260326-CLIN2-Concept-Tracked-Changes.pdf', 'CLIN2 Awards: Funding Opportunity for Clinical Trials', 'Apply'), 'internal_doc');
});
test('convocatorias legítimas con "funding" o "research" en el título siguen siendo convocatoria', () => {
  assert.equal(ty('https://grants.nih.gov/grants/guide/pa-files/PAR-25-297.html', "PAR-25-297: Alzheimer's Drug-Development Program (U01)", 'Application due date November 5, 2026. How to apply: submit an application.'), 'call');
});

test('segunda ronda: FAQ, «About…», áreas de interés, tipos de beca y contratos de highergov', () => {
  assert.equal(ty('https://www.nia.nih.gov/research/sbir/nia-small-business-programs-frequently-asked-questions', 'NIA Small Business Programs Frequently Asked Questions | National Institute on Aging', 'Apply'), 'blog');
  assert.equal(ty('https://www.nia.nih.gov/research/sbir/about-nia-small-business-funding', 'About NIA Small Business Funding | National Institute on Aging', 'Apply'), 'directory');
  assert.equal(ty('https://www.nia.nih.gov/research/sbir/nia-small-business-interest-areas', 'NIA Small Business Interest Areas | National Institute on Aging', 'Apply'), 'directory');
  assert.equal(ty('https://www.alz.org/research/for_researchers/grants/types-of-grants', "Types of Grants | Alzheimer's Association", 'Apply'), 'directory');
  assert.equal(ty('https://grants.nih.gov/grants/guide/pa-files/PA-27-100.html', 'PA-27-100: NIH, CDC and FDA Small Business Innovation Research Grant (Parent SBIR [R43/R44])', 'Applications due January 5, 2027. How to apply.'), 'call');
});

test('ayuda exterior y convocatorias tribales no son para una empresa de Maryland', () => {
  assert.equal(screenCall({ url: 'https://x.gov/y', title: 'Request for Information (RFI) - Community Engagement Services for the Solomon Islands Threshold Program', org: 'Millennium Challenge Corporation' }, igc).code, 'foreign_aid');
  assert.equal(screenCall({ url: 'https://grants.gov/y', title: 'Native Public Health Resilience', org: 'Indian Health Service' }, igc).code, 'restricted_applicant');
  assert.equal(screenCall({ url: 'https://grants.nih.gov/y', title: 'PA-27-100: NIH, CDC and FDA Small Business Innovation Research Grant', org: 'National Institutes of Health' }, igc), null);
});
test('la misma convocatoria con dos URL se junta en un solo resultado', async () => {
  const { dedupe } = await import('../server/research/core.mjs');
  const mk = (url, title) => ({ kind: 'opportunity', fundingType: 'grant', org: 'nsf.gov', title, contact: { type: 'source', value: url }, externalId: `orchestrator:grant:${url}`, risks: [], evidence: [], paths: [], foundBy: [], facts: {} });
  const t = 'Small Business Innovation Research / Small Business Technology Transfer Phase I, Phase II, Fast-Track Programs SBIR/STTR: Developing Deep Technologies | NSF';
  const out = dedupe([mk('https://www.nsf.gov/funding/opportunities/sbir', t), mk('https://www.nsf.gov/funding/opportunities/sbir/nsf26-510/solicitation', `NSF 26-510: ${t}`)]);
  assert.equal(out.length, 1);
});

test('policy brief en PDF, guía de LOI y premios del VA para investigadores propios', () => {
  assert.equal(ty('https://www.ghtcoalition.org/documents/pdf/The-Supporting-Innovative-Global-Health-Technologies-Fund-policy-brief.pdf', 'The Supporting Innovative Global Health Technologies (SIGHT) Fund:', 'Apply'), 'report');
  assert.equal(ty('https://www.research.va.gov/isrm/shared_docs/Guidance-DrugDevelopmentLOI.pdf', 'Guidance for Submission of a Letter of Intent for a BLRD Merit Review Award', 'Apply'), 'blog');
  assert.equal(screenCall({ url: 'https://www.research.va.gov/funding/x', title: 'BLRD Merit Review Award' }, igc).code, 'restricted_applicant');
  assert.equal(screenCall({ url: 'https://www.va.gov/x', title: 'x' }, igc), null);
});

test('el policy brief del SIGHT Fund se reconoce por su contenido aunque la URL no lo diga', () => {
  const text = "The Supporting Innovative Global Health Technologies (SIGHT) Fund: A new proposal to drive inclusive innovation at USAID and stock the global health toolbox of the future. January 2022. Copyright 2022, PATH. Suggested reference: Rashid J, Tasneem Z, Conron C. The SIGHT Fund. Washington, DC: Global Health Technologies Coalition; 2022. This brief was authored by Julien Rashid.";
  assert.equal(ty('https://www.ghtcoalition.org/documents/pdf/sight-fund.pdf', 'The Supporting Innovative Global Health Technologies (SIGHT) Fund:', text), 'report');
});

test('centros institucionales (T42, P30), IHS, reuniones y portadas no son para una empresa', () => {
  assert.equal(screenCall({ url: 'https://x', title: 'Occupational Safety and Health Education and Research Centers (T42)', org: 'CDC' }, igc).code, 'institutional_only');
  assert.equal(screenCall({ url: 'https://x', title: 'Cancer Center Support Grants (CCSGs) for NCI-designated Cancer Centers (P30 Clinical Trial Optional)', org: 'NCI' }, igc).code, 'institutional_only');
  assert.equal(screenCall({ url: 'https://x', title: 'Behavioral Health Integration Initiative', org: 'Indian Health Service' }, igc).code, 'restricted_applicant');
  assert.equal(screenCall({ url: 'https://x', title: 'PA-27-100: NIH, CDC and FDA Small Business Innovation Research Grant (Parent SBIR [R43/R44])', org: 'NIH' }, igc), null);
  assert.equal(ty('https://www.fda.gov/drugs/x', 'Emerging Drug Safety Technology Meetings (EDSTM) | FDA', 'Apply'), 'event');
  assert.equal(ty('https://r3cr.org/2026-stakeholder-meeting-executive-summary', '2026 Stakeholder Meeting Executive Summary', 'Apply'), 'event');
  assert.equal(ty('https://www.onofound.org/', 'Ono Pharma Foundation', 'Our foundation supports pharmaceutical research in Japan.'), 'home');
  assert.equal(ty('https://www.ninds.nih.gov/current-research/research-funded-ninds/translational-research', 'Translational Research', 'Apply'), 'directory');
  assert.equal(ty('https://www.grants.gov/learn-grants/grant-making-agencies/u-s-department-of-health-and-human-services-hhs', 'U.S. Department of Health and Human Services (HHS) | Grants.gov', 'Apply'), 'directory');
  assert.equal(ty('https://grants.nih.gov/grants/guide/pa-files/PAR-25-297.html', "PAR-25-297: Alzheimer's Drug-Development Program (U01 Clinical Trial Optional)", 'Application due date November 5, 2026. How to apply: submit an application.'), 'call');
});

test('NSF SBIR farmacéutica: dice que no financia fármacos en etapa clínica → no encaja con un candidato en Fase 2', () => {
  const nsf = 'NSF invests up to $2 million in seed funding and takes zero equity. Your company must be a small business located in the United States. We do not fund clinical trials, or the development of pre-clinical or clinical-stage drug candidates. Get started with a project pitch.';
  const brief = { maturity: 'clinical_phase_2', stage: 'grant', product: 'MINT-AD' };
  const bad = verifyOpportunity({}, { url: 'https://seedfund.nsf.gov/topics/pharmaceutical-technologies/', title: 'Pharmaceutical Technologies Grant | NSF SBIR', text: nsf }, { codeOnly: true, brief });
  assert.equal(bad.scopeFit.verdict, 'does_not_fit'); assert.ok(bad.reasons.includes('scope_mismatch')); assert.equal(bad.tier, 'drop');
  // sin necesidad clínica no se aplica
  const ok = verifyOpportunity({}, { url: 'https://seedfund.nsf.gov/x', title: 'Pharmaceutical Technologies Grant | NSF SBIR', text: nsf }, { codeOnly: true, brief: { maturity: 'preclinical' } });
  assert.notEqual(ok.scopeFit?.verdict, 'does_not_fit');
  // un aviso NIH que permite ensayos clínicos no se descarta
  const nih = verifyOpportunity({}, { url: 'https://grants.nih.gov/x', title: 'PA-27-100: Parent SBIR (R43/R44 Clinical Trial Optional)', text: 'Clinical Trial Optional. Phase I does not support clinical trials of new drugs in some institutes; see Section 2. Applications due January 5, 2027. How to apply.' }, { codeOnly: true, brief });
  assert.notEqual(nih.scopeFit?.verdict, 'does_not_fit');
});
test('listados de reclutamiento de ensayos clínicos (paidtrials, clinicaltrials.gov) no son convocatorias', () => {
  assert.equal(verifyOpportunity({}, { url: 'https://paidtrials.com/clinicaltrials/study-to-evaluate-bms-986368/', title: 'Study to Evaluate BMS-986368 for agitation in Alzheimer\'s', text: 'Apply to participate' }, { codeOnly: true }).tier, 'drop');
  assert.equal(ty('https://example.org/clinicaltrials/study-to-evaluate-x-for-agitation', 'Study to evaluate X', 'Apply to participate'), 'trial_listing');
});

test('la búsqueda web de grants usa consultas federales para biotecnología y premios para el resto', async () => {
  const { grantWebQueries } = await import('../server/research/webscrape.mjs');
  const bio = grantWebQueries({ industry: 'Pharmaceuticals Biotech Neuroscience', maturity: 'clinical_phase_2', state: 'Maryland' }, ['Alzheimer agitation'], 2026);
  assert.ok(bio.length >= 18); assert.equal(new Set(bio).size, bio.length); assert.ok(bio.every((q) => !/prize|accelerator/i.test(q)));
  assert.ok(bio.some((q) => /PA-27-100/.test(q)) && bio.some((q) => /Maryland/.test(q)) && bio.some((q) => /Alzheimer agitation .*CDMRP/.test(q)) && bio.some((q) => /BARDA/.test(q)));
  const gen = grantWebQueries({ industry: 'mental health app', stage: 'pre-seed' }, [], 2026);
  assert.ok(gen.some((q) => /prize/.test(q)));
});

test('artículos científicos (doi) y el agregador scientifyresearch no son convocatorias', () => {
  assert.equal(ty('https://alz-journals.onlinelibrary.wiley.com/doi/10.1002/alz.082777', 'Combination therapies for Alzheimer disease', 'Apply'), 'report');
  assert.equal(verifyOpportunity({}, { url: 'https://www.scientifyresearch.org/grant/translational-research-alzheimers-disease-combination-therapies-funding-worldwide', title: 'Translational Research', text: 'Apply' }, { codeOnly: true }).tier, 'drop');
});

test('las consultas de grants las escribe el modelo desde el brief; sin modelo o con error, plantillas', async () => {
  const { modelGrantQueries, briefDigest } = await import('../server/research/webscrape.mjs');
  const brief = { venture: 'MINT-AD', industry: 'Pharmaceuticals', maturity: 'clinical_phase_2', state: 'Maryland', secretToken: 'abc123', contact: { email: 'x@y.com' } };
  assert.ok(!/abc123|x@y\.com/.test(briefDigest(brief))); assert.match(briefDigest(brief), /state: Maryland/);
  let prompt = '';
  const chat = async ({ user }) => { prompt = user; return { json: { queries: ['NIA ADRD clinical trial RFA PA-26-123 for-profit 2026', { query: 'NIA ADRD clinical trial RFA PA-26-123 for-profit 2026' }, 'ADDF drug development RFP 2026 biotechnology', 'short'] } }; };
  const out = await modelGrantQueries(brief, ['Alzheimer agitation'], { env: {}, chat, n: 24, today: new Date('2026-10-05') });
  assert.deepEqual(out, ['NIA ADRD clinical trial RFA PA-26-123 for-profit 2026', 'ADDF drug development RFP 2026 biotechnology']);
  assert.match(prompt, /2026-10-05/); assert.match(prompt, /Maryland/); assert.match(prompt, /Alzheimer agitation/);
  assert.deepEqual(await modelGrantQueries(brief, [], { env: {}, chat: async () => { throw new Error('down'); } }), []);
  assert.deepEqual(await modelGrantQueries(brief, [], { env: {} }), []);   // sin flota ni chat inyectado
});

test('centros institucionales, páginas de universidad y agregadores nuevos se descartan; el año del modelo se corrige', async () => {
  const profile = applicantProfile({ organization: 'IGC Pharma', state: 'Maryland', entityType: 'for-profit company' });
  assert.equal(screenCall({ url: 'https://www.nia.nih.gov/research/adrcs', title: "NIA-Funded Alzheimer's Disease Research Centers" }, profile)?.code, 'institutional_only');
  assert.equal(screenCall({ url: 'https://publichealth.lsuhsc.edu/x.pdf', title: '[PDF] Other Latest Update 11/10/2025 - LSU School of Public Health' }, profile)?.code, 'university_page');
  assert.equal(screenCall({ url: 'https://cancer.osu.edu/x', title: 'NIH SBIR Phase II notice' }, profile), null);
  for (const u of ['https://atomgrants.com/collections/foundation-grants-biomedical-research', 'https://everglade.com/x', 'https://grantcompass.co/healthcare-biotech-business-grants', 'https://www.evagarland.com/powering-cardiovascular-innovation']) assert.equal(verifyOpportunity({}, { url: u, title: 'Grants', text: 'Apply now' }, { codeOnly: true }).tier, 'drop');
  const { modelGrantQueries } = await import('../server/research/webscrape.mjs');
  const out = await modelGrantQueries({ industry: 'Pharma' }, [], { env: {}, today: new Date('2026-10-05'), chat: async () => ({ json: { queries: ['ADDF Alzheimer drug development RFP 2024 open', 'NIA SBIR Phase IIB deadline 2027'] } }) });
  assert.deepEqual(out, ['ADDF Alzheimer drug development RFP 2026 open', 'NIA SBIR Phase IIB deadline 2027']);
});

test('la búsqueda web de grants se detiene al llegar al tope de créditos', async () => {
  const { grantWebOpportunities } = await import('../server/research/webscrape.mjs');
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(JSON.stringify({ success: true, data: { web: [] }, creditsUsed: 60 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const env = { FIRECRAWL_API_KEY: 'fc-test', GRANT_WEB_MODEL_QUERIES: '0', GRANT_WEB_CREDITS: '10', FIRECRAWL_DAILY_CREDITS: 'unlimited', FIRECRAWL_LEDGER: ':memory:' };
  await grantWebOpportunities({ industry: 'biotech clinical', maturity: 'phase 2' }, { terms: [{ term: 'Alzheimer' }] }, { env, fetcher }).catch(() => {});
  assert.ok(calls >= 1 && calls <= 2, `calls=${calls}`);
});

test('SearXNG: proveedor de búsqueda sin créditos con el mismo formato de filas', async () => {
  const { searxngActive, searchConfigured, searxngSearch, firecrawlSearch } = await import('../server/research/webscrape.mjs');
  const env = { SEARCH_PROVIDER: 'searxng', SEARXNG_URL: 'http://127.0.0.1:8888/' };
  assert.equal(searxngActive(env), true); assert.equal(searchConfigured(env), true);
  assert.equal(searxngActive({ SEARXNG_URL: 'http://x' }), false); assert.equal(searchConfigured({}), false);
  let seenUrl = '';
  const fetcher = async (u) => { seenUrl = String(u); return new Response(JSON.stringify({ results: [{ url: 'https://grants.nih.gov/a', title: 'PA-27-100', content: 'SBIR apply' }, { url: 'https://grants.nih.gov/a', title: 'dup', content: '' }, { url: 'not a url', title: 'x' }, { url: 'https://nia.nih.gov/b', title: 'NIA', content: 'open' }] }), { status: 200 }); };
  const rows = await searxngSearch('NIH SBIR', { env, fetcher, limit: 8 });
  assert.match(seenUrl, /^http:\/\/127\.0\.0\.1:8888\/search\?q=NIH\+SBIR&format=json/);
  assert.deepEqual(rows.map((r) => r.url), ['https://grants.nih.gov/a', 'https://nia.nih.gov/b']); assert.equal(rows.credits, 0);
  const viaFirecrawl = await firecrawlSearch('NIH SBIR', { env, fetcher, markdown: true });
  assert.equal(viaFirecrawl.length, 2);   // sin clave de Firecrawl: el proveedor lo atiende
  await assert.rejects(searxngSearch('q', { env, fetcher: async () => new Response('', { status: 403 }) }), /enable "json"/);
});

test('páginas índice de financiadores (tipos, áreas de interés, directorio, raíz de sección) y blog de consultora no son convocatorias', async () => {
  const cases = [
    ['https://www.ninds.nih.gov/funding/ninds-small-business-program/types-ninds-small-business-grants', 'Types of NINDS Small Business Grants | National Institute of ...'],
    ['https://www.ninds.nih.gov/funding/ninds-small-business-program/ninds-small-business-program-areas-interest', 'NINDS Small Business Program Areas of Interest | National Institute ...'],
    ['https://www.nsf.gov/eng/emerging-frontiers-multidisciplinary-activities', 'ENG Emerging Frontiers and Multidisciplinary Activities - Directorate for Engineering (ENG) | NSF - U.S. National Science Foundation'],
    ['https://department.va.gov/grants', 'VA Grants'],
    ['https://professional.heart.org/en/research-programs', 'Research - Professional Heart Daily | American Heart Association'],
  ];
  for (const [url, title] of cases) assert.equal(ty(url, title, 'Apply for funding. Eligibility. Deadlines.'), 'directory', title);
  assert.notEqual(ty('https://grants.nih.gov/grants/guide/pa-files/PAR-26-094.html', 'PAR-26-094: Research Project Cooperative Agreements', 'Apply by Jan 5, 2027'), 'directory');
  assert.equal(verifyOpportunity({}, { url: 'https://jm-aq.com/neuroscience-funding-in-2026/', title: 'Neuroscience Funding in 2026', text: 'Apply' }, { codeOnly: true }).tier, 'drop');
  const { fixGenericTitle } = await import('../server/research/orchestrator.mjs');
  const a = { title: 'Part 1. Overview Information' };
  fixGenericTitle(a, { text: 'Part 1. Overview Information Funding Opportunity Title  Genomic and Biologic Therapies for ADRD  Activity Code U01' }, 'https://grants.nih.gov/grants/guide/rfa-files/RFA-AG-26-012.html');
  assert.equal(a.title, 'RFA-AG-26-012: Genomic and Biologic Therapies for ADRD');
  const b = { title: 'Part 1. Overview Information' }; fixGenericTitle(b, null, 'https://grants.nih.gov/grants/guide/pa-files/PAR-24-293.html'); assert.equal(b.title, 'PAR-24-293 (NIH funding notice)');
  const c = { title: 'PAR-1: Real title' }; fixGenericTitle(c, null, 'https://x.gov/y'); assert.equal(c.title, 'PAR-1: Real title');
});

test('«Clinical Trial Not Allowed» descarta la convocatoria para un solicitante en fase clínica, no para uno preclínico', () => {
  const page = { url: 'https://grants.nih.gov/grants/guide/rfa-files/RFA-TR-25-002.html', title: 'RFA-TR-25-002: Preclinical Proof of Concept Studies for Rare Diseases (R21 Clinical Trial Not Allowed)', text: 'Preclinical Proof of Concept Studies for Rare Diseases (R21 Clinical Trial Not Allowed). Application Due Date: June 2, 2027. Clinical Trials: Not Allowed: Only accepting applications that do not propose clinical trials. For-Profit Organizations eligible. Apply through ASSIST.' };
  const clin = verifyOpportunity({}, page, { brief: { maturity: 'clinical_phase_2', industry: 'pharma' }, codeOnly: true });
  assert.equal(clin.tier, 'drop'); assert.ok(clin.reasons.includes('scope_mismatch'));
  const pre = verifyOpportunity({}, page, { brief: { maturity: 'preclinical', industry: 'pharma' }, codeOnly: true });
  assert.notEqual(pre.tier, 'drop');
});

test('el modelo lee la página abierta y su juicio de alcance (con cita literal) manda sobre el del código', async () => {
  const { confirmFromPages, searchRowsToLeads } = await import('../server/research/orchestrator.mjs');
  const { readOpportunity } = await import('../server/research/readOpportunity.mjs');
  const brief = { venture: 'MINT-AD', industry: 'pharma Alzheimer agitation', maturity: 'Phase 2', fundingTypes: ['grant'] };
  const text = 'RFA-TR-25-002 Rare Diseases Preclinical Proof of Concept. Application due June 2, 2027. Eligible: for-profit organizations. Apply through ASSIST. Only rare diseases affecting fewer than 200,000 individuals are supported. ' + 'Background detail. '.repeat(40);
  const page = { url: 'https://grants.nih.gov/grants/guide/rfa-files/RFA-TR-25-002.html', title: 'Part 1. Overview Information', text };
  const leads = searchRowsToLeads([{ url: page.url, title: page.title, description: 'Apply now rare diseases funding opportunity', markdown: '' }], brief, { objective: 'grant', query: 'q' });
  assert.equal(leads.length, 1);
  const chat = async () => ({ model: 'fake', json: { status: 'open', deadline: '2027-06-02', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { deadline: 'Application due June 2, 2027', eligible: 'Eligible: for-profit organizations' }, page_type: 'call', scope_fit: { verdict: 'does_not_fit', reason: 'Rare diseases only; Alzheimer agitation is not rare.', funds_quote: null, excludes_quote: 'Only rare diseases affecting fewer than 200,000 individuals are supported.', work_type: 'applied_research' } } });
  const modelRead = (p) => readOpportunity(p, brief, { env: {}, chat });
  await confirmFromPages(leads, brief, { read: async () => page, modelRead });
  assert.equal(leads[0].verification.scopeFit.verdict, 'does_not_fit');
  assert.ok(leads[0].verification.reasons.includes('scope_mismatch')); assert.equal(leads[0].verification.tier, 'drop');
  assert.ok(leads[0].codeCheck);
  assert.equal(modelRead.count, 1);
});

test('notRecipientHost: company databases and aggregators are never investor leads', async () => {
  const { notRecipientHost } = await import('../server/research/providers.mjs');
  assert.equal(notRecipientHost('https://www.cbinsights.com/company/pura-mente', 'investment'), true);
  assert.equal(notRecipientHost('https://www.crunchbase.com/organization/x', 'grant'), true);
  assert.equal(notRecipientHost('https://www.goodwatercap.com/', 'investment'), false);
  assert.equal(notRecipientHost('https://www.grantforward.com/x', 'investment'), true);
});

test('SearXNG as base: always first, paid APIs only complement', async () => {
  const { searchApisConfigured, searchProviders } = await import('../server/research/searchApis.mjs');
  const { webSourcePlan } = await import('../server/research/sourcePlan.mjs');
  const env = { SEARCH_PROVIDER: 'searxng', SEARXNG_URL: 'http://127.0.0.1:8888', EXA_API_KEY: 'x', SERPER_API_KEY: 'y', TAVILY_API_KEY: 'z' };
  assert.deepEqual(searchProviders(env), ['searxng', 'exa', 'serper']);
  assert.deepEqual(searchProviders({ ...env, SEARCH_COMPLEMENT: 'none' }), ['searxng']);
  assert.equal(searchApisConfigured({ ...env, SEARCH_COMPLEMENT: 'none' }), true);
  const w = webSourcePlan({ fundingTypes: ['investment'], engineOn: false, env });
  assert.deepEqual([w.exa, w.serper, w.rounds], [false, false, false]);
  assert.equal(webSourcePlan({ fundingTypes: ['investment'], engineOn: false, env: { EXA_API_KEY: 'x' } }).exa, true);
});
