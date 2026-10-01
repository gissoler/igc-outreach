import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, callNumber } from '../server/research/core.mjs';

const mk = (o) => ({ risks: [], evidence: [{ id: o.eid, url: 'u' }], paths: [], foundBy: [], facts: {}, kind: 'opportunity', ...o });
test('la misma convocatoria del registro y del motor web es un solo registro', () => {
  const a = mk({ eid: 'a', externalId: 'NSF 26-512', org: 'NSF', title: 'AI datasets' });
  const b = mk({ eid: 'b', org: 'National Science Foundation', title: 'NSF 26-512: Artificial Intelligence Ready Datasets' });
  assert.equal(dedupe([a, b]).length, 1);
});
test('convocatorias con números distintos siguen separadas', () => {
  assert.equal(dedupe([mk({ eid: 'a', externalId: 'RFA-AG-27-005', org: 'NIA', title: 'x' }), mk({ eid: 'b', externalId: 'RFA-AG-27-004', org: 'NIA', title: 'x' })]).length, 2);
  assert.equal(callNumber({ title: 'sin número' }), null);
});
