import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPage } from '../server/research/pageType.mjs';
import { verifyOpportunity } from '../server/research/verify.mjs';

const t = (url, title, text = '') => classifyPage({ url, title, text }).type;
test('título «Expired PAR-…» no es convocatoria abierta', () => assert.equal(t('https://grants.nih.gov/grants/guide/pa-files/PAR-25-332.html', "Expired PAR-25-332: Research on Current Topics in Alzheimer's Disease (R01)", 'Applications due November 5, 2026. How to apply.'), 'expired'));
test('premio ya concedido en sbir.gov/awards', () => assert.equal(t('https://www.sbir.gov/awards/213006', 'Award | SBIR', 'Apply now'), 'award_record'));
test('oferta de empleo', () => assert.equal(t('https://www.alzdiscovery.org/senior-program-officer-assistant-director-search-and-evaluation', 'Senior Program Officer, Assistant Director, or Associate Director of Search and Evaluation | Alzheimer\'s Drug Discovery Foundation'), 'job'));
test('una convocatoria real con id no cae en las reglas nuevas', () => assert.equal(t('https://grants.nih.gov/grants/guide/pa-files/PAR-25-297.html', "PAR-25-297: Alzheimer's Drug-Development Program (U01)", 'Application due date November 5, 2026. How to apply: submit an application.'), 'call'));
test('agregadores nuevos se descartan', () => { for (const u of ['https://grantable.co/grants/alzheimers', 'https://www.usgrants.org/business/x', 'https://fedlaws.org/orphan-drug']) assert.equal(verifyOpportunity({}, { url: u, title: 'Grants', text: 'Apply now' }, { codeOnly: true }).tier, 'drop'); });
