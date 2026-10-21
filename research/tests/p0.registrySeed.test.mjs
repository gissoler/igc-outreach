import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentObjective, registryQueries } from '../server/research/agentic/loop.mjs';
import { createTools, nihGuideUrl, registryText } from '../server/research/agentic/tools.mjs';
import { stepPrompt, TOOL_ARGS } from '../server/research/agentic/prompts.v14.mjs';

const brief = { company: 'IGC', industry: 'Alzheimer imaging', constraints: 'Do not claim accuracy. Exact search terms: Alzheimer MRI biomarker; MCI imaging AI; dementia validation.' };
const step = (tool, args) => ({ thought: '', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const traceOf = () => { const events = []; return { events, event: (type, data) => events.push({ type, ...data }), page: () => ({}) }; };
const search2 = (keyword) => ({ errorcode: 0, data: { oppHits: [
  { id: '360001', number: 'PAR-25-272', title: 'New Approaches for Measuring Brain Changes', agency: 'National Institutes of Health', openDate: '05/08/2025', closeDate: '05/08/2027', oppStatus: 'posted' },
  { id: '360002', number: 'HHS-2027-ACL-01', title: `Other call ${keyword}`, agency: 'ACL', openDate: '01/01/2026', closeDate: '12/01/2026', oppStatus: 'forecasted' },
] } });

test('P0.6 consultas de siembra: términos exactos declarados en el brief; si no hay, industria o producto', () => {
  assert.deepEqual(registryQueries(brief, 2), ['Alzheimer MRI biomarker', 'MCI imaging AI']);
  assert.deepEqual(registryQueries({ industry: 'rural health', oneLiner: 'telehealth' }, 2), ['rural health', 'telehealth']);
  assert.deepEqual(registryQueries({}, 2), []);
});

test('P0.6 registry grants_gov: convocatorias como refs abribles sin red, guide_ref oficial del NIH, sin gastar búsquedas web', async () => {
  const urls = []; const trace = traceOf();
  const fetcher = async (url, init) => { urls.push(url); if (/grants\.nih\.gov/.test(url)) return new Response('not found', { status: 404 }); return new Response(JSON.stringify(search2(JSON.parse(init.body).keyword)), { status: 200 }); };
  const tools = createTools({ env: { ENGINE_AGENT_REGISTRY_DETAIL: '0' }, fetcher, trace });
  const out = await tools.registry({ source: 'grants_gov', query: 'Alzheimer MRI biomarker' });
  assert.equal(out.rows.length, 2); assert.equal(out.rows[0].ref, 'r1.1'); assert.equal(out.rows[0].number, 'PAR-25-272');
  assert.equal(out.rows[0].guide_ref, 'r1.1.g'); assert.equal(tools.refs.get('r1.1.g').url, nihGuideUrl('PAR-25-272'));
  assert.equal(out.rows[1].guide_ref, undefined, 'un número no-NIH no produce URL');
  assert.equal(tools.usage().searches, 0);
  const page = await tools.open({ ref: 'r1.1' });
  assert.equal(page.via, 'registry'); assert.match(page.text, /Opportunity number: PAR-25-272/); assert.match(page.text, /Close date: 05\/08\/2027/);
  // V15: una ficha sin alcance ni requisitos (stub) de un aviso del NIH intenta primero el aviso oficial completo; si no carga, queda marcada stub.
  assert.deepEqual(urls, ['https://api.grants.gov/v1/api/search2', nihGuideUrl('PAR-25-272')]); assert.equal(page.stub, true);
  assert.equal(tools.usage().opens, 1);
  assert.deepEqual(trace.events.find((e) => e.tool === 'registry').urls.length, 2);
});

test('P0.6 registry simpler usa la API oficial con X-API-Key y falla claro sin clave', async () => {
  const seen = [];
  const fetcher = async (url, init) => { seen.push([url, init.headers['X-API-Key']]); return new Response(JSON.stringify({ data: [{ opportunity_id: 'd07e', opportunity_number: 'RFA-AG-27-005', opportunity_title: 'Title', agency_name: 'NIH', opportunity_status: 'posted', close_date: '2026-11-01', summary: { summary_description: 'S' } }] }), { status: 200 }); };
  const out = await createTools({ env: { SIMPLER_GRANTS_API_KEY: 'k' }, fetcher }).registry({ source: 'simpler', query: 'dementia' });
  assert.deepEqual(seen[0], ['https://api.simpler.grants.gov/v1/opportunities/search', 'k']);
  assert.equal(out.rows[0].url, 'https://simpler.grants.gov/opportunity/d07e'); assert.equal(out.rows[0].guide_ref, 'r1.1.g');
  const none = await createTools({ env: {}, fetcher }).registry({ source: 'simpler', query: 'x' });
  assert.equal(none.error, 'simpler_not_configured');
  assert.match(registryText({ title: 'T', number: 'N', agency: 'A', oppStatus: 'posted', closeDate: '2026-11-01' }, 'simpler'), /Simpler\.Grants\.gov[\s\S]*Close date: 2026-11-01/);
});

test('P0.6 el agente de grants arranca con convocatorias del registro en la observación inicial; inversión y la bandera 0 no siembran', async () => {
  for (const [objective, env, expected] of [['grant', {}, 'grants_gov'], ['grant', { SIMPLER_GRANTS_API_KEY: 'k' }, 'simpler'], ['investment', {}, null], ['grant', { ENGINE_AGENT_REGISTRY_SEED: '0' }, null]]) {
    const calls = []; const users = []; const trace = traceOf();
    const tools = { registry: async (args) => { calls.push(args); return { rows: [{ ref: `r${calls.length}.1`, url: `https://www.grants.gov/search-results-detail/${calls.length}`, title: 'Call', number: 'PAR-25-272', guide_ref: `r${calls.length}.1.g` }] }; },
      finish: async () => ({ ok: true }), usage: () => ({}) };
    const chat = async (req) => { if (req.name === 'agent') { users.push(req.user); return { json: step('finish', { reason: 'done', finalists: [] }) }; } return { json: {} }; };
    await runAgentObjective(objective, brief, { chat, tools, trace, today: '2026-10-19', parallel: true, secondJudge: 0, env: { ENGINE_AGENT_UNDERSTAND_MODE: 'profile', ...env } });
    if (!expected) { assert.equal(calls.length, 0, `${objective} ${JSON.stringify(env)}`); continue; }
    assert.deepEqual(calls.map((c) => [c.source, c.query]), [[expected, 'Alzheimer MRI biomarker'], [expected, 'MCI imaging AI']]);
    assert.match(users[0], /"registry_seed"/); assert.match(users[0], /"r1\.1"/); assert.match(users[0], /"guide_ref":"r1\.1\.g"/);
    assert.equal(trace.events.find((e) => e.type === 'registry_seed').results_n, 2);
  }
});

test('P0.6 en un hub los enlaces con ID oficial de convocatoria van primero y lo muestran; el prompt documenta registry y entity_funding', async () => {
  const links = [...Array.from({ length: 25 }, (_, i) => ({ ref: `p1.l${i + 1}`, text: `About ${i}`, url: `https://www.nia.nih.gov/about/${i}` })), { ref: 'p1.l26', text: 'PAR-25-272 New Approaches', url: 'https://grants.nih.gov/grants/guide/pa-files/PAR-25-272.html' }];
  const users = []; const steps = [step('open', { refs: ['s1.1'] }), step('finish', { reason: 'done', finalists: [] })];
  const tools = { open: async () => ({ ref: 'p1', url: 'https://www.nia.nih.gov/research/grants-funding/announcements', title: 'NIA Funding Announcements', chars: 30, text: '<page_data>Funding announcements list.</page_data>', links }), finish: async () => ({ ok: true }), usage: () => ({}) };
  const chat = async (req) => { if (req.name === 'agent') { users.push(req.user); return { json: steps.shift() }; } return { json: { ref: 'p1', page_type: 'directory', about: 'NIA hub', dates: [], criteria: Object.fromEntries(['deadline', 'eligibility', 'region', 'entity_type', 'stage', 'amount', 'topic_fit', 'non_dilutive', 'official'].map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: false, lead: null } }; };
  await runAgentObjective('grant', { company: 'X' }, { chat, tools, trace: traceOf(), today: '2026-10-19', parallel: true, secondJudge: 0, env: { ENGINE_AGENT_UNDERSTAND_MODE: 'profile' } });
  const obs = JSON.parse(users[1].match(/Last observation:\n([\s\S]*?)\n\nReturn agent\.step/)[1]);
  const shown = obs.pages[0]?.links || obs.failed[0]?.links;
  assert.equal(shown[0].ref, 'p1.l26'); assert.equal(shown[0].call_id, 'PAR-25-272'); assert.equal(shown.length, 20);
  const prompt = stepPrompt({ state: { objective: 'grant', parallel: true }, observation: { type: 'start' } }).user;
  assert.equal(prompt.includes(TOOL_ARGS), true);
  assert.match(prompt, /registry \{"source":"simpler"\|"grants_gov"\|"reporter"\|"nsf"\|"sbir","query"/); assert.match(prompt, /entity_funding \{"entity":/);
});
