import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { createTools } from '../server/research/agentic/tools.mjs';
import { multiSearch } from '../server/research/searchApis.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';
import { footerFor, funnelOf, modelsUsed, providerRows } from '../server/research/agentic/report.mjs';

const ids = AGENT_CRITERIA.grant;
const step = (tool, args) => ({ thought: '', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const traceOf = () => { const events = []; return { events, event: (type, data) => events.push({ type, ...data }), page: () => ({}) }; };
const never = () => new Promise(() => {});
const env0 = { ENGINE_AGENT_UNDERSTAND_MODE: 'profile', ENGINE_AGENT_REGISTRY_SEED: '0' };

test('P0.8 un paso que agota el tiempo no pierde los resultados de búsqueda: se repite la misma observación con nota', async () => {
  const users = []; let n = 0;
  const tools = { search: async (a) => ({ results: [{ ref: 's1.1', url: 'https://example.org/kept', title: a.query, snippet: '' }] }), finish: async () => ({ ok: true }), usage: () => ({}) };
  const chat = async (req) => { users.push(req.user); n++; if (n === 1) return { json: step('search', { queries: ['alpha one'] }) }; if (n === 2) return never(); return { json: step('finish', { reason: 'done', finalists: [] }) }; };
  const r = await runAgentObjective('grant', { company: 'X' }, { chat, tools, trace: traceOf(), today: '2026-10-19', parallel: true, secondJudge: 0, env: { ...env0, ENGINE_AGENT_STEP_TIMEOUT_MS: '30' } });
  assert.equal(r.audit.agent.invalid_steps, 1);
  assert.match(users[2], /example\.org\/kept/); assert.match(users[2], /previous step failed \(timeout\)/);
  assert.equal(users[2].includes('"type":"invalid_step"'), false);
});

test('P0.8 las consultas descartadas por duplicado (y por tope por paso) quedan en la traza', async () => {
  const trace = traceOf(); const steps = [step('search', { queries: ['NIA grant 2024', 'q2 two', 'q3 three', 'q4 four', 'q5 five'] }), step('search', { queries: ['NIA grant 2026'] }), step('finish', { reason: 'done', finalists: [] })];
  const tools = { search: async () => ({ results: [] }), finish: async () => ({ ok: true }), usage: () => ({}) };
  await runAgentObjective('grant', { company: 'X' }, { chat: async (req) => ({ json: steps.shift() }), tools, trace, today: '2026-10-19', parallel: true, secondJudge: 0, env: env0 });
  const skipped = trace.events.filter((e) => e.type === 'query_skipped');
  assert.deepEqual(skipped.map((e) => [e.query, e.reason]), [['q5 five', 'per_step_cap'], ['NIA grant 2026', 'duplicate']]);
  assert.equal(skipped[1].step, 2);
});

test('P0.8 cada consulta guarda las URL por proveedor; un proveedor con HTTP 402 se marca apagado una vez y no se vuelve a llamar', async () => {
  const trace = traceOf(); let jinaCalls = 0;
  const rows = (p) => Array.from({ length: 12 }, (_, i) => ({ url: `https://${p}.example/${i}`, title: `${p} ${i}`, description: '', markdown: '', provider: p, rank: i }));
  const fns = { jina: async () => { jinaCalls++; throw new Error('Jina HTTP 402: InsufficientBalanceError'); }, exa: async () => rows('exa'), serper: async () => rows('serper') };
  const tools = createTools({ env: {}, trace, readers: { search: (q, o) => multiSearch(q, { ...o, providers: ['jina', 'exa', 'serper'], fns }) } });
  await tools.search({ query: 'one' }); await tools.search({ query: 'two' });
  const exa = trace.events.find((e) => e.type === 'tool_call' && e.provider === 'exa');
  assert.equal(exa.urls.length, 10); assert.equal(exa.urls[0], 'https://exa.example/0');
  assert.equal(jinaCalls, 1, 'el cortacircuitos lo apaga tras el 402');
  assert.equal(trace.events.filter((e) => e.type === 'provider_disabled').length, 1);
  assert.deepEqual(Object.keys(tools.disabledProviders()), ['jina']);
  const prov = providerRows(trace.events); assert.equal(prov.rows.jina.disabled.includes('402'), true); assert.equal(prov.active_errors, 0, 'los errores de Jina no contaminan a los activos');
  // apagado desde el inicio: cero llamadas
  let calls = 0; const off = createTools({ env: { ENGINE_SEARCH_PROVIDERS_OFF: 'jina' }, trace: traceOf(), readers: { search: (q, o) => multiSearch(q, { ...o, providers: ['jina', 'exa'], fns: { ...fns, jina: async () => { calls++; return []; } } }) } });
  await off.search({ query: 'x' }); assert.equal(calls, 0);
});

test('P0.8 una llamada cortada por tiempo registra tokens: con streaming cuenta lo generado; sin streaming estima la entrada y lo anota', async () => {
  const encoder = new TextEncoder();
  const streaming = async () => new Response(new ReadableStream({ start(c) { for (const t of ['{"', 'thought', '":"']) c.enqueue(encoder.encode(`data: ${JSON.stringify({ model: 'm', choices: [{ delta: { content: t } }] })}\n\n`)); } }), { status: 200 });
  const base = { ENGINE_AGENT_LLM_URL: 'http://agent/v1', ENGINE_AGENT_LLM_MODEL: 'm', ENGINE_AGENT_STEP_TIMEOUT_MS: '80', ...env0 };
  const t1 = traceOf();
  await runAgentObjective('grant', { company: 'X' }, { fetcher: streaming, tools: { finish: async () => ({}), usage: () => ({}) }, trace: t1, today: '2026-10-19', maxSteps: 1, secondJudge: 0, env: { ...base, ENGINE_AGENT_LLM_STREAM: '1' } });
  const c1 = t1.events.find((e) => e.type === 'model_call' && e.purpose === 'step');
  assert.match(c1.error, /model_timeout_agent/); assert.equal(c1.tokens.completion, 3); assert.equal(c1.tokens.streamed, true); assert.equal(c1.tokens.prompt > 100, true);
  const t2 = traceOf();
  await runAgentObjective('grant', { company: 'X' }, { fetcher: async () => never(), tools: { finish: async () => ({}), usage: () => ({}) }, trace: t2, today: '2026-10-19', maxSteps: 1, secondJudge: 0, env: base });
  const c2 = t2.events.find((e) => e.type === 'model_call' && e.purpose === 'step');
  assert.equal(c2.tokens.completion_unknown, true); assert.equal(c2.tokens.estimated, true); assert.equal(c2.tokens.prompt > 100, true);
});

test('P0.8 reporte: embudo, modelos usados por propósito y pie sin "todo pasó la verificación" cuando no hubo lecturas', () => {
  const audits = [{ objective: 'grant', agent: { on: true }, pages: 3, read: 0, unread: 3, reads: { ok: 0, ok_min: 0, retried: 3 }, candidates: 0, judge: { finalists: 0 }, kept: 0, unread_by_model: [{ page_ref: 'p1', url: 'https://x', reason: 'timeout', retried: { ok: false, reason: 'timeout' }, triage: { structure: { kind: 'page' }, banners: [], dates: [] } }] }];
  const funnel = funnelOf(audits, []);
  assert.deepEqual({ ...funnel[0], objective: undefined }, { objective: undefined, agent: true, pages_opened: 3, read_ok: 0, read_min: 0, unread: 3, retried: 3, candidates: 0, finalists: 0, findings: 0, apply: 0 });
  assert.equal(footerFor(funnel, []).includes('Todo lo listado pasó'), false); assert.match(footerFor(funnel, []), /Ninguna página fue leída con éxito/);
  assert.match(footerFor([{ ...funnel[0], read_ok: 1 }], [{}]), /Todo lo listado pasó/);
  const used = modelsUsed([{ type: 'model_call', role: 'agent', purpose: 'assess', model: 'openai/gpt-oss-120b', ok: false }, { type: 'model_call', role: 'agent', purpose: 'step', model: 'openai/gpt-oss-120b', ok: true }, { type: 'model_call', role: 'compiler', model: 'Qwen', ok: true }]);
  assert.deepEqual(used.assess.models, { 'openai/gpt-oss-120b': 1, Qwen: 1 }); assert.equal(used.step.ok, 1);
});

test('P0.8 engine-run (fixture, modo agente): el reporte muestra el embudo y los modelos de la traza, y no afirma verificación sin lecturas', () => {
  const root = mkdtempSync(join(tmpdir(), 'p08-engine-run-')); const brief = join(root, 'brief.json'); const out = join(root, 'out');
  writeFileSync(brief, JSON.stringify({ company: 'IGC', industry: 'Alzheimer risk', fundingTypes: ['grant'] }));
  const run = spawnSync(process.execPath, ['scripts/engine-run.mjs', '--brief', brief, '--objectives', 'grant', '--today', '2026-10-19', '--no-cache', '--trace', '--out', out], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, ENGINE_TEST_FIXTURE: '1', ENGINE_AGENT: '1', ENGINE_AGENT_PARALLEL: '1', ENGINE_AGENT_SECONDS: '5', ENGINE_AGENT_HARD_SECONDS: '8', ENGINE_AGENT_JUDGE_RESERVE_SECONDS: '2',
      ENGINE_LLM_URL: 'http://engine/v1', ENGINE_LLM_MODEL: 'engine-model', ENGINE_AGENT_LLM_URL: 'http://agent/v1', ENGINE_AGENT_LLM_MODEL: 'agent-model', COMPILER_LLM_URL: 'http://compiler/v1', COMPILER_LLM_MODEL: 'compiler-model', JUDGE_LLM_URL: 'http://judge/v1', JUDGE_LLM_MODEL: 'judge-model' },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = readFileSync(join(out, 'report.md'), 'utf8'); const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  assert.match(report, /## Embudo/); assert.match(report, /usado en la traza: `fixture`/);
  assert.equal(report.includes('Todo lo listado pasó la verificación'), false);
  assert.equal(Array.isArray(summary.funnel), true); assert.equal(typeof summary.models_used, 'object');
  const events = readFileSync(join(out, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.some((e) => e.type === 'registry_seed'), false, 'el fixture no siembra registros reales');
});

const findingPage = (ref, host) => ({ ref, url: `https://${host}/call`, title: 'Call', chars: 50, text: '<page_data>Official call. Application deadline is December 15, 2026.</page_data>', links: [] });
function apolloSetup(hosts) {
  let n = 0; const calls = [];
  const client = { stats: { calls: 0, creditsEstimated: 0 }, cache: { hits: 0 },
    organizationSearch: async ({ domain }) => { calls.push(['org', domain]); client.stats.calls++; client.stats.creditsEstimated += 1; return { data: { organizations: [{ id: `o-${domain}`, name: domain, primary_domain: domain }] } }; },
    peopleSearch: async ({ domain }) => { calls.push(['people', domain]); client.stats.calls++; return { data: { people: [{ id: 'x1', name: 'Pat Officer', title: 'Program Officer', organization: { name: domain } }] } }; } };
  const tools = { open: async () => findingPage(`p${++n}`, hosts[n - 1]), finish: async () => ({ ok: true }), apolloClient: client, apollo: async () => { calls.push(['agent-tool']); return { rows: [] }; }, usage: () => ({}) };
  const read = (ref) => ({ ref, page_type: 'call', about: 'Official call', dates: [{ role: 'application_deadline', date: '2026-12-15', estimated: false, quote: 'Application deadline is December 15, 2026.' }], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: true, lead: null });
  const judgment = { page_type: 'call', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null, reason: '', compiler: 'agree' }])) };
  return { client, calls, tools, read, judgment };
}

test('P0.8 Apollo después del juez (bandera post_judge): determinista, con tope de créditos y trazas enabled/eligible_for_call/called/créditos/razón', async () => {
  const { client, calls, tools, read, judgment } = apolloSetup(['funder-a.org', 'www.grants.gov', 'funder-b.org']); const trace = traceOf();
  const steps = [step('apollo', { op: 'organization', domain: 'x.org' }), step('open', { refs: ['s1', 's2', 's3'] }), step('finish', { reason: 'done', finalists: ['p1', 'p2', 'p3'] })];
  const chat = async (req) => (req.name === 'agent' ? { json: steps.shift() } : req.name === 'assess' ? { json: read(String(req.user.match(/Page ref: (\S+?)\./)[1])) } : { json: judgment });
  const r = await runAgentObjective('grant', { company: 'X' }, { chat, tools, trace, apollo: client, today: '2026-10-19', parallel: true, secondJudge: 0,
    env: { ...env0, APOLLO_ENABLED: '1', ENGINE_AGENT_APOLLO_STAGE: 'post_judge', ENGINE_AGENT_APOLLO_CREDITS: '1' } });
  assert.equal(calls.some((c) => c[0] === 'agent-tool'), false, 'el agente no puede gastar créditos en este modo');
  assert.equal(trace.events.some((e) => e.type === 'tool_call' && e.tool === 'apollo' && e.error === 'apollo_runs_after_judge'), true);
  const rows = trace.events.filter((e) => e.type === 'apollo_stage');
  assert.deepEqual(rows.map((e) => [e.domain, e.eligible_for_call, e.called, e.credits, e.reason_not_called]), [['funder-a.org', true, true, 1, null], ['grants.gov', false, false, 0, 'registry_host'], ['funder-b.org', false, false, 0, 'credit_cap']]);
  assert.equal(rows.every((e) => e.enabled === true), true);
  assert.equal(r.audit.apollo.credits, 1); assert.equal(r.audit.apollo.called, 1); assert.deepEqual(r.audit.apollo.reasons, { registry_host: 1, credit_cap: 1 });
  assert.equal(r.findings.find((f) => f.url.includes('funder-a')).contacts[0].route, 'public_affiliation');
});

test('P0.8 Apollo: desactivado o sin hallazgos se explica en la traza; el modo anterior (tool) queda resumido para comparar', async () => {
  const { client, tools } = apolloSetup([]); const t1 = traceOf();
  await runAgentObjective('grant', { company: 'X' }, { chat: async () => ({ json: step('finish', { reason: 'done', finalists: [] }) }), tools, trace: t1, apollo: client, today: '2026-10-19', parallel: true, secondJudge: 0, maxSteps: 1, env: { ...env0, APOLLO_ENABLED: '1', ENGINE_AGENT_APOLLO_STAGE: 'post_judge' } });
  assert.deepEqual(t1.events.filter((e) => e.type === 'apollo_stage').map((e) => [e.eligible_for_call, e.called, e.reason_not_called]), [[false, false, 'no_findings']]);
  const t2 = traceOf();
  const r = await runAgentObjective('grant', { company: 'X' }, { chat: async () => ({ json: step('finish', { reason: 'done', finalists: [] }) }), tools, trace: t2, apollo: client, today: '2026-10-19', parallel: true, secondJudge: 0, maxSteps: 1, env: env0 });
  const row = t2.events.find((e) => e.type === 'apollo_stage');
  assert.equal(row.stage, 'tool'); assert.equal(row.enabled, false); assert.equal(row.reason_not_called, 'apollo_disabled'); assert.equal(r.audit.apollo.stage, 'tool');
});
