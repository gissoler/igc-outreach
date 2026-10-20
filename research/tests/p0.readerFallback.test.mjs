import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';

const ids = AGENT_CRITERIA.grant;
const understood = { product_one_line: 'x', who_pays: 'x', sector: 'x', neighbor_sectors: [], stage: 'x', geography: 'x', assumptions: [], doubts: [] };
const step = (tool, args) => ({ thought: '', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const pageText = 'Official Program. Letter of intent due November 4, 2026. Funds dementia research.';
const traceOf = () => { const events = []; return { events, event: (type, data) => events.push({ type, ...data }) }; };
const toolsOf = () => {
  let n = 0;
  return { open: async () => { const ref = `p${++n}`; return { ref, url: `https://example.org/${ref}`, title: 'Program', chars: pageText.length, text: `<page_data>${pageText}</page_data>`, links: [{ ref: `${ref}.l1`, text: 'Details', url: 'https://example.org/d' }] }; },
    search: async () => ({ results: [] }), finish: async () => ({ ok: true }), usage: () => ({ opens: n }) };
};
const never = () => new Promise(() => {});
const minRead = (ref) => ({ ref, page_type: 'call', about: 'Official Program', candidate: true, deadline: { role: 'loi_deadline', date: '2026-11-04', quote: 'Letter of intent due November 4, 2026' } });
const judgment = { page_type: 'call', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null, reason: '', compiler: 'agree' }])) };

function chatWith({ assess, retry, agentSteps }) {
  const calls = [];
  const chat = async (req) => {
    calls.push([req.name, req.schema?.$id, req.maxTokens]);
    if (req.name === 'understand') return { json: understood };
    if (req.name === 'agent') return { json: agentSteps.shift() || step('finish', { reason: 'done', finalists: ['p1'] }) };
    if (req.name === 'assess') return req.schema?.$id === 'agent.assess_min/1' ? retry(req) : assess(req);
    return { json: judgment };
  };
  return { chat, calls };
}

test('P0.4 lectura que agota el tiempo: queda unread_by_model con razón y triage, reintenta una vez con el esquema mínimo y, si este responde, puede pasar al juez', async () => {
  const trace = traceOf();
  const { chat, calls } = chatWith({ assess: never, retry: (req) => ({ json: minRead(String(req.user.match(/Page ref: (\S+?)\./)[1])) }), agentSteps: [step('open', { refs: ['s1.1'] })] });
  const r = await runAgentObjective('grant', { company: 'X' }, { chat, tools: toolsOf(), trace, today: '2026-10-19', parallel: true, secondJudge: 0,
    env: { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ENGINE_AGENT_ASSESS_TIMEOUT_MS: '30', ENGINE_AGENT_ASSESS_RETRY_MIN_MS: '10' } });
  assert.deepEqual(calls.filter((c) => c[0] === 'assess').map((c) => c[1]), ['agent.assess_lite/1', 'agent.assess_min/1']);
  assert.equal(calls.find((c) => c[1] === 'agent.assess_min/1')[2], 300, 'el reintento usa su propio tope de tokens');
  assert.equal(r.audit.reads.retried, 1); assert.equal(r.audit.reads.ok_min, 1); assert.equal(r.audit.unread, 0);
  assert.equal(r.findings.length, 1); assert.equal(r.findings[0].read_contract, 'min');
});

test('P0.4 si el reintento también falla, la página queda en la traza y en el audit, nunca como candidata ni hallazgo', async () => {
  const trace = traceOf(); const agentUsers = [];
  const { chat } = chatWith({ assess: never, retry: never, agentSteps: [step('open', { refs: ['s1.1'] }), step('finish', { reason: 'done', finalists: ['p1'] })] });
  const spy = async (req) => { if (req.name === 'agent') agentUsers.push(req.user); return chat(req); };
  const r = await runAgentObjective('grant', { company: 'X' }, { chat: spy, tools: toolsOf(), trace, today: '2026-10-19', parallel: true, secondJudge: 0,
    env: { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ENGINE_AGENT_ASSESS_TIMEOUT_MS: '30', ENGINE_AGENT_ASSESS_RETRY_MIN_MS: '10', ENGINE_AGENT_ASSESS_RETRY_TIMEOUT_MS: '30' } });
  assert.equal(r.findings.length, 0); assert.equal(r.audit.judge.finalists, 0, 'un finalista sin lectura no llega al juez');
  assert.equal(r.audit.unread, 1);
  const u = r.audit.unread_by_model[0]; assert.equal(u.reason, 'timeout'); assert.equal(u.retried.ok, false); assert.equal(u.retried.reason, 'timeout');
  assert.equal(u.triage.dates[0].date, '2026-11-04', 'el triage determinista se conserva');
  assert.equal(trace.events.filter((e) => e.type === 'page_unread').length, 1);
  assert.equal(trace.events.some((e) => e.type === 'decision' && e.reason === 'unread_by_model'), true);
  assert.match(agentUsers[1], /"unread_by_model":true/); assert.match(agentUsers[1], /"p1\.l1"/, 'el agente puede seguir los enlaces de una página no leída');
});

test('P0.4 sin tiempo suficiente no se reintenta; con ENGINE_AGENT_ASSESS_RETRY=0 tampoco', async () => {
  for (const env of [{ ENGINE_AGENT_ASSESS_RETRY_MIN_MS: '999999' }, { ENGINE_AGENT_ASSESS_RETRY: '0', ENGINE_AGENT_ASSESS_RETRY_MIN_MS: '10' }]) {
    const { chat, calls } = chatWith({ assess: async () => ({ json: { nope: true } }), retry: (req) => ({ json: minRead('p1') }), agentSteps: [step('open', { refs: ['s1.1'] })] });
    const r = await runAgentObjective('grant', { company: 'X' }, { chat, tools: toolsOf(), trace: traceOf(), today: '2026-10-19', parallel: true, secondJudge: 0, maxSeconds: 30, hardSeconds: 30, reserveSeconds: 5, env: { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ...env } });
    assert.equal(calls.some((c) => c[1] === 'agent.assess_min/1'), false); assert.equal(r.audit.unread_by_model[0].reason, 'invalid');
  }
});
