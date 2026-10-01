/* Un solo camino de búsqueda web: con el motor disponible, ningún objetivo corre las fuentes web antiguas. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webSourcePlan } from '../server/research/sourcePlan.mjs';

const env = { EXA_API_KEY: 'x', SERPER_API_KEY: 'y' };
const OFF = { exa: false, rounds: false, serper: false, agentic: false, legacy: false };
const pick = (p) => ({ exa: p.exa, rounds: p.rounds, serper: p.serper, agentic: p.agentic, legacy: p.legacy });

test('con el motor disponible, grants e inversión usan el mismo camino: sin fuentes web antiguas', () => {
  for (const fundingTypes of [['grant'], ['investment'], ['debt'], ['sponsorship'], ['grant', 'investment'], ['partnering'], ['investment', 'debt', 'grant']]) {
    assert.deepEqual(pick(webSourcePlan({ fundingTypes, engineOn: true, env })), OFF, fundingTypes.join('+'));
  }
});

test('sin motor (modelo caído o sin configurar), inversión conserva el respaldo y grants solos no', () => {
  assert.deepEqual(pick(webSourcePlan({ fundingTypes: ['investment'], engineOn: false, env })), { exa: true, rounds: true, serper: true, agentic: true, legacy: true });
  const grants = webSourcePlan({ fundingTypes: ['grant'], engineOn: false, env });
  assert.equal(grants.grantsOnly, true); assert.equal(grants.legacy, false); assert.equal(grants.exa, false); assert.equal(grants.serper, false);
});

test('el respaldo solo usa las claves que existen y las pruebas con proveedores inyectados no lo activan', () => {
  assert.equal(webSourcePlan({ fundingTypes: ['investment'], engineOn: false, env: { SERPER_API_KEY: 'y' } }).exa, false);
  assert.equal(webSourcePlan({ fundingTypes: ['investment'], engineOn: false, env: {} }).rounds, false);
  assert.deepEqual(pick(webSourcePlan({ fundingTypes: ['investment'], engineOn: false, env, providers: [] })), { ...OFF, rounds: true });
});
