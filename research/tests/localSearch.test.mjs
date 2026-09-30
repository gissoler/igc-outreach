import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, isPublicUrl, searxSearch, fetchPage } from '../server/research/localSearch.mjs';
import { runObjective } from '../server/research/engine.mjs';

test('isPublicUrl bloquea red interna (SSRF)', () => {
  for (const u of ['http://localhost:8000/x', 'http://127.0.0.1/', 'http://10.15.37.33/', 'http://192.168.1.4/', 'http://169.254.169.254/latest', 'file:///etc/passwd']) assert.equal(isPublicUrl(u), false, u);
  assert.equal(isPublicUrl('https://www.nia.nih.gov/x'), true);
});

test('htmlToText quita scripts/nav y conserva títulos', () => {
  const t = htmlToText('<html><nav>Menu</nav><script>evil()</script><h1>Prize</h1><p>Deadline: 15 November 2026 &amp; more</p></html>');
  assert.match(t, /# Prize/); assert.match(t, /Deadline: 15 November 2026 & more/); assert.ok(!/evil|Menu/.test(t));
});

test('searxSearch normaliza, deduplica y descarta URLs privadas', async () => {
  const fetcher = async (url) => { assert.match(String(url), /format=json/); return { ok: true, json: async () => ({ results: [{ url: 'https://a.org/x', title: 'A', content: 'c' }, { url: 'https://a.org/x', title: 'dup' }, { url: 'http://localhost/x', title: 'no' }] }) }; };
  const r = await searxSearch('q', { env: { SEARXNG_URL: 'http://searx:8080/' }, fetcher });
  assert.deepEqual(r.map((x) => x.url), ['https://a.org/x']);
  await assert.rejects(() => searxSearch('q', { env: {} }), /SEARXNG_URL/);
});

test('fetchPage: solo HTML público; nunca lanza', async () => {
  const ok = await fetchPage('https://a.org/p', { fetcher: async () => ({ ok: true, url: 'https://a.org/p', headers: { get: () => 'text/html' }, text: async () => `<title>T</title><p>${'Deadline 15 November 2026 '.repeat(10)}</p>` }) });
  assert.equal(ok.title, 'T'); assert.match(ok.text, /Deadline/);
  assert.equal(await fetchPage('https://a.org/f.pdf', { fetcher: async () => ({ ok: true, url: 'https://a.org/f.pdf', headers: { get: () => 'application/pdf' }, text: async () => 'x' }) }), null);
  assert.equal(await fetchPage('https://a.org/p', { fetcher: async () => { throw new Error('net'); } }), null);
  assert.equal(await fetchPage('http://127.0.0.1/', {}), null);
});

test('rondas: la ronda 2 usa consultas de seguimiento del modelo y no repite páginas', async () => {
  const PAGE = (n) => ({ url: `https://p${n}.example.org/call`, title: `P${n}`, markdown: `Program ${n} prize for mental health startups. The application deadline is 15 November 2026. Open to startups anywhere in the world. Grant.` });
  const queriesSeen = [];
  const search = async (q) => { queriesSeen.push(q); return q.includes('NEW') ? [PAGE(1), PAGE(2)] : [PAGE(1)]; };
  const chat = async ({ name, user }) => {
    if (name === 'plan') return { json: { queries: ['mental health prize apply', 'digital health grant Europe', 'wellbeing startup challenge'].map((query) => ({ query, family: 'f' })) } };
    if (name === 'followup') return { json: { queries: [{ query: 'NEW named program sister call', family: 'gap' }, { query: 'mental health prize apply', family: 'dup' }] } };
    const n = /PAGE URL: https:\/\/p(\d)/.exec(user)[1];
    return { json: { relevant: true, name: `Program ${n}`, official: true, status: 'open', deadline: '2026-11-15', eligible: 'yes', non_dilutive: 'yes', money: 'prize', quotes: { identity: `Program ${n} prize for mental health startups.`, deadline: 'The application deadline is 15 November 2026', eligible: 'Open to startups anywhere in the world' } } };
  };
  const r = await runObjective('grant', { industry: 'mental health', fundingTypes: ['grant'] }, { chat, search, today: '2026-09-29', rounds: 2 });
  assert.equal(r.audit.rounds, 2);
  assert.deepEqual(r.findings.map((f) => f.name).sort(), ['Program 1', 'Program 2']);
  assert.equal(r.findings.find((f) => f.name === 'Program 2').round, 2);
  assert.equal(queriesSeen.filter((q) => q === 'mental health prize apply').length, 1, 'no repite consultas');
  assert.equal(r.audit.read, 2, 'la página 1 no se relee en la ronda 2');
});
