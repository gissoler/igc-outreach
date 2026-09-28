// Pilar B/C y Módulo 6: registro de acercamientos, rangos, privacidad k≥3, Thompson con umbral.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOutreach, summarizeOutreach, networkAggregate, chooseArm, armsFromEvents, importOutreachRows, effectiveOutcome } from '../server/analysis/outreach.mjs';
import { rateInterval, betaCdf, seeded, betaSample } from '../server/analysis/stats.mjs';
import { createStore } from '../server/research/store.mjs';

const ev = (o) => validateOutreach({ fundName: 'Kaszek', channel: 'cold_email', sentAt: '2026-08-01', ...o }, { userId: o.userId || 'u1', now: '2026-09-27T00:00:00Z' });

test('validación de acercamientos', () => {
  assert.throws(() => validateOutreach({ channel: 'cold_email' }), /fund/);
  assert.throws(() => validateOutreach({ fundName: 'X', channel: 'fax' }), /channel/i);
  assert.throws(() => validateOutreach({ fundName: 'X', channel: 'cold_email', outcome: 'ganado' }), /result/i);
  const e = ev({ arguments: ['traccion', 'traccion'], outcome: 'reunion' });
  assert.deepEqual(e.arguments, ['traccion']);
  assert.equal(e.fundId, 'f:nm:kaszek');
  assert.equal(effectiveOutcome(ev({}), new Date('2026-09-27')), 'sin_respuesta', '>14 días sin cambio');
});

test('intervalos Beta: k de n con rango, nunca porcentaje suelto', () => {
  const r = rateInterval(3, 7);
  assert.match(r.label, /^3 of 7 · range \d+–\d+%$/);
  assert.ok(r.lo < 3 / 7 && r.hi > 3 / 7);
  assert.equal(rateInterval(0, 0).label, 'no data');
  assert.ok(Math.abs(betaCdf(0.5, 2, 2) - 0.5) < 1e-9);
  const rng = seeded(3); const xs = Array.from({ length: 2000 }, () => betaSample(3, 7, rng));
  assert.ok(Math.abs(xs.reduce((a, b) => a + b) / xs.length - 0.3) < 0.02);
});

test('tablero del pilar B por canal', () => {
  const events = [ev({ channel: 'intro_portafolio', outcome: 'reunion' }), ev({ channel: 'intro_portafolio', outcome: 'negativa' }), ev({ channel: 'cold_email', outcome: 'sin_respuesta' }), ev({ channel: 'cold_email', outcome: 'enviado', sentAt: '2026-09-25' })];
  const s = summarizeOutreach(events, { now: new Date('2026-09-27') });
  assert.equal(s.total, 3); assert.equal(s.pending, 1); assert.equal(s.stage, 'descriptivo');
  assert.equal(s.rows[0].key, 'intro_portafolio');
  assert.match(s.rows[0].meetingRate.label, /^1 of 2/);
});

test('pilar C: solo celdas con ≥3 fundadores que comparten', () => {
  const shared = [1, 2, 3].map((i) => ev({ userId: `u${i}`, shared: true, outcome: i === 1 ? 'reunion' : 'sin_respuesta', channel: i === 1 ? 'intro_portafolio' : 'cold_email', sector: 'mental health' }));
  const two = [1, 2].map((i) => ev({ userId: `v${i}`, shared: true, fundName: 'Otro Fondo', outcome: 'reunion' }));
  const res = networkAggregate([...shared, ...two, ev({ userId: 'x', shared: false, outcome: 'reunion' })], { now: new Date('2026-09-27') });
  assert.equal(res.cells.length, 1);
  assert.equal(res.hiddenCells, 1);
  assert.equal(res.cells[0].founders, 3);
  assert.match(res.cells[0].text, /Replied to 1 of 3 outreach rows from 3 founders in mental health/);
  assert.equal(res.cells[0].meetingRoutes[0].channel, 'Portfolio founder intro');
  assert.ok(!JSON.stringify(res).includes('u1'), 'no revela quién contactó');
});

test('Thompson sampling solo con volumen; antes, explorar', () => {
  const few = chooseArm([{ key: 'a', n: 5, k: 2 }, { key: 'b', n: 2, k: 0 }]);
  assert.equal(few.mode, 'explorar'); assert.equal(few.key, 'b');
  const many = chooseArm([{ key: 'a', n: 60, k: 20 }, { key: 'b', n: 60, k: 2 }], { rng: seeded(1) });
  assert.equal(many.mode, 'thompson'); assert.equal(many.key, 'a');
  assert.deepEqual(armsFromEvents([ev({ variant: 'v1', outcome: 'reunion' }), ev({ variant: 'v1', outcome: 'negativa' })], new Date('2026-09-27')), [{ key: 'v1', n: 2, k: 1 }]);
});

test('importar hoja de outreach histórica y persistir', () => {
  const { events, errors } = importOutreachRows([{ fondo: 'Kaszek', canal: 'Intro por portfolio founder', resultado: 'Meeting', fecha: '2025-03-01', argumentos: 'traccion;equipo' }, { fondo: '', canal: 'cold' }], { userId: 'u1' });
  assert.equal(events.length, 1); assert.equal(errors.length, 1);
  assert.equal(events[0].channel, 'intro_portafolio'); assert.equal(events[0].outcome, 'reunion');
  const store = createStore(':memory:');
  store.analysis.saveOutreach(events[0]);
  assert.equal(store.analysis.outreachFor('u1').length, 1);
  assert.equal(store.analysis.sharedOutreach().length, 0);
  store.close();
});
