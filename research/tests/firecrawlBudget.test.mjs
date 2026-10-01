/* Gasto de Firecrawl: caché por URL, TTL, tope diario con llamadas concurrentes, nada de créditos en páginas que ya
   se descartan, y decisiones idénticas con y sin caché. Sin red: fetchers inyectados y ledger en memoria o en un
   archivo temporal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firecrawlExtract, firecrawlScrape, firecrawlSearch, resetProviderBreakers } from '../server/research/webscrape.mjs';
import { createFirecrawlLedger, createRunMeter, normalizeUrl, dailyCap, DEFAULT_DAILY_CREDITS } from '../server/research/firecrawlLedger.mjs';
import { runObjective, extractNeed } from '../server/research/engine.mjs';

const mentiva = JSON.parse(readFileSync(new URL('../eval/briefs/mentiva.json', import.meta.url), 'utf8'));
const TODAY = '2026-09-30';
const env = { FIRECRAWL_API_KEY: 'k' };
const QUOTE = 'get their dossier in by 15 January 2027 at noon';
const okExtract = (calls) => async (url, init) => { calls.push(JSON.parse(init.body).url); return new Response(JSON.stringify({ success: true, creditsUsed: 5, data: { markdown: '', json: { is_open_call: true, dates: [{ phase: 'application_deadline', quote: QUOTE }] } } }), { status: 200 }); };

test('la misma URL dos veces: la segunda no llama a Firecrawl y cuenta un acierto de caché (0 créditos)', async () => {
  resetProviderBreakers();
  const ledger = createFirecrawlLedger({ env }); const meter = createRunMeter(); const calls = [];
  const a = await firecrawlExtract('https://funder.example.org/call?utm_source=x', { env, fetcher: okExtract(calls), ledger, meter });
  const b = await firecrawlExtract('https://www.funder.example.org/call/', { env, fetcher: okExtract(calls), ledger, meter });
  assert.equal(calls.length, 1); assert.equal(a.credits, 5); assert.equal(b.cached, true); assert.equal(b.credits, 0);
  assert.deepEqual(b.json, a.json);
  assert.equal(meter.cacheHits.extract, 1); assert.equal(meter.credits, 5); assert.equal(ledger.usage().used, 5);
  // scrape y búsqueda (no principal) también
  const md = async () => new Response(JSON.stringify({ success: true, data: { markdown: 'x'.repeat(200), metadata: { title: 'T' } } }), { status: 200 });
  let n = 0; const count = (f) => async (...x) => { n++; return f(...x); };
  await firecrawlScrape('https://funder.example.org/team', { env, fetcher: count(md), ledger, meter });
  const s2 = await firecrawlScrape('https://funder.example.org/team', { env, fetcher: count(md), ledger, meter });
  assert.equal(n, 1); assert.equal(s2.cached, true); assert.equal(meter.cacheHits.scrape, 1);
  const rows = async () => new Response(JSON.stringify({ success: true, data: { web: [{ url: 'https://a.example.org', title: 'A' }] } }), { status: 200 });
  n = 0;
  await firecrawlSearch('fund team', { env, fetcher: count(rows), ledger, meter });
  const r2 = await firecrawlSearch('fund team', { env, fetcher: count(rows), ledger, meter });
  assert.equal(n, 1); assert.equal(r2.cached, true); assert.equal(r2[0].url, 'https://a.example.org/');
  // la búsqueda principal (cache:false) siempre llama
  await firecrawlSearch('fund team', { env, fetcher: count(rows), ledger, meter, cache: false, essential: true });
  assert.equal(n, 2);
  assert.equal(normalizeUrl('HTTP://www.Foo.org/a/?utm_medium=x&b=2#top'), 'https://foo.org/a?b=2');
});

test('la caché expirada vuelve a llamar (TTL FIRECRAWL_CACHE_TTL_HOURS)', async () => {
  resetProviderBreakers();
  let clock = Date.parse('2026-09-30T12:00:00Z');
  const ledger = createFirecrawlLedger({ env: { FIRECRAWL_CACHE_TTL_HOURS: '2' }, now: () => clock }); const calls = [];
  await firecrawlExtract('https://funder.example.org/ttl', { env, fetcher: okExtract(calls), ledger });
  clock += 90 * 60_000;
  assert.equal((await firecrawlExtract('https://funder.example.org/ttl', { env, fetcher: okExtract(calls), ledger })).cached, true);
  clock += 60 * 60_000;   // 2 h 30 min después de guardarla
  const again = await firecrawlExtract('https://funder.example.org/ttl', { env, fetcher: okExtract(calls), ledger });
  assert.equal(calls.length, 2); assert.ok(!again.cached); assert.equal(again.credits, 5);
  // FIRECRAWL_CACHE_TTL_HOURS=0 apaga la caché
  const off = createFirecrawlLedger({ env: { FIRECRAWL_CACHE_TTL_HOURS: '0' } });
  await firecrawlExtract('https://funder.example.org/off', { env, fetcher: okExtract(calls), ledger: off });
  await firecrawlExtract('https://funder.example.org/off', { env, fetcher: okExtract(calls), ledger: off });
  assert.equal(calls.length, 4);
});

test('la caché persiste en disco entre procesos (otro ledger sobre el mismo archivo)', async () => {
  resetProviderBreakers();
  const dir = mkdtempSync(join(tmpdir(), 'fc-cache-')); const path = join(dir, 'firecrawl-cache.sqlite'); const calls = [];
  try {
    const l1 = createFirecrawlLedger({ path, env }); await firecrawlExtract('https://funder.example.org/disk', { env, fetcher: okExtract(calls), ledger: l1 }); l1.close();
    const l2 = createFirecrawlLedger({ path, env }); const r = await firecrawlExtract('https://funder.example.org/disk', { env, fetcher: okExtract(calls), ledger: l2 });
    assert.equal(calls.length, 1); assert.equal(r.cached, true); assert.equal(l2.usage().used, 5, 'el gasto del día también se comparte'); l2.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tope diario: con llamadas concurrentes no se pasa y la llamada que no cabe gasta 0 créditos', async () => {
  resetProviderBreakers();
  const ledger = createFirecrawlLedger({ env: { FIRECRAWL_DAILY_CREDITS: '12' } }); const meter = createRunMeter(); const calls = [];
  const slow = async (url, init) => { await new Promise((r) => setTimeout(r, 30)); return okExtract(calls)(url, init); };
  const out = await Promise.all(Array.from({ length: 5 }, (_, i) => firecrawlExtract(`https://f${i}.example.org/c`, { env, fetcher: slow, ledger, meter })));
  assert.equal(calls.length, 2, 'solo caben 2 extracciones de 5 créditos en 12');
  assert.equal(out.filter((x) => x.budget).length, 3); assert.ok(out.every((x) => x.json || /daily credit cap/.test(x.error)));
  assert.equal(ledger.usage().used, 10); assert.equal(meter.capReached, true); assert.equal(meter.capSkipped.extract, 3);
  assert.equal(dailyCap({}), DEFAULT_DAILY_CREDITS); assert.equal(dailyCap({ FIRECRAWL_DAILY_CREDITS: 'unlimited' }), Infinity);
});

/* Motor */
const mkPages = (n, host = (i) => `https://f${i}.example.org/call`) => Array.from({ length: n }, (_, i) => ({ url: host(i), title: `Call ${i}`, markdown: `Call ${i} for mental health startups. Teams need to ${QUOTE}. Open to for-profit startups worldwide. Grant, no equity. How to apply: submit your application through our online portal.`, providers: ['exa'] }));
const chat = async ({ name }) => name === 'plan' ? { json: { queries: [] } } : { json: { relevant: true, kind: 'program', name: 'Call', official: true, status: 'open', deadline: null, eligible: 'yes', non_dilutive: 'yes', money: 'grant', page_type: 'call', quotes: { identity: 'for mental health startups' } } };
const quiet = { pageFetcher: async () => null, reader: async () => null };

test('motor: el tope diario se respeta con lecturas concurrentes y la corrida termina bien (audit.errors y traza)', async () => {
  resetProviderBreakers();
  const ledger = createFirecrawlLedger({ env: { FIRECRAWL_DAILY_CREDITS: '10' } }); const calls = [];
  const r = await runObjective('grant', mentiva, { chat, search: async () => mkPages(6), today: TODAY, rounds: 1, concurrency: 6, extractor: firecrawlExtract, fetcher: okExtract(calls), firecrawlLedger: ledger, env: { ...env, ENGINE_EXTRACT_MAX: '6' }, ...quiet });
  assert.equal(calls.length, 2); assert.equal(r.audit.extracted, 2); assert.equal(r.findings.length, 6);
  assert.ok(r.audit.errors.some((e) => /daily credit cap reached/.test(e))); assert.equal(r.audit.extractBudgetStopped, true);
  assert.ok(r.findings.some((f) => f.trace.extraction?.skipped === 'credit_cap'));
  assert.equal(r.audit.firecrawl.capReached, true); assert.equal(r.audit.firecrawl.credits, 10); assert.equal(r.audit.firecrawl.daily.used, 10);
});

test('una página que ya sería descartada (agregador, no elegible, cerrada por otra causa, prensa) no gasta créditos', async () => {
  resetProviderBreakers();
  const ledger = createFirecrawlLedger({ env }); const calls = [];
  const pages = [
    ...mkPages(1, () => 'https://www.fundsforngos.org/call-1'),                                  // agregador: ni se lee
    { url: 'https://nonprofit.example.org/call', title: 'NP', markdown: `Call for mental health. ${QUOTE}. Only US-based nonprofit organizations are eligible to apply. How to apply: online portal.`, providers: ['exa'] },
    ...mkPages(1, () => 'https://www.prnewswire.com/news/call'),
  ];
  const chatNo = async (x) => { if (x.name === 'plan') return chat(x); const j = (await chat(x)).json; return x.user.includes('nonprofit.example.org') ? { json: { ...j, eligible: 'no', quotes: { ...j.quotes, identity: 'Call for mental health', eligible: 'Only US-based nonprofit organizations are eligible to apply.' } } } : { json: j }; };
  const r = await runObjective('grant', mentiva, { chat: chatNo, search: async () => pages, today: TODAY, rounds: 1, extractor: firecrawlExtract, fetcher: okExtract(calls), firecrawlLedger: ledger, env, ...quiet });
  assert.equal(calls.length, 0); assert.equal(r.audit.extractCredits, 0); assert.equal(ledger.usage().used, 0);
  assert.ok(r.audit.dropped.aggregator >= 1); assert.equal(r.audit.dropped.not_eligible, 1);
  // regla: solo «cerrada» sin otra causa; nunca agregador, no convocatoria ni prensa
  assert.equal(extractNeed({ keep: false, drop: 'closed', reasons: ['closed', 'not_eligible'] }, { url: 'https://a.org' }), null);
  assert.equal(extractNeed({ keep: false, drop: 'closed', reasons: ['closed'] }, { url: 'https://a.org' }), 'closed_doubt');
  assert.equal(extractNeed({ keep: false, drop: 'aggregator', reasons: ['aggregator'] }, { url: 'https://a.org' }), null);
  assert.equal(extractNeed({ keep: true, tier: 'main', flags: [] }, { url: 'https://techcrunch.com/x' }), null);
  assert.equal(extractNeed({ keep: true, tier: 'verify', status: 'open', deadline: '2027-01-01', flags: [], pageType: { type: 'call' } }, { url: 'https://a.org' }), null, 'fecha resuelta y sin conflicto: no cambia la decisión');
  assert.equal(extractNeed({ keep: true, tier: 'verify', status: 'unknown', deadline: null, flags: [], pageType: { type: 'call' } }, { url: 'https://a.org' }), 'unresolved');
  assert.equal(extractNeed({ keep: true, tier: 'verify', status: 'open', deadline: '2027-01-01', flags: ['deadline_conflict'], pageType: { type: 'call' } }, { url: 'https://a.org' }), 'conflict');
});

test('resultados idénticos con y sin caché; la segunda corrida gasta 0 créditos de extractor', async () => {
  resetProviderBreakers();
  const pick = (r) => r.findings.map((f) => ({ url: f.url, verdict: f.verdict, tier: f.tier, deadline: f.deadline, quotes: f.quotes, deadlineQuote: f.deadlineQuote })).sort((a, b) => a.url.localeCompare(b.url));
  const opts = (ledger, calls) => ({ chat, search: async () => mkPages(4), today: TODAY, rounds: 1, extractor: firecrawlExtract, fetcher: okExtract(calls), firecrawlLedger: ledger, env, ...quiet });
  const noCacheCalls = [];
  const plain = await runObjective('grant', mentiva, opts(createFirecrawlLedger({ env, cache: false }), noCacheCalls));
  const ledger = createFirecrawlLedger({ env }); const c1 = []; const c2 = [];
  const first = await runObjective('grant', mentiva, opts(ledger, c1));
  const second = await runObjective('grant', mentiva, opts(ledger, c2));
  assert.equal(c1.length, 4); assert.equal(c2.length, 0);
  assert.equal(first.audit.extractCredits, 20); assert.equal(second.audit.extractCredits, 0); assert.equal(second.audit.extractCacheHits, 4);
  assert.deepEqual(pick(second), pick(first)); assert.deepEqual(pick(first), pick(plain));
  assert.ok(second.findings.every((f) => f.deadline === '2027-01-15' && f.trace.extraction.cached === true && f.trace.extraction.credits === 0));
});

test('timeout del extractor: no se reintenta y se cuenta como posiblemente cobrado', async () => {
  resetProviderBreakers();
  let n = 0;
  const timeout = async () => { n++; throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  const ledger = createFirecrawlLedger({ env }); const meter = createRunMeter();
  const r = await firecrawlExtract('https://funder.example.org/slow', { env, fetcher: timeout, ledger, meter });
  assert.equal(n, 1); assert.ok(/timed out/.test(r.error)); assert.equal(r.possiblyCharged, 5);
  assert.equal(meter.possiblyCharged, 5); assert.equal(meter.credits, 0); assert.equal(ledger.usage().possiblyCharged, 5);
  // un 429 sin ritmo adaptativo no existe en Firecrawl: todas las llamadas pasan por el gate (ver extractor.test.mjs)
});
