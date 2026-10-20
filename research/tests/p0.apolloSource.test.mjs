import test from 'node:test';
import assert from 'node:assert/strict';
import { ApolloBudget, createApolloClient } from '../capital/apollo.mjs';
import { createTools } from '../server/research/agentic/tools.mjs';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';
import { funnelLines } from '../server/research/agentic/report.mjs';

const ids = AGENT_CRITERIA.grant;
const understood = { product_one_line: 'x', who_pays: 'x', sector: 'x', neighbor_sectors: [], stage: 'x', geography: 'x', assumptions: [], doubts: [] };
const step = (tool, args) => ({ thought: '', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const brief = { company: 'IGC', industry: 'Alzheimer imaging', constraints: 'Exact search terms: brain MRI classification; Alzheimer biomarker' };
const orgs = [
  { name: 'Alzheimer Foundation', primary_domain: 'alz-foundation.org', website_url: 'https://www.alz-foundation.org', industry: 'nonprofit', short_description: 'Funds dementia research', estimated_num_employees: 40 },
  { name: 'Brain Imaging Fund', primary_domain: 'www.brainfund.com', industry: 'venture capital', short_description: 'Seed funds' },
  { name: 'Sin sitio', short_description: 'sin dominio' },
  { name: 'Repetida', primary_domain: 'alz-foundation.org', website_url: 'https://alz-foundation.org' },
];
function fakeApollo({ rows = orgs, fail = null } = {}) {
  const calls = []; const stats = { calls: 0, creditsEstimated: 0 };
  return { stats, calls, budget: new ApolloBudget({ perRun: 25, perDay: 50 }), organizationSearch: async (args) => { calls.push(args); if (fail) throw fail; stats.calls++; stats.creditsEstimated += 1; return { data: { organizations: rows } }; }, peopleSearch: async () => { throw new Error('no se piden personas en la fuente inicial'); } };
}

test('Apollo fuente: organizationSearch envía las palabras clave, estima 1 crédito y respeta el tope por corrida', async () => {
  const bodies = [];
  const fetcher = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ organizations: [] }), { status: 200 }); };
  const client = createApolloClient({ apiKey: 'k', fetcher, budget: new ApolloBudget({ perRun: 2, perDay: 50 }), cache: { get: () => null, put() {} } });
  await client.organizationSearch({ keywords: ['brain MRI'], perPage: 8 }); await client.organizationSearch({ keywords: ['alzheimer'], perPage: 8 });
  assert.deepEqual(bodies[0].q_organization_keyword_tags, ['brain MRI']); assert.equal(bodies[0].per_page, 8); assert.equal(client.stats.creditsEstimated, 2);
  await assert.rejects(client.organizationSearch({ keywords: ['tercera'], perPage: 8 }), (e) => e.code === 'APOLLO_RUN_CAP');
  assert.equal(client.stats.creditsEstimated, 2, 'la llamada rechazada no gasta');
  const plain = createApolloClient({ apiKey: 'k', fetcher, budget: new ApolloBudget({ perRun: 5, perDay: 50 }), cache: { get: () => null, put() {} } });
  await plain.organizationSearch({ domain: 'x.org' }); assert.equal('q_organization_keyword_tags' in bodies.at(-1), false, 'sin palabras clave la petición no cambia');
});

test('Apollo fuente: las organizaciones salen como refs abribles al sitio oficial, sin duplicados ni filas sin dominio, y sin pedir personas', async () => {
  const apollo = fakeApollo(); const events = [];
  const tools = createTools({ env: {}, apollo, trace: { event: (type, data) => events.push({ type, ...data }), page() {} } });
  const out = await tools.apolloSource({ keywords: ['brain MRI classification'], n: 8 });
  assert.deepEqual(out.rows.map((r) => [r.ref, r.url, r.domain]), [['a1.1', 'https://www.alz-foundation.org', 'alz-foundation.org'], ['a1.2', 'https://brainfund.com', 'brainfund.com']]);
  assert.equal(out.rows.every((r) => r.source === 'apollo'), true); assert.equal(out.credits_estimated, 1);
  assert.equal(tools.refs.get('a1.1').url, 'https://www.alz-foundation.org'); assert.equal(tools.refs.get('a1.1').markdown, '', 'abrir el ref lee el sitio, no el texto de Apollo');
  assert.deepEqual(apollo.calls[0].keywords, ['brain MRI classification']);
  assert.equal(events.find((e) => e.type === 'tool_call').credits, 1);
  assert.deepEqual(await tools.apolloSource({ keywords: [] }), { error: 'no_keywords' });
});

const toolsOf = () => { let n = 0; return { open: async () => { const ref = `p${++n}`; return { ref, url: `https://example.org/${ref}`, title: 'P', chars: 10, text: '<page_data>x</page_data>', links: [] }; }, search: async () => ({ results: [] }), finish: async () => ({ ok: true }), usage: () => ({ opens: n }) }; };
async function runWith({ env = {}, apollo = fakeApollo(), tools } = {}) {
  const starts = []; const events = [];
  const chat = async (req) => {
    if (req.name === 'understand') return { json: understood };
    if (req.name === 'agent') { starts.push(req.user); return { json: step('finish', { reason: 'done', finalists: [] }) }; }
    return { json: { page_type: 'call', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null, reason: '', compiler: 'agree' }])) } };
  };
  const t = tools || createTools({ env, apollo, trace: { event: (type, data) => events.push({ type, ...data }), page() {} }, readers: {} });
  const r = await runAgentObjective('grant', brief, { chat, tools: t, trace: { events, event: (type, data) => events.push({ type, ...data }), page() {} }, today: '2026-10-19', apollo, secondJudge: 0, env: { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ENGINE_AGENT_REGISTRY_SEED: '0', ...env } });
  return { r, starts, events, apollo };
}

test('Apollo fuente en el bucle: con APOLLO_ENABLED=1 siembra organizaciones antes del primer paso, dentro del tope, y queda en la traza y el audit', async () => {
  const { r, starts, events, apollo } = await runWith({ env: { APOLLO_ENABLED: '1', APOLLO_API_KEY: 'k' } });
  assert.equal(apollo.calls.length, 2, 'una búsqueda por término del brief'); assert.deepEqual(apollo.calls.map((c) => c.keywords), [['brain MRI classification'], ['Alzheimer biomarker']]);
  assert.match(starts[0], /"apollo_seed"/); assert.match(starts[0], /alz-foundation\.org/);
  const stage = events.find((e) => e.type === 'apollo_source');
  assert.equal(stage.called, true); assert.equal(stage.credits, 2); assert.equal(stage.cap, 5); assert.equal(stage.results_n, 2); assert.equal(stage.reason_not_called, null);
  assert.deepEqual(r.audit.apollo.seed, { called: 1, results_n: 2, credits: 2 });
  assert.equal(apollo.calls.every((c) => c.domain === undefined), true);
});

test('Apollo fuente: el tope por corrida es 5 créditos por defecto y ENGINE_AGENT_APOLLO_CREDITS lo baja; al llegar al tope la fuente inicial se detiene', async () => {
  const lowCap = await runWith({ env: { APOLLO_ENABLED: '1', APOLLO_API_KEY: 'k', ENGINE_AGENT_APOLLO_CREDITS: '1' } });
  assert.equal(lowCap.apollo.calls.length, 1, 'con tope 1 solo cabe una búsqueda'); const stage = lowCap.events.find((e) => e.type === 'apollo_source');
  assert.equal(stage.cap, 1); assert.equal(stage.credits, 1); assert.equal(stage.capped, true);
  const big = await runWith({ env: { APOLLO_ENABLED: '1', APOLLO_API_KEY: 'k', ENGINE_AGENT_APOLLO_SEED_QUERIES: '9' }, apollo: fakeApollo() });
  assert.equal(big.apollo.calls.length <= 5, true, 'nunca pasa de 5 créditos estimados por defecto');
  const none = await runWith({ env: { APOLLO_API_KEY: 'k' } }); assert.equal(none.apollo.calls.length, 0, 'sin APOLLO_ENABLED=1 no se llama');
});

test('Apollo fuente: sin APOLLO_ENABLED, sin clave o con ENGINE_AGENT_APOLLO_SEED=0 no se llama y la razón queda en la traza (0 créditos)', async () => {
  for (const [env, reason, opts] of [[{}, 'apollo_disabled', { apollo: fakeApollo() }], [{ APOLLO_ENABLED: '1', ENGINE_AGENT_APOLLO_SEED: '0' }, 'seed_off', { apollo: fakeApollo() }]]) {
    const { r, starts, events, apollo } = await runWith({ env, ...opts });
    assert.equal(apollo.calls.length, 0, reason); assert.doesNotMatch(starts[0], /"apollo_seed"/);
    const stage = events.find((e) => e.type === 'apollo_source'); assert.equal(stage.called, false); assert.equal(stage.reason_not_called, reason); assert.equal(stage.credits, 0);
    assert.equal(r.audit.apollo.seed.reason_not_called, reason);
  }
  const noKey = await runWith({ env: { APOLLO_ENABLED: '1' }, apollo: null, tools: { ...toolsOf(), apolloSource: async () => { throw new Error('no debe llamarse'); } } });
  assert.equal(noKey.events.find((e) => e.type === 'apollo_source').reason_not_called, 'apollo_not_configured');
});

test('Apollo fuente: si Apollo falla o llega al tope, la corrida sigue sin organizaciones y el error queda visible', async () => {
  const cap = Object.assign(new Error('Apollo run credit cap reached.'), { code: 'APOLLO_RUN_CAP', budget: true });
  const { r, starts, events } = await runWith({ env: { APOLLO_ENABLED: '1', APOLLO_API_KEY: 'k' }, apollo: fakeApollo({ fail: cap }) });
  assert.doesNotMatch(starts[0], /"apollo_seed"/); assert.equal(r.findings.length, 0);
  const stage = events.find((e) => e.type === 'apollo_source'); assert.equal(stage.results_n, 0); assert.equal(stage.errors.length >= 1, true);
  assert.match(String(stage.errors[0]), /APOLLO_RUN_CAP/); assert.equal(stage.errors.length, 1, 'tras el tope no sigue intentando');
});

test('Apollo fuente: el reporte muestra la fuente inicial, con organizaciones y créditos o con la razón de no llamada', () => {
  const audit = (seed) => ({ objective: 'grant', apollo: { stage: 'tool', enabled: true, configured: true, eligible: 0, called: 0, credits: 2, cap: 5, reasons: {}, seed } });
  const on = funnelLines([], [audit({ called: 1, results_n: 2, credits: 2 })]).join('\n'); assert.match(on, /fuente inicial: 2 organizaciones, 2 créditos/);
  const off = funnelLines([], [audit({ called: 0, results_n: 0, credits: 0, reason_not_called: 'apollo_disabled' })]).join('\n'); assert.match(off, /fuente inicial: no llamada \(apollo_disabled\)/);
});
