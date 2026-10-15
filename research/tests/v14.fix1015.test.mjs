import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runGptr, startPrefetch } from '../server/research/gptr.mjs';
import { createTools } from '../server/research/agentic/tools.mjs';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { runEngine } from '../server/research/engine.mjs';

// 15-10 (MINT AD, 0 resultados): con el plazo del pipeline, GPTR gastaba todo menos 120 s y el bucle descartaba por tiempo cada página antes del juez.
test('15-10 GPTR deja GPTR_RESERVE_SECONDS (210 s por defecto) para leer y juzgar', async () => {
  let seconds = null;
  await runGptr('grant', { company: 'IGC' }, { env: { REGISTRY_TOOL: 'off' }, today: '2026-10-15', deadlineAt: Date.now() + 400_000,
    gptrRunner: async (o) => { seconds = o.seconds; return {}; }, logText: '', reportText: '', judgeRunner: async () => ({ findings: [], audit: {} }) });
  assert.ok(seconds >= 185 && seconds <= 190, `GPTR recibió ${seconds}s`);
});

test('15-10 las rutas de capital van al prompt de la misma corrida de GPTR (sin segunda corrida)', async () => {
  let prompt = ''; let runs = 0;
  await runEngine({ fundingTypes: ['grant'], company: 'IGC' }, { env: { ENGINE_GPTR: '1', REGISTRY_TOOL: 'off' }, today: '2026-10-15',
    gptrQueriesBy: { grant: [{ query: 'state matching funds for SBIR awardees', family: 'capital_strategy:r1' }] },
    gptrRunner: async ({ promptFile }) => { runs++; prompt = readFileSync(promptFile, 'utf8'); return {}; }, logText: '', reportText: '' });
  assert.equal(runs, 1); assert.match(prompt, /state matching funds for SBIR awardees/);
});

test('15-10 descarga anticipada: baja cada URL nueva del log de GPTR una sola vez, sin redes sociales ni imágenes', async () => {
  let log = 'Added source url to research: https://a.gov/rfa\nAdded source url to research: https://linkedin.com/x\n'; const got = [];
  const pre = startPrefetch({ logFile: 'x', read: () => log, everyMs: 60_000, fetchFn: async (u) => { got.push(u); return { url: u, title: 't', text: 'texto '.repeat(30) }; } });
  pre.scan(); log += 'Added source url to research: https://a.gov/rfa\nAdded source url to research: https://b.org/logo.png\nAdded source url to research: https://b.org/call).\n';
  await new Promise((r) => setTimeout(r, 10)); const st = pre.stop(); await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(got, ['https://a.gov/rfa', 'https://b.org/call']); assert.equal(st.queued, 2); assert.ok(pre.pages.has('https://a.gov/rfa'));
});

test('15-10 open usa la página ya descargada sin volver a leerla', async () => {
  const cached = new Map([['https://a.gov/rfa', { url: 'https://a.gov/rfa', title: 'RFA', text: 'Applications due November 30, 2026. '.repeat(5) }]]);
  const tools = createTools({ env: {}, fetcher: async () => { throw new Error('no debe descargar'); }, readers: { cached } });
  tools.refs.set('seed1', { url: 'https://a.gov/rfa', title: 'RFA' });
  const r = await tools.open({ ref: 'seed1' }); assert.equal(r.via, 'prefetch'); assert.match(r.text, /November 30, 2026/);
});

test('15-10 el bucle usa la comprensión hecha en paralelo y no la repite', async () => {
  const roles = [];
  const chat = async ({ name }) => { roles.push(name); return null; };
  await runAgentObjective('grant', { company: 'IGC' }, { env: {}, today: '2026-10-15', chat, maxSteps: 0, seedUrls: [],
    understood: Promise.resolve({ product_one_line: 'x', who_pays: '', sector: '', neighbor_sectors: [], stage: '', geography: '', assumptions: [], doubts: [] }),
    tools: { refs: new Map(), usage: () => ({}), ask_user: async () => ({}), finish: async () => ({}) }, apollo: { } }).catch(() => {});
  assert.ok(!roles.includes('understand'), `llamadas: ${roles.join(',')}`);
});
