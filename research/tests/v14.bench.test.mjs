/* Tarea E: el banco nocturno corre desatendido, no aborta si un caso falla y deja un RESUMEN.md legible (modo --dry, sin red). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { benchBrief, CASES } from '../scripts/bench-overnight.mjs';
import { validateBrief } from '../server/research/core.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
test('E banco: 3 grants + 3 inversores, y todos los briefs pasan el formulario de la app', () => {
  assert.equal(CASES.filter((c) => c.kind === 'grant').length, 3); assert.equal(CASES.filter((c) => c.kind === 'investment').length, 3);
  assert.ok(CASES.some((c) => c.brief.includes('jefe-igc-mint-ad')));
  for (const c of CASES) { const b = validateBrief(benchBrief(JSON.parse(readFileSync(join(ROOT, c.brief), 'utf8')), c.objective)); assert.deepEqual(b.fundingTypes, [c.objective]); }
});
test('E banco --dry: un caso que falla no detiene a los demás; RESUMEN.md con etapas, conteos y cobertura de MINT AD', () => {
  const out = mkdtempSync(join(tmpdir(), 'bench-'));
  const r = spawnSync('bash', ['scripts/bench-overnight.sh', '--dry'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, BENCH_DRY_FAIL: 'g3-ngo-latam', BENCH_CASES: 'g1-mint-ad g3-ngo-latam i1-mint-ad' }, timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const dir = join(ROOT, (r.stdout.match(/Banco nocturno → (\S+)/) || [])[1] || out);
  const md = readFileSync(join(dir, 'RESUMEN.md'), 'utf8');
  assert.match(md, /correctos: 2 · fallidos: 1/); assert.match(md, /fallo simulado en g3-ngo-latam/);
  assert.match(md, /Cobertura: 4\/4/); assert.match(md, /Tiempo por etapa/); assert.match(md, /Créditos Apollo/);
  assert.ok(existsSync(join(dir, 'i1-mint-ad', 'result.json')), 'el caso después del fallo sí corrió');
  spawnSync('rm', ['-rf', dir]);
});
