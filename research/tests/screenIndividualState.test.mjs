import test from 'node:test';
import assert from 'node:assert/strict';
import { applicantProfile, screenCall, usStateOf } from '../server/research/applicant.mjs';
import { classifyPage } from '../server/research/pageType.mjs';
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
