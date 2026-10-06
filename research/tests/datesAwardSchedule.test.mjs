/* Caso CDMRP (DoD, Alzheimer's Research Program, 5-oct-2026): "Awards … will be made no later than September 30, 2027"
   (calendario de fondos) se leía como plazo y la convocatoria salía abierta con 359 días. Además "5:00 p.m. ET" cortaba la frase
   y la fecha perdía su etiqueta. El plazo real de entrada (pre-aplicación 22-jun-2026) y el de la solicitud (24-sep-2026) ya pasaron. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { milestones, deadlineDecision } from '../server/research/dates.mjs';

const TODAY = '2026-10-05';
const cdmrp = readFileSync(new URL('./fixtures/cdmrp-azr-2026-10-05.txt', import.meta.url), 'utf8');

test('CDMRP: pre-aplicación y solicitud pasadas → cerrada, nunca el 2027-09-30', () => {
  const d = deadlineDecision(cdmrp, { today: TODAY });
  assert.equal(d.status, 'closed');
  assert.equal(d.deadline, '2026-06-22');
  assert.equal(d.phase, 'loi');
  assert.ok(d.flags.includes('entry_phase_closed'));
  assert.ok(d.flags.includes('next_phase_by_invitation'));
});

test('"Awards … made no later than" es calendario de fondos (result), no plazo', () => {
  const m = milestones(cdmrp).find((x) => x.iso === '2027-09-30');
  assert.equal(m.phase, 'result');
  const alone = deadlineDecision('Awards supported with FY26 funds will be made no later than September 30, 2027.', { today: TODAY });
  assert.notEqual(alone.status, 'open');
  assert.equal(alone.deadline, null);
});

test('"no later than" sigue siendo plazo cuando habla de enviar propuestas', () => {
  const d = deadlineDecision('Proposals must be received no later than November 3, 2026.', { today: TODAY });
  assert.equal(d.status, 'open');
  assert.equal(d.deadline, '2026-11-03');
});

test('"5:00 p.m. ET" no corta la frase: la fecha conserva su etiqueta', () => {
  const m = milestones('Application Submission Deadline: 11:59 p.m. ET, November 3, 2026').find((x) => x.iso === '2026-11-03');
  assert.equal(m.phase, 'deadline');
  const d = deadlineDecision('Applications are due by 5:00 p.m. ET, November 3, 2026.', { today: TODAY });
  assert.equal(d.deadline, '2026-11-03');
});

test('abreviaturas (U.S., No., Inc.) no se toman como fin de frase', () => {
  const m = milestones('Applications close for U.S. applicants and Foo Inc. members on December 1, 2026').find((x) => x.iso === '2026-12-01');
  assert.equal(m.phase, 'deadline');
});
