import test from 'node:test';
import assert from 'node:assert/strict';
import { candidate, evidence, evaluate } from '../server/research/core.mjs';
import { enrichWithHunter, leadDomain, registrableDomain, makeHunter } from '../server/research/hunter.mjs';
import { orchestrate, metricsOf, ruleAssessment, templateQueries, searchRowsToLeads, reflect, mergeLeads } from '../server/research/orchestrator.mjs';
import { jevProvider, systemOne } from '../server/research/jev.mjs';
import { serperSearch, searchProviders, multiSearch } from '../server/research/searchApis.mjs';
import { firecrawlSearch, firecrawlSearchMany, resetProviderBreakers } from '../server/research/webscrape.mjs';

const brief = { venture: 'Mentiva', company: 'Mentiva', industry: 'digital mental health', stage: 'pre-seed', geography: 'GLOBAL', fundingTypes: ['investment'], exclusions: '', minDays: 14, criteria: '', constraints: '' };
const orgLead = (name, url, extra = {}) => candidate({ externalId: `t:${url}`, org: name, title: `${name} invests in digital mental health`, kind: 'research', fundingType: 'investment', contact: { type: 'web', value: url }, evidence: [evidence('test', url, `${name} invests in digital mental health pre-seed startups`, 'profile')], searchText: 'digital mental health pre-seed', ...extra });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('hunter: dominio registrable y dominio propio del lead (sin prensa ni registros)', () => {
  assert.equal(registrableDomain('www.team.acme.co.uk'), 'acme.co.uk');
  assert.equal(registrableDomain('blog.acmevc.com'), 'acmevc.com');
  assert.equal(leadDomain(orgLead('Acme VC', 'https://www.acmevc.com/team')), 'acmevc.com');
  assert.equal(leadDomain(orgLead('News', 'https://techcrunch.com/2026/01/x')), '');
  assert.equal(leadDomain(orgLead('NIH', 'https://grants.nih.gov/x')), '');
  assert.equal(leadDomain(orgLead('LinkedIn', 'https://www.linkedin.com/company/x')), '');
});

test('hunter: email-finder añade email a personas y domain-search añade personas con email a organizaciones', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(String(url));
    assert.equal(init.headers['X-API-KEY'], 'hk', 'la clave va en cabecera, no en la URL');
    assert.ok(!String(url).includes('hk'));
    if (String(url).includes('email-finder')) return json(200, { data: { email: 'ana.ruiz@acmevc.com', score: 91, position: 'Partner', sources: [{ uri: 'https://acmevc.com/team' }], verification: { status: 'valid' } } });
    if (String(url).includes('domain-search')) return json(200, { data: { organization: 'Beta Ventures', emails: [
      { value: 'lu@betaventures.com', confidence: 95, first_name: 'Lu', last_name: 'Chen', position: 'General Partner', seniority: 'executive', sources: [{ uri: 'https://betaventures.com/about' }], verification: { status: 'valid' } },
      { value: 'ops@betaventures.com', confidence: 99, first_name: 'Sam', last_name: 'Ops', position: 'Office manager', seniority: 'junior' },
      { value: 'low@betaventures.com', confidence: 20, first_name: 'Lo', last_name: 'Score', position: 'Partner' },
    ] } });
    throw new Error('unexpected');
  };
  const person = { ...orgLead('Acme VC', 'https://acmevc.com/team'), person: 'Ana Ruiz', role: 'Partner', kind: 'person' };
  const ranked = evaluate([person, orgLead('Beta Ventures', 'https://betaventures.com')], brief);
  const { leads, stats } = await enrichWithHunter(ranked, brief, { env: { HUNTER_API_KEY: 'hk' }, fetcher });
  assert.equal(stats.emailsAdded, 1);
  assert.equal(stats.peopleAdded, 1, 'solo la persona con cargo relevante y confianza suficiente');
  const ana = leads.find((l) => l.person === 'Ana Ruiz');
  assert.equal(ana.contact.type, 'email'); assert.equal(ana.contact.value, 'ana.ruiz@acmevc.com');
  assert.match(ana.contact.provenance, /Hunter\.io · acmevc\.com · confidence 91% · valid/);
  const lu = leads.find((l) => l.person === 'Lu Chen');
  assert.equal(lu.contact.value, 'lu@betaventures.com'); assert.equal(lu.org, 'Beta Ventures'); assert.equal(lu.kind, 'person');
  assert.ok(lu.evidence.some((e) => e.url === 'https://betaventures.com/about' && e.verified));
  assert.equal(calls.length, 2);
});

test('hunter: 401/cuota apaga Hunter para el resto de la corrida; presupuesto de llamadas', async () => {
  let n = 0;
  const fetcher = async () => { n++; return json(401, { errors: [{ id: 'authentication_failed', details: 'No user found for the API key supplied' }] }); };
  const ranked = evaluate([orgLead('A', 'https://a-fund.com'), orgLead('B', 'https://b-fund.com'), orgLead('C', 'https://c-fund.com')], brief);
  const { stats } = await enrichWithHunter(ranked, brief, { env: { HUNTER_API_KEY: 'bad' }, fetcher });
  assert.equal(n, 1, 'no sigue llamando tras un 401');
  assert.match(stats.errors[0], /Hunter HTTP 401/);
  const h = makeHunter({ env: { HUNTER_API_KEY: 'k', HUNTER_MAX_CALLS: '1' }, fetcher: async () => json(200, { data: { emails: [] } }) });
  await h.domainSearch('x.com');
  await assert.rejects(h.domainSearch('y.com'), /budget/);
});

test('hunter: en grants el contacto del programa queda en la oportunidad, no como candidato aparte', async () => {
  const opp = candidate({ externalId: 'g1', org: 'Wellness Foundation', title: 'Digital mental health grant 2027', kind: 'opportunity', fundingType: 'grant', status: 'open', deadline: '2027-01-15', contact: { type: 'web', value: 'https://wellnessfoundation.org/grants' }, evidence: [evidence('t', 'https://wellnessfoundation.org/grants', 'Digital mental health grant; applications open', 'opportunity')] });
  const fetcher = async () => json(200, { data: { emails: [{ value: 'grants@wellnessfoundation.org', confidence: 90, first_name: 'Mia', last_name: 'Lopez', position: 'Program Officer' }] } });
  const gb = { ...brief, fundingTypes: ['grant'] };
  const { leads, stats } = await enrichWithHunter(evaluate([opp], gb), gb, { env: { HUNTER_API_KEY: 'k' }, fetcher });
  assert.equal(leads.length, 1); assert.equal(stats.peopleAdded, 0); assert.equal(stats.emailsAdded, 1);
  assert.equal(leads[0].contact.value, 'grants@wellnessfoundation.org');
  assert.match(leads[0].contact.provenance, /Mia Lopez, Program Officer/);
});

test('openjev: proveedor por defecto, localhost sin clave, https obligatorio y respuesta de error de OpenJev', async () => {
  assert.equal(jevProvider({}), null);
  assert.deepEqual(jevProvider({ OPENJEV_API_KEY: 'o' }).name, 'OpenJev');
  assert.equal(jevProvider({ OPENJEV_API_KEY: 'o' }).url, 'https://api.codiv.ai/v1/systemone');
  assert.equal(jevProvider({ OPENJEV_API_URL: 'http://127.0.0.1:8080/v1/systemone' }).name, 'OpenJev');
  assert.equal(jevProvider({ JEV_API_KEY: 'j' }).name, 'Jev');
  assert.equal(jevProvider({ JEV_API_KEY: 'j', OPENJEV_API_KEY: 'o', JEV_PROVIDER: 'jev' }).name, 'Jev');
  await assert.rejects(systemOne({}, { q: { type: 'noul' } }, { env: { OPENJEV_API_KEY: 'o', OPENJEV_API_URL: 'http://example.com/v1/systemone' }, fetcher: async () => json(200, {}) }), /HTTPS/);
  await assert.rejects(systemOne({}, { q: { type: 'noul' } }, { env: { OPENJEV_API_KEY: 'o' }, fetcher: async () => json(422, { detail: { error_type: 'invalid_request', message: 'bad question' } }) }), /OpenJev returned 422: bad question/);
  let sent;
  const r = await systemOne({ a: 1 }, { q: { type: 'noul' } }, { env: { OPENJEV_API_KEY: 'o' }, fetcher: async (url, init) => { sent = { url, init }; return json(200, { model: 'openjev-0.1', answers: { q: { noul: 0.8 } } }); } });
  assert.equal(sent.init.headers.Authorization, 'Bearer o'); assert.equal(JSON.parse(sent.init.body).model, 'openjev-latest');
  assert.equal(r.answers.q.noul, 0.8); assert.equal(r.provider, 'OpenJev');
});

test('orquestador: métricas, reglas y consultas por estrategia', () => {
  const ranked = evaluate([orgLead('A', 'https://a-fund.com'), orgLead('B', 'https://b-fund.com')], brief);
  const m = metricsOf(ranked);
  assert.equal(m.top, 2); assert.equal(m.withEmail, 0);
  const r = ruleAssessment(m, { env: {} });
  assert.equal(r.sufficient, false); assert.equal(r.gap, 'too_few'); assert.equal(r.strategy, 'named_funders');
  assert.equal(ruleAssessment(m, { env: {}, tried: ['named_funders'] }).strategy, 'adjacent_terms');
  const geo = templateQueries('geography', brief, { year: 2026 });
  assert.ok(geo.some((q) => /Latin America/.test(q.query)) && geo.every((q) => q.objective === 'investment'));
  assert.ok(templateQueries('adjacent_terms', brief, { terms: [{ term: 'mood tracking' }], year: 2026 })[0].query.includes('mood tracking'));
  assert.ok(templateQueries('named_funders', brief, { ranked: evaluate([orgLead('Beta Health Ventures', 'https://beta.vc')], brief) }).some((q) => /similar to Beta Health Ventures/.test(q.query)));
});

test('orquestador: filas de búsqueda → candidatos (sin agregadores ni la propia empresa)', () => {
  const rows = [
    { url: 'https://fund-one.com/thesis', title: 'Fund One', description: 'We back mental health founders', markdown: 'Fund One invests in pre-seed mental health startups '.repeat(20), providers: ['serper', 'exa'] },
    { url: 'https://www.f6s.com/list', title: 'List', description: 'top investors', providers: ['serper'] },
    { url: 'https://mentiva.app', title: 'Mentiva', description: 'us', providers: ['you'] },
  ];
  const leads = searchRowsToLeads(rows, brief, { objective: 'investment', query: 'q' });
  assert.equal(leads.length, 1); assert.equal(leads[0].org, 'fund-one.com'); assert.equal(leads[0].evidence[0].verified, true);
  const g = searchRowsToLeads([{ url: 'https://x.org/news', title: 'Our team', description: 'photos' }], { ...brief, fundingTypes: ['grant'] }, { objective: 'grant' });
  assert.equal(g.length, 0, 'grants: solo páginas que hablan de convocatorias');
});

test('orquestador: reflexiona con OpenJev, hace 2 intentos con estrategias distintas y se detiene', async () => {
  const seenStates = []; const strategies = [];
  const jev = async (state, questions) => {
    seenStates.push(state);
    assert.ok(questions.sufficient && questions.gap && questions.strategy && questions.quality);
    assert.ok(!JSON.stringify(state).includes('@'), 'el estado no lleva emails');
    return { provider: 'OpenJev', model: 'openjev-0.1', answers: { sufficient: { noul: 0.1 }, gap: { choice: 'too_few' }, strategy: { choice: seenStates.length === 1 ? 'geography' : 'geography' }, quality: { score: 1 } } };
  };
  let i = 0;
  const runSearch = async (queries, { strategy }) => { strategies.push(strategy); i++; return [orgLead(`New ${i}`, `https://new-${i}.com`)]; };
  const events = [];
  const out = await orchestrate({ leads: [orgLead('A', 'https://a-fund.com')], brief, rank: (l) => evaluate(l, brief), runSearch, env: { ORCHESTRATOR_MAX_ATTEMPTS: '2' }, jev, live: (e) => events.push(e), chat: null });
  assert.equal(out.attempts.length, 2);
  assert.deepEqual(strategies, ['geography', 'named_funders'], 'no repite una estrategia ya probada');
  assert.equal(out.leads.length, 3);
  assert.equal(out.attempts[1].after.top, 3);
  assert.ok(events.some((e) => /Reflection 1/.test(e.title)) && events.some((e) => /Attempt 2 done/.test(e.title)));
});

test('orquestador: si ya es suficiente no busca; sin tiempo, tampoco', async () => {
  const many = Array.from({ length: 12 }, (_, k) => ({ ...orgLead(`F${k}`, `https://f${k}.com`), contact: { type: 'email', value: `a@f${k}.com` } }));
  let searched = 0;
  const runSearch = async () => { searched++; return []; };
  const ok = await orchestrate({ leads: many, brief, rank: (l) => evaluate(l, brief), runSearch, env: {}, chat: null });
  assert.equal(searched, 0); assert.equal(ok.attempts[0].stopped, 'sufficient');
  const late = await orchestrate({ leads: [orgLead('A', 'https://a.com')], brief, rank: (l) => evaluate(l, brief), runSearch, env: {}, deadline: Date.now() + 1000, chat: null });
  assert.equal(searched, 0); assert.equal(late.attempts[0].stopped, 'time');
});

test('orquestador: OpenJev caído → reglas, con aviso', async () => {
  const view = await reflect(brief, evaluate([orgLead('A', 'https://a.com')], brief), { env: { OPENJEV_API_KEY: 'o' }, jev: async () => { throw new Error('OpenJev returned 503'); } });
  assert.equal(view.by, 'rules'); assert.match(view.warning, /503/);
});

test('mergeLeads conserva el email nuevo sin duplicar', () => {
  const a = { ...orgLead('A', 'https://a.com'), person: 'Ana Ruiz' };
  const merged = mergeLeads([a], [{ ...a, contact: { type: 'email', value: 'ana@a.com' } }, orgLead('B', 'https://b.com')]);
  assert.equal(merged.length, 2); assert.equal(merged[0].contact.value, 'ana@a.com');
});

test('serper: proveedor del buscador múltiple (clave en cabecera, tbs por recencia) y por defecto sin Firecrawl', async () => {
  let sent;
  const rows = await serperSearch('mental health seed fund', { env: { SERPER_API_KEY: 'sk' }, recency: 'year', fetcher: async (url, init) => { sent = { url, init }; return json(200, { organic: [{ link: 'https://fund.com', title: 'Fund', snippet: 'We invest', date: 'Jan 2026' }, { link: 'http://127.0.0.1/x', title: 'bad' }] }); } });
  assert.equal(sent.url, 'https://google.serper.dev/search'); assert.equal(sent.init.headers['X-API-KEY'], 'sk');
  assert.equal(JSON.parse(sent.init.body).tbs, 'qdr:y');
  assert.equal(rows.length, 1); assert.equal(rows[0].provider, 'serper'); assert.equal(rows[0].markdown, '');
  assert.deepEqual(searchProviders({ SERPER_API_KEY: 's', FIRECRAWL_API_KEY: 'f', EXA_API_KEY: 'e' }), ['exa', 'serper']);
  assert.deepEqual(searchProviders({ SERPER_API_KEY: 's', FIRECRAWL_API_KEY: 'f', ENGINE_SEARCH_PROVIDERS: 'serper,firecrawl' }), ['serper', 'firecrawl']);
  const merged = await multiSearch('q', { providers: ['serper', 'x'], fns: { serper: async () => rows, x: async () => [{ ...rows[0], provider: 'x', markdown: 'long page '.repeat(80) }] } });
  assert.deepEqual(merged[0].providers, ['serper', 'x']); assert.ok(merged[0].markdown.length > 100);
});

test('firecrawl: reintenta 429/5xx, 402 se reporta claro y corta las demás búsquedas', async () => {
  resetProviderBreakers();
  let n = 0;
  const flaky = async () => { n++; return n < 3 ? json(n === 1 ? 429 : 502, { error: 'busy' }) : json(200, { success: true, data: { web: [{ url: 'https://a.org/x', title: 'A', markdown: null, metadata: { statusCode: 200 } }] }, creditsUsed: 1 }); };
  const rows = await firecrawlSearch('q', { env: { FIRECRAWL_API_KEY: 'f', WEB_RETRIES: '2' }, fetcher: flaky });
  assert.equal(n, 3); assert.equal(rows.length, 1); assert.equal(rows[0].markdown, '', 'markdown null → vacío, no "null"');
  resetProviderBreakers();
  let m = 0;
  const broke = async () => { m++; return json(402, { success: false, error: 'Insufficient credits' }); };
  const many = await firecrawlSearchMany(['q1', 'q2', 'q3'], { env: { FIRECRAWL_API_KEY: 'f' }, fetcher: broke });
  assert.equal(m, 1, 'un 402 no se reintenta ni se repite en las demás consultas');
  assert.match(many.errors[0], /HTTP 402 \(out of credits/);
  await assert.rejects(firecrawlSearch('q', { env: { FIRECRAWL_API_KEY: 'f' }, fetcher: broke }), /disabled after a key\/credit error/);
  resetProviderBreakers();
  const ok200fail = async () => json(200, { success: false, error: 'Search timed out' });
  await assert.rejects(firecrawlSearch('q', { env: { FIRECRAWL_API_KEY: 'f', WEB_RETRIES: '0' }, fetcher: ok200fail }), /Search timed out/);
  resetProviderBreakers();
});

test('pipeline completo: Serper + orquestador (OpenJev) + Hunter → más resultados y con email', async () => {
  const { createStore } = await import('../server/research/store.mjs');
  const { runResearch } = await import('../server/research/pipeline.mjs');
  const { validateBrief } = await import('../server/research/core.mjs');
  const store = createStore(':memory:');
  const b = validateBrief({ name: 'Tester', role: 'Founder', company: 'Mentiva', product: 'Wellbeing app', description: 'digital mental health', industry: 'digital mental health', stage: 'prototype', geography: 'GLOBAL', fundingTypes: ['investment'], dataMode: 'live', useTeam: false, useApify: false, minDays: 14 });
  const job = { id: 'orch', brief: b, mode: 'live', events: [], leads: [], senderEvidence: [] };
  const seen = { serper: 0, hunter: 0, openjev: 0 };
  let fund = 0;
  const fetcher = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
    if (u.hostname === 'google.serper.dev') {
      seen.serper++; fund++;
      if (u.pathname === '/news') return json(200, { news: [] });
      return json(200, { organic: [{ link: `https://fund${fund}.vc/`, title: `Fund ${fund} · digital mental health pre-seed`, snippet: `Fund ${fund} invests in digital mental health pre-seed startups` }] });
    }
    if (/^fund\d+\.vc$/.test(u.hostname)) return new Response(`<html><head><title>${u.hostname} | Home</title></head><body><p>We are an early-stage venture fund. We invest in digital mental health startups at pre-seed and seed, with checks from $250k.</p><p>${'Our portfolio and team. '.repeat(30)}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    if (u.hostname === 'api.hunter.io') {
      seen.hunter++;
      const domain = u.searchParams.get('domain');
      return json(200, { data: { organization: domain, emails: [{ value: `gp@${domain}`, confidence: 93, first_name: 'Pat', last_name: `Lee ${domain.split('.')[0]}`, position: 'General Partner', seniority: 'executive', verification: { status: 'valid' } }] } });
    }
    if (u.hostname === 'api.codiv.ai') {
      seen.openjev++;
      const body = JSON.parse(init.body);
      if (body.questions.sufficient) return json(200, { model: 'openjev-0.1', answers: { sufficient: { noul: 0.2 }, gap: { choice: 'too_few' }, strategy: { choice: 'adjacent_terms' }, quality: { score: 1 } } });
      return json(200, { model: 'openjev-0.1', answers: Object.fromEntries(Object.keys(body.questions).map((k) => [k, k.endsWith('_action') ? { choice: 'prioritize', confidence: 0.9 } : k.endsWith('_fit') ? { score: 3, confidence: 0.8 } : { noul: 0.9 }])) });
    }
    throw new Error(`unexpected ${url}`);
  };
  await runResearch(job, store, { env: { SERPER_API_KEY: 's', HUNTER_API_KEY: 'h', OPENJEV_API_KEY: 'o', ORCHESTRATOR_MAX_ATTEMPTS: '2', RESEARCH_RUN_TIMEOUT_MS: '120000', ORCHESTRATOR_RESERVE_MS: '5000', ORCHESTRATOR_MIN_REMAINING_MS: '5000', EXPAND_TERMS: '0' }, fetcher });
  assert.notEqual(job.status, 'failed', job.events.map((e) => e.message).join('\n'));
  assert.equal(job.orchestrator.by, 'OpenJev');
  assert.equal(job.orchestrator.attempts.filter((a) => a.strategy).length, 2, 'dos intentos adicionales');
  assert.ok(seen.openjev >= 3, `reflexión ×2 + triage (${seen.openjev})`);
  const withEmail = job.leads.filter((l) => l.contact?.type === 'email');
  assert.ok(withEmail.length >= 3, `emails: ${withEmail.length}`);
  assert.ok(withEmail.every((l) => /Hunter\.io/.test(l.contact.provenance)));
  assert.ok(job.hunter.peopleAdded >= 3);
  assert.ok(job.leads.some((l) => l.jev?.provider === 'OpenJev'));
  store.close();
});
