import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentObjective } from '../server/research/agentic/loop.mjs';
import { cleanQuery, validateCoverage, firstQuery } from '../server/research/agentic/discovery.mjs';
import { contactStage, orgDomain } from '../server/research/agentic/contacts.mjs';
import { AGENT_CRITERIA } from '../server/research/agentic/prompts.v14.mjs';

test('cleanQuery quita operadores y comillas, exige lenguaje natural', () => {
  assert.equal(cleanQuery('site:nih.gov "SBIR grants" Alzheimer AND diagnostics'), 'SBIR grants Alzheimer diagnostics');
  assert.equal(cleanQuery('grants'), ''); assert.equal(cleanQuery(''), '');
});
test('validateCoverage limpia, deduplica entre niveles y descarta niveles sin consultas', () => {
  const r = validateCoverage({ levels: [
    { level: 'national', why: 'x', queries: ['federal small business grants digital health', 'federal small business grants digital health', 'ab'] },
    { level: 'state', why: 'y', queries: ['site:md.gov state innovation grants for startups Maryland'] },
    { level: 'empty', why: 'z', queries: ['a'] }, { level: '', queries: ['should be dropped completely here'] }] });
  assert.equal(r.ok, true); assert.deepEqual(r.value.levels.map((l) => l.level), ['national', 'state']);
  assert.deepEqual(r.value.levels[0].queries, ['federal small business grants digital health']);
  assert.equal(r.value.levels[1].queries[0], 'state innovation grants for startups Maryland');
  assert.equal(validateCoverage({ levels: 'no' }).ok, false);
});
test('firstQuery usa solo campos del brief, sin nombres de financiadores', () => {
  const q = firstQuery({ brief: { state: 'Maryland', country: 'US', entityType: 'for_profit' }, understood: { product_one_line: 'Alzheimer risk software', geography: 'US' }, objective: 'grant', today: '2026-10-12' });
  assert.match(q, /grants open for applications Alzheimer risk software for-profit company Maryland US 2026/);
});
test('orgDomain: dominio registrable', () => {
  assert.equal(orgDomain('https://www.nia.nih.gov/research/sbir'), 'nih.gov'); assert.equal(orgDomain('https://seedfund.nsf.gov/topics/x'), 'nsf.gov');
  assert.equal(orgDomain('https://foo.bar.co.uk/x'), 'bar.co.uk'); assert.equal(orgDomain('nope'), null);
});

function apolloTools(extra = {}) {
  const calls = []; let credits = 0;
  return { calls, tools: { usage: () => ({ apollo_credits: credits }),
    apollo: async (args) => { calls.push(args); credits += 1;
      if (args.op === 'organization') return extra.noOrg ? { rows: [] } : { rows: [{ id: 'o1', name: 'Org' }], credits_estimated: 1 };
      return { rows: [{ id: 'p1', first_name: 'Ana', last_name_obfuscated: 'Pe***', title: 'Program Officer', organization: { name: 'Org' }, has_email: true }], credits_estimated: 1 }; } } };
}
test('contactStage llama a Apollo en código, una vez por dominio, y adjunta contactos', async () => {
  const { calls, tools } = apolloTools();
  const findings = [{ url: 'https://www.nia.nih.gov/a', eligible: 'yes', status: 'open' }, { url: 'https://grants.nih.gov/b', eligible: 'unclear', status: 'open' }, { url: 'https://x.org/c', eligible: 'no', status: 'open' }, { url: 'https://closed.org/d', eligible: 'yes', status: 'closed' }];
  const out = await contactStage({ findings, objective: 'grant', tools, env: { APOLLO_API_KEY: 'k', APOLLO_FOR_GRANTS: '1' }, configured: true });
  assert.deepEqual(calls.map((c) => `${c.op}:${c.domain}`), ['organization:nih.gov', 'people:nih.gov']);
  assert.equal(findings[0].contacts[0].name, 'Ana Pe***'); assert.equal(findings[1].contacts[0].title, 'Program Officer');
  assert.equal(findings[2].contacts, undefined); assert.equal(out.orgs, 1); assert.equal(out.people, 1); assert.equal(out.credits, 2);
});
test('contactStage respeta APOLLO_ENABLED=0, falta de clave y el tope de organizaciones', async () => {
  const a = apolloTools();
  assert.equal((await contactStage({ findings: [{ url: 'https://a.org/x' }], tools: a.tools, env: { APOLLO_ENABLED: '0' }, configured: true })).skipped, 'APOLLO_ENABLED=0');
  assert.equal((await contactStage({ findings: [{ url: 'https://a.org/x' }], tools: a.tools, env: {}, configured: false })).skipped, 'APOLLO_API_KEY missing'); assert.equal(a.calls.length, 0);
  const b = apolloTools(); const fs = ['a.org', 'b.org', 'c.org'].map((h) => ({ url: `https://${h}/x`, eligible: 'yes', status: 'open' }));
  const out = await contactStage({ findings: fs, tools: b.tools, env: { APOLLO_API_KEY: 'k', APOLLO_FOR_GRANTS: '1', ENGINE_AGENT_APOLLO_ORGS: '2' }, configured: true });
  assert.equal(out.orgs, 2); assert.equal(b.calls.filter((c) => c.op === 'organization').length, 2);
});
test('contactStage: organización no encontrada no gasta la búsqueda de personas', async () => {
  const { calls, tools } = apolloTools({ noOrg: true }); const f = [{ url: 'https://a.org/x', eligible: 'yes', status: 'open' }];
  await contactStage({ findings: f, tools, env: { APOLLO_API_KEY: 'k', APOLLO_FOR_GRANTS: '1' }, configured: true });
  assert.deepEqual(calls.map((c) => c.op), ['organization']); assert.deepEqual(f[0].contacts, []);
});

// --- bucle completo con descubrimiento y Apollo activados ---
const understood = { product_one_line: 'Alzheimer risk software', who_pays: 'health systems', sector: 'health', neighbor_sectors: [], stage: 'seed', geography: 'US', assumptions: [], doubts: [] };
const pageText = 'Official Program. Application deadline is December 15, 2026. Eligible for-profit companies in the United States. Funds Alzheimer research. This is a grant with no equity.';
const quoteOf = { deadline: 'Application deadline is December 15, 2026.', topic_fit: 'Funds Alzheimer research.', non_dilutive: 'This is a grant with no equity.', official: 'Official Program.' };
const criteria = Object.fromEntries(AGENT_CRITERIA.grant.map((id) => [id, { verdict: 'yes', quote: quoteOf[id] || 'Eligible for-profit companies in the United States.', reason: 'stated' }]));
const dates = [{ role: 'application_deadline', date: '2026-12-15', estimated: false, quote: 'Application deadline is December 15, 2026.' }];
const assessment = (ref) => ({ ref, page_type: 'call', about: 'Official Program', dates, date_missing_next: null, criteria, candidate: true, lead: null });
const judgment = { page_type: 'call', dates, criteria: Object.fromEntries(Object.entries(criteria).map(([id, c]) => [id, { ...c, compiler: 'agree' }])) };
const step = (tool, args) => ({ thought: 'next', assessment: null, notes: [], action: { tool, args, from_lead: null } });

test('el bucle: descubrimiento por niveles alimenta el primer paso y Apollo se llama tras el juez', async () => {
  const calls = []; const apolloCalls = []; let n = 0; const events = []; const agentUsers = []; const seen = [];
  const tools = {
    search: async (args) => { calls.push(args.query); return { results: [{ ref: `s${calls.length}.1`, url: `https://example.org/${calls.length}`, title: args.query, snippet: 'x' }] }; },
    open: async (args) => { const ref = `p${++n}`; return { ref, url: `https://www.nia.nih.gov/p${n}`, title: 'Program', chars: pageText.length, text: `<page_data>${pageText}</page_data>`, links: [] }; },
    note: async (a) => { events.push(['note', a]); return { ok: true }; }, ask_user: async () => ({ answered: false }), finish: async () => ({ ok: true }), entity_funding: async () => ({ rows: [] }), registry: async () => ({ rows: [] }),
    apollo: async (a) => { apolloCalls.push(a); return a.op === 'organization' ? { rows: [{ id: 'o' }] } : { rows: [{ id: 'p', first_name: 'Ana', title: 'Program Officer' }] }; },
    usage: () => ({ searches: calls.length, opens: n, apollo_credits: apolloCalls.length }),
  };
  const agentSteps = [step('open', { refs: ['s2.1'] }), step('finish', { reason: 'done', finalists: ['p1'] })];
  const chat = async (req) => { seen.push(req.name);
    if (req.name === 'understand') return { json: understood, model: 'f' };
    if (req.name === 'coverage') return { json: { levels: [
      { level: 'national agencies', why: 'for-profit R&D', queries: ['federal small business innovation grants digital health open now', 'federal grants for dementia risk prediction software'] },
      { level: 'state programs', why: 'brief names a state', queries: ['Maryland state technology commercialization grants for startups'] }] }, model: 'f' };
    if (req.name === 'agent') { agentUsers.push(req.user); return { json: agentSteps.shift(), model: 'f' }; }
    if (req.name === 'assess') return { json: assessment(String(req.user.match(/Page ref: (\S+?)\./)?.[1])), model: 'f' };
    return { json: judgment, model: 'f' }; };
  const result = await runAgentObjective('grant', { company: 'IGC', state: 'Maryland', country: 'US' }, { chat, tools, trace: { event: () => null }, today: '2026-10-12', parallel: true, secondJudge: 0, discovery: true, env: { APOLLO_API_KEY: 'k', APOLLO_FOR_GRANTS: '1', ENGINE_AGENT_STEPS: '6' } });
  assert.equal(seen.includes('coverage'), true);
  assert.equal(calls.length, 4, 'primera búsqueda + 3 consultas del plan');
  assert.match(agentUsers[0], /national agencies/); assert.match(agentUsers[0], /"level":"state programs"/, 'el primer paso ya ve resultados etiquetados por nivel');
  assert.match(agentUsers[0], /coverage/);
  assert.equal(events.some(([t, a]) => t === 'note' && a.discovery === 'coverage_plan'), true);
  assert.equal(result.findings.length, 1); assert.deepEqual(apolloCalls.map((c) => `${c.op}:${c.domain}`), ['organization:nih.gov', 'people:nih.gov']);
  assert.equal(result.findings[0].contacts[0].name, 'Ana'); assert.equal(result.audit.discovery.levels, 2); assert.equal(result.audit.contacts.orgs, 1);
});

test('sin ENGINE_DISCOVERY el bucle no llama al planificador de cobertura', async () => {
  const seen = []; const tools = { search: async () => ({ results: [] }), open: async () => ({}), note: async () => ({}), ask_user: async () => ({}), finish: async () => ({}), apollo: async () => ({ rows: [] }), entity_funding: async () => ({}), registry: async () => ({}), usage: () => ({}) };
  const chat = async (req) => { seen.push(req.name); if (req.name === 'understand') return { json: understood, model: 'f' }; return { json: step('finish', { reason: 'done', finalists: [] }), model: 'f' }; };
  await runAgentObjective('grant', { company: 'IGC' }, { chat, tools, trace: { event: () => null }, today: '2026-10-12', parallel: true, env: { ENGINE_AGENT_STEPS: '3' } });
  assert.equal(seen.includes('coverage'), false);
});

test('modo solo juez: abre las URLs dadas, no hace pasos del agente ni descubrimiento y juzga', async () => {
  const seen = []; const opened = []; let n = 0;
  const tools = { refs: new Map(), search: async () => { throw new Error('no search'); },
    open: async (a) => { opened.push(tools.refs.get(a.ref).url); const ref = `p${++n}`; return { ref, url: tools.refs.get(a.ref).url, title: 'Program', chars: pageText.length, text: `<page_data>${pageText}</page_data>`, links: [] }; },
    note: async () => ({}), ask_user: async () => ({}), finish: async () => ({}), apollo: async () => ({ rows: [] }), entity_funding: async () => ({}), registry: async () => ({}), usage: () => ({ searches: 0, opens: n }) };
  const chat = async (req) => { seen.push(req.name);
    if (req.name === 'understand') return { json: understood, model: 'f' };
    if (req.name === 'assess') return { json: assessment(String(req.user.match(/Page ref: (\S+?)\./)?.[1])), model: 'f' };
    if (req.name === 'agent' || req.name === 'coverage') throw new Error('el agente no debe correr');
    return { json: judgment, model: 'f' }; };
  const r = await runAgentObjective('grant', { company: 'IGC' }, { chat, tools, trace: { event: () => null }, today: '2026-10-12', parallel: true, secondJudge: 0, discovery: true, seedUrls: [{ url: 'https://a.org/1' }, 'https://b.org/2'], env: { APOLLO_ENABLED: '0' } });
  assert.deepEqual(opened, ['https://a.org/1', 'https://b.org/2']); assert.equal(seen.includes('agent'), false); assert.equal(seen.includes('coverage'), false);
  assert.equal(r.findings.length, 2); assert.equal(r.audit.agent.stop_reason, 'seeded');
});

test('modo solo juez: una convocatoria que el compilador rechaza (candidate=false, un "no" citado) llega igual al juez', async () => {
  let judged = 0; const tools = { refs: new Map(), open: async (a) => ({ ref: 'p1', url: tools.refs.get(a.ref).url, title: 'RFA', chars: pageText.length, text: `<page_data>${pageText}</page_data>`, links: [] }),
    note: async () => ({}), ask_user: async () => ({}), finish: async () => ({}), apollo: async () => ({ rows: [] }), usage: () => ({ opens: 1 }) };
  const rejected = { ...assessment('p1'), candidate: false, criteria: { ...criteria, non_dilutive: { verdict: 'no', quote: 'This is a grant with no equity.', reason: 'x' } } };
  const chat = async (req) => { if (req.name === 'understand') return { json: understood, model: 'f' }; if (req.name === 'assess') return { json: rejected, model: 'f' }; judged++; return { json: judgment, model: 'f' }; };
  const r = await runAgentObjective('grant', { company: 'IGC' }, { chat, tools, trace: { event: () => null }, today: '2026-10-12', parallel: true, secondJudge: 0, seedUrls: ['https://a.org/rfa'], env: { APOLLO_ENABLED: '0' } });
  assert.equal(judged >= 1, true); assert.equal(r.findings.length, 1);
});
