/* Benchmark por proveedor de búsqueda en el audit de cada corrida: qué trajo cada uno, qué fue único y en qué terminó.
   Sin red: buscadores, descarga y modelo simulados. Los números son de los simuladores, no de proveedores reales. */
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
// Cada proveedor trae algo distinto: exa+tavily la oficial, tavily la cerrada, exa el blog, serper el agregador y la red social.
const rows = (spec) => spec.map(([url, providers]) => ({ url, title: url.includes('blog') ? 'Prize announced' : 'Acme', description: (TEXT[url] || '').slice(0, 90), markdown: '', providers }));
const SPEC = [[OFFICIAL, ['exa', 'tavily']], [CLOSED, ['tavily']], [BLOG, ['exa']], [AGG, ['serper']], [SOCIAL, ['serper']]];
const pageFetcher = async (url) => (TEXT[url] ? { url, title: 'Page', text: TEXT[url] } : null);
const go = () => run(makeChat([]), { search: async () => rows(SPEC), pageFetcher, reader: async () => null });

test('benchmark: cada URL se asienta una vez con su desenlace y se acredita a todos los proveedores que la trajeron', async () => {
  const r = await go(); const p = r.audit.providers;
  assert.deepEqual(Object.keys(p).sort(), ['exa', 'serper', 'tavily']);
  assert.equal(p.exa.urls, 2); assert.equal(p.exa.onlyUrls, 1); assert.equal(p.exa.outcomes.apply, 1);
  assert.equal(p.tavily.urls, 2); assert.equal(p.tavily.outcomes.apply, 1); assert.equal(p.tavily.outcomes.closed, 1);
  assert.equal(p.serper.urls, 2); assert.equal(p.serper.onlyUrls, 2); assert.equal(p.serper.outcomes.aggregator, 1); assert.equal(p.serper.outcomes.social_host, 1);
  // Nada se cuenta dos veces: la suma de desenlaces es el número de URLs de cada proveedor.
  for (const x of Object.values(p)) assert.equal(Object.values(x.outcomes).reduce((a, b) => a + b, 0), x.urls);
  assert.equal(p.exa.keptOnlyHere, 0); assert.equal(p.exa.kept, 1);
});

test('benchmark: runAudit lo resume por proveedor (útil, ruido, único) y ordena por valor', async () => {
  const r = await go();
  const bench = buildRunAudit({ engineRuns: [r.audit, r.audit] }).providers;
  const by = Object.fromEntries(bench.map((b) => [b.provider, b]));
  assert.equal(by.exa.urls, 4); assert.equal(by.exa.apply, 2); assert.equal(by.exa.useful, 2); assert.equal(by.exa.usefulPct, 50);
  assert.equal(by.serper.noisePct, 100); assert.equal(by.serper.useful, 0); assert.equal(by.serper.usefulPct, 0);
  assert.equal(by.tavily.outcomes.closed, 2);
  assert.ok(['exa', 'tavily'].includes(bench[0].provider), 'los que traen la convocatoria abierta van primero'); assert.equal(bench.at(-1).provider, 'serper');
  assert.equal(by.exa.costPerUseful, null, 'sin coste declarado: no medido, no inventado');
  assert.deepEqual(buildRunAudit({ engineRuns: [{ objective: 'grant' }] }).providers, []);
});

test('benchmark: el resultado de las decisiones no cambia por medir (mismos hallazgos con y sin proveedores declarados)', async () => {
  const a = await go();
  const b = await run(makeChat([]), { search: async () => rows(SPEC.map(([u]) => [u, undefined])), pageFetcher, reader: async () => null });
  assert.deepEqual(a.findings.map((f) => [f.url, f.verdict, f.deadline]), b.findings.map((f) => [f.url, f.verdict, f.deadline]));
});
