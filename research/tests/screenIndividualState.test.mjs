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
