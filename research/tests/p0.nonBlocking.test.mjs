import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { AGENT_CRITERIA, understandFromBrief, mergeUnderstood } from '../server/research/agentic/prompts.v14.mjs';
import { validateUnderstand } from '../server/research/agentic/contracts.v14.mjs';

const ids = AGENT_CRITERIA.grant;
const brief = { company: 'IGC', oneLiner: 'Clinical and MRI classifier for MCI', industry: 'Alzheimer imaging', stage: 'experimental', geography: 'Global' };
const modelUnderstood = { product_one_line: 'MRI classifier (model)', who_pays: 'health systems', sector: 'neuro imaging', neighbor_sectors: ['digital health'], stage: '', geography: '', assumptions: ['entity unknown'], doubts: [] };
const step = (tool, args) => ({ thought: '', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => {});
const traceOf = () => { const events = []; return { events, event: (type, data) => events.push({ type, at: Date.now(), ...data }) }; };
const pageText = 'Official Program. Application deadline is December 15, 2026. Funds dementia research. This is a grant with no equity.';
const toolsOf = () => { let n = 0; return {
  search: async () => ({ results: [{ ref: 's1.1', url: 'https://example.org/a', title: 'a', snippet: '' }] }),
  open: async () => { const ref = `p${++n}`; return { ref, url: `https://example.org/${ref}`, title: 'Program', chars: pageText.length, text: `<page_data>${pageText}</page_data>`, links: [] }; },
  finish: async () => ({ ok: true }), ask_user: async () => ({ answered: false }), note: async () => ({ ok: true }), usage: () => ({ opens: n }) }; };
const liteRead = (ref) => ({ ref, page_type: 'call', about: 'Official Program', dates: [{ role: 'application_deadline', date: '2026-12-15', estimated: false, quote: 'Application deadline is December 15, 2026.' }],
  criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: true, lead: null });
const judgment = { page_type: 'call', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null, reason: '', compiler: 'agree' }])) };
const refOf = (req) => String(req.user.match(/Page ref: (\S+?)\./)?.[1]);

test('P0.5 comprensión determinista desde el perfil: válida contra agent.understand/1 y sin inventar', () => {
  const u = understandFromBrief(brief);
  assert.equal(validateUnderstand(u).ok, true);
  assert.equal(u.product_one_line, brief.oneLiner); assert.equal(u.sector, brief.industry); assert.deepEqual(u.assumptions, []); assert.equal(u.who_pays, '');
  assert.equal(validateUnderstand(understandFromBrief({})).ok, true);
  const m = mergeUnderstood(u, modelUnderstood); assert.equal(m.stage, 'experimental', 'un campo vacío del modelo no borra el perfil'); assert.equal(m.who_pays, 'health systems');
});

test('P0.5 la comprensión del modelo corre en paralelo: el primer paso sale antes y usa el perfil; los siguientes, la del modelo', async () => {
  const trace = traceOf(); const stepStates = []; const steps = [step('search', { queries: ['a one'] }), step('search', { queries: ['b two'] }), step('finish', { reason: 'done', finalists: [] })];
  const chat = async (req) => {
    if (req.name === 'understand') { await sleep(80); return { json: modelUnderstood }; }
    if (req.name === 'agent') { stepStates.push(JSON.parse(req.user.match(/State:\n([\s\S]*?)\n\nLast observation/)[1]).understood); if (stepStates.length === 2) await sleep(120); return { json: steps.shift() }; }
    return { json: {} };
  };
  const r = await runAgentObjective('grant', brief, { chat, tools: toolsOf(), trace, today: '2026-10-19', parallel: true, secondJudge: 0 });
  assert.equal(stepStates[0].product_one_line, brief.oneLiner, 'paso 1 con el perfil, sin esperar al modelo');
  assert.equal(stepStates[2].product_one_line, 'MRI classifier (model)');
  const u = trace.events.filter((e) => e.type === 'understand'); assert.deepEqual(u.map((e) => e.source), ['profile', 'model']);
  assert.equal(trace.events.some((e) => e.type === 'brief_patch'), true);
  assert.equal(r.audit.agent.understand_source, 'model');
});

test('P0.5 si la comprensión agota su tope corto, se sigue con el perfil y el brief en bruto, con nota visible en la traza', async () => {
  const trace = traceOf(); const steps = [step('search', { queries: ['a one'] }), step('finish', { reason: 'done', finalists: [] })];
  const chat = async (req) => (req.name === 'understand' ? never() : req.name === 'agent' ? (await sleep(40), { json: steps.shift() }) : { json: {} });
  const r = await runAgentObjective('grant', brief, { chat, tools: toolsOf(), trace, today: '2026-10-19', parallel: true, secondJudge: 0, env: { ENGINE_AGENT_UNDERSTAND_TIMEOUT_MS: '20' } });
  const notes = trace.events.filter((e) => e.type === 'understand').map((e) => e.note);
  assert.equal(notes.some((n) => /model_understand_failed:timeout/.test(n)), true); assert.equal(r.audit.agent.understand_source, 'profile');
  // modo perfil: ninguna llamada de comprensión
  const t2 = traceOf(); const s2 = [step('finish', { reason: 'done', finalists: [] })]; const names = [];
  await runAgentObjective('grant', brief, { chat: async (req) => { names.push(req.name); return { json: s2.shift() }; }, tools: toolsOf(), trace: t2, today: '2026-10-19', parallel: true, secondJudge: 0, env: { ENGINE_AGENT_UNDERSTAND_MODE: 'profile' } });
  assert.equal(names.includes('understand'), false);
});

test('P0.5 la lectura no bloquea el bucle: el paso sigue con la página en `reading` y el resultado llega después como late_reads', async () => {
  const trace = traceOf(); const users = []; const steps = [step('open', { refs: ['s1.1'] }), step('search', { queries: ['b two'] }), step('search', { queries: ['c three'] }), step('finish', { reason: 'done', finalists: ['p1'] })];
  const chat = async (req) => {
    if (req.name === 'understand') return { json: modelUnderstood };
    if (req.name === 'agent') { users.push(req.user); if (users.length === 3) await sleep(150); return { json: steps.shift() }; }
    if (req.name === 'assess') { await sleep(100); return { json: liteRead(refOf(req)) }; }
    return { json: judgment };
  };
  const r = await runAgentObjective('grant', brief, { chat, tools: toolsOf(), trace, today: '2026-10-19', parallel: true, secondJudge: 0, env: { ENGINE_AGENT_READ_WAIT_MS: '10', ENGINE_AGENT_UNDERSTAND_MODE: 'profile' } });
  assert.match(users[1], /"status":"reading"/, 'el paso siguiente no esperó la lectura');
  assert.equal(users.slice(2).some((u) => /"late_reads"/.test(u) && /Official Program/.test(u)), true, 'la lectura tardía llega en un paso posterior');
  assert.equal(r.findings.length, 1);
});

test('P0.5 fase de drenaje: al vencer la ventana, las lecturas ya lanzadas terminan antes del juez', async () => {
  const trace = traceOf(); const steps = [step('open', { refs: ['s1.1'] })];
  const chat = async (req) => {
    if (req.name === 'agent') return { json: steps.shift() || step('search', { queries: [`q ${Math.random()}`] }) };
    if (req.name === 'assess') { await sleep(1300); return { json: liteRead(refOf(req)) }; }
    return { json: judgment };
  };
  const t0 = Date.now();
  const r = await runAgentObjective('grant', brief, { chat, tools: toolsOf(), trace, today: '2026-10-19', parallel: true, secondJudge: 0, maxSeconds: 2, hardSeconds: 4, reserveSeconds: 1,
    env: { ENGINE_AGENT_READ_WAIT_MS: '10', ENGINE_AGENT_UNDERSTAND_MODE: 'profile', ENGINE_AGENT_SEARCHES: '50' } });
  const drain = trace.events.find((e) => e.type === 'drain');
  assert.equal(r.findings.length, 1, 'la lectura que terminó en el drenaje llegó al juez');
  assert.equal(Date.now() - t0 < 4000, true);
  assert.equal(drain.completed, 1); assert.equal(drain.aborted, 0);
  const judgeAt = trace.events.find((e) => e.type === 'model_call' && e.purpose === 'judge').at;
  const readAt = trace.events.find((e) => e.type === 'model_call' && e.purpose === 'assess').at;
  assert.equal(judgeAt >= readAt, true);
});

test('P0.5 el drenaje tiene tope propio y nunca pasa de hardSeconds − reserveSeconds; lo que no termina queda unread_by_model', async () => {
  const trace = traceOf(); const steps = [step('open', { refs: ['s1.1'] }), step('finish', { reason: 'done', finalists: ['p1'] })];
  const chat = async (req) => (req.name === 'agent' ? { json: steps.shift() } : req.name === 'assess' ? never() : { json: judgment });
  const t0 = Date.now();
  const r = await runAgentObjective('grant', brief, { chat, tools: toolsOf(), trace, today: '2026-10-19', parallel: true, secondJudge: 0, maxSeconds: 1, hardSeconds: 2, reserveSeconds: 1,
    env: { ENGINE_AGENT_READ_WAIT_MS: '10', ENGINE_AGENT_UNDERSTAND_MODE: 'profile', ENGINE_AGENT_DRAIN_SECONDS: '60', ENGINE_AGENT_ASSESS_TIMEOUT_MS: '60000', ENGINE_AGENT_ASSESS_RETRY: '0' } });
  const took = Date.now() - t0; assert.equal(took < 1800, true, `tope duro menos reserva (${took} ms)`);
  assert.equal(r.findings.length, 0); assert.equal(r.audit.unread, 1);
  assert.match(r.audit.unread_by_model[0].reason, /timeout|drain_timeout/);
  // tope propio del drenaje, más corto que la ventana disponible
  const t2 = traceOf(); const s2 = [step('open', { refs: ['s1.1'] }), step('finish', { reason: 'done', finalists: [] })]; const t1 = Date.now();
  const r2 = await runAgentObjective('grant', brief, { chat: async (req) => (req.name === 'agent' ? { json: s2.shift() } : req.name === 'assess' ? never() : { json: judgment }), tools: toolsOf(), trace: t2, today: '2026-10-19', parallel: true, secondJudge: 0, maxSeconds: 10, hardSeconds: 20, reserveSeconds: 5,
    env: { ENGINE_AGENT_READ_WAIT_MS: '10', ENGINE_AGENT_UNDERSTAND_MODE: 'profile', ENGINE_AGENT_DRAIN_SECONDS: '0.2', ENGINE_AGENT_ASSESS_RETRY: '0' } });
  assert.equal(Date.now() - t1 < 1500, true);
  const d = t2.events.find((e) => e.type === 'drain'); assert.equal(d.aborted, 1); assert.equal(d.cap_ms, 200);
  assert.equal(r2.audit.unread_by_model[0].reason, 'drain_timeout');
});
