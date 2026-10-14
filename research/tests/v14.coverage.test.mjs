/* Criterio de éxito de la tarea A: con el log REAL de GPT Researcher del 14-10 y un modelo honesto simulado, las convocatorias de la
   lista de Gemini no se pierden en ningún paso que dependa del código (ranking, registro, promoción, juez, auditoría, filtros, engineLeads, evaluate). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runGptr } from '../server/research/gptr.mjs';
import { createTools } from '../server/research/agentic/tools.mjs';
import { engineLeads } from '../server/research/engine.mjs';
import { evaluate } from '../server/research/core.mjs';
import { honestChat, mapReader, registryFetcher, loadWorld, coverage } from '../scripts/bench/fake.mjs';

const W = loadWorld(new URL('../eval/gold/mint-ad-gemini-2026-10-14.json', import.meta.url).pathname);
const BRIEF = JSON.parse(readFileSync(new URL(`../${W.brief}`, import.meta.url), 'utf8'));
const LOG = readFileSync(new URL('./fixtures/v14fix/gptr-log-mintad-20261014-013838.txt', import.meta.url), 'utf8') + '\n' + W.extra_log_urls.map((u) => `Added source url to research: ${u}`).join('\n');

async function simulate() {
  const calls = [];
  const tools = createTools({ env: {}, readers: { open: mapReader(W.pages) }, limits: { opens: 400, apolloCredits: 0 }, apollo: { organizationSearch: async () => ({ data: {} }), peopleSearch: async () => ({ data: {} }), stats: {} } });
  const r = await runGptr('grant', BRIEF, { env: { SIMPLER_GRANTS_API_KEY: 'fixture', GPTR_JUDGE_MAX: '40' }, today: W.today, gptrRunner: async () => ({ early: true }), registryFetcher: registryFetcher(W.registry),
    logText: LOG, reportText: '', chat: honestChat({ today: W.today, calls }), tools });
  return { r, calls };
}

test('COBERTURA MINT AD: las 4 de Gemini llegan al juez, salen como hallazgos con su fecha exacta y ninguna se descarta', async () => {
  const { r } = await simulate();
  const cov = coverage(W.gold, r.findings);
  for (const c of cov) { assert.equal(c.found, true, `${c.label} se perdió`); assert.equal(c.dateOk, true, `${c.label}: fecha ${c.deadline} ≠ ${c.expected}`); }
  const leads = evaluate(engineLeads(r.findings), BRIEF, new Set(), new Date(`${W.today}T12:00:00Z`), []);
  for (const g of W.gold) { const l = leads.find((x) => g.re.test(`${x.title} ${x.externalId} ${x.contact?.value || ''}`)); assert.ok(l, `${g.id} no llegó a la lista`); assert.notEqual(l.bucket, 'discarded', `${g.id} descartado: ${l.discard}`); }
});
test('COBERTURA MINT AD: la lista queda limpia — ninguna página sin plazo ni genérica sale como hallazgo', async () => {
  const { r } = await simulate();
  for (const f of r.findings) assert.ok(f.deadline || f.status === 'forecast' || f.status === 'upcoming', `hallazgo sin plazo: ${f.url} (${f.status})`);
  assert.ok(r.findings.length <= 6, `${r.findings.length} hallazgos: deberían ser solo las convocatorias con plazo`);
  assert.ok(r.findings.find((f) => f.registry?.number === 'PA-27-100')?.contacts?.some((c) => c.source === 'registry'), 'el contacto oficial del registro viaja con el hallazgo');
});
