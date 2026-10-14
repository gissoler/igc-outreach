import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gptrPrompt, findingsFromVerified, runGptr, urlsFromRun, GPTR_DIR } from '../server/research/gptr.mjs';
import { runObjective } from '../server/research/engine.mjs';

const ok = (date, role = 'application_deadline') => ({ role, date, quote: `Due ${date}`, quote_ok: true, date_ok: true });
const rows = [
  { url: 'https://seedfund.nsf.gov/x', verdict: 'verificada', blockers: [], data: { name: 'Seed Fund', funder: 'NSF', page_type: 'call', dates: [ok('2026-11-04')], eligibility: { for_profit_ok: 'yes', quote: 'Small businesses' }, amount: { text: '$275,000' } } },
  { url: 'https://x.org/dir', verdict: 'a_revisar', blockers: ['sin cita'], data: { name: 'Dir', page_type: 'directory', source_kind: 'aggregator', dates: [] } },
  { url: 'https://y.org/prog', verdict: 'a_revisar', blockers: ['elegibilidad sin cita'], data: { name: 'Prog', page_type: 'program_page', dates: [ok('2027-01-05')], eligibility: { for_profit_ok: 'unknown' } } },
  { url: 'https://old.org/c', verdict: 'a_revisar', blockers: [], data: { name: 'Old', page_type: 'call', dates: [ok('2025-01-05')] } },
  { url: 'https://bad.org/z', verdict: 'rechazada', blockers: [], data: {} }, { url: 'https://nope.org', verdict: 'inalcanzable', blockers: ['x'] },
];
test('el prompt sale solo del brief, sin financiadores nombrados', () => {
  const p = gptrPrompt({ brief: { company: 'IGC', state: 'Maryland', sector: 'health' }, today: '2026-10-14' });
  assert.match(p, /Today is 2026-10-14/); assert.match(p, /state: Maryland/); assert.doesNotMatch(p, /NSF|NIH|TEDCO|SBIR/);
});
test('hallazgos: verificada → apply/main; a revisar de convocatoria → watch; listas, cerradas, rechazadas e inalcanzables fuera', () => {
  const f = findingsFromVerified(rows, { today: '2026-10-14' });
  assert.deepEqual(f.map((x) => x.url), ['https://seedfund.nsf.gov/x', 'https://y.org/prog', 'https://old.org/c']);
  assert.equal(f[0].verdict, 'apply'); assert.equal(f[0].tier, 'main'); assert.equal(f[0].deadline, '2026-11-04'); assert.equal(f[0].daysLeft, 21); assert.equal(f[0].eligible, 'yes');
  assert.equal(f[1].verdict, 'watch'); assert.equal(f[1].deadline, '2027-01-05'); assert.equal(f[2].deadline, null); assert.equal(f[2].status, 'unknown');
});
test('runGptr: usa el proceso, lee el JSON verificado y llama a Apollo después', async () => {
  mkdirSync(join(GPTR_DIR, 'outputs'), { recursive: true }); const rel = 'outputs/fixture-test.json'; writeFileSync(join(GPTR_DIR, rel), JSON.stringify(rows));
  const apollo = []; const tools = { usage: () => ({ apollo_credits: apollo.length }), apollo: async (a) => { apollo.push(a); return a.op === 'organization' ? { rows: [{ id: 'o' }] } : { rows: [{ id: 'p', first_name: 'Ana', title: 'Program Officer' }] }; } };
  const r = await runGptr('grant', { company: 'IGC' }, { env: { APOLLO_API_KEY: 'k', GPTR_JUDGE: 'verify' }, today: '2026-10-14', tools, gptrRunner: async () => ({ json: rel }) });
  assert.equal(r.findings.length, 3); assert.equal(r.audit.gptr.verified, 1); assert.equal(r.findings[0].contacts[0].name, 'Ana'); assert.equal(apollo[0].domain, 'nsf.gov');
});
test('runGptr: si el proceso falla devuelve cero hallazgos con el error, no revienta', async () => {
  const r = await runGptr('grant', {}, { env: { GPTR_JUDGE: 'verify' }, today: '2026-10-14', tools: { usage: () => ({}), apollo: async () => ({ rows: [] }) }, gptrRunner: async () => { throw new Error('GPTR_FAILED x'); } });
  assert.equal(r.findings.length, 0); assert.match(r.audit.gptr.error, /GPTR_FAILED/);
});
test('engine: ENGINE_GPTR=1 usa gptr y no el agente; seedOnly no', async () => {
  let g = 0; let a = 0; const env = { ENGINE_GPTR: '1', GPTR_JUDGE: 'verify', ENGINE_AGENT: '1', ENGINE_AGENT_LLM_URL: 'http://x/v1', ENGINE_AGENT_LLM_MODEL: 'm' };
  const gptrRunner = async () => { g++; throw new Error('GPTR_FAILED'); };
  const r = await runObjective('grant', { fundingTypes: ['grant'] }, { env, today: '2026-10-14', gptrRunner, agentRunner: async () => { a++; return {}; }, tools: { usage: () => ({}), apollo: async () => ({ rows: [] }) } });
  assert.equal(g, 1); assert.equal(a, 0); assert.equal(r.findings.length, 0);
});

test('urlsFromRun: informe primero, log después, sin duplicados ni imágenes, con tope', () => {
  const u = urlsFromRun({ report: 'ver (https://a.org/x). y https://b.org/y#frag y https://a.org/x/', log: 'Added source url to research: https://c.org/z\nAdded source url to research: https://a.org/x\nAdded source url to research: https://d.org/i.png', max: 3 });
  assert.deepEqual(u.map((x) => x.url), ['https://a.org/x', 'https://b.org/y', 'https://c.org/z']); assert.deepEqual(u.map((x) => x.in_report), [true, true, false]);
  const r = urlsFromRun({ log: ['https://mgaleg.maryland.gov/2026RS/bills/hb/hb1.pdf', 'https://www.tedcomd.com/funding/rfa-2026', 'https://blog.x.com/news/post', 'https://nih.gov/old/2019/program'].map((x) => `Added source url to research: ${x}`).join('\n'), today: '2026-10-14' });
  assert.equal(r[0].url, 'https://www.tedcomd.com/funding/rfa-2026'); assert.equal(r.at(-1).url, 'https://blog.x.com/news/post');
});
test('runGptr (juez de Node): pasa las URLs al juez como seedUrls y anota la búsqueda; si se corta por tiempo usa el log', async () => {
  let seen = null;
  const r = await runGptr('grant', { company: 'IGC' }, { env: {}, today: '2026-10-14', gptrRunner: async () => ({ timedOut: true }), logText: 'Added source url to research: https://c.org/z', reportText: '',
    judgeRunner: async (obj, brief, o) => { seen = o; return { findings: [{ url: 'https://c.org/z' }], audit: { objective: obj } }; } });
  assert.deepEqual(seen.seedUrls, [{ url: 'https://c.org/z', in_report: false }]); assert.equal(seen.parallel, true);
  assert.equal(r.audit.gptr.judge, 'node'); assert.match(r.audit.gptr.error, /GPTR_TIMEOUT/);
});
test('runGptr (juez de Node): sin URLs devuelve cero hallazgos y el motivo', async () => {
  const r = await runGptr('grant', {}, { env: {}, today: '2026-10-14', gptrRunner: async () => ({}), logText: '', reportText: '', judgeRunner: async () => { throw new Error('no debe llamarse'); } });
  assert.equal(r.findings.length, 0); assert.equal(r.audit.gptr.error, 'GPTR_NO_URLS');
});

test('el prompt solo invita a financiadores de otros países si el brief no fija geografía', () => {
  assert.doesNotMatch(gptrPrompt({ brief: { country: 'US', state: 'Maryland' }, today: '2026-10-14' }), /outside the applicant's country/);
  assert.match(gptrPrompt({ brief: { company: 'X', geography: 'GLOBAL' }, today: '2026-10-14' }), /outside the applicant's country/);
});
