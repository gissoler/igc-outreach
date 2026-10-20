import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSESS_MIN_SCHEMA, ASSESS_SCHEMA, STEP_SCHEMA, UNDERSTAND_SCHEMA, assessLiteSchema, clipLengths, relaxForModel, validateAssess, validateAssessLite, validateAssessMin, validateStep, validateUnderstand } from '../server/research/agentic/contracts.v14.mjs';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';
import { buildReplayRequest } from '../server/research/agentic/replay.mjs';

const ids = AGENT_CRITERIA.grant;
const count = (schema, key) => JSON.stringify(schema).split(`"${key}"`).length - 1;
const lite = (extra = {}) => ({ ref: 'p1', page_type: 'call', about: 'x', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null }])), candidate: false, lead: null, ...extra });

test('P0.3 relaxForModel: quita solo maxLength (en todos los contratos), conserva enum, pattern, maxItems, required y $id, y no muta el original', () => {
  for (const schema of [assessLiteSchema(ids), ASSESS_SCHEMA, ASSESS_MIN_SCHEMA, UNDERSTAND_SCHEMA, STEP_SCHEMA]) {
    const before = JSON.stringify(schema); const relaxed = relaxForModel(schema);
    assert.equal(count(schema, 'maxLength') > 0, true); assert.equal(count(relaxed, 'maxLength'), 0);
    for (const key of ['enum', 'pattern', 'maxItems', 'required', 'additionalProperties']) assert.equal(count(relaxed, key), count(schema, key), key);
    assert.equal(relaxed.$id, schema.$id); assert.equal(JSON.stringify(schema), before, 'el original no cambia');
  }
  assert.deepEqual(relaxForModel({ type: 'object', properties: { maxLength: { type: 'string', maxLength: 5 } } }), { type: 'object', properties: { maxLength: { type: 'string' } } }, 'un campo llamado maxLength no se confunde con la restricción');
});

test('P0.3 clipLengths recorta solo textos que pasan su límite, en objetos, listas y criterios con claves libres', () => {
  const schema = { type: 'object', properties: { a: { type: 'string', maxLength: 3 }, list: { type: 'array', items: { type: 'string', maxLength: 2 } }, free: { type: 'object', additionalProperties: { type: 'object', properties: { q: { type: 'string', maxLength: 4 } } } }, n: { type: 'number' } } };
  const input = { a: 'abcdef', list: ['xyz', 'k'], free: { one: { q: '123456' } }, n: 7, extra: 'sin esquema' };
  const { value, clipped } = clipLengths(input, schema);
  assert.deepEqual(value, { a: 'abc', list: ['xy', 'k'], free: { one: { q: '1234' } }, n: 7, extra: 'sin esquema' }); assert.equal(clipped, 3); assert.equal(input.a, 'abcdef', 'no muta la entrada');
  assert.equal(clipLengths(null, schema).value, null);
});

test('P0.3 los validadores aceptan textos largos recortándolos, informan cuántos y siguen rechazando lo que no se recorta', () => {
  const quote = 'Letter of intent due November 4, 2026 '.repeat(20);
  const ok = validateAssessLite(lite({ about: 'A'.repeat(500), criteria: { ...lite().criteria, [ids[0]]: { verdict: 'yes', quote } } }), ids);
  assert.equal(ok.ok, true); assert.equal(ok.clipped, 2); assert.equal(ok.value.about.length, 200); assert.equal(ok.value.criteria[ids[0]].quote.length, 300);
  assert.equal(quote.startsWith(ok.value.criteria[ids[0]].quote), true, 'la cita recortada sigue siendo literal (prefijo)');
  assert.equal(validateAssessLite(lite({ dates: Array.from({ length: 7 }, () => ({ role: 'application_deadline', date: '2026-12-15', estimated: false, quote: 'x' })) }), ids).ok, false, 'maxItems no se recorta: se rechaza');
  assert.equal(validateAssessLite(lite({ page_type: 'invented' }), ids).ok, false);
  assert.equal(validateAssessLite(lite(), ids).clipped, undefined, 'sin recortes no hay campo clipped');
  assert.equal(validateAssessMin({ ref: 'p1', page_type: 'call', about: 'y'.repeat(900), candidate: true, deadline: null }).ok, true);
  assert.equal(validateUnderstand({ product_one_line: 'p'.repeat(900), who_pays: 'x', sector: 'x', neighbor_sectors: [], stage: 'x', geography: 'x', assumptions: [], doubts: [] }).ok, true);
  assert.equal(validateStep({ thought: 't'.repeat(900), assessment: null, notes: [], action: { tool: 'finish', args: {}, from_lead: null } }).ok, true);
  assert.equal(validateAssess({ ref: 'p1', page_type: 'call', about: 'z'.repeat(900), dates: [], date_missing_next: null, criteria: {}, candidate: false, lead: null }).ok, true);
});

test('P0.3 el banco puede enviar el esquema relajado y valida con el original', () => {
  const page = { case: 'RD-01', run: 'runs', objective: 'grant', today: '2026-10-19', brief: { company: 'IGC' }, url: 'https://example.org/c', title: 'Call', sha256: 'a'.repeat(64), text: 'Application deadline is December 15, 2026.' };
  const strict = buildReplayRequest(page, 'lite', { model: 'm' }); const relaxed = buildReplayRequest(page, 'lite-relaxed', { model: 'm' }); const fullRelaxed = buildReplayRequest(page, 'full-relaxed', { model: 'm' });
  assert.equal(count(strict.body.response_format.json_schema.schema, 'maxLength') > 0, true); assert.equal(count(relaxed.body.response_format.json_schema.schema, 'maxLength'), 0);
  assert.equal(count(fullRelaxed.body.response_format.json_schema.schema, 'maxLength'), 0); assert.equal(strict.body.messages[1].content, relaxed.body.messages[1].content, 'mismo prompt');
});

const understood = { product_one_line: 'x', who_pays: 'x', sector: 'x', neighbor_sectors: [], stage: 'x', geography: 'x', assumptions: [], doubts: [] };
const step = (tool, args) => ({ thought: '', assessment: null, notes: [], action: { tool, args, from_lead: null } });
const pageText = 'Official Program. Letter of intent due November 4, 2026. Funds dementia research.';
const toolsOf = () => { let n = 0; return { open: async () => { const ref = `p${++n}`; return { ref, url: `https://example.org/${ref}`, title: 'Program', chars: pageText.length, text: `<page_data>${pageText}</page_data>`, links: [] }; }, search: async () => ({ results: [] }), finish: async () => ({ ok: true }), usage: () => ({ opens: n }) }; };
const judgment = { page_type: 'call', dates: [], criteria: Object.fromEntries(ids.map((id) => [id, { verdict: 'unknown', quote: null, reason: '', compiler: 'agree' }])) };

async function runWith(env) {
  const seen = []; const events = []; const agentSteps = [step('open', { refs: ['s1.1'] })];
  const chat = async (req) => {
    seen.push({ name: req.name, relaxed: count(req.schema, 'maxLength') === 0 });
    if (req.name === 'understand') return { json: understood };
    if (req.name === 'agent') return { json: agentSteps.shift() || step('finish', { reason: 'done', finalists: ['p1'] }) };
    if (req.name === 'assess') return { json: lite({ ref: String(req.user.match(/Page ref: (\S+?)\./)[1]), about: 'A'.repeat(500), candidate: true }) };
    return { json: judgment };
  };
  const r = await runAgentObjective('grant', { company: 'X' }, { chat, tools: toolsOf(), trace: { events, event: (type, data) => events.push({ type, ...data }) }, today: '2026-10-19', parallel: true, secondJudge: 0, env: { ENGINE_AGENT_UNDERSTAND_MODE: 'blocking', ...env } });
  return { seen, events, r };
}

test('P0.3 el bucle envía el esquema sin maxLength por defecto, acepta la respuesta larga recortada y lo deja en la traza; ENGINE_AGENT_SCHEMA_RELAX=0 envía el original', async () => {
  const on = await runWith({});
  assert.equal(on.seen.length > 2 && on.seen.every((c) => c.relaxed), true, JSON.stringify(on.seen));
  assert.equal(on.r.audit.unread, 0, 'una about de 500 caracteres no invalida la lectura');
  const calls = on.events.filter((e) => e.type === 'model_call'); assert.equal(calls.length > 0 && calls.every((e) => e.schema_relaxed === true), true);
  const off = await runWith({ ENGINE_AGENT_SCHEMA_RELAX: '0' });
  assert.equal(off.seen.every((c) => c.relaxed === false), true, JSON.stringify(off.seen));
  assert.equal(off.events.filter((e) => e.type === 'model_call').every((e) => e.schema_relaxed === false), true);
});
