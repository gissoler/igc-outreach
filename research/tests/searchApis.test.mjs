import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProviders, searchApisConfigured, linkupSearch, exaSearchApi, youSearch, tavilySearch, jinaSearch, jinaRead, multiSearch, urlKey } from '../server/research/searchApis.mjs';
import { runObjective } from '../server/research/engine.mjs';
import { fleetConfig } from '../server/analysis/fleet.mjs';

const ENV = { LINKUP_API_KEY: 'lk', EXA_API_KEY: 'ex', YOU_API_KEY: 'yo', TAVILY_API_KEY: 'tv', JINA_API_KEY: 'ji' };
const LONG = 'Mental health innovation prize. The application deadline is 15 November 2026. Open to startups anywhere in the world. '.repeat(8);
const res = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const calls = [];
const fetcher = async (url, init = {}) => {
  const u = String(url); calls.push({ u, init });
  if (u.startsWith('https://api.linkup.so/v1/search')) return res({ results: [{ type: 'text', name: 'Prize', url: 'https://prize.example.org/call?utm_source=x', content: LONG }, { name: 'Local', url: 'http://127.0.0.1/x', content: 'x' }] });
  if (u.startsWith('https://api.exa.ai/search')) return res({ results: [{ url: 'https://www.prize.example.org/call/', title: 'Prize (Exa)', text: 'short', publishedDate: '2026-08-01' }, { url: 'https://fund.example.vc/', title: 'Fund', text: LONG }], costDollars: { total: 0.005 } });
  if (u.startsWith('https://ydc-index.io/v1/search')) return res({ results: { web: [{ url: 'https://only-you.example.org/p', title: 'You', description: 'desc', snippets: ['a snippet'] }] } });
  if (u.startsWith('https://api.tavily.com/search')) return res({ error: 'bad key' }, 401);
  if (u.startsWith('https://s.jina.ai/')) return res({ code: 200, data: [{ url: 'https://prize.example.org/call', title: 'Prize (Jina)', description: 'd', content: LONG }] });
  if (u.startsWith('https://r.jina.ai/')) return res({ code: 200, data: { url: u.slice(18), title: 'Read', content: LONG } });
  throw new Error(`unexpected ${u}`);
};

test('proveedores: solo los que tienen clave; ENGINE_SEARCH_PROVIDERS filtra', () => {
  assert.deepEqual(searchProviders(ENV), ['linkup', 'exa', 'you', 'tavily', 'jina']);
  assert.deepEqual(searchProviders({ ...ENV, ENGINE_SEARCH_PROVIDERS: 'exa, jina,foo' }), ['exa', 'jina']);
  assert.deepEqual(searchProviders({ EXA_API_KEY: ' ' }), []);
  assert.equal(searchApisConfigured({}), false);
});

test('cada proveedor usa su endpoint y su cabecera de clave, y normaliza la respuesta', async () => {
  calls.length = 0;
  const lk = await linkupSearch('q', { env: ENV, fetcher });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer lk'); assert.equal(JSON.parse(calls[0].init.body).outputType, 'searchResults');
  assert.equal(lk.length, 1, 'descarta URL privada'); assert.ok(lk[0].markdown.length > 600);
  const ex = await exaSearchApi('q', { env: ENV, fetcher });
  assert.equal(calls[1].init.headers['x-api-key'], 'ex'); assert.equal(ex.costUsd, 0.005); assert.equal(ex[0].markdown, '', 'texto corto = snippet');
  const yo = await youSearch('q', { env: ENV, fetcher });
  assert.equal(calls[2].init.headers['X-API-Key'], 'yo'); assert.match(calls[2].u, /query=q/); assert.match(yo[0].description, /a snippet/);
  await assert.rejects(() => tavilySearch('q', { env: ENV, fetcher }), /Tavily HTTP 401/);
  assert.equal(JSON.parse(calls[3].init.body).include_raw_content, 'markdown');
  const ji = await jinaSearch('q', { env: ENV, fetcher });
  assert.equal(calls[4].init.headers.Authorization, 'Bearer ji'); assert.equal(ji[0].provider, 'jina');
  for (const c of calls) assert.ok(!/lk|ex|yo|tv|ji/.test(new URL(c.u).search.replace(/query=q|q=q/, '')), 'la clave nunca va en la URL');
});

test('multiSearch une por URL (www, barra, utm), cuenta consenso y no cae si un proveedor falla', async () => {
  const r = await multiSearch('q', { env: ENV, fetcher });
  assert.equal(urlKey('https://www.prize.example.org/call/'), urlKey('https://prize.example.org/call?utm_source=x'));
  assert.deepEqual(r[0].providers.sort(), ['exa', 'jina', 'linkup']);
  assert.ok(r[0].markdown.length > 600, 'se queda con el texto más largo');
  assert.equal(r.length, 3);
  assert.match(r.stats.tavily.error, /401/); assert.equal(r.stats.exa.returned, 2);
});

test('jinaRead: markdown de la página; nada para URLs privadas o sin clave', async () => {
  assert.match((await jinaRead('https://a.org/f.pdf', { env: ENV, fetcher })).text, /deadline/);
  assert.equal(await jinaRead('http://10.0.0.1/', { env: ENV, fetcher }), null);
  assert.equal(await jinaRead('https://a.org/', { env: {}, fetcher }), null);
});

test('motor con APIs: consenso + auditoría por proveedor; snippet sin texto se completa con Jina Reader', async () => {
  const chat = async ({ name, user }) => {
    if (name === 'plan') return { json: { queries: [{ query: 'mental health startup prize 2026', family: 'prizes' }, { query: 'digital health grant open call', family: 'foundations' }, { query: 'wellbeing challenge apply', family: 'prizes' }] } };
    if (name === 'followup') return { json: { queries: [] } };
    const url = /PAGE URL: (\S+)/.exec(user)[1];
    return { json: { relevant: true, name: url, official: true, status: 'open', deadline: '2026-11-15', eligible: 'yes', non_dilutive: 'yes', money: 'prize', quotes: { identity: 'Mental health innovation prize.', deadline: 'The application deadline is 15 November 2026', eligible: 'Open to startups anywhere in the world' } }, model: 'm' };
  };
  const r = await runObjective('grant', { industry: 'mental health', fundingTypes: ['grant'] }, { env: { ...ENV, ENGINE_ROUNDS: '1' }, fetcher, chat, today: '2026-09-29', pageFetcher: async () => null });
  assert.match(r.audit.search, /^apis:/);
  const prize = r.findings.find((f) => /prize\.example/.test(f.url));
  assert.ok(prize && prize.providers.length === 3, JSON.stringify(r.findings.map((f) => [f.url, f.providers])));
  assert.ok(r.findings.some((f) => /only-you/.test(f.url)), 'el resultado solo-snippet de You se leyó vía Jina Reader');
  assert.ok(r.audit.jinaRead >= 1);
  assert.equal(r.audit.providers.you.keptOnlyHere, 1);
  assert.ok(r.audit.providers.tavily.errors >= 1 && r.audit.errors.some((e) => /tavily/.test(e)));
});

test('rol engine: ENGINE_LLM_* sustituye al 30B solo en el motor; sin él, cae al rol chat', () => {
  const base = { VLLM_CHAT_URL: 'http://h:8000/v1', VLLM_CHAT_MODEL: 'q30' };
  assert.equal(fleetConfig(base).roles.engine.model, 'q30');
  const big = fleetConfig({ ...base, ENGINE_LLM_URL: 'http://127.0.0.1:8010/v1/', ENGINE_LLM_MODEL: 'openai/gpt-oss-120b', ENGINE_LLM_JSON_MODE: '0' }).roles;
  assert.equal(big.engine.url, 'http://127.0.0.1:8010/v1'); assert.equal(big.engine.jsonMode, false); assert.equal(big.chat.model, 'q30');
});

test('modelos que razonan: el JSON se toma después del </think>, aunque solo venga el cierre; ENGINE_LLM_THINKING=0 lo desactiva', async () => {
  const { parseJsonContent, chatJSON } = await import('../server/analysis/fleet.mjs');
  assert.deepEqual(parseJsonContent('<think>pienso {"a":1} y sigo</think>{"queries":[1]}'), { queries: [1] });
  assert.deepEqual(parseJsonContent('Razono con {llaves} primero...\n</think>\n{"ok":true}'), { ok: true }, 'plantilla que abre <think> en el prompt');
  assert.deepEqual(parseJsonContent('{"ok":true}'), { ok: true });
  let body; const fetcher = async (u, init) => { body = JSON.parse(init.body); return { ok: true, text: async () => JSON.stringify({ model: 'm', choices: [{ message: { content: '{"x":1}' } }] }) }; };
  const env = { ENGINE_LLM_URL: 'http://h:1/v1', ENGINE_LLM_MODEL: 'Qwen/Qwen3.6-27B-FP8' };
  await chatJSON({ system: 's', user: 'u', role: 'engine' }, { env, fetcher }); assert.equal(body.chat_template_kwargs, undefined);
  await chatJSON({ system: 's', user: 'u', role: 'engine' }, { env: { ...env, ENGINE_LLM_THINKING: '0' }, fetcher }); assert.equal(body.chat_template_kwargs.enable_thinking, false);
});
