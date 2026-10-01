import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, GOAL_FIELDS } from '../server/research/intake.mjs';
import { validateBrief } from '../server/research/core.mjs';

test('el tipo de entidad es un campo del prerregistro solo para grants', () => {
  const f = FIELDS.find((x) => x.path === 'company.entity_type');
  assert.ok(f && f.grant && f.ask);
  assert.ok(GOAL_FIELDS.grant.includes('company.entity_type'));
  assert.ok(!GOAL_FIELDS.investment.includes('company.entity_type'));
});
test('validateBrief conserva entityType y country', () => {
  const b = validateBrief({ name: 'G', role: 'x', company: 'AHA', product: 'p', description: 'd'.repeat(30), industry: 'health', stage: 'prototype', geography: 'Global', fundingTypes: ['grant'], dataMode: 'live', mode: 'strategic', entityType: 'nonprofit', country: 'US' });
  assert.equal(b.entityType, 'nonprofit');
  assert.equal(b.country, 'US');
});
