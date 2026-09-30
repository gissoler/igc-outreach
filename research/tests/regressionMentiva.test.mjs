/* Regresión de calidad de grants (brief Mentiva, hoy 2026-09-30): los criterios medibles deben cumplirse aunque el
   modelo lector mienta. Detalle y replay de corridas reales: node eval/regression/mentiva-grants.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { partA, partC, PASS } from '../eval/regression/mentiva-grants.mjs';

for (const mode of ['adversarial', 'faithful']) {
  test(`regresión Mentiva (lector ${mode}): 0 cerradas como abiertas, 0 sin fecha, 0 no-convocatorias, 0 no elegibles como apply, 100 % fechas con cita`, async () => {
    const r = await partA(mode);
    assert.equal(r.closedAsOpen, 0, JSON.stringify(r.detail.closedAsOpen));
    assert.equal(r.mainWithoutVerifiableDate, 0, JSON.stringify(r.detail.mainWithoutVerifiableDate));
    assert.equal(r.nonCallsKeptAsCall, 0, JSON.stringify(r.detail.nonCallsKeptAsCall));
    assert.equal(r.notEligibleAsApply, 0, JSON.stringify(r.detail.notEligibleAsApply));
    assert.equal(r.datesWithLiteralQuotePct, 100);
    assert.ok(PASS(r));
  });
}

test('estrés con páginas reales guardadas (si está la caché local): invariantes de la lista principal', { skip: !existsSync(new URL('../eval/runs/search-cache.json', import.meta.url)) && 'eval/runs/search-cache.json no está en este checkout' }, async () => {
  const c = await partC();
  for (const [k, ok] of Object.entries(c.invariants)) assert.ok(ok, k);
});
