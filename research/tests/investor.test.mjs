// Inversión: decide el código, no el modelo. Casos tomados de la corrida 23:37 (GV, Prime Movers, AngelList, PDF de Pender).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyInvestor, sectorTerms } from '../server/research/investor.mjs';
import { verifyFinding } from '../server/research/engine.mjs';

const brief = JSON.parse(readFileSync(new URL('../eval/briefs/mentiva.json', import.meta.url), 'utf8'));
const TODAY = '2026-09-30';
const model = { relevant: true, kind: 'investor', name: 'Fund', official: true, eligible: 'yes', money: 'equity', quotes: {} };
const v = (url, text, out = model, title = 'Fund') => verifyInvestor(out, { url, title, text }, { today: TODAY, brief });

const GOOD = 'We invest in pre-seed and seed digital health and mental health founders around the world. Founders can pitch us by sending your deck to pitch@fund.example.com. Our 2026 portfolio additions include three behavioral health companies.';

test('inversor completo: tesis, etapa, geografía global, vía de contacto y año reciente → lista principal, con citas literales', () => {
  const r = v('https://fund.example.com/', GOOD);
  assert.equal(r.tier, 'main'); assert.equal(r.verdict, 'apply');
  for (const q of Object.values(r.quotes)) assert.ok(GOOD.includes(q), 'cita literal');
});

test('GV: portafolio de IA y un menú de navegación no son tesis ni vía de contacto, aunque el modelo diga official/eligible yes', () => {
  const text = 'We have backed 50+ companies building the next generation of AI-native applications. Some of the fastest growing companies in our portfolio are at the application layer. AI CONSUMER ENTERPRISE LIFE SCIENCES FRONTIER TECH Vercel StackBlitz Synthesia Harvey + 99 More Contact';
  const r = v('https://www.gv.com/', text);
  assert.notEqual(r.tier, 'main'); assert.equal(r.verdict, 'watch');
  assert.ok(r.blockers.some((b) => /sector/i.test(b))); assert.ok(r.blockers.some((b) => /pitch or contact|way to pitch/i.test(b)));
});

test('nota de prensa de una ronda de otra empresa no es la página del inversor (Prime Movers Lab)', () => {
  const r = v('https://www.prnewswire.com/news-releases/the-path-raises-14-3m.html', 'The Path raises $14.3M in seed funding led by Prime Movers Lab. ' + GOOD);
  assert.equal(r.tier, 'drop'); assert.match(r.drop, /^not_investor_page/);
});

test('plataforma de sindicatos (AngelList) y PDF nunca llegan a la lista principal', () => {
  assert.notEqual(v('https://venture.angellist.com/mental-health/syndicate', GOOD).tier, 'main');
  const pdf = v('https://www.penderventures.com/wp-content/uploads/2026/01/Pender-letter.pdf', GOOD);
  assert.notEqual(pdf.tier, 'main'); assert.ok(pdf.blockers.some((b) => /document/i.test(b)));
});

test('un inversor que solo invierte donde la empresa no está constituida → no elegible (con cita)', () => {
  const r = v('https://usfund.example.com/', 'We only invest in companies incorporated in the United States, at pre-seed and seed, in digital health and mental health. Pitch us by sending your deck to pitch@usfund.example.com in 2026.');
  assert.equal(r.eligible, 'no'); assert.equal(r.tier, 'drop'); assert.equal(r.drop, 'not_eligible');
});

test('etapa tardía sin pre-seed/seed → a verificar con el motivo', () => {
  const r = v('https://growth.example.com/', 'We invest in growth equity and Series C rounds in digital health and mental health companies around the world. Reach out to us at invest@growth.example.com about your 2026 round.');
  assert.notEqual(r.tier, 'main'); assert.ok(r.flags.includes('stage_mismatch'));
});

test('geografía sin decir → a verificar, no apply', () => {
  const r = v('https://quiet.example.com/', 'We invest in pre-seed and seed digital health and mental health founders. Founders can pitch us by sending your deck to pitch@quiet.example.com. Our 2026 portfolio is growing.');
  assert.equal(r.tier, 'verify'); assert.ok(r.blockers.some((b) => /Geography/i.test(b)));
});

test('sin señal reciente → a verificar', () => {
  const r = v('https://old.example.com/', GOOD.replace('Our 2026 portfolio additions include three behavioral health companies.', 'We like founders.'));
  assert.equal(r.tier, 'verify'); assert.ok(r.blockers.some((b) => /recent activity/i.test(b)));
});

test('el motor usa esta verificación para inversión: verifyFinding ignora official/eligible/how_to_apply del modelo', () => {
  const out = { ...model, quotes: { identity: 'GV is a venture firm', eligible: 'We have backed 50+ companies', how_to_apply: 'AI CONSUMER ENTERPRISE LIFE SCIENCES' } };
  const page = { url: 'https://www.gv.com/', title: 'GV', text: 'GV is a venture firm. We have backed 50+ companies building the next generation of AI-native applications. AI CONSUMER ENTERPRISE LIFE SCIENCES' };
  const f = verifyFinding(out, page, 'investment', { today: TODAY, brief });
  assert.notEqual(f.tier, 'main'); assert.equal(f.verdict, 'watch');
  const good = verifyFinding({ ...model, quotes: { identity: 'We invest in pre-seed and seed digital health' } }, { url: 'https://fund.example.com/', title: 'Fund', text: GOOD }, 'investment', { today: TODAY, brief });
  assert.equal(good.tier, 'main'); assert.ok(good.quotes.how_to_apply.includes('pitch@fund.example.com'));
});

test('términos de sector salen del brief', () => {
  assert.ok(sectorTerms(brief).includes('mental health')); assert.ok(sectorTerms({ industry: 'fintech payments' }).includes('payments'));
});
