import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDate } from '../server/research/judge/audit.v13.mjs';

const D = (role, date, quote) => ({ role, date, estimated: false, quote });

test('Una fecha numérica ambigua (11/12/2027) escrita una sola vez se acepta con la lectura del juez y queda marcada', () => {
  const page = 'Posted date: 11/06/2024. Close date: 11/12/2027. Eligible applicants: small business.';
  const a = verifyDate(D('application_deadline', '2027-11-12', 'Close date: 11/12/2027.'), page);
  assert.equal(a.verified, true); assert.equal(a.ambiguous, true); assert.equal(a.why, null);
  const b = verifyDate(D('application_deadline', '2027-12-11', 'Close date: 11/12/2027.'), page);
  assert.equal(b.verified, true, 'la otra lectura también es una lectura posible de lo escrito');
  assert.equal(verifyDate(D('application_deadline', '2027-11-13', 'Close date: 11/12/2027.'), page).why, 'date_not_in_quote', 'una fecha que no sale de la cita sigue rechazada');
});

test('Una fecha no ambigua no se marca, y dos fechas escritas distintas siguen rechazándose aunque una sea ambigua', () => {
  const page = 'Close date: 11/18/2026. Posted date: 11/06/2024. Close date: 11/18/2026 Posted date: 11/06/2024';
  const ok = verifyDate(D('application_deadline', '2026-11-18', 'Close date: 11/18/2026.'), page); assert.equal(ok.verified, true); assert.equal('ambiguous' in ok, false);
  assert.equal(verifyDate(D('application_deadline', '2026-11-18', 'Close date: 11/18/2026 Posted date: 11/06/2024'), page).why, 'quote_has_several_dates');
});

test('La misma fecha escrita dos veces en la cita cuenta como una', () => {
  const page = 'Due 15 December 2026 (Dec 15, 2026) for all applicants.';
  assert.equal(verifyDate(D('application_deadline', '2026-12-15', 'Due 15 December 2026 (Dec 15, 2026)'), page).verified, true);
});
