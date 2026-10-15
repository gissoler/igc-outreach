import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runGptr } from '../server/research/gptr.mjs';
import { runEngine } from '../server/research/engine.mjs';

// 15-10 (MINT AD, 0 resultados): con el plazo del pipeline, GPTR gastaba todo menos 120 s y el bucle descartaba por tiempo cada página antes del juez.
test('15-10 GPTR deja GPTR_RESERVE_SECONDS (270 s por defecto) para leer y juzgar', async () => {
  let seconds = null;
  await runGptr('grant', { company: 'IGC' }, { env: { REGISTRY_TOOL: 'off' }, today: '2026-10-15', deadlineAt: Date.now() + 500_000,
    gptrRunner: async (o) => { seconds = o.seconds; return {}; }, logText: '', reportText: '', judgeRunner: async () => ({ findings: [], audit: {} }) });
  assert.ok(seconds >= 225 && seconds <= 230, `GPTR recibió ${seconds}s`);
});

test('15-10 las rutas de capital van al prompt de la misma corrida de GPTR (sin segunda corrida)', async () => {
  let prompt = ''; let runs = 0;
  await runEngine({ fundingTypes: ['grant'], company: 'IGC' }, { env: { ENGINE_GPTR: '1', REGISTRY_TOOL: 'off' }, today: '2026-10-15',
    gptrQueriesBy: { grant: [{ query: 'state matching funds for SBIR awardees', family: 'capital_strategy:r1' }] },
    gptrRunner: async ({ promptFile }) => { runs++; prompt = readFileSync(promptFile, 'utf8'); return {}; }, logText: '', reportText: '' });
  assert.equal(runs, 1); assert.match(prompt, /state matching funds for SBIR awardees/);
});
