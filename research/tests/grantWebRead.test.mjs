import test from 'node:test';
import assert from 'node:assert/strict';
import { grantWebOpportunities } from '../server/research/webscrape.mjs';

const PAGES = {
  'https://prize.example.org/call': 'Mental health innovation prize. Apply now: the application deadline is 15 November 2026. Open to startups anywhere. Grant, no equity taken.',
  'https://old.example.org/challenge': 'Texas challenge for startups. Apply by April 5, 2023. The application period is open now through April 5, 2023 for founders.',
  'https://www.fundsforngos.org/list': 'Grants for startups apply now challenge prize: deadline 18 September 2026 open to all founders in many countries around the world.',
};
const answers = {
  'https://prize.example.org/call': { status: 'open', deadline: '2026-11-15', official: true, eligible: 'yes', non_dilutive: 'yes', quotes: { deadline: 'the application deadline is 15 November 2026', eligible: 'Open to startups anywhere' } },
  'https://old.example.org/challenge': { status: 'open', deadline: '2023-04-05', official: true, eligible: 'unclear', non_dilutive: 'unknown', quotes: { deadline: 'Apply by April 5, 2023' } },
};
const fetcher = async (url, init) => {
  const u = String(url);
  const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
  if (u.includes('/search')) return json({ data: { web: Object.entries(PAGES).map(([url, markdown]) => ({ url, title: url.split('/').pop(), description: markdown, markdown })) } });
  const body = JSON.parse(init.body);
  const page = Object.keys(answers).find((k) => body.messages[1].content.includes(`PAGE URL: ${k}`));
  return json({ model: 'q30', choices: [{ message: { content: JSON.stringify(answers[page] || {}) } }] });
};
const env = { FIRECRAWL_API_KEY: 'x', GRANT_WEB_MAX_SEARCHES: '1', VLLM_CHAT_URL: 'http://fleet/v1', VLLM_CHAT_MODEL: 'q30' };
const brief = { company: 'Mentiva', stage: 'pre-seed', focus: 'mental health' };

test('sin flag: comportamiento anterior (no se lee ni se descarta nada)', async () => {
  const out = await grantWebOpportunities(brief, { terms: [] }, { env, fetcher });
  assert.equal(out.length, 3);
});

test('GRANT_WEB_READ=1: cerradas y agregadores se descartan; la abierta queda con fecha verificada y cita', async () => {
  const out = await grantWebOpportunities(brief, { terms: [] }, { env: { ...env, GRANT_WEB_READ: '1' }, fetcher });
  assert.deepEqual(out.map((l) => l.externalId), ['web-opportunity:https://prize.example.org/call']);
  const l = out[0];
  assert.equal(l.deadline, '2026-11-15');
  assert.equal(l.verification.verdict, 'apply');
  assert.ok(l.evidence.some((e) => e.quote.includes('15 November 2026')));
  const audit = out.searchAudit.find((a) => a.dimension === 'verification');
  assert.deepEqual(audit.dropped, { closed: 1, aggregator: 1 });
});

test('GRANT_WEB_READ=1 sin flota: no rompe; solo cae el agregador (no necesita modelo), lo demás queda sin leer', async () => {
  const out = await grantWebOpportunities(brief, { terms: [] }, { env: { FIRECRAWL_API_KEY: 'x', GRANT_WEB_MAX_SEARCHES: '1', GRANT_WEB_READ: '1' }, fetcher });
  assert.equal(out.length, 2);
  assert.ok(out.every((l) => !l.verification));
});
