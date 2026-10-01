import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleAssessment, reflectionQuestions } from '../server/research/orchestrator.mjs';

const m = { top: 0, radar: 3, open: 2, closed: 0, emailRate: 0, total: 3 };
test('grants: las opciones del orquestador no incluyen find_contacts', () => {
  assert.ok(!('find_contacts' in reflectionQuestions([], { grantsOnly: true }).strategy.criteria));
  assert.ok('find_contacts' in reflectionQuestions([]).strategy.criteria);
});
test('grants: las reglas nunca eligen find_contacts', () => {
  for (const tried of [[], ['named_funders'], ['named_funders', 'adjacent_terms', 'geography', 'recent_deals']]) {
    assert.notEqual(ruleAssessment({ ...m, top: 5 }, { grantsOnly: true, tried }).strategy, 'find_contacts');
    assert.notEqual(ruleAssessment(m, { grantsOnly: true, tried }).strategy, 'find_contacts');
  }
});
