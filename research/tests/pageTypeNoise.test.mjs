/* Run IGC/MINT-AD del 5-oct-2026: 42 «a vigilar» incluían guías, blogs, noticias e índices de fondos porque el texto mencionaba
   «eligibility» o «deadlines». El título y el dominio los delatan sin leer la página. Las convocatorias con identificador siguen pasando. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPage } from '../server/research/pageType.mjs';
import { hostKind } from '../server/research/verify.mjs';

const TEXT = 'How to apply: submit your application via the portal. Eligibility: small businesses. Application deadline: November 3, 2026.';
const cls = (title, url = 'https://funder.example.org/page') => classifyPage({ url, title, text: TEXT });

test('guías y explicaciones no son convocatoria', () => {
  for (const t of ['Understanding SBIR and STTR | Seed', 'Ask the Expert: NIH Grants | Rock Health', 'What is an SBIR grant?', 'The Ultimate Guide to Digital Health Grants']) {
    const r = cls(t);
    assert.equal(r.isCall, false, t); assert.equal(r.type, 'blog', t);
  }
});

test('índices de oportunidades no son convocatoria (las convocatorias individuales son los leads)', () => {
  for (const t of ['Funding | Telehealth.HHS.gov', 'Solicitations | MTEC', 'VA ORD Funding Resources', 'Explore NIH Grant Opportunities | Grants & Funding',
    "SBIR and STTR Funding Opportunities - NIH's Seed", 'Funding for Neuroscience Research—Active Opportunities | NICHD', 'CIRM Funding Opportunities - CA.gov', 'Upcoming and open funding calls - EIBIR']) {
    const r = cls(t);
    assert.equal(r.isCall, false, t); assert.equal(r.type, 'directory', t);
  }
});

test('convocatorias con identificador o nombre propio siguen siendo convocatoria', () => {
  for (const t of ['PAR-25-383: Blueprint MedTech Translator (UG3/UH3 - Clinical Trial Optional)', 'RFA-RM-27-012: PRIMED-AI: Data-to-Model Academic-Industrial Partnerships',
    'Funding Opportunities for AI in Health (RFA-XX-27-001)', 'BRING IT - Rainwater Charitable Foundation', 'Digital Health Grant – Apply Today | NSF SBIR', 'SBIR Application Guide for Phase I']) {
    assert.equal(cls(t).isCall, true, t);
  }
});

test('blogs, consultoras y directorios del run quedan como agregadores', () => {
  for (const u of ['https://billgates.pk/gates-foundation-ai-health-funding', 'https://www.layer3labs.io/guides/grants-for-ai-projects', 'https://www.smartmdr.com/notcias/fda-updates', 'https://digital.health/digital-health-accelerators']) {
    assert.equal(hostKind(u), 'aggregator', u);
  }
  assert.equal(hostKind('https://grants.nih.gov/grants/guide/pa-files/PAR-25-383.html'), 'other');
});
