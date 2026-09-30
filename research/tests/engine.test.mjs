import test from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTIVES, planQueries, verifyFinding, runObjective, runEngine, engineLeads, fallbackQueries } from '../server/research/engine.mjs';

const TODAY = '2026-09-29';
const brief = { company: 'Mentiva', industry: 'mental health digital wellness', stage: 'pre-seed', fundingTypes: ['grant', 'investment'] };
const P = {
  grant: { url: 'https://prize.example.org/call', title: 'Prize', markdown: 'Mental health innovation prize. The application deadline is 15 November 2026. Open to startups anywhere in the world. Cash prize, no equity taken by the funder.' },
  old: { url: 'https://old.example.org/c', title: 'Old', markdown: 'Texas challenge. Apply by April 5, 2023. The application period is open now through April 5, 2023 for founders and startups.' },
  fund: { url: 'https://fund.example.vc/about', title: 'Fund', markdown: 'Example Ventures invests in pre-seed and seed digital health startups worldwide with cheques of $250k to $1M. We back founders building mental health products.' },
  agg: { url: 'https://www.fundsforngos.org/x', title: 'Agg', markdown: 'Grants list for startups. Deadline 18 September 2026. Open to all companies and founders around the world, many programs.' },
  unrelated: { url: 'https://blog.example.com/p', title: 'Blog', markdown: 'Ten tips for founders on hiring their first engineer and other unrelated advice for early stage startups everywhere.' },
};
const ANS = {
  [P.grant.url]: { relevant: true, name: 'Mental Health Prize', official: true, status: 'open', deadline: '2026-11-15', eligible: 'yes', non_dilutive: 'yes', money: 'prize', quotes: { identity: 'Mental health innovation prize.', deadline: 'The application deadline is 15 November 2026', eligible: 'Open to startups anywhere in the world' } },
  [P.old.url]: { relevant: true, name: 'Texas', official: true, status: 'open', deadline: '2023-04-05', eligible: 'unclear', non_dilutive: 'unknown', money: 'grant', quotes: { identity: 'Texas challenge.', deadline: 'Apply by April 5, 2023' } },
  [P.fund.url]: { relevant: true, name: 'Example Ventures', official: true, status: 'unknown', eligible: 'yes', money: 'equity', amount: '$250k to $1M', quotes: { identity: 'Example Ventures invests in pre-seed and seed digital health startups worldwide', eligible: 'We back founders building mental health products' } },
  [P.unrelated.url]: { relevant: false, name: 'Blog', official: false, quotes: { identity: 'Ten tips for founders on hiring their first engineer' } },
};
const chat = async ({ name, user }) => {
  if (name === 'plan') return { json: { queries: [{ query: 'mental health startup prize apply 2026', family: 'prizes' }, { query: 'SBIR NIH digital mental health phase I', family: 'us federal' }, { query: 'pre-seed digital health fund Europe', family: 'funds' }] } };
  const url = Object.keys(ANS).find((k) => user.includes(`PAGE URL: ${k}`));
  return { json: ANS[url] || {}, model: 'q30' };
};
const search = async () => Object.values(P);

test('plan: usa el modelo si responde, cae a plantillas si falla o devuelve poco', async () => {
  const ok = await planQueries('grant', brief, { chat, today: TODAY });
  assert.equal(ok.planned, true); assert.ok(ok.queries.some((q) => /SBIR/.test(q.query)));
  const bad = await planQueries('investment', brief, { chat: async () => { throw new Error('x'); }, today: TODAY });
  assert.equal(bad.planned, false); assert.ok(bad.queries.length >= 3);
  assert.equal((await planQueries('grant', brief, { env: {}, today: TODAY })).planned, false);
  for (const k of Object.keys(OBJECTIVES)) assert.ok(fallbackQueries(k, brief, TODAY).length >= 2, k);
});

test('grant: solo sobrevive la abierta; cerrada, agregador e irrelevante se descartan con motivo', async () => {
  const r = await runObjective('grant', brief, { chat, search, today: TODAY });
  assert.deepEqual(r.findings.map((f) => f.url), [P.grant.url]);
  assert.equal(r.findings[0].verdict, 'apply');
  assert.equal(r.audit.dropped.closed, 1); assert.equal(r.audit.dropped.aggregator, 1);
  assert.equal(Object.values(r.audit.dropped).reduce((a, b) => a + b, 0), 3, JSON.stringify(r.audit.dropped)); // vieja, agregador y el fondo (equity ≠ grant); el blog es demasiado corto y ni se lee
});

test('investor: el fondo entra por el mismo ciclo; un premio sin capital no es inversor', async () => {
  const r = await runObjective('investment', brief, { chat, search, today: TODAY });
  const urls = r.findings.map((f) => f.url);
  assert.ok(urls.includes(P.fund.url));
  assert.ok(!urls.includes(P.grant.url), 'un premio (money=prize) no encaja con inversión');
  assert.equal(r.findings.find((f) => f.url === P.fund.url).amount, '$250k to $1M');
});

test('una cita inventada tumba la identidad; nunca hay lead sin cita literal', () => {
  const v = verifyFinding({ relevant: true, name: 'X', official: true, money: 'equity', eligible: 'yes', quotes: { identity: 'We are the best fund in the whole world' } }, P.fund && { url: P.fund.url, text: P.fund.markdown }, 'investment', { today: TODAY });
  assert.equal(v.keep, false); assert.equal(v.drop, 'no_identity_quote'); assert.ok(v.flags.includes('fake_quote:identity'));
});

test('runEngine cubre todos los objetivos del brief y engineLeads produce leads con evidencia', async () => {
  const r = await runEngine(brief, { chat, search, today: TODAY });
  assert.equal(r.audits.length, 2);
  const leads = engineLeads(r.findings);
  assert.equal(leads.length, 2);
  const g = leads.find((l) => l.fundingType === 'grant'); const i = leads.find((l) => l.fundingType === 'investment');
  assert.equal(g.kind, 'opportunity'); assert.equal(g.deadline, '2026-11-15'); assert.ok(g.evidence.every((e) => e.quote && e.url));
  assert.equal(i.kind, 'research'); assert.equal(i.deadline, null);
});

test('sin flota no se inventa nada: cero hallazgos y páginas contadas como sin leer', async () => {
  const r = await runObjective('grant', brief, { env: {}, search, today: TODAY });
  assert.equal(r.findings.length, 0); assert.ok(r.audit.unread >= 1);
});
