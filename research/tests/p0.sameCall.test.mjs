import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';

const ids = AGENT_CRITERIA.grant;
const understood = { product_one_line: 'x', who_pays: 'x', sector: 'x', neighbor_sectors: [], stage: 'x', geography: 'x', assumptions: [], doubts: [] };
const step = (tool, args) => ({ thought: '', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const lite = (ref, extra = {}) => ({ ref, page_type: 'call', about: 'NIAGADS', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: true, lead: null, ...extra });
const RICH = 'NIA Genetics of Alzheimer Data Storage Site RFA-AG-27-005. The NOFO will build a cloud data storage platform for genetic data. Eligible applicants: small business.';
const POOR = 'Official registry record (Grants.gov). Opportunity title: NIAGADS. Opportunity number: RFA-AG-27-005. Opportunity status: forecasted.';
const judgeOf = (drop) => ({ page_type: 'forecast_notice', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, id === 'topic_fit' && drop ? { verdict: 'no', quote: 'cloud data storage platform', reason: 'storage, not research', compiler: 'agree' } : { verdict: 'unknown', quote: null, reason: '', compiler: 'agree' }])) });

async function run({ agentSteps, openOf }) {
  const events = []; const users = []; const queue = [...agentSteps];
  const chat = async (req) => {
    if (req.name === 'understand') return { json: understood };
    if (req.name === 'agent') { users.push(req.user); return { json: queue.shift() ?? step('finish', { reason: 'done', finalists: ['p1', 'p2'] }) }; }
    if (req.name === 'assess') return { json: lite(String(req.user.match(/Page ref: (\S+?)\./)[1])) };
    return { json: judgeOf(req.user.includes('cloud data storage platform')) };
  };
  let n = 0;
  const tools = { open: async ({ ref }) => openOf(ref, ++n), search: async () => ({ results: [] }), finish: async () => ({ ok: true }), usage: () => ({ opens: n }) };
  const r = await runAgentObjective('grant', { company: 'IGC' }, { chat, tools, trace: { events, event: (type, data) => events.push({ type, ...data }) }, today: '2026-10-19', parallel: true, secondJudge: 0, env: { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ENGINE_AGENT_REGISTRY_SEED: '0' } });
  return { r, events, users };
}
const page = (ref, text, url) => ({ ref, url, title: 'T', chars: text.length, text: `<page_data>${text}</page_data>`, links: [] });

test('la misma convocatoria (mismo ID) descartada por el juez en su página completa no queda verificada por una ficha pobre', async () => {
  const { r, events } = await run({ agentSteps: [step('open', { refs: ['s1.1', 's1.2'] })], openOf: (ref, n) => n === 1 ? page('p1', RICH, 'https://simpler.grants.gov/opportunity/abc') : page('p2', POOR, 'https://www.grants.gov/search-results-detail/362454') });
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings.map((f) => f.url)));
  const drops = events.filter((e) => e.type === 'drop'); assert.equal(drops.some((d) => d.decided_by === 'judge' && d.reason === 'scope_mismatch'), true);
  const same = drops.find((d) => d.reason === 'same_call_dropped'); assert.ok(same); assert.equal(same.call_id, 'RFA-AG-27-005'); assert.match(same.dropped_url, /simpler/);
});

test('sin descarte del juez, dos páginas con el mismo ID siguen su camino; y otra convocatoria no se ve afectada', async () => {
  const other = 'Another program PAR-26-094. Eligible applicants: small business.';
  const { r } = await run({ agentSteps: [step('open', { refs: ['s1.1', 's1.2'] })], openOf: (ref, n) => n === 1 ? page('p1', other, 'https://example.org/a') : page('p2', POOR, 'https://www.grants.gov/search-results-detail/362454') });
  assert.equal(r.findings.length, 2);
});

test('un ref de página ya leída se rechaza con una explicación que el agente ve en la siguiente observación', async () => {
  const { users } = await run({ agentSteps: [step('open', { refs: ['s1.1'] }), step('open', { refs: ['p1'] })], openOf: (ref, n) => ref === 'p1' ? { error: 'rejected_ref' } : page('p1', RICH, 'https://simpler.grants.gov/opportunity/abc') });
  const after = users.find((u) => /already read/.test(u)); assert.ok(after, 'el aviso aparece en una observación'); assert.match(after, /Do not reopen it/);
});
