// Agentes de la flota: bucle con herramientas, ficha verificada, roadmap con crítica, orquestador y rutas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Notebook, checkClaim } from '../server/analysis/agent/evidence.mjs';
import { focusText, createTools } from '../server/analysis/agent/tools.mjs';
import { analyzeContact, verifyDossier, seedNotebook } from '../server/analysis/agent/analyst.mjs';
import { verifyRoadmap, strategyPack } from '../server/analysis/agent/strategist.mjs';
import { runDeep, contactsFor } from '../server/analysis/agent/deepRun.mjs';
import { analyzeJob, PLAYBOOK } from '../server/analysis/advisor.mjs';
import { createStore } from '../server/research/store.mjs';
import { createApp } from '../server/index.mjs';

const brief = { name: 'Gisel', company: 'IGC Pharma', organization: 'IGC Pharma', venture: 'Mentiva', industry: 'Wellbeing Mental Health', product: 'App de estrés', round: 'pre-seed', amount: 1500000, fundingTypes: ['investment'] };
const hop = (from, to, strength, relation) => ({ from, to, strength, relation, url: 'https://x.example/p' });
const job = { id: 'j1', userId: null, brief, leads: [
  { key: 'ir', person: 'Andres Sanchez', role: 'Investor Relations', org: 'IGC Pharma', fundingType: 'investment', bucket: 'top', rank: 1, score: 71, paths: [{ strength: 0.5, hypothesis: true, hops: [hop('Gisel', 'Andres Sanchez', 0.5, 'colega')] }], evidence: [{ url: 'https://n.example', quote: 'Andres Sanchez, Investor Relations, IGC Pharma', verified: true }] },
  { key: 'hl', person: 'Erin S', role: 'Head of Investments', org: 'Hopelab', fundingType: 'investment', bucket: 'top', rank: 2, score: 58, paths: [{ strength: 0.2, hypothesis: true, hops: [hop('Gisel', 'Andres Sanchez', 0.5, 'colega'), hop('Andres Sanchez', 'Erin S', 0.4, 'aparecen en la misma página')] }], evidence: [{ url: 'https://h.example', quote: 'Hopelab invests in youth mental health. Erin S leads investments.', verified: true }] },
] };
const net = [{ name: 'Andres Sanchez', org: 'IGC Pharma, Inc.', role: 'Investor Relations', source: 'csv', connectedOn: '1 Sep 2026' }];

/** Flota falsa: responde según el nombre del esquema pedido. */
function fakeFleet({ dossier, roadmap, critic, steps = ['network', 'finish'] } = {}) {
  const calls = [];
  let step = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    const name = body.response_format?.json_schema?.name;
    calls.push({ url, name, user: body.messages[1].content });
    let content;
    if (name === 'paso') { const a = steps[step++ % steps.length]; content = { thought: 'revisar red', action: a, args: a === 'network' ? { name: 'Andres' } : {} }; }
    else if (name === 'ficha') content = dossier;
    else if (name === 'roadmap') content = roadmap;
    else if (name === 'critica') content = critic;
    return new Response(JSON.stringify({ model: 'qwen-30b', choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  };
  return { fetcher, calls };
}
const DOSSIER = {
  summary: 'Erin dirige inversiones en Hopelab, foco en salud mental juvenil.',
  role: { kind: 'decisor', title: 'Head of Investments', evidence: ['E1'] },
  current_focus: [{ text: 'Invierte en salud mental juvenil', evidence: ['E1'] }, { text: 'Hizo 14 inversiones en 2026', evidence: ['E1'] }, { text: 'Lidera rondas seed', evidence: ['E99'] }],
  fit: { verdict: 'alto', reasons: [{ text: 'Tesis de salud mental coincide con Mentiva', evidence: ['E1'] }] },
  warm_paths: [{ via: 'Andres Sanchez', relationship: 'solo_mencion', strength: 0.8, would_introduce: 'incierto', reasoning: 'Solo aparecen en la misma página', evidence: ['E3'] }, { via: 'Alguien Inventado', relationship: 'trabajo_directo', strength: 0.9, would_introduce: 'probable', reasoning: 'x', evidence: [] }],
  best_route: { type: 'pedido_de_consejo', via: '', why: 'El camino es débil' },
  common_ground: [{ text: 'Ambos trabajan salud mental', evidence: ['E1'] }],
  ask: { text: '¿Qué te gustaría ver antes de hablar de inversión?', why: 'Construir relación' },
  timing: { when: 'Tras el primer update', why: 'Mostrar progreso' },
  risks: ['Hopelab puede enfocarse en jóvenes, no adultos'], open_questions: ['¿Invierte en pre-seed?'], confidence: 'media',
};
const ROADMAP = {
  headline: 'Construir relación con 2 decisores antes de pedir',
  diagnosis: [{ text: 'La red directa no llega a fondos', refs: ['D1'] }, { text: 'Tienes 500 contactos en fondos', refs: ['D1'] }, { text: 'Sin refs', refs: ['X9'] }],
  thesis: 'Usar a Andres como puente y updates para calentar a Erin.',
  phases: [{ name: 'Fase 1', window: 'semanas 1–4', goal: 'Confirmar caminos', exit_criteria: ['Andres acepta presentar'], actions: [{ who: 'Andres Sanchez', what: 'Pedir lista de inversionistas de IGC en salud digital', via: '', why: 'Red prestada', refs: ['D1', 'P5'] }, { who: 'Pedro Pérez', what: 'Pedir intro', via: 'nadie', why: 'x', refs: ['D2'] }] }],
  first_week: [{ who: 'Erin S', what: 'Pedido de consejo', via: 'Andres Sanchez', why: 'Camino débil', refs: ['D2'] }],
  update_plan: { cadence_days: 120, themes: [{ text: 'Avances del piloto', refs: ['C1'] }] },
  do_not: [{ text: 'No pedir dinero a Erin todavía', refs: ['D2'] }], risks: [{ text: 'Camino hipotético', refs: ['D2'] }],
};

test('libreta: ids citables y verificación de cifras', () => {
  const nb = new Notebook();
  const id = nb.add({ source: 'web', url: 'u', text: 'Hopelab invested $2M in 3 startups' });
  assert.equal(nb.add({ source: 'web', url: 'u', text: 'Hopelab invested $2M in 3 startups' }), id, 'deduplica');
  assert.ok(checkClaim({ text: 'Invirtió 2M en 3 startups', evidence: [id] }, nb));
  assert.equal(checkClaim({ text: 'Invirtió 5M', evidence: [id] }, nb), null);
  assert.equal(checkClaim({ text: 'Invirtió', evidence: ['E9'] }, nb), null);
  assert.match(focusText('a '.repeat(500) + 'Erin S leads investments' + ' b'.repeat(500), ['Erin'], { window: 60 }), /Erin S leads/);
});

test('ficha: se descartan afirmaciones sin evidencia, cifras inventadas y caminos sin respaldo', () => {
  const { nb, facts } = seedNotebook({ ...job.leads[1], mode: 'target' }, { brief });
  const d = verifyDossier(DOSSIER, nb, facts, { ...job.leads[1] });
  assert.equal(d.current_focus.length, 1, '"14 inversiones" (cifra inventada) y E99 fuera');
  assert.equal(d.warm_paths.length, 1);
  assert.equal(d.warm_paths[0].strength, 0.3, 'solo mención no puede ser un camino fuerte');
  assert.equal(d.role.kind, 'decisor');
  assert.equal(d.verification.dropped, 3);
});

test('analista: bucle con herramientas y ficha final (flota simulada)', async () => {
  const store = createStore(':memory:');
  const { fetcher, calls } = fakeFleet({ dossier: DOSSIER });
  const env = { VLLM_CHAT_URL: 'http://fleet/v1', VLLM_CHAT_MODEL: 'qwen-30b' };
  const r = await analyzeContact({ ...job.leads[1], leadKey: 'hl', mode: 'target' }, { brief, store, userId: null, network: net, role: 'chat' }, { env, fetcher, maxSteps: 4 });
  assert.deepEqual(calls.map((c) => c.name), ['paso', 'paso', 'ficha']);
  assert.equal(r.trace[0].action, 'network');
  assert.ok(r.evidence.some((e) => /Connections\.csv/.test(e.source)), 'la herramienta de red agregó evidencia');
  assert.match(calls[2].user, /EVIDENCE/);
  assert.equal(r.dossier.fit.verdict, 'alto');
});

test('roadmap: refs y personas verificadas', () => {
  const pack = strategyPack({ dossiers: [{ person: 'Andres Sanchez', org: 'IGC Pharma', dossier: { ...DOSSIER, role: { kind: 'conector', title: 'IR', evidence: [] }, warm_paths: [] } }, { person: 'Erin S', org: 'Hopelab', dossier: { ...DOSSIER, warm_paths: [{ via: 'Andres Sanchez', relationship: 'solo_mencion', strength: 0.3, would_introduce: 'incierto', reasoning: '', evidence: [] }] } }], brief, update: null, playbook: PLAYBOOK });
  const r = verifyRoadmap(ROADMAP, pack, brief);
  assert.equal(r.diagnosis.length, 1, 'cifra inventada y ref inexistente fuera');
  assert.equal(r.phases[0].actions.length, 1, 'Pedro Pérez no está en las fichas');
  assert.equal(r.first_week.length, 1);
  assert.equal(r.verification.dropped, 3);
});

test('orquestador: contactos, fichas, juicios de relación, roadmap con crítica y reutilización', async () => {
  const store = createStore(':memory:');
  const rules = analyzeJob(job, { network: net });
  const contacts = contactsFor(job, rules);
  assert.deepEqual(contacts.map((c) => [c.person, c.mode]), [['Erin S', 'target'], ['Andres Sanchez', 'connector']]);
  const env = { VLLM_CHAT_URL: 'http://fleet/v1', VLLM_CHAT_MODEL: 'qwen-30b' };
  const { fetcher, calls } = fakeFleet({ dossier: DOSSIER, roadmap: ROADMAP, critic: { verdict: 'corregir', issues: [{ severity: 'alta', issue: 'Pedro Pérez no está', fix: 'quitarlo', refs: ['D1'] }] } });
  const saved = [];
  const run = await runDeep({ job, store, userId: null, network: net, update: null, env, fetcher, save: (r) => saved.push(r.status), concurrency: 2, maxSteps: 3 });
  assert.equal(run.status, 'done');
  assert.equal(run.dossiers.length, 2);
  assert.equal(run.revised, true, 'la crítica con severidad alta fuerza una revisión');
  assert.equal(calls.filter((c) => c.name === 'roadmap').length, 2);
  assert.ok(run.roadmap.phases.length);
  assert.ok(store.analysis.edgeJudgments(null).length >= 1);
  assert.ok(store.analysis.generations().some((g) => g.kind === 'dossier'));
  const again = await runDeep({ job, store, userId: null, network: net, update: null, env, fetcher, concurrency: 2, maxSteps: 3 });
  assert.ok(again.dossiers.every((d) => d.cached), 'fichas frescas se reutilizan');
});

test('API del análisis profundo', async () => {
  const store = createStore(':memory:');
  store.save(job);
  const { fetcher } = fakeFleet({ dossier: DOSSIER, roadmap: ROADMAP, critic: { verdict: 'sólido', issues: [] } });
  const noFleet = createApp({ store, env: { FUND_VEHICLES_PATH: '/x', EVAL_RESULTS_DIR: '/x' }, browser: null });
  await new Promise((r) => noFleet.server.listen(0, '127.0.0.1', r));
  assert.equal((await fetch(`http://127.0.0.1:${noFleet.server.address().port}/api/research/advisor/deep`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: 'j1' }) })).status, 409);
  noFleet.server.close();
  const { server } = createApp({ store, env: { FUND_VEHICLES_PATH: '/x', EVAL_RESULTS_DIR: '/x', VLLM_CHAT_URL: 'http://fleet/v1', VLLM_CHAT_MODEL: 'qwen-30b' }, browser: null, modelFetch: fetcher });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/research/advisor`;
  const call = (m, p, b) => fetch(url + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  try {
    const { runId } = await (await call('POST', '/deep', { jobId: 'j1', maxSteps: 2 })).json();
    assert.ok(runId);
    let st;
    for (let i = 0; i < 50; i++) { st = await (await call('GET', `/deep/${runId}`)).json(); if (!st.running && st.run.status !== 'running') break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(st.run.status, 'done');
    assert.equal((await (await call('GET', '/deep?jobId=j1')).json()).run.id, runId);
    assert.equal((await call('POST', '/dossier/feedback', { key: 'hl', verdict: 'util' })).status, 200);
    const edges = (await (await call('GET', '/edges')).json()).edges;
    assert.equal((await call('POST', '/edge/label', { id: edges[0].id, strength: 0.1, would_introduce: 'improbable' })).status, 200);
  } finally { server.close(); }
});

test('herramientas: con reranker configurado, person_voice y fund_deals priorizan por relevancia real', async () => {
  const chunksByPerson = { 'erin s': [
    { text: 'Erin habla de su gato en un podcast de cocina.', kind: 'podcast', url: 'https://a', title: 'Cocina', published: '2026-01-01' },
    { text: 'Erin dice que Hopelab prioriza salud mental juvenil y pre-seed en LatAm.', kind: 'entrevista', url: 'https://b', title: 'Entrevista', published: '2026-02-01' },
    { text: 'Erin fue premiada por su trayectoria en finanzas.', kind: 'nota', url: 'https://c', title: 'Nota', published: '2026-03-01' },
  ] };
  const fakeStore = { analysis: {
    chunks: (personKey) => chunksByPerson[personKey] || [],
    dealsByFund: () => [
      { startup: 'GatoTech', stage: 'seed', date: '2026-01-01', quote: 'Deal de logística sin relación con el sector.', url: 'https://d1' },
      { startup: 'MenteSana', stage: 'pre-seed', date: '2026-02-01', quote: 'Hopelab lideró la ronda de MenteSana, salud mental juvenil.', url: 'https://d2' },
      { startup: 'Other', stage: 'series a', date: '2026-03-01', quote: 'Deal irrelevante de logística.', url: 'https://d3' },
    ],
  } };
  const env = { VLLM_RERANK_URL: 'http://fleet:8004/v1', VLLM_RERANK_MODEL: 'mixbread' };
  const rerankCalls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    rerankCalls.push(body.query);
    // El reranker de verdad pondría primero el documento sobre salud mental; lo simulamos así.
    const scored = body.documents.map((d, index) => ({ index, relevance_score: /salud mental/.test(d) ? 1 : 0 }));
    return new Response(JSON.stringify({ results: scored.sort((a, b) => b.relevance_score - a.relevance_score) }), { status: 200 });
  };
  const tools = createTools({ store: fakeStore, userId: null, network: [], env, fetcher, budget: { web: 4 } });
  const nb = new Notebook();
  const voice = await tools.person_voice({ person: 'Erin S', query: 'tesis en salud mental juvenil' }, nb);
  assert.ok(rerankCalls.some((q) => q === 'tesis en salud mental juvenil'), 'llamó al reranker con la pregunta del analista');
  assert.match(voice.split('\n')[0], /Entrevista/, 'el fragmento relevante (la entrevista sobre salud mental) queda primero, no el cronológicamente primero (el podcast de cocina)');
  const deals = await tools.fund_deals({ fund: 'Hopelab', query: 'salud mental juvenil pre-seed' }, nb);
  assert.match(deals.split('\n')[0], /MenteSana/, 'el deal relevante a la tesis queda primero');
});

test('herramientas: sin reranker de verdad, usa embeddings + coseno (lo que realmente hay en la flota)', async () => {
  const chunksByPerson = { 'erin s': [
    { text: 'Erin habla de su gato en un podcast de cocina.', kind: 'podcast', url: 'https://a', title: 'Cocina', published: '2026-01-01' },
    { text: 'Erin dice que Hopelab prioriza salud mental juvenil y pre-seed en LatAm.', kind: 'entrevista', url: 'https://b', title: 'Entrevista', published: '2026-02-01' },
    { text: 'Erin fue premiada por su trayectoria en finanzas.', kind: 'nota', url: 'https://c', title: 'Nota', published: '2026-03-01' },
  ] };
  const fakeStore = { analysis: { chunks: (personKey) => chunksByPerson[personKey] || [], dealsByFund: () => [] } };
  // Sin VLLM_RERANK_*: los modelos reales de esta flota (BAAI/bge, mxbai-embed) son de embeddings, no cross-encoders.
  const env = { VLLM_EMBED_URL: 'http://fleet:8003/v1', VLLM_EMBED_MODEL: 'BAAI/bge-large-en-v1.5' };
  const embedCalls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    embedCalls.push(body.input);
    // Simula el embedding real: el texto sobre salud mental queda cerca de la pregunta; el resto, lejos.
    const vec = (t) => (/salud mental/.test(t) ? [1, 0] : [0, 1]);
    return new Response(JSON.stringify({ data: body.input.map((t, index) => ({ index, embedding: vec(t) })) }), { status: 200 });
  };
  const tools = createTools({ store: fakeStore, userId: null, network: [], env, fetcher, budget: { web: 4 } });
  const nb = new Notebook();
  const voice = await tools.person_voice({ person: 'Erin S', query: 'tesis en salud mental juvenil' }, nb);
  assert.ok(embedCalls.length, 'llamó a embeddings, no a un reranker inexistente');
  assert.match(voice.split('\n')[0], /Entrevista/, 'el fragmento relevante por similitud de embeddings queda primero');
});
