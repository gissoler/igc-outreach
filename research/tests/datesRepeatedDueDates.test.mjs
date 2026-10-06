import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineDecision } from '../server/research/dates.mjs';

const prose = 'PA-27-100: Parent SBIR. Standard Due Dates for Submission: September 05, 2026 for New and Renewal/Resubmission applications. January 05, 2027 for New and Renewal/Resubmission applications. April 05, 2027 for New and Renewal/Resubmission applications.';
const bullets = 'Standard Due Dates: - September 05, 2026 for New and Renewal/Resubmission applications - January 05, 2027 for New and Renewal/Resubmission applications - April 05, 2027 for New and Renewal/Resubmission applications';

for (const [name, text] of [['prosa', prose], ['viñetas', bullets]]) {
  test(`varios plazos con una sola etiqueta (${name}): toma el próximo abierto`, () => {
    assert.equal(deadlineDecision(text, { today: '2026-10-05' }).deadline, '2027-01-05');
    assert.equal(deadlineDecision(text, { today: '2027-01-06' }).deadline, '2027-04-05');
    assert.equal(deadlineDecision(text, { today: '2027-04-06' }).status, 'closed');
  });
}
