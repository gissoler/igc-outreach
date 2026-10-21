import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/research/store.mjs';
import { createApp } from '../server/index.mjs';
import { applyUpdate, closingLine, editField, missingRequired, planFields, heuristicExtract, interpretAnswer, newIntake, planResearch, runTurn, toProfile } from '../server/research/intake.mjs';
import { blankProfile } from '../server/research/profileDefaults.mjs';
import { createServer } from 'node:http';

const DECK = `Andes Neuro Labs es una startup de Bogotá, Colombia.
Nuestro producto se llama Aurora: un wearable con IA que detecta deterioro cognitivo temprano.
Estamos en piloto con 3 clínicas en EE.UU.
Buscamos levantar US$1.5M en una ronda pre-seed y aplicar a grants del NIH.
El TAM es de $5B.
Competidores: Calmwave, NeuroNest y Mindloop.
No queremos inversionistas de tabaco.`;

test('extracción heurística con citas literales y sin confundir TAM con monto', () => {
  const out = heuristicExtract(DECK);
  const get = (p) => out.find((u) => u.path === p)?.value;
  assert.equal(get('company.name'), 'Andes Neuro Labs');
  assert.equal(get('product.name'), 'Aurora');
  assert.equal(get('funding.amount_usd'), 1_500_000);
  assert.equal(get('funding.round'), 'pre-seed');
  assert.equal(get('product.maturity'), 'prototype');
  assert.deepEqual(get('competitors'), ['Calmwave', 'NeuroNest', 'Mindloop']);
  assert.ok(out.filter((u) => u.path === 'funding.objectives').flatMap((u) => u.value).includes('grant'));
  for (const u of out) assert.ok(DECK.replace(/\s+/g, ' ').includes(u.quote), u.path);
});

test('alternativas genéricas no se convierten en competidores ni exclusiones', () => {
  const out = heuristicExtract('Alternativas: apps para conversar, tests aislados, clases, eventos o profesionales.');
  assert.equal(out.some((u) => u.path === 'competitors'), false);
  assert.equal(out.some((u) => u.path === 'constraints'), false);
});

test('respuestas guiadas, omisiones y ediciones del usuario bloqueadas', async () => {
  assert.deepEqual(interpretAnswer('funding.amount_usd', 'unos 2 millones'), { value: 2_000_000 });
  assert.deepEqual(interpretAnswer('geography', 'México y Estados Unidos').value.sort(), ['MX', 'US']);
  assert.deepEqual(interpretAnswer('competitors', 'none'), { skip: true });
  const s = newIntake({ user: { name: 'Ana Pérez' } });
  await runTurn(s, { text: 'Hi' });
  assert.equal(s.pending, 'company.name');
  await runTurn(s, { text: 'IGC Pharma' });
  assert.equal(s.fields['company.name'].value, 'IGC Pharma');
  assert.equal(s.fields['industry.sectors'], undefined);
  s.fields['company.name'] = { value: 'Nombre editado', origin: 'user', confidence: 'user', quote: '' };
  assert.equal(applyUpdate(s, { path: 'company.name', value: 'Other', quote: '' }, 'conversation', ''), false);
});

test('con modelo configurado, la heurística por patrones NO corre en paralelo (modelo manda)', async () => {
  // Un servidor OpenAI-compatible real (como vLLM), no un mock de fetch: prueba el contrato HTTP tal
  // cual lo habla el endpoint remoto (147.185.41.229), incluida la ruta /v1/models.
  let lastBody = null;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'qwen3-4b' }] })); return; }
      lastBody = JSON.parse(raw);
      res.setHeader('Content-Type', 'application/json');
      // El modelo decide deliberadamente NO extraer nada de este mensaje, aunque el texto
      // contenga disparadores que la heurística por patrones sí reconocería (p. ej. "inversionistas").
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'Ese texto no parece describir tu propia búsqueda de financiación. ¿Qué quieres financiar tú?', updates: [] }) } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const env = { INTAKE_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, INTAKE_LLM_MODEL: 'qwen3-4b' };
    const s = newIntake({});
    // Texto que la heurística SÍ leería (dispara sector, objetivo e incluso un enlace) si corriera.
    const noisy = 'Este README describe la investigación de inversionistas del propio producto. Ver http://localhost:5173/buscar.';
    const turn = await runTurn(s, { text: noisy, env, fetchImpl: fetch });
    assert.equal(turn.model.used, true);
    assert.equal(s.fields['funding.objectives'], undefined, 'la heurística no debió tocar funding.objectives');
    assert.equal(s.fields['company.website'], undefined, 'la heurística no debió tocar company.website');
    assert.equal(s.messages.at(-1).text, 'Ese texto no parece describir tu propia búsqueda de financiación. ¿Qué quieres financiar tú?');
    // El cuerpo enviado al servidor siguió el contrato OpenAI: model + messages con system/user.
    assert.equal(lastBody.model, 'qwen3-4b');
    assert.ok(Array.isArray(lastBody.messages) && lastBody.messages.some((m) => m.role === 'system'));
  } finally {
    server.close();
  }
});

test('el modelo propone, el código valida enums y citas; si falla se usa la heurística', async () => {
  const s = newIntake({});
  const modelFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think>{"reply":"Entendido. ¿Qué monto buscas?","updates":[{"path":"product.maturity","value":"clinical_phase_2","quote":"fase 2"},{"path":"funding.objectives","value":["grant","lottery"],"quote":""},{"path":"hack.field","value":"x"}]}' } }] }));
  const turn = await runTurn(s, { text: 'Estamos en fase 2 con nuestro fármaco', env: { INTAKE_LLM_BASE_URL: 'http://127.0.0.1:11434/v1' }, fetchImpl: modelFetch });
  assert.equal(turn.model.used, true);
  assert.equal(s.fields['product.maturity'].value, 'clinical_phase_2');
  assert.deepEqual(s.fields['funding.objectives'].value, ['grant']);
  assert.equal(s.fields['funding.objectives'].confidence, 'inferred');
  assert.equal(s.fields['hack.field'], undefined);
  assert.equal(s.messages.at(-1).text, 'Entendido. ¿Qué monto buscas?');
  const broken = await runTurn(s, { text: 'Somos Delta Bio', env: { INTAKE_LLM_BASE_URL: 'http://x' }, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(broken.model.error, 'offline');
  assert.equal(s.fields['company.name'].value, 'Delta Bio');
});

test('planificador elige fuentes por objetivo y perfil confirmado conserva evidencia', async () => {
  const s = newIntake({});
  await runTurn(s, { documents: [{ name: 'deck.pdf', text: DECK }] });
  const plan = planResearch(s, {});
  const sources = plan.steps.map((x) => x.source);
  assert.ok(sources.includes('Grants.gov') && sources.includes('NIH RePORTER') && sources.includes('SEC Form D'));
  assert.ok(!sources.includes('ClinicalTrials.gov'));
  const profile = toProfile(s, blankProfile({ name: 'Ana', email: 'a@b.co' }), { name: 'Ana', email: 'a@b.co' });
  assert.equal(profile.founder.org, 'Andes Neuro Labs');
  assert.ok(profile.project.funding_types.includes('grant'));
  assert.equal(profile.intake.evidence['company.name'].origin, 'document:deck.pdf');
  assert.equal(profile.intake.documents[0].name, 'deck.pdf');
});

test('rutas HTTP del prerregistro: aislamiento, documentos, edición y confirmación', async () => {
  const store = createStore(':memory:');
  const { server } = createApp({ store, env: {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/research`;
  try {
    assert.equal((await fetch(url + '/intake')).status, 401);
    const reg = await fetch(url + '/auth/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'k'.repeat(40) }) });
    const cookie = reg.headers.get('set-cookie').split(';')[0];
    const call = (path, method = 'GET', body) => fetch(url + path, method === 'GET' ? { headers: { cookie } } : { method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body ?? {}) });
    const first = await (await call('/intake')).json();
    assert.equal(first.messages[0].role, 'assistant');
    assert.equal(first.model.configured, false);
    assert.equal((await call('/intake/message', 'POST', { text: '' })).status, 400);
    assert.equal((await call('/intake/confirm', 'POST', {})).status, 400);
    const after = await (await call('/intake/message', 'POST', { text: 'Te paso el deck', documents: [{ name: 'deck.pdf', type: 'application/pdf', size: 1000, text: DECK }] })).json();
    assert.equal(after.documents.length, 1);
    assert.equal(after.documents[0].text, undefined);
    assert.equal(after.fields['company.name'].value, 'Andes Neuro Labs');
    const edited = await (await call('/intake/field', 'PUT', { path: 'product.one_liner', value: 'Wearable que detecta deterioro cognitivo' })).json();
    assert.equal(edited.fields['product.one_liner'].origin, 'user');
    assert.equal((await call('/intake/field', 'PUT', { path: 'nope', value: 'x' })).status, 400);
    const confirmed = await (await call('/intake/confirm', 'POST', {})).json();
    assert.equal(confirmed.profile.project.name, 'Aurora');
    assert.equal(confirmed.profile.onboardingComplete, false);
    assert.ok(confirmed.intake.confirmedAt);
    const me = await (await call('/auth/me')).json();
    assert.equal(me.profile.founder.org, 'Andes Neuro Labs');
    const removed = await (await call(`/intake/documents/${after.documents[0].id}`, 'DELETE', {})).json();
    assert.equal(removed.documents.length, 0);
    assert.equal(removed.fields['company.name'], undefined);
    assert.equal(removed.fields['product.one_liner'].value, 'Wearable que detecta deterioro cognitivo');
  } finally {
    server.close();
  }
});

test('investor-style intake: never re-asks a known field and sees previous documents', async () => {
  const s = newIntake({ user: { name: 'Gisel' } });
  let seen = null;
  const reply = (body) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }) });
  const env = { INTAKE_LLM_BASE_URL: 'http://model/v1' };
  // Turn 1: a deck gives name, product and amount.
  await runTurn(s, { text: 'Here is our deck', documents: [{ name: 'deck.pdf', text: 'Mentiva raises USD 1.5M. Mentiva app helps knowledge workers reflect on stress. 1,200 beta users.' }], env, fetchImpl: async (_u, init) => { seen = JSON.parse(JSON.parse(init.body).messages[1].content.replace(/\n\/no_think$/, '')); return reply({ reply: 'Read deck.pdf: Mentiva, raising $1.5M.', asking: 'product.one_liner', updates: [{ path: 'company.name', value: 'Mentiva', quote: 'Mentiva raises' }, { path: 'funding.amount_usd', value: 1500000, quote: 'USD 1.5M' }] }); } });
  assert.ok(seen.open_questions.some((q) => q.path === 'company.name'));
  assert.equal(s.pending, 'product.one_liner');
  // Turn 2: the model tries to ask for the company name again → the server replaces it with an open question.
  await runTurn(s, { text: 'It helps people reflect on stress and focus.', env, fetchImpl: async (_u, init) => { seen = JSON.parse(JSON.parse(init.body).messages[1].content.replace(/\n\/no_think$/, '')); return reply({ reply: 'Got it. What is the company name?', asking: 'company.name', updates: [{ path: 'product.one_liner', value: 'Helps people reflect on stress and focus', quote: '' }] }); } });
  assert.ok(seen.previous_documents.includes('deck.pdf'), 'previous documents are sent again');
  assert.ok(!seen.open_questions.some((q) => q.path === 'company.name'), 'filled fields are not open');
  assert.notEqual(s.pending, 'company.name');
  assert.ok(!/company name\?/i.test(s.messages.at(-1).text));
  assert.match(s.messages.at(-1).text, /\?/);
});

test('intake: "no sé" skips the pending question, always asks one, never repeats the same summary', async () => {
  const s = newIntake({ user: { name: 'Gisel' } });
  const env = { INTAKE_LLM_BASE_URL: 'http://model/v1' };
  const summary = 'Mentiva is a local, on-device mobile experience for professionals managing stress and focus.';
  const answer = (body) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }) });
  // Optional questions are not asked while required ones are open (the progress bar counts only those).
  await runTurn(s, { text: 'Mentiva, on-device app for stress and focus, prototype, pre-seed $1.5M, global, mental health', env, fetchImpl: answer({ ack: summary, question: 'Which product do you want to fund?', asking: 'product.name', updates: [{ path: 'company.name', value: 'Mentiva', quote: 'Mentiva' }] }) });
  assert.equal(s.pending, 'product.name');
  // The founder doesn't know: skipped, and the next question is a different one.
  await runTurn(s, { text: 'no se cuales son', env, fetchImpl: answer({ ack: summary, question: 'Which product?', asking: 'product.name', updates: [] }) });
  assert.ok(s.skipped.includes('product.name'));
  assert.notEqual(s.pending, 'product.name');
  const last = s.messages.at(-1).text;
  assert.ok(!last.includes('local, on-device'), 'the same summary is not repeated');
  assert.match(last, /\?/);
  // The model forgets to ask: the server still asks the next open question.
  await runTurn(s, { text: 'for quarter 2 2026', env, fetchImpl: answer({ ack: 'Target: Q2 2026.', question: '', asking: null, updates: [{ path: 'funding.timeline', value: 'Q2 2026', quote: 'quarter 2 2026' }] }) });
  assert.match(s.messages.at(-1).text, /^Target: Q2 2026\. .+\?/);
});

test('espacio del navegador sin login: misma clave, mismo espacio; otra clave, otro espacio', async () => {
  const store = createStore(':memory:');
  const { server } = createApp({ store, env: {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/research`;
  const open = (key) => fetch(url + '/auth/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  try {
    const key = 'a'.repeat(20) + 'B_-9'.repeat(5);
    assert.equal((await open('short')).status, 400);
    const first = await open(key);
    assert.equal(first.status, 200);
    const u1 = (await first.json()).user;
    assert.equal(u1.browser, true);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    await fetch(url + '/intake/field', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ path: 'company.name', value: 'Mentiva' }) });
    const again = await open(key);
    const cookie2 = again.headers.get('set-cookie').split(';')[0];
    assert.equal((await again.json()).user.id, u1.id);
    const intake = await (await fetch(url + '/intake', { headers: { cookie: cookie2 } })).json();
    assert.equal(intake.fields['company.name'].value, 'Mentiva');
    const other = await (await open('z'.repeat(40))).json();
    assert.notEqual(other.user.id, u1.id);
  } finally { server.close(); }
});

test('intake: el plan depende del objetivo; inversión exige ronda, monto y tracción antes del 100%', async () => {
  const s = newIntake({ user: { name: 'Gisel' } });
  const env = { INTAKE_LLM_BASE_URL: 'http://model/v1' };
  const answer = (body) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }) });
  const base = [['company.name', 'Mentiva'], ['product.name', 'Mentiva app'], ['product.one_liner', 'Helps students name their stress'], ['industry.sectors', ['mental health']], ['product.maturity', 'prototype'], ['geography', ['CO']], ['funding.objectives', ['investment']]].map(([path, value]) => ({ path, value, quote: '' }));
  await runTurn(s, { text: 'all of it', env, fetchImpl: answer({ ack: 'Got it.', question: 'Who is on your team?', asking: 'company.team', updates: base }) });
  assert.deepEqual(planFields(s).slice(-3), ['funding.round', 'funding.amount_usd', 'company.traction']);
  assert.deepEqual(missingRequired(s), ['funding.round', 'funding.amount_usd', 'company.traction']);
  assert.equal(s.pending, 'funding.round', 'asks what the plan needs, not the team');
  // "I don't know" keeps it missing: the plan is not complete and the assistant says what is left.
  await runTurn(s, { text: 'seed', env, fetchImpl: answer({ ack: 'Seed.', question: 'How much?', asking: 'funding.amount_usd', updates: [{ path: 'funding.round', value: 'seed', quote: 'seed' }] }) });
  await runTurn(s, { text: 'no sé', env, fetchImpl: answer({ ack: 'Ok.', question: '', asking: null, skipped: 'funding.amount_usd', updates: [] }) });
  assert.ok(missingRequired(s).includes('funding.amount_usd'));
  await runTurn(s, { text: '1,200 beta users', env, fetchImpl: answer({ ack: 'Great traction.', question: '', asking: null, updates: [{ path: 'company.traction', value: '1,200 beta users', quote: '1,200 beta users' }] }) });
  assert.match(s.messages.at(-1).text, /missing one useful detail.*amount/i);
  assert.doesNotMatch(s.messages.at(-1).text, /complete/);
  await runTurn(s, { text: 'about 500k', env, fetchImpl: answer({ ack: 'USD 500k.', question: '', asking: null, updates: [{ path: 'funding.amount_usd', value: 500000, quote: '500k' }] }) });
  assert.deepEqual(missingRequired(s), []);
  assert.match(s.messages.at(-1).text, /Your plan is complete/);
  assert.equal(s.pending, null);
});

test('intake: grants pide datos propios de grants y no obliga a completar una ronda de inversión', () => {
  const s = newIntake({});
  s.fields['funding.objectives'] = { value: ['grant'], origin: 'user', confidence: 'source' };
  assert.deepEqual(planFields(s).slice(-8), ['funding.amount_usd', 'funding.use_of_funds', 'company.entity_type', 'company.state', 'funding.apply_window', 'funding.applicant_role', 'project.target_population', 'funding.search_terms']);
  assert.ok(!planFields(s).includes('funding.round'));
  assert.ok(!planFields(s).includes('company.traction'));
});

test('feedback IGC: conserva RHTP, población rural y ruta de aplicación sin inventar pre-seed', async () => {
  const s = newIntake({});
  await runTurn(s, { text: 'I work for IGC Pharma, a for-profit U.S. biotech company. We seek grants for PRISM under the Rural Health Transformation Program (RHTP), serving older adults in rural counties at risk of dementia. Include direct applications and subcontractor or vendor routes.' });
  assert.ok(s.fields['funding.search_terms'].value.some((x) => /Rural Health Transformation Program|RHTP/.test(x)));
  assert.match(s.fields['project.target_population'].value, /older adults in rural counties/i);
  assert.equal(s.fields['funding.applicant_role'].value, 'either');
  assert.equal(s.fields['funding.round'], undefined);
  const profile = toProfile(s, blankProfile({ name: 'Gisel', email: 'g@x.co' }), { name: 'Gisel', email: 'g@x.co' });
  assert.equal(profile.project.stage, 'other');
  assert.ok(profile.project.keywords.some((x) => /RHTP|Rural Health Transformation Program/.test(x)));
  assert.equal(profile.intake.traction, '');
});

test('plan de grants rural muestra fuentes rurales y Simpler cuando está configurado', () => {
  const s = newIntake({});
  editField(s, 'funding.objectives', ['grant']);
  editField(s, 'funding.search_terms', ['RHTP', 'rural health']);
  const sources = planResearch(s, { SIMPLER_GRANTS_API_KEY: 'configured' }).steps.map((x) => x.source);
  assert.ok(sources.includes('Simpler.Grants.gov + Grants.gov'));
  assert.ok(sources.includes('CMS Rural Health Transformation + Rural Health Information Hub'));
});

test('intake sin modelo: capta ronda y monto aunque lleguen fuera de orden; "1,200 users" no es un monto', async () => {
  const s = newIntake({});
  s.fields['funding.objectives'] = { value: ['investment'], origin: 'user', confidence: 'source' };
  s.pending = 'funding.amount_usd';
  await runTurn(s, { text: 'seed', env: {} });
  assert.equal(s.fields['funding.round']?.value, 'seed');
  s.pending = 'company.traction';
  await runTurn(s, { text: '1,200 beta users in 3 universities', env: {} });
  assert.equal(s.fields['funding.amount_usd'], undefined);
  s.pending = null;
  await runTurn(s, { text: 'about 500k USD', env: {} });
  assert.equal(s.fields['funding.amount_usd']?.value, 500000);
});

test('intake: el cierre usa el contexto y ofrece continuar con un dato desconocido', () => {
  const s = newIntake();
  applyUpdate(s, { path: 'company.name', value: 'Mentiva', quote: 'Mentiva' }, 'conversation', 'Mentiva');
  applyUpdate(s, { path: 'product.name', value: 'Compass', quote: 'Compass' }, 'conversation', 'Compass');
  const line = closingLine(s);
  assert.match(line, /Compass/);
  assert.match(line, /I don't know/);
  assert.doesNotMatch(line, /To build your plan I still need:/);
});

test('el modelo acusa recibo de un rango sin devolver el número: el código guarda el monto (tope del rango)', async () => {
  const s = newIntake({});
  s.pending = 'funding.amount_usd';
  const modelFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: 'Got it: range $500k-$3M. What will the money fund?', updates: [] }) } }] }) });
  const turn = await runTurn(s, { text: 'Anywhere from about $500,000 to $3 million in total. Smaller awards are fine too.', env: { INTAKE_LLM_BASE_URL: 'http://127.0.0.1:11434/v1' }, fetchImpl: modelFetch });
  assert.equal(turn.model.used, true);
  assert.equal(s.fields['funding.amount_usd'].value, 3000000);
});
test('montos: rangos y cifras sueltas', () => {
  const a = (t) => interpretAnswer('funding.amount_usd', t).value;
  assert.equal(a('$500k-$3M'), 3000000);
  assert.equal(a('between 500k and 3 million'), 3000000);
  assert.equal(a('about $2 million'), 2000000);
  assert.equal(a('entre 500 mil y 2 millones de dólares'), 2000000);
  assert.equal(a('$750,000'), 750000);
});
