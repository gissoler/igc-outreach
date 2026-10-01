import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRule, profileFromBrief } from '../server/analysis/eligibility.mjs';

const rule = (types) => ({ type: 'entity_type', requirement: types });
test('sin tipo de entidad en el brief: lo supuesto no excluye', () => {
  const p = profileFromBrief({ venture: 'AHA', amount: 200000 });
  assert.equal(p.entityType.assumed, true);
  assert.equal(evaluateRule(rule(['Nonprofits having a 501(c)(3) status']), p).verdict, '?');
});
test('entidad explícita sin ánimo de lucro: acepta nonprofits y excluye solo si está dicho', () => {
  const p = profileFromBrief({ entityType: 'nonprofit', country: 'US' });
  assert.equal(evaluateRule(rule(['Nonprofits having a 501(c)(3) status']), p).verdict, '✔');
  assert.equal(evaluateRule(rule(['Small businesses']), p).verdict, '✖');
});
test('academic y país desde el brief; el presupuesto viene del brief', () => {
  const p = profileFromBrief({ entityType: 'university research lab', geography: 'incorporated outside the US', amount: 50000 });
  assert.equal(p.usEntity.value, false);
  assert.equal(p.requestedBudget.value, 50000);
  assert.equal(evaluateRule(rule(['Public and State controlled institutions of higher education']), p).verdict, '✔');
});
test('una regla de pi_us sin dato queda en "?", nunca en exclusión', () => {
  assert.equal(evaluateRule({ type: 'pi_us' }, profileFromBrief({})).verdict, '?');
});
