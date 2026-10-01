/* Crawl4AI como lector de páginas (sin créditos) y Firecrawl desactivable. Sin red: servidor y fetcher simulados. Los comportamientos del servidor
   real (forma exacta de la respuesta de /crawl) NO están verificados contra un Crawl4AI en marcha. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runObjective } from '../server/research/engine.mjs';
import { buildRunAudit } from '../server/research/runAudit.mjs';

const mentiva = JSON.parse(readFileSync(new URL('../eval/briefs/mentiva.json', import.meta.url), 'utf8'));
const TODAY = '2026-09-30';
const OFFICIAL = 'https://acme.example.org/prize/apply';
const CLOSED = 'https://old.example.org/prize/apply';
const BLOG = 'https://news-site.example.com/blog/acme-prize-announced';
const AGG = 'https://www.fundsforngos.org/acme-prize';
const SOCIAL = 'https://www.linkedin.com/posts/acme-prize';
const officialText = 'Acme Innovation Prize for digital mental health. Applications close 15 January 2027. Open to for-profit startups and small businesses worldwide. Grant, no equity. How to apply: submit your application through our online portal.';
const closedText = 'Old Prize for digital mental health. Applications close 15 January 2026. Open to for-profit startups worldwide. Grant, no equity. How to apply: submit your application through our online portal.';
const blogText = 'A new prize was announced this week. The Acme Innovation Prize and the Old Prize are two of the programs that startups in digital mental health should watch in 2027, say analysts at the news site.';
const TEXT = { [OFFICIAL]: officialText, [CLOSED]: closedText, [BLOG]: blogText, [AGG]: 'List of prizes and grants for NGOs and startups worldwide.', [SOCIAL]: 'Post about the Acme prize.' };
const IDENT = { [OFFICIAL]: 'Acme Innovation Prize for digital mental health', [CLOSED]: 'Old Prize for digital mental health', [BLOG]: 'A new prize was announced this week' };

/** Modelo simulado: 'research' lo dirige el guion; 'finding' lee la página como un modelo crédulo (dice abierta y elegible). */
function makeChat(script, seen = []) {
  let step = 0;
  return async ({ name, user }) => {
    if (name === 'plan') return { json: { queries: [{ query: 'digital mental health startup grant 2027', family: 'a' }, { query: 'mental health prize startups 2027', family: 'b' }, { query: 'wellbeing startup innovation prize 2027', family: 'c' }] } };
    if (name === 'research') { seen.push(user); const r = script[Math.min(step++, script.length - 1)]; if (r instanceof Error) throw r; return { json: r }; }
    if (name === 'followup') return { json: { queries: [] } };
    const url = Object.keys(IDENT).find((u) => user.includes(`PAGE URL: ${u}`));
    return { json: { relevant: true, kind: 'program', page_type: 'call', name: 'Prize', official: true, status: 'open', deadline: null, eligible: 'yes', non_dilutive: 'yes', money: 'grant', quotes: { identity: IDENT[url] || 'x' } }, model: 'sim' };
  };
}
const run = (chat, opts = {}) => runObjective('grant', mentiva, { chat, today: TODAY, rounds: 1, concurrency: 1, ...opts });
import { crawl4aiRead, crawl4aiConfigured, pickMarkdown } from '../server/research/crawl4ai.mjs';
import { firecrawlConfigured, firecrawlDisabled, firecrawlScrape, firecrawlExtract } from '../server/research/webscrape.mjs';
import { firecrawlRead, searchProviders } from '../server/research/searchApis.mjs';

const rows = (spec) => spec.map(([url, providers]) => ({ url, title: 'Acme', description: (TEXT[url] || '').slice(0, 90), markdown: '', providers }));
const C4 = { CRAWL4AI_URL: 'http://crawl4ai.internal:11235/' };
const body = (md, extra = {}) => ({ ok: true, json: async () => ({ success: true, results: [{ url: 'https://acme.example.org/p', success: true, markdown: md, metadata: { title: 'Acme' }, ...extra }] }) });
const LONG = 'Acme Innovation Prize for startups. '.repeat(10);

test('crawl4ai: pide /crawl con la URL, usa el token si hay y devuelve markdown (texto u objeto)', async () => {
  const seen = [];
  const fetcher = async (url, init) => { seen.push({ url, init }); return body({ raw_markdown: LONG, fit_markdown: 'short but dense. '.repeat(8) }); };
  const r = await crawl4aiRead('https://acme.example.org/p', { env: { ...C4, CRAWL4AI_TOKEN: 'tok' }, fetcher });
  assert.equal(seen.length, 1); assert.equal(seen[0].url, 'http://crawl4ai.internal:11235/crawl');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer tok');
  const sent = JSON.parse(seen[0].init.body); assert.deepEqual(sent.urls, ['https://acme.example.org/p']); assert.equal(sent.crawler_config.params.cache_mode, 'bypass');
  assert.equal(r.title, 'Acme'); assert.equal(r.text, LONG.trim());
  const plain = await crawl4aiRead('https://acme.example.org/p', { env: C4, fetcher: async () => body(LONG) });
  assert.equal(plain.text, LONG.trim());
  const fit = await crawl4aiRead('https://acme.example.org/p', { env: { ...C4, CRAWL4AI_MARKDOWN: 'fit' }, fetcher: async () => body({ raw_markdown: LONG, fit_markdown: 'fit version. '.repeat(10) }) });
  assert.match(fit.text, /^fit version/);
  assert.equal(pickMarkdown({ markdown_with_citations: 'x'.repeat(5) }), 'xxxxx'); assert.equal(pickMarkdown(null), '');
});

test('crawl4ai: sin servidor, con URL privada, con error, con timeout o con página vacía devuelve null y nunca lanza', async () => {
  let calls = 0; const fetcher = async () => { calls++; return body(LONG); };
  assert.equal(await crawl4aiRead('https://acme.example.org/p', { env: {}, fetcher }), null); assert.equal(crawl4aiConfigured({}), false); assert.equal(crawl4aiConfigured(C4), true);
  for (const u of ['http://localhost:8080/admin', 'http://10.0.0.5/x', 'http://169.254.169.254/latest/meta-data']) assert.equal(await crawl4aiRead(u, { env: C4, fetcher }), null, u);
  assert.equal(calls, 0, 'el servidor interno nunca recibe URLs privadas');
  assert.equal(await crawl4aiRead('https://acme.example.org/p', { env: C4, fetcher: async () => ({ ok: false, status: 500 }) }), null);
  assert.equal(await crawl4aiRead('https://acme.example.org/p', { env: C4, fetcher: async () => { throw new Error('ECONNREFUSED'); } }), null);
  assert.equal(await crawl4aiRead('https://acme.example.org/p', { env: C4, fetcher: async () => ({ ok: true, json: async () => ({ success: false }) }) }), null);
  assert.equal(await crawl4aiRead('https://acme.example.org/p', { env: C4, fetcher: async () => body('tiny') }), null);
});

test('firecrawl: FIRECRAWL_DISABLED=1 lo apaga entero aunque la clave siga en el .env', async () => {
  const on = { FIRECRAWL_API_KEY: 'k' }; const off = { FIRECRAWL_API_KEY: 'k', FIRECRAWL_DISABLED: '1' };
  assert.equal(firecrawlConfigured(on), true); assert.equal(firecrawlConfigured(off), false); assert.equal(firecrawlDisabled(off), true);
  let calls = 0; const fetcher = async () => { calls++; return { ok: true, json: async () => ({}) }; };
  assert.equal(await firecrawlRead('https://acme.example.org/p', { env: off, fetcher }), null);
  assert.equal(await firecrawlScrape('https://acme.example.org/p', { env: off, fetcher }).catch(() => null), null);
  const ex = await firecrawlExtract('https://acme.example.org/p', { env: off, fetcher }).catch((e) => ({ error: String(e) })); assert.ok(ex?.error || ex === null);
  assert.equal(calls, 0, 'ninguna llamada a Firecrawl');
  assert.ok(!searchProviders({ ...off, ENGINE_SEARCH_PROVIDERS: 'firecrawl,exa', EXA_API_KEY: 'e' }).includes('firecrawl'));
  assert.ok(searchProviders({ ...on, ENGINE_SEARCH_PROVIDERS: 'firecrawl' }).includes('firecrawl'));
});

test('motor: la página que el buscador solo trajo en trozo se lee con Crawl4AI, antes que Jina y Firecrawl, y el código decide igual', async () => {
  const order = [];
  // Páginas reales pasan de 400 caracteres (por debajo, la cadena prueba el siguiente lector); se rellena sin tocar fechas ni requisitos.
  const pad = ' Programme background and history of the funder. '.repeat(12);
  const crawl4aiReader = async (url) => { order.push('crawl4ai'); return TEXT[url] ? { url, title: 'Page', text: `${TEXT[url]}${pad}` } : null; };
  const jina = async () => { order.push('jina'); return null; };
  const fallback = async () => { order.push('firecrawl'); return null; };
  const r = await run(makeChat([]), { search: async () => rows([[OFFICIAL, ['exa']], [CLOSED, ['exa']]]), pageFetcher: async () => null, reader: jina, fallbackReader: fallback, crawl4aiReader });
  const official = r.findings.find((f) => f.url === OFFICIAL);
  assert.ok(official, 'la oficial llega por Crawl4AI'); assert.equal(official.verdict, 'apply'); assert.equal(official.deadline, '2027-01-15');
  assert.ok(!r.findings.some((f) => f.url === CLOSED)); assert.equal(r.audit.dropped.closed, 1, 'la cerrada la descarta el código con la fecha de hoy');
  assert.equal(r.audit.crawl4aiRead, 2); assert.ok(!order.includes('jina') && !order.includes('firecrawl'), 'si Crawl4AI lee, no se gasta Jina ni Firecrawl');
  assert.equal(official.trace.fetchedVia, 'crawl4ai');
  assert.equal(buildRunAudit({ engineRuns: [r.audit] }).counters.readVia.crawl4ai, 2);
});

test('motor: si Crawl4AI no responde, la cadena sigue con Jina y luego Firecrawl', async () => {
  const order = [];
  const r = await run(makeChat([]), { search: async () => rows([[OFFICIAL, ['exa']]]), pageFetcher: async () => null, crawl4aiReader: async () => { order.push('crawl4ai'); return null; }, reader: async () => { order.push('jina'); return null; }, fallbackReader: async (url) => { order.push('firecrawl'); return { url, title: 'Page', text: TEXT[url] }; } });
  assert.deepEqual(order, ['crawl4ai', 'jina', 'firecrawl']); assert.equal(r.audit.firecrawlRead, 1); assert.ok(r.findings.some((f) => f.url === OFFICIAL));
});
