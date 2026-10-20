import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssessLite, assessLiteSchema } from '../server/research/agentic/contracts.v14.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';

const lite = (ids) => ({ ref: 'p1', page_type: 'call', about: 'x', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: false, lead: null });

test('P0.3 el contrato ligero valida listas de criterios distintas en el mismo proceso (grants e inversión) sin chocar por $id', () => {
  const grant = AGENT_CRITERIA.grant; const other = [...grant].slice(0, Math.max(1, grant.length - 1));
  assert.equal(assessLiteSchema(grant).$id, assessLiteSchema(other).$id, 'el $id es fijo: por eso cada lista necesita su propio validador');
  assert.equal(validateAssessLite(lite(grant), grant).ok, true);
  assert.equal(validateAssessLite(lite(other), other).ok, true);
  assert.equal(validateAssessLite(lite(grant), grant).ok, true, 'la caché devuelve el validador correcto');
  const investment = AGENT_CRITERIA.investment;
  if (investment) assert.equal(validateAssessLite(lite(investment), investment).ok, true);
  assert.equal(validateAssessLite(lite(other), grant).ok, false, 'faltan criterios del objetivo: se rechaza');
});
