import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFinding } from '../server/research/engine.mjs';
import { hostKind } from '../server/research/verify.mjs';
import { multiSearch } from '../server/research/searchApis.mjs';

const TODAY = '2026-09-30';
const V = (out, text, objective, url = 'https://x.example.org/p') => verifyFinding(out, { url, text }, objective, { today: TODAY });
const FUND = 'Verge HealthTech Fund is an early stage healthtech venture capital fund investing in impactful health technology startups globally. We back founders at seed.';
const base = { relevant: true, official: true, money: 'equity', eligible: 'yes', quotes: { identity: 'early stage healthtech venture capital fund investing in impactful health technology startups', eligible: 'We back founders at seed' } };

test('tipo de entidad: inversor sí; empresa que recibió inversión, adquirente, directorio y noticia no (casos del reporte)', () => {
  assert.equal(V({ ...base, name: 'Verge', kind: 'investor' }, FUND, 'investment').keep, true);
  for (const kind of ['company', 'deal_news', 'directory', 'news', 'other']) {
    const v = V({ ...base, name: 'X', kind }, FUND, 'investment');
    assert.equal(v.keep, false, kind); assert.equal(v.drop, `wrong_kind:${kind}`);
  }
  assert.equal(V({ ...base, kind: 'Investor (VC fund)', name: 'Verge' }, FUND, 'investment').keep, true, 'tolera texto extra tras el tipo');
  assert.equal(V({ ...base, name: 'Verge' }, FUND, 'investment').keep, true, 'sin tipo no se descarta, pero se avisa');
  assert.ok(V({ ...base, name: 'Verge' }, FUND, 'investment').flags.includes('kind_missing'));
});

test('convocatoria: un programa entra; una noticia sobre un programa ajeno no', () => {
  const page = 'Mental health prize. The application deadline is 15 November 2026. Open to startups anywhere in the world. Cash prize.';
  const o = { relevant: true, name: 'Prize', official: true, status: 'open', deadline: '2026-11-15', eligible: 'yes', non_dilutive: 'yes', money: 'prize', quotes: { identity: 'Mental health prize.', deadline: 'The application deadline is 15 November 2026', eligible: 'Open to startups anywhere in the world' } };
  assert.equal(V({ ...o, kind: 'program' }, page, 'grant').verdict, 'apply');
  assert.equal(V({ ...o, kind: 'news' }, page, 'grant').drop, 'wrong_kind:news');
});

test('citas inventadas: una impide "apply"; dos o más descartan la lectura entera', () => {
  const page = 'Mental health prize. The application deadline is 15 November 2026. Open to startups anywhere in the world. Cash prize.';
  const o = { relevant: true, kind: 'program', name: 'Prize', official: true, status: 'open', deadline: '2026-11-15', eligible: 'yes', non_dilutive: 'yes', money: 'prize', quotes: { identity: 'Mental health prize.', deadline: 'The application deadline is 15 November 2026', eligible: 'Open to startups anywhere in the world' } };
  assert.equal(V(o, page, 'grant').verdict, 'apply');
  const one = V({ ...o, quotes: { ...o.quotes, status: 'Applications are open until spring' } }, page, 'grant');
  assert.equal(one.keep, true); assert.equal(one.verdict, 'watch'); assert.ok(one.flags.includes('fake_quote:status'));
  const two = V({ ...o, quotes: { ...o.quotes, status: 'Applications are open until spring', eligible: 'Anyone can apply for this' } }, page, 'grant');
  assert.equal(two.keep, false); assert.equal(two.drop, 'unreliable_read');
});

test('directorios y blogs de listas conocidos se tratan como agregadores', () => {
  for (const u of ['https://www.ycombinator.com/companies/industry/consumer-health-and-wellness', 'https://www.roundfunded.com/en/vc/bih', 'https://hellodarwin.com/business-aid/programs/x', 'https://www.ellty.com/blog/wellness-investors', 'https://www.spinverse.com/blog/x']) assert.equal(hostKind(u), 'aggregator', u);
  assert.equal(hostKind('https://www.ycombinator.com/apply'), 'other');
  assert.equal(hostKind('https://solve.mit.edu/challenges'), 'other');
});

test('cortacircuito: sin saldo se apaga al primer error; otros fallos, tras 3 seguidos; un éxito reinicia la cuenta', async () => {
  const ok = async () => [{ url: 'https://a.org/x', title: 'A', description: 'd', markdown: '', provider: 'you', rank: 1 }];
  const noCredit = async () => { throw new Error('Linkup HTTP 402: insufficient credits'); };
  let n = 0; const flaky = async () => { n++; if (n % 3 === 0) return ok(); throw new Error('Exa HTTP 500'); };
  const fns = { linkup: noCredit, you: ok, exa: flaky };
  const breaker = {}; const o = { providers: ['linkup', 'you', 'exa'], fns, breaker, env: {} };
  const r1 = await multiSearch('q', o);
  assert.ok(r1.stats.linkup.disabled, 'apagado tras el primer error fatal'); assert.equal(breaker.linkup.off, true);
  const r2 = await multiSearch('q', o);
  assert.equal(r2.stats.linkup, undefined, 'ya no se llama'); assert.equal(r2.stats.you.returned, 1);
  assert.equal(breaker.exa.off, false, 'dos fallos y un éxito: sigue activo');
  const bad = async () => { throw new Error('boom'); }; const b2 = {};
  for (let i = 0; i < 3; i++) await multiSearch('q', { providers: ['x'], fns: { x: bad }, breaker: b2, env: {} });
  assert.equal(b2.x.off, true);
});
