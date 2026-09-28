import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/index.mjs';
import { createStore } from '../server/research/store.mjs';
import { runResearch } from '../server/research/pipeline.mjs';
import { candidate, evidence, validateBrief } from '../server/research/core.mjs';
import { makeClient } from '../server/research/providers.mjs';
import { runApifyActor } from '../server/research/apify.mjs';
import { createBrowserService, blockedRequest } from '../server/research/browser.mjs';
import { createFrameStore, createLiveHub, createRecorder, redactText, safeSample, sanitizeUrl, secretValues } from '../server/research/liveRun.mjs';
// Lógica pura del frontend (TypeScript sin sintaxis no borrable; Node >= 22.18 la ejecuta directamente).
import { autoFocus, buildScenes, buildSteps, mergeEvents, operations, runOutcome } from '../../frontend/src/liveRunModel.ts';

const brief = {
  name: 'Tester', role: 'Founder', company: 'Test Company', product: 'Test project',
  description: 'Alzheimer agitation research', industry: 'Alzheimer agitation neuroscience',
  stage: 'clinical_phase_2', geography: 'US', fundingTypes: ['partnering'], dataMode: 'live', useTeam: false, minDays: 30,
};
const newJob = (id = 'job-1', extra = {}) => ({ id, brief: validateBrief(brief), mode: 'live', status: 'queued', createdAt: new Date().toISOString(), events: [], leads: [], senderEvidence: [], ...extra });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const html = '<html><body><h1>Programa oficial</h1><p>The a2 Collective anticipates new awards.</p></body></html>';
/** fetch simulado: robots.txt vacío, HTML para páginas y JSON para APIs. */
const fakeFetch = (routes = {}) => async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
  for (const [needle, reply] of Object.entries(routes)) if (url.includes(needle)) return typeof reply === 'function' ? reply(url, init) : reply.clone();
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
};
/** Navegador simulado con la misma interfaz que createBrowserService. */
const fakeBrowser = ({ fail = null } = {}) => {
  const visits = [];
  return {
    visits,
    async visit(url, { screenshot, onOpened, onLoaded }) {
      visits.push({ url, screenshot });
      onOpened?.();
      if (fail) throw new Error(fail);
      onLoaded?.({ status: 200, finalUrl: url, durationMs: 12 });
      return { status: 200, finalUrl: url, html, screenshot: screenshot ? JPEG : null, durationMs: 20 };
    },
    status: () => ({ available: true }),
    close: async () => {},
  };
};
const recorderFor = (job, extra = {}) => createRecorder(job, { store: null, ...extra });
const frameFacade = (frames, jobId) => ({ canStore: () => frames.canStore(jobId), put: (b) => frames.put(jobId, b) });
async function listen(app) {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${app.server.address().port}/api/research`;
}
/** Lector SSE mínimo para pruebas: devuelve bloques {event, id, data}. */
async function readSse(url, { headers = {}, until = () => false, timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { headers, signal: controller.signal });
  const blocks = [];
  if (res.status !== 200) { clearTimeout(timer); return { status: res.status, blocks, body: await res.json() }; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const block = { raw };
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) block.event = line.slice(7);
          if (line.startsWith('id: ')) block.id = Number(line.slice(4));
          if (line.startsWith('data: ')) block.data = JSON.parse(line.slice(6));
        }
        blocks.push(block);
        if (until(block, blocks)) { controller.abort(); return { status: 200, blocks }; }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  } finally {
    clearTimeout(timer);
  }
  return { status: 200, blocks };
}

test('events keep a strict, gap-free order and the run closes with a completed event', async () => {
  const store = createStore(':memory:');
  const job = newJob('ordered');
  await runResearch(job, store, {
    env: {},
    providers: [
      ['Fuente A', async () => [candidate({ org: 'A', title: 'Alzheimer agitation research', fundingType: 'partnering', evidence: [evidence('Fixture', 'https://example.org/a', 'Alzheimer agitation research', 'title')] })]],
      ['Fuente B', async () => []],
    ],
  });
  const events = job.run.events;
  assert.deepEqual(events.map((e) => e.sequence), events.map((_, i) => i + 1));
  assert.equal(job.status, 'done');
  assert.equal(events[0].phase, 'planning');
  assert.equal(events.at(-1).phase, 'completed');
  for (const name of ['Fuente A', 'Fuente B']) {
    const started = events.findIndex((e) => e.provider === name && e.phase === 'source_started');
    const completed = events.findIndex((e) => e.provider === name && e.phase === 'source_completed');
    assert.ok(started >= 0 && completed > started, `${name} empieza antes de terminar`);
  }
  assert.equal(events.find((e) => e.phase === 'source_started').detail.parallel, 2);
  assert.ok(events.every((e) => e.id === `ordered:${e.sequence}` && !Number.isNaN(Date.parse(e.at))));
  // Persistido con el trabajo para reproducción posterior.
  assert.equal(store.get('ordered').run.events.length, events.length);
  store.close();
});

test('one failing source does not stop the others and the run finishes as partial', async () => {
  const store = createStore(':memory:');
  const job = newJob('partial');
  let slowFinished = false;
  await runResearch(job, store, {
    env: {},
    providers: [
      ['Rota', async () => { throw new Error('Servicio caído'); }],
      ['Lenta', async () => { await new Promise((r) => setTimeout(r, 30)); slowFinished = true; return []; }],
    ],
  });
  assert.ok(slowFinished);
  const done = (name) => job.run.events.find((e) => e.provider === name && e.phase === 'source_completed');
  assert.equal(done('Rota').status, 'error');
  assert.match(done('Rota').message, /Servicio caído/);
  assert.equal(done('Lenta').status, 'success');
  assert.equal(job.status, 'partial');
  assert.equal(job.run.events.at(-1).status, 'warning');
  const steps = buildSteps(job.run.events);
  assert.equal(steps.find((s) => s.title === 'Rota').state, 'error');
  assert.equal(steps.find((s) => s.title === 'Lenta').state, 'success');
  assert.equal(runOutcome(job.run.events), 'partial');
  store.close();
});

test('an explicit cancellation aborts active providers and records an interrupted run', async () => {
  const store = createStore(':memory:');
  const job = newJob('cancelled');
  const controller = new AbortController();
  const running = runResearch(job, store, {
    env: {},
    signal: controller.signal,
    providers: [['Fuente lenta', async () => new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    })]],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort(new Error('Stopped by the user.'));
  await running;
  assert.equal(job.status, 'failed');
  assert.equal(runOutcome(job.run.events), 'failed');
  assert.match(job.events.at(-1).message, /stopped by the user/i);
  assert.equal(job.run.events.at(-2).title, 'Search stopped');
  assert.equal(job.run.events.at(-1).phase, 'completed');
  store.close();
});

test('final, partial and failed states are explicit in events and in the frontend model', async () => {
  const store = createStore(':memory:');
  const ok = newJob('ok');
  await runResearch(ok, store, { env: {}, providers: [['Fuente', async () => []]] });
  assert.equal(ok.status, 'done');
  assert.equal(runOutcome(ok.run.events), 'done');
  const failed = newJob('failed', { brief: null });
  await runResearch(failed, store, { env: {} });
  assert.equal(failed.status, 'failed');
  const last = failed.run.events.at(-1);
  assert.equal(last.phase, 'completed');
  assert.equal(last.status, 'error');
  assert.equal(runOutcome(failed.run.events), 'failed');
  assert.ok(failed.run.events.some((e) => e.phase === 'error'));
  // Sin evento `completed` todavía: sigue en curso aunque haya eventos.
  assert.equal(runOutcome(ok.run.events.slice(0, 3)), 'running');
  assert.equal(runOutcome([], null), 'idle');
  // Un reinicio del servidor marca la ejecución como interrumpida en el registro estructurado.
  const dir = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'live-'));
  const path = `${dir}/r.sqlite`;
  const first = createStore(path);
  const running = newJob('restart', { status: 'running', run: { version: 1, events: [{ id: 'restart:1', sequence: 1, at: new Date().toISOString(), phase: 'planning', title: 'Plan', message: 'x', status: 'success' }], dropped: 0 } });
  first.save(running);
  first.close();
  const second = createStore(path);
  const restored = second.get('restart');
  assert.equal(restored.status, 'failed');
  assert.equal(runOutcome(restored.run.events), 'failed');
  assert.deepEqual(restored.run.events.map((e) => e.sequence), [1, 2, 3]);
  second.close();
  store.close();
});

test('URLs, messages and JSON samples never expose secrets, tokens, cookies or emails', () => {
  const env = { APIFY_TOKEN: 'apify_api_SECRETSECRET123', EXA_API_KEY: 'exa-key-987654321', HARMLESS: 'visible' };
  const secrets = secretValues(env);
  assert.deepEqual(secrets.sort(), ['apify_api_SECRETSECRET123', 'exa-key-987654321'].sort());
  const url = sanitizeUrl('https://user:pass@api.example.org/v1/search?q=alzheimer&api_key=abc&token=xyz&mailto=me@x.org&contact=jane@corp.com&page=2#frag', secrets);
  assert.equal(url, 'https://api.example.org/v1/search?q=alzheimer&page=2');
  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeUrl('file:///etc/passwd'), null);
  const text = redactText('Bearer abc.def-123 falló con exa-key-987654321 para jane@corp.com y ?api_key=zzz', secrets);
  assert.doesNotMatch(text, /abc\.def|exa-key|jane@corp|zzz/);
  const sample = safeSample({ token: 'x', data: { authorization: 'Bearer y', items: [{ name: 'A', email: 'a@b.co', note: 'write to a@b.co' }, { name: 'B' }, { name: 'C' }], cookie: 'sid=1' } });
  assert.doesNotMatch(sample, /"token"|authorization|cookie|a@b\.co/);
  assert.match(sample, /1 more items/);
  assert.ok(safeSample({ long: 'x'.repeat(5000) }).length < 400);
  // El registrador redacta también los mensajes y el detalle de cualquier evento.
  const job = newJob('secret');
  const live = recorderFor(job, { env });
  live({ phase: 'warning', title: 'Error', message: 'Apify HTTP 401 con apify_api_SECRETSECRET123', publicUrl: 'https://api.apify.com/v2/acts/x?token=apify_api_SECRETSECRET123', detail: { kind: 'api', params: { q: 'exa-key-987654321' } } });
  assert.doesNotMatch(JSON.stringify(job.run.events), /SECRETSECRET|exa-key-987654321/);
});

test('Apify inspector events show endpoint and public params but never the token', async () => {
  const job = newJob('apify');
  const live = recorderFor(job, { env: { APIFY_TOKEN: 'apify_api_SUPERSECRET42' } });
  let sentAuth = '';
  const fetcher = async (url, init) => {
    sentAuth = init.headers.Authorization;
    return new Response(JSON.stringify([{ fullName: 'Ana Ruiz', email: 'ana@corp.com', linkedinUrl: 'https://www.linkedin.com/in/ana' }]), { status: 200 });
  };
  const result = await runApifyActor({ input: { companies: ['Acme'] }, env: { APIFY_TOKEN: 'apify_api_SUPERSECRET42' }, fetcher, live });
  assert.equal(result.items.length, 1);
  assert.equal(sentAuth, 'Bearer apify_api_SUPERSECRET42');
  const [request, response] = job.run.events;
  assert.equal(request.phase, 'api_request');
  assert.equal(request.detail.method, 'POST');
  assert.deepEqual(request.detail.params.companies, ['Acme']);
  assert.equal(response.phase, 'api_response');
  assert.equal(response.resultCount, 1);
  assert.equal(response.detail.httpStatus, 200);
  const serialized = JSON.stringify(job.run.events);
  assert.doesNotMatch(serialized, /SUPERSECRET|Authorization|ana@corp\.com/);
});

test('API sources emit an inspector (request/response) and never pretend to open a browser', async () => {
  const job = newJob('api');
  const live = recorderFor(job);
  const browser = fakeBrowser();
  const client = makeClient({
    env: {}, live, browser,
    fetcher: fakeFetch({ 'api.grants.gov': new Response(JSON.stringify({ errorcode: 0, data: { oppHits: [{ id: 1 }, { id: 2 }] } }), { status: 200 }) }),
  });
  await client.scope('Grants.gov').json('https://api.grants.gov/v1/api/search2', { keyword: 'alzheimer', rows: 15 });
  assert.equal(browser.visits.length, 0);
  assert.deepEqual(job.run.events.map((e) => e.phase), ['api_request', 'api_response']);
  const [request, response] = job.run.events;
  assert.equal(request.provider, 'Grants.gov');
  assert.equal(request.detail.kind, 'api');
  assert.equal(request.detail.endpoint, 'https://api.grants.gov/v1/api/search2');
  assert.deepEqual(request.detail.params, { keyword: 'alzheimer', rows: 15 });
  assert.equal(response.resultCount, 2);
  assert.equal(response.detail.httpStatus, 200);
  assert.ok(response.detail.sample.includes('oppHits'));
  assert.ok(job.run.events.every((e) => !e.frameId && !['browser_opened', 'page_loaded', 'screenshot'].includes(e.phase)));
  // Una página web sí pasa por el navegador y produce una captura real con frameId.
  const frames = createFrameStore();
  const webJob = newJob('web');
  const webClient = makeClient({ env: {}, live: recorderFor(webJob), browser, frames: frameFacade(frames, 'web'), fetcher: fakeFetch() });
  const text = await webClient.scope('Official radar').page('https://www.a2collective.ai/pilotawards');
  assert.match(text, /anticipates new awards/);
  const phases = webJob.run.events.map((e) => e.phase);
  for (const phase of ['browser_opened', 'page_loaded', 'screenshot']) assert.ok(phases.includes(phase), phase);
  const shot = webJob.run.events.find((e) => e.phase === 'screenshot');
  assert.ok(frames.get(shot.frameId).buffer.equals(JPEG));
  // El modelo del frontend distingue ambos tipos de operación.
  const step = buildSteps([...job.run.events.map((e) => ({ ...e, sequence: e.sequence })), ...webJob.run.events.map((e) => ({ ...e, sequence: e.sequence + 100 }))]);
  assert.equal(step.find((s) => s.title === 'Grants.gov').channel, 'api');
  assert.equal(step.find((s) => s.title === 'Official radar').channel, 'web');
  assert.equal(operations(step.find((s) => s.title === 'Official radar'))[0].kind, 'page');
  assert.equal(operations(step.find((s) => s.title === 'Grants.gov'))[0].kind, 'api');
  frames.close();
});

test('screenshot limit per run is enforced and pages are still read without captures', async () => {
  const frames = createFrameStore({ maxPerJob: 2 });
  const job = newJob('limit');
  const browser = fakeBrowser();
  const client = makeClient({ env: {}, live: recorderFor(job), browser, frames: frameFacade(frames, 'limit'), fetcher: fakeFetch() });
  for (let i = 0; i < 4; i++) await client.page(`https://site${i}.example.org/page`);
  assert.equal(frames.countFor('limit'), 2);
  assert.equal(job.run.events.filter((e) => e.phase === 'screenshot').length, 2);
  assert.deepEqual(browser.visits.map((v) => v.screenshot), [true, true, false, false]);
  assert.equal(job.run.events.filter((e) => e.title === 'No capture').length, 2);
  assert.equal(frames.put('limit', JPEG), null);
  // Límite total de memoria: nunca se supera.
  const tiny = createFrameStore({ maxTotalBytes: 15 });
  assert.ok(tiny.put('a', JPEG));
  assert.equal(tiny.put('b', JPEG), null);
  tiny.close();
  frames.close();
});

test('frames expire with their job and the frame route stops serving them', async () => {
  let clock = 1_000;
  const frames = createFrameStore({ ttlMs: 500, now: () => clock });
  const id = frames.put('job-x', JPEG);
  frames.put('job-y', JPEG);
  assert.ok(frames.get(id));
  frames.expireJob('job-x');
  frames.sweep();
  assert.ok(frames.get(id), 'todavía no caduca');
  clock += 600;
  frames.sweep();
  assert.equal(frames.get(id), null);
  assert.equal(frames.countFor('job-x'), 0);
  assert.equal(frames.stats().frames, 1, 'las capturas de otros trabajos se conservan');
  frames.close();
  assert.equal(frames.stats().frames, 0);

  const store = createStore(':memory:');
  const appFrames = createFrameStore();
  const app = createApp({ store, env: {}, frames: appFrames, browser: null });
  const url = await listen(app);
  try {
    const job = newJob('7f6c3a52-0000-4000-8000-000000000001', { status: 'done' });
    store.save(job);
    const frameId = appFrames.put(job.id, JPEG);
    const served = await fetch(`${url}/jobs/${job.id}/frames/${frameId}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/jpeg');
    assert.ok(Buffer.from(await served.arrayBuffer()).equals(JPEG));
    appFrames.dropJob(job.id);
    const gone = await fetch(`${url}/jobs/${job.id}/frames/${frameId}`);
    assert.equal(gone.status, 410);
    assert.equal((await gone.json()).code, 'FRAME_EXPIRED');
  } finally {
    await app.close();
    store.close();
  }
});

test('without Playwright the pipeline keeps reading pages over HTTP and says so', async () => {
  const browser = createBrowserService({ env: {}, importPlaywright: async () => { throw new Error('Cannot find package playwright'); } });
  const job = newJob('nopw');
  const frames = createFrameStore();
  const client = makeClient({ env: {}, live: recorderFor(job), browser, frames: frameFacade(frames, 'nopw'), fetcher: fakeFetch() });
  const text = await client.scope('Official radar').page('https://www.alzdiscovery.org/programs');
  assert.match(text, /Programa oficial|Official program/);
  const warning = job.run.events.find((e) => e.phase === 'warning');
  assert.match(warning.message, /Playwright isn't installed/);
  assert.ok(job.run.events.some((e) => e.detail?.via === 'http'));
  assert.equal(job.run.events.filter((e) => e.frameId).length, 0);
  assert.equal(browser.status().available, false);
  // Una segunda página no reintenta cargar Playwright.
  await client.page('https://www.alzdiscovery.org/other');
  assert.equal(frames.stats().frames, 0);
  frames.close();
});

test('a browser navigation error is reported as an error card and the page is read over HTTP', async () => {
  const job = newJob('navfail');
  const client = makeClient({ env: {}, live: recorderFor(job), browser: fakeBrowser({ fail: 'net::ERR_TIMED_OUT' }), fetcher: fakeFetch() });
  const text = await client.scope('Official radar').page('https://cdmrp.health.mil/funding/azrp');
  assert.match(text, /Programa oficial|Official program/);
  const error = job.run.events.find((e) => e.phase === 'error');
  assert.match(error.message, /ERR_TIMED_OUT/);
  const [op] = operations(buildSteps(job.run.events).find((s) => s.title === 'Official radar'));
  assert.equal(op.kind, 'page');
  assert.equal(op.frameId, null);
  assert.match(op.error, /ERR_TIMED_OUT/);
  assert.equal(op.viaHttp, true);
});

test('one shared Chromium, one page at a time, contexts closed and trackers blocked', async () => {
  let launches = 0;
  let open = 0;
  let maxOpen = 0;
  let closedContexts = 0;
  let browserClosed = false;
  const routes = [];
  const fakePlaywright = {
    chromium: {
      async launch(options) {
        launches++;
        assert.equal(options.headless, true);
        return {
          on() {},
          async close() { browserClosed = true; },
          async newContext(options) {
            assert.deepEqual(options.viewport, { width: 1280, height: 720 });
            return {
              async route(pattern, handler) { routes.push(handler); },
              async newPage() {
                open++;
                maxOpen = Math.max(maxOpen, open);
                let current = '';
                return {
                  setDefaultTimeout() {},
                  async goto(url) { current = url; await new Promise((r) => setTimeout(r, 15)); return { status: () => 200, text: async () => html }; },
                  url: () => current,
                  async waitForLoadState() {},
                  async screenshot(options) { assert.equal(options.type, 'jpeg'); assert.equal(options.fullPage, false); return JPEG; },
                  async close() { open--; },
                };
              },
              async close() { closedContexts++; },
            };
          },
        };
      },
    },
  };
  const service = createBrowserService({ env: {}, importPlaywright: async () => fakePlaywright });
  const results = await Promise.all([1, 2, 3].map((i) => service.visit(`https://example.org/${i}`, { screenshot: true })));
  assert.equal(launches, 1);
  assert.equal(maxOpen, 1);
  assert.equal(closedContexts, 3);
  assert.ok(results.every((r) => r.screenshot.equals(JPEG) && r.status === 200));
  assert.equal(routes.length, 3);
  await service.close();
  assert.ok(browserClosed);
  await assert.rejects(service.visit('https://example.org/4'), /shutting down/);
  assert.equal(blockedRequest('https://www.google-analytics.com/analytics.js', 'script'), true);
  assert.equal(blockedRequest('https://example.org/video.mp4', 'media'), true);
  assert.equal(blockedRequest('https://example.org/style.css', 'stylesheet'), false);
  assert.equal(blockedRequest('https://example.org/logo.png', 'image'), false);
});

test('SSE sends a snapshot, streams new events in order, keeps alive, closes at the end and cleans listeners', async () => {
  const store = createStore(':memory:');
  const hub = createLiveHub();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pipeline = async (job, jobStore, options) => {
    await runResearch(job, jobStore, { ...options, providers: [['Fuente lenta', async () => { await gate; return []; }]] });
  };
  const app = createApp({ store, env: {}, hub, pipeline, browser: null, keepAliveMs: 40 });
  const url = await listen(app);
  try {
    const started = await fetch(`${url}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief) });
    const { jobId } = await started.json();
    // Primera conexión: se corta después de recibir el snapshot y un keepalive.
    const first = await readSse(`${url}/jobs/${jobId}/events`, { until: (b, all) => all.some((x) => x.event === 'snapshot') && b.raw.startsWith(': keepalive') });
    const snapshot = first.blocks.find((b) => b.event === 'snapshot');
    assert.ok(snapshot.data.events.length >= 2);
    const lastSeen = snapshot.data.events.at(-1).sequence;
    assert.equal(snapshot.id, lastSeen);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(hub.listenerCount(jobId), 0, 'el listener se limpia al desconectarse el cliente');
    // Reconexión con Last-Event-ID: solo eventos posteriores, sin duplicados, y cierre al terminar.
    setTimeout(release, 60);
    const second = await readSse(`${url}/jobs/${jobId}/events`, { headers: { 'Last-Event-ID': String(lastSeen) }, until: (b) => b.event === 'end' });
    const resent = second.blocks.find((b) => b.event === 'snapshot').data.events;
    const streamed = second.blocks.filter((b) => b.event === 'live').map((b) => b.data);
    const after = [...resent, ...streamed];
    assert.ok(after.every((e) => e.sequence > lastSeen));
    assert.equal(new Set(after.map((e) => e.sequence)).size, after.length);
    assert.deepEqual(after.map((e) => e.sequence), after.map((e) => e.sequence).sort((a, b) => a - b));
    assert.equal(after.at(-1).phase, 'completed');
    assert.equal(second.blocks.at(-1).event, 'end');
    // El cliente une ambas conexiones sin duplicar.
    const merged = mergeEvents(mergeEvents([], snapshot.data.events), [...snapshot.data.events, ...after]);
    const full = store.get(jobId).run.events;
    assert.deepEqual(merged.map((e) => e.sequence), full.map((e) => e.sequence));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(hub.listenerCount(), 0);
    // Un trabajo terminado envía snapshot completo + end y cierra de inmediato.
    const finished = await readSse(`${url}/jobs/${jobId}/events`);
    assert.deepEqual(finished.blocks.filter((b) => b.event).map((b) => b.event), ['snapshot', 'end']);
    assert.equal(finished.blocks[1].data.events.length, full.length);
  } finally {
    release();
    await app.close();
    store.close();
  }
});

test('a missing job answers 404 JOB_NOT_FOUND on status and SSE so the client can recover silently', async () => {
  const store = createStore(':memory:');
  const app = createApp({ store, env: {}, browser: null });
  const url = await listen(app);
  try {
    const missing = '0b7a2f7e-1111-4222-8333-444455556666';
    const status = await fetch(`${url}/jobs/${missing}`);
    assert.equal(status.status, 404);
    assert.equal((await status.json()).code, 'JOB_NOT_FOUND');
    const stream = await readSse(`${url}/jobs/${missing}/events`);
    assert.equal(stream.status, 404);
    assert.equal(stream.body.code, 'JOB_NOT_FOUND');
    assert.equal((await fetch(`${url}/jobs/${missing}/frames/abcdef0123456789`)).status, 404);
    // Tras la recuperación se puede iniciar otra investigación normalmente.
    const started = await fetch(`${url}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...brief, dataMode: 'demo' }) });
    assert.equal(started.status, 202);
  } finally {
    await app.close();
    store.close();
  }
});

test('the cancel endpoint aborts the active job and allows a new search afterward', async () => {
  const store = createStore(':memory:');
  const pipeline = async (job, jobStore, { signal }) => {
    job.status = 'running';
    jobStore.save(job);
    try {
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } catch {
      job.status = 'failed';
      job.events.push({ phase: 'error', message: 'Stopped by the user.', at: new Date().toISOString() });
      jobStore.save(job);
    }
  };
  const app = createApp({ store, env: {}, pipeline, browser: null });
  const url = await listen(app);
  try {
    const started = await fetch(`${url}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief) });
    const { jobId } = await started.json();
    const cancelled = await fetch(`${url}/jobs/${jobId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(cancelled.status, 202);
    assert.equal((await cancelled.json()).cancelled, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const stopped = await (await fetch(`${url}/jobs/${jobId}`)).json();
    assert.equal(stopped.status, 'failed');
    assert.match(stopped.events.at(-1).message, /stopped by the user/i);
    const alreadyStopped = await fetch(`${url}/jobs/${jobId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(alreadyStopped.status, 200);
    assert.equal((await alreadyStopped.json()).cancelled, false);
    const restarted = await fetch(`${url}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief) });
    assert.equal(restarted.status, 202);
  } finally {
    await app.close();
    store.close();
  }
});

test('frontend model: dedupe, steps, parallel sources, manual-independent auto focus', () => {
  const ev = (sequence, phase, extra = {}) => ({ id: `j:${sequence}`, sequence, at: new Date(1_700_000_000_000 + sequence * 1000).toISOString(), phase, title: phase, message: `${phase} ${sequence}`, ...extra });
  const events = [
    ev(1, 'planning', { status: 'success', detail: { kind: 'plan', items: [], sources: ['A', 'B', 'C'] } }),
    ev(2, 'source_started', { provider: 'A', status: 'running', detail: { parallel: 2 } }),
    ev(3, 'source_started', { provider: 'B', status: 'running', detail: { parallel: 2 } }),
    ev(4, 'api_request', { provider: 'A', status: 'running', detail: { kind: 'api', callId: 'c1', method: 'GET', host: 'api.a.org', endpoint: 'https://api.a.org/x', params: {} } }),
    ev(5, 'browser_opened', { provider: 'B', status: 'running', detail: { kind: 'page', visitId: 'v1', host: 'b.org' } }),
  ];
  assert.deepEqual(mergeEvents(events, [events[2], events[4]]), events, 'sin cambios si todo está repetido');
  const shuffled = mergeEvents([events[3], events[0]], [events[4], events[1], events[2], events[0]]);
  assert.deepEqual(shuffled.map((e) => e.sequence), [1, 2, 3, 4, 5]);
  const steps = buildSteps(events);
  assert.deepEqual(steps.map((s) => s.id), ['plan', 'source:A', 'source:B', 'source:C', 'evaluate', 'draft']);
  assert.deepEqual(steps.filter((s) => s.state === 'running').map((s) => s.title), ['A', 'B']);
  assert.equal(steps.find((s) => s.title === 'C').state, 'pending');
  assert.equal(autoFocus(steps).title, 'B', 'el foco sigue la actividad real más reciente');
  const withFrame = [...events, ev(6, 'page_loaded', { provider: 'B', detail: { kind: 'page', visitId: 'v1', host: 'b.org', httpStatus: 200 } }), ev(7, 'screenshot', { provider: 'B', frameId: 'f1', detail: { kind: 'page', visitId: 'v1', host: 'b.org' } }), ev(8, 'api_response', { provider: 'A', status: 'success', resultCount: 3, durationMs: 90, detail: { kind: 'api', callId: 'c1', method: 'GET', host: 'api.a.org', endpoint: 'https://api.a.org/x', params: {}, httpStatus: 200 } })];
  const after = buildSteps(withFrame);
  const [page] = operations(after.find((s) => s.title === 'B'));
  assert.equal(page.frameId, 'f1');
  assert.equal(page.state, 'reading');
  const [call] = operations(after.find((s) => s.title === 'A'));
  assert.equal(call.response.resultCount, 3);
  assert.equal(call.state, 'processing');
  assert.equal(autoFocus(after).title, 'A');
});

test('real Chromium (when installed): local page opened, captured as JPEG, video blocked, secrets stripped', async (t) => {
  let videoRequested = false;
  const site = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(404); res.end(); return; }
    if (req.url.endsWith('.mp4')) { videoRequested = true; res.writeHead(200); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body style="background:#eef3ff"><h1>Programa oficial</h1><p>The a2 Collective anticipates new awards.</p><video src="/clip.mp4" autoplay muted></video></body></html>');
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const browser = createBrowserService({ env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } });
  const frames = createFrameStore();
  const job = newJob('chromium');
  try {
    const client = makeClient({ env: {}, live: recorderFor(job), browser, frames: frameFacade(frames, 'chromium') });
    const text = await client.scope('Sitio local').page(`http://127.0.0.1:${site.address().port}/page?api_key=SHOULD_NOT_LEAK&q=ok`);
    if (!browser.status().available) {
      t.skip(`Chromium no disponible: ${browser.status().reason}`);
      return;
    }
    assert.match(text, /anticipates new awards/);
    const shot = job.run.events.find((e) => e.phase === 'screenshot');
    const frame = frames.get(shot.frameId);
    assert.equal(frame.buffer[0], 0xff);
    assert.equal(frame.buffer[1], 0xd8, 'JPEG');
    assert.ok(frame.buffer.length < 400_000);
    assert.equal(videoRequested, false);
    assert.doesNotMatch(JSON.stringify(job.run.events), /SHOULD_NOT_LEAK/);
    assert.equal(browser.status().maxOpenPages, 1);
  } finally {
    await browser.close();
    frames.close();
    site.close();
  }
});

test('visual scenes map one-to-one to real operations and wait for real responses', async () => {
  const store = createStore(':memory:');
  const job = newJob('scenes');
  const frames = createFrameStore();
  await runResearch(job, store, {
    env: {}, browser: fakeBrowser(), frames,
    fetcher: fakeFetch({ 'api.example.org': new Response(JSON.stringify({ results: [{ title: 'Alzheimer award', agency: 'NIA' }, { title: 'Second' }] }), { status: 200 }) }),
    providers: [
      ['API', async (c) => { await c.json('https://api.example.org/search?q=alzheimer&api_key=zz'); return []; }],
      ['Web', async (c) => { await c.page('https://site.example.org/program'); return []; }],
    ],
  });
  const scenes = buildScenes(job.run.events);
  const kinds = scenes.map((s) => s.kind);
  assert.deepEqual(kinds.filter((k) => k !== 'search' && k !== 'page'), ['profile', 'network', 'evaluate', 'draft', 'done'].filter((k) => kinds.includes(k)));
  assert.equal(kinds.filter((k) => k === 'search').length, 1);
  assert.equal(kinds.filter((k) => k === 'page').length, 1);
  assert.ok(scenes.every((s) => s.complete));
  const search = scenes.find((s) => s.kind === 'search');
  const response = search.events.find((e) => e.phase === 'api_response');
  assert.deepEqual(response.detail.preview, [{ title: 'Alzheimer award', subtitle: 'NIA' }, { title: 'Second', subtitle: null }]);
  assert.equal(search.events[0].detail.query, 'alzheimer');
  assert.ok(scenes.find((s) => s.kind === 'page').events.some((e) => e.frameId));
  // Una petición sin respuesta deja la escena incompleta: la animación espera en lugar de inventar resultados.
  const pending = buildScenes(job.run.events.filter((e) => !(e.phase === 'api_response' || (e.phase === 'source_completed' && e.provider === 'API'))));
  assert.equal(pending.find((s) => s.kind === 'search').complete, false);
  frames.close();
  store.close();
});
