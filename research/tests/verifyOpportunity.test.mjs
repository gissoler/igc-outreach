import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { datesIn, literalIn, verifyOpportunity, hostKind } from '../server/research/verify.mjs';
import { readOpportunity, readMany } from '../server/research/readOpportunity.mjs';

const pages = JSON.parse(readFileSync(new URL('../eval/bench/mentiva-pages.json', import.meta.url), 'utf8')).pages;
const gold = JSON.parse(readFileSync(new URL('../eval/bench/mentiva-gold.json', import.meta.url), 'utf8'));
const page = (id) => pages.find((p) => p.id === id);
const TODAY = '2026-09-29';

test('datesIn entiende los formatos habituales y rechaza fechas imposibles', () => {
  const d = datesIn('Deadline: 25 January 2027; June 30, 2026; 2026-10-15; 3rd of March 2027; 31 Feb 2026');
  for (const x of ['2027-01-25', '2026-06-30', '2026-10-15', '2027-03-03']) assert.ok(d.includes(x), x);
  assert.ok(!d.includes('2026-03-03') && d.length === 4);
});

test('literalIn ignora markdown y mayúsculas pero no acepta citas inventadas', () => {
  assert.ok(literalIn('apply by **April 5**', 'Please Apply by April 5 2026'));
  assert.ok(!literalIn('applications close 15 October 2026', 'Please apply by April 5'));
});

test('caso Headstream: el modelo inventó "abierta, 2026-10-15" sin cita real → sin fecha, sin apply', () => {
  const p = page('headstreaminnovation');
  const r = verifyOpportunity({ status: 'open', deadline: '2026-10-15', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { status: 'Applications are open until October 15, 2026', deadline: 'Applications close 15 October 2026', eligible: 'Open to startups worldwide' } }, p, { today: TODAY });
  assert.equal(r.deadline, null);
  assert.notEqual(r.verdict, 'apply');
  assert.ok(r.flags.includes('fake_quote:deadline'));
  assert.notEqual(r.status, 'open');
});

test('fecha pasada → cerrada aunque el modelo diga "open" (wellcome / fundsforngos)', () => {
  for (const id of ['wellcome']) {
    const p = page(id);
    const past = datesIn(p.text).filter((x) => x < TODAY).sort().at(-1);
    if (!past) continue;
    const quote = p.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/).find((s) => datesIn(s).includes(past));
    const r = verifyOpportunity({ status: 'open', deadline: past, official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { deadline: quote, status: quote } }, p, { today: TODAY });
    assert.equal(r.status, 'closed');
    assert.equal(r.drop, 'closed');
  }
});

test('agregadores y redes se descartan aunque el modelo diga que son oficiales', () => {
  for (const id of ['fundsforngos', 'startupgrantsindia', 'vestbee']) {
    const r = verifyOpportunity({ status: 'open', deadline: null, official: true, eligible: 'yes', non_dilutive: 'yes', quotes: {} }, page(id), { today: TODAY });
    assert.equal(r.keep, false, id);
    assert.equal(r.drop, 'aggregator');
  }
  assert.equal(hostKind('https://www.linkedin.com/posts/x'), 'social');
});

test('convocatoria real abierta con fecha citada → apply; elegibilidad "no" con cita → skip', () => {
  const p = { url: 'https://prize.example.org/call', text: 'Mental health prize. Deadline: 15 November 2026. Open to companies incorporated anywhere. Grant of $50,000, no equity.' };
  const ok = verifyOpportunity({ status: 'open', deadline: '2026-11-15', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { deadline: 'Deadline: 15 November 2026', eligible: 'Open to companies incorporated anywhere', status: 'Deadline: 15 November 2026' } }, p, { today: TODAY });
  assert.equal(ok.verdict, 'apply'); assert.equal(ok.daysLeft, 47);
  const no = verifyOpportunity({ status: 'open', deadline: '2026-11-15', official: true, eligible: 'no', non_dilutive: 'yes', quotes: { deadline: 'Deadline: 15 November 2026', eligible: 'Open to companies incorporated anywhere' } }, p, { today: TODAY });
  assert.equal(no.drop, 'not_eligible');
});

test('sin fecha pero con "applications are open" citado → watch (nunca apply)', () => {
  const p = { url: 'https://fund.example.org', text: 'Applications are now open on a rolling basis for early-stage founders.' };
  const r = verifyOpportunity({ status: 'open', deadline: null, official: true, eligible: 'unclear', non_dilutive: 'yes', quotes: { status: 'Applications are now open on a rolling basis' } }, p, { today: TODAY });
  assert.equal(r.status, 'open'); assert.equal(r.verdict, 'watch');
});

test('el oráculo (gold) pasa el verificador sin perder campos correctos en las 11 páginas', () => {
  for (const [id, want] of Object.entries(gold.extract)) {
    const p = page(id); if (!p) continue;
    const dl = want.deadline && want.deadline !== '*' ? want.deadline : null;
    const quote = dl ? p.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/).find((s) => datesIn(s).includes(dl)) : null;
    const r = verifyOpportunity({ status: want.status === '*' ? 'unknown' : want.status, deadline: dl, official: want.official === true, eligible: 'unclear', non_dilutive: 'unknown', quotes: quote ? { deadline: quote } : {} }, p, { today: TODAY });
    if (dl && quote) assert.equal(r.deadline, dl, id);
    if (want.status === 'closed' && dl && quote) assert.equal(r.status, 'closed', id);
  }
});

test('readOpportunity: modelo simulado, sin flota → null; con error → no verificado; nunca lanza', async () => {
  const p = { url: 'https://prize.example.org/call', text: 'Deadline: 15 November 2026.' };
  assert.equal(await readOpportunity(p, {}, { env: {}, today: TODAY }), null);
  const bad = await readOpportunity(p, {}, { today: TODAY, chat: async () => { throw new Error('boom'); } });
  assert.equal(bad.read, false); assert.equal(bad.verdict, 'watch');
  const good = await readOpportunity(p, {}, { today: TODAY, chat: async () => ({ json: { status: 'open', deadline: '2026-11-15', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { deadline: 'Deadline: 15 November 2026' } }, model: 'm' }) });
  assert.equal(good.deadline, '2026-11-15'); assert.equal(good.read, true);
  const many = await readMany([p, p, p], {}, { today: TODAY, concurrency: 2, chat: async () => ({ json: { status: 'closed' } }) });
  assert.equal(many.length, 3);
});
