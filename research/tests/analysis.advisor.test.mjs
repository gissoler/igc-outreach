// Agente asesor: reencuadre, conectores, lista corta, estados, updates sin datos inventados, rutas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJob, classifyLead, composeUpdate, validateUpdate, unsupportedNumbers, llmMemo, polishUpdate, relevantEvidence, composeIntro } from '../server/analysis/advisor.mjs';
import { validateOutreach } from '../server/analysis/outreach.mjs';
import { createStore } from '../server/research/store.mjs';
import { createApp } from '../server/index.mjs';

const brief = { name: 'Gisel', company: 'IGC Pharma', organization: 'IGC Pharma', venture: 'Mentiva', industry: 'Wellbeing Mental Health', product: 'App de estrés', stage: 'prototype', round: 'pre-seed', amount: 1500000, fundingTypes: ['investment'], constraints: 'No diagnóstico ni terapia', oneLiner: 'Nombra el ruido' };
const hop = (from, to, strength, relation = 'colega') => ({ from, to, strength, relation, url: 'https://x.example/p' });
const job = {
  id: 'j1', userId: null, brief,
  leads: [
    { key: 'ir', person: 'Andres Sanchez', role: 'Investor Relations', org: 'IGC Pharma', fundingType: 'investment', bucket: 'top', rank: 1, score: 71, paths: [{ strength: 0.5, hypothesis: true, hops: [hop('Gisel', 'Andres Sanchez', 0.5)] }], evidence: [] },
    { key: 'cs', person: 'Camillo S', role: 'Founder', org: 'sandstorm.vc', fundingType: 'investment', bucket: 'top', rank: 2, score: 63, paths: [{ strength: 0.2, hypothesis: true, hops: [hop('Gisel', 'Andres Sanchez', 0.5), hop('Andres Sanchez', 'Camillo S', 0.6)] }], evidence: [{ url: 'https://s.example', quote: 'We back mental health founders early.', verified: true }] },
    { key: 'ov', person: 'Lucas R', role: 'Founder', org: 'OpenVC', fundingType: 'investment', bucket: 'top', rank: 3, score: 58, evidence: [] },
    { key: 'gv', person: 'Ben R', role: null, org: 'GV', fundingType: 'investment', bucket: 'top', rank: 4, score: 58, evidence: [] },
    { key: 'hl', person: 'Erin S', role: 'Head of Investments', org: 'Hopelab', fundingType: 'investment', bucket: 'top', rank: 5, score: 58, evidence: [{ url: 'https://h.example', quote: 'rom our portfolio and more', verified: true }] },
    { key: 'nih', person: null, org: 'National Institutes of Health', kind: 'opportunity', fundingType: 'grant', bucket: 'radar', score: 20 },
  ],
};

test('reencuadre: conector interno, plataforma, decisor, por confirmar, convocatoria', () => {
  const c = (k) => classifyLead(job.leads.find((l) => l.key === k), brief).cls;
  assert.equal(c('ir'), 'conector_interno');
  assert.equal(c('ov'), 'plataforma');
  assert.equal(c('cs'), 'decisor', 'fundador de un .vc es decisor');
  assert.equal(c('hl'), 'decisor');
  assert.equal(c('gv'), 'decisor_por_confirmar');
  assert.equal(c('nih'), 'convocatoria');
});

test('análisis: lista corta solo con decisores, conector con palanca, hallazgos y plan', () => {
  const a = analyzeJob(job, { now: new Date('2026-09-28'), network: [{ name: 'X', org: 'Snowflake', role: 'AE', source: 'csv' }] });
  assert.deepEqual(a.list.map((r) => r.leadKey).sort(), ['cs', 'gv', 'hl']);
  assert.equal(a.list[0].leadKey, 'cs', 'el warm path sube la prioridad');
  assert.equal(a.connectors[0].name, 'Andres Sanchez');
  assert.equal(a.connectors[0].targets[0].leadKey, 'cs');
  assert.match(a.findings[0].title, /#1 recommendation isn't an investor/);
  assert.ok(a.findings.some((f) => /platform/.test(f.title)));
  assert.ok(a.findings.some((f) => /Borrowed network/.test(f.title)), 'el IR interno es la red prestada');
  assert.ok(a.findings.some((f) => /type you didn.t ask for/.test(f.title)));
  assert.ok(a.findings.some((f) => /No updates logged/.test(f.title)));
  assert.equal(a.list.find((r) => r.leadKey === 'cs').move.kind, 'confirmar_conector', 'camino hipótesis: confirmar antes de pedir');
  assert.equal(a.list.find((r) => r.leadKey === 'hl').move.kind, 'consejo_frio');
  assert.equal(a.readiness.ready, false);
  assert.ok(a.plan.some((s) => /Andres Sanchez/.test(s.what)));
  assert.equal(a.memo.method, 'reglas');
});

test('estados de relación: updates convierten el punto en línea', () => {
  const ev = (o) => validateOutreach({ fundName: 'Hopelab', person: 'Erin S', channel: 'update', ...o }, { now: '2026-09-28T00:00:00Z' });
  const events = [ev({ sentAt: '2026-01-10' }), ev({ sentAt: '2026-05-10' })];
  const a = analyzeJob(job, { events, now: new Date('2026-09-28') });
  const hl = a.list.find((r) => r.leadKey === 'hl');
  assert.equal(hl.state.updates, 2);
  assert.equal(hl.state.stage, 'calentando');
  assert.equal(hl.state.nextDue, '2026-09-07');
  assert.equal(hl.move.kind, 'roadshow');
  const declined = analyzeJob(job, { events: [ev({ sentAt: '2026-09-01', outcome: 'negativa', channel: 'pedido_consejo' })], now: new Date('2026-09-28') });
  assert.equal(declined.list.find((r) => r.leadKey === 'hl').move.kind, 'pausa');
});

test('update: solo hechos del formulario; los no públicos no salen; pedido según etapa', () => {
  assert.throws(() => validateUpdate({ period: '2026-10' }), /at least/);
  assert.throws(() => validateUpdate({ period: 'oct', highlights: ['x'] }), /period/i);
  const u = validateUpdate({ period: '2026-10', metrics: [{ name: 'Usuarios piloto', value: '40', previous: '12' }, { name: 'Secreto', value: '99', public: false }], highlights: ['Piloto con 3 equipos'], raisingInMonths: 6 });
  const a = analyzeJob(job, { now: new Date('2026-09-28'), updates: [u] });
  const target = a.list.find((r) => r.leadKey === 'cs');
  const d = composeUpdate(u, { type: 'target', ...target }, { brief });
  assert.match(d.body, /Usuarios piloto: 40 \(prev\.: 12\)/);
  assert.doesNotMatch(d.body, /Secreto|99/);
  assert.equal(d.withheld.length, 1);
  assert.match(d.body, /about 6 months/);
  assert.match(d.body, /We back mental health founders early/);
  assert.ok(d.warnings.some((w) => /Reg FD/.test(w)));
  const conn = composeUpdate(u, { type: 'connector', ...a.connectors[0], person: a.connectors[0].name }, { brief });
  assert.match(conn.body, /would you introduce me to Camillo S \(sandstorm\.vc\)/);
  assert.ok(a.readiness.checks.find((c) => /rising metric/.test(c.label)).ok);
});

test('evidencia: no se usa texto cortado ni fuera de tema', () => {
  assert.equal(relevantEvidence([{ url: 'u', quote: 'rom our portfolio and more' }], brief), null);
  assert.equal(relevantEvidence([{ url: 'u', quote: 'We invest in fintech only.' }], brief), null);
  assert.ok(relevantEvidence([{ url: 'u', quote: 'Mental health is our focus.' }], brief));
  const intro = composeIntro({ connector: { name: 'Andres Sanchez' }, target: { person: 'Camillo S', org: 'sandstorm.vc', evidence: [] }, brief });
  assert.match(intro.ask, /^Hi Andres/);
  assert.ok(intro.rules.some((r) => /double opt-in/i.test(r)));
});

test('verificación de la flota: números nuevos o refs inexistentes se descartan', async () => {
  assert.deepEqual(unsupportedNumbers('Subimos a 40 usuarios y 300 clientes', 'Usuarios: 40'), ['300']);
  const env = { VLLM_CHAT_URL: 'http://fleet/v1', VLLM_CHAT_MODEL: 'qwen-30b' };
  const a = analyzeJob(job, { now: new Date('2026-09-28') });
  const reply = (content) => async () => new Response(JSON.stringify({ model: 'qwen-30b', choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  const memo = await llmMemo(a, { env, fetcher: reply({ headline: 'Empieza por el conector.', paragraphs: [{ text: 'Andres abre la puerta a Camillo.', refs: ['F1'] }, { text: 'Tienes 500 inversionistas.', refs: ['F1'] }, { text: 'Otro.', refs: ['F99'] }] }) });
  assert.equal(memo.method, 'fleet (qwen-30b)');
  assert.equal(memo.paragraphs.length, 1);
  assert.equal(memo.dropped, 2);
  const u = validateUpdate({ period: '2026-10', metrics: [{ name: 'Usuarios', value: '40' }] });
  const draft = composeUpdate(u, { type: 'target', person: 'Erin S', org: 'Hopelab', state: { stage: 'en_lista' } }, { brief });
  const bad = await polishUpdate(draft, { env, fetcher: reply({ subject: 'Mentiva', body: 'Tenemos 40 usuarios y 12 clientes pagos.' }) });
  assert.equal(bad.method, 'plantilla');
  assert.match(bad.note, /12/);
  const ok = await polishUpdate(draft, { env, fetcher: reply({ subject: 'Mentiva · octubre', body: 'Hola Erin, ya son 40 usuarios.' }) });
  assert.equal(ok.method, 'fleet (qwen-30b)');
});

test('API del asesor: análisis, update, borrador, registro de envío y revisión', async () => {
  const store = createStore(':memory:');
  store.save(job);
  const { server } = createApp({ store, env: { FUND_VEHICLES_PATH: '/nonexistent.json', EVAL_RESULTS_DIR: '/nonexistent' }, browser: null });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/research/advisor`;
  const call = (method, path, body) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    const a = await (await call('GET', '?jobId=j1')).json();
    assert.equal(a.list.length, 3);
    assert.equal((await call('POST', '/compose', { jobId: 'j1', leadKey: 'cs' })).status, 400, 'sin update no hay borrador');
    assert.equal((await call('POST', '/updates', { period: 'x' })).status, 400);
    const u = await (await call('POST', '/updates', { period: '2026-10', highlights: ['Piloto con 3 equipos'] })).json();
    const d = await (await call('POST', '/compose', { jobId: 'j1', leadKey: 'cs', updateId: u.id })).json();
    assert.match(d.body, /Piloto con 3 equipos/);
    assert.equal(d.generationId, null, 'sin flota no hay generación que etiquetar');
    const intro = await (await call('POST', '/intro', { jobId: 'j1', connectorKey: a.connectors[0].key })).json();
    assert.match(intro.forwardable, /Piloto con 3 equipos/);
    assert.equal((await call('POST', '/sent', { jobId: 'j1', leadKey: 'cs', channel: 'update', sentAt: '2026-10-01' })).status, 201);
    const after = await (await call('GET', '?jobId=j1')).json();
    assert.equal(after.list.find((r) => r.leadKey === 'cs').state.stage, 'en_lista');
    assert.equal((await call('POST', '/review', { generationId: 'nope', label: 'aprobado' })).status, 404);
    const ts = await (await call('GET', '/trainset')).json();
    assert.equal(ts.total, 0);
  } finally { server.close(); }
});
