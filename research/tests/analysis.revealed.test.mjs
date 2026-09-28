// Módulo 2: tesis revelada, momento, backtest. Deals de prueba construidos para el test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRevealed, rankAppFit, fundIndex } from '../server/analysis/revealed.mjs';
import { momentumSignals, indexVehicles, vehicleSponsor } from '../server/analysis/momentum.mjs';
import { leadRank, metricsOf, bootstrapDiff, runBacktest, dayBefore, markdownReport } from '../server/analysis/backtest.mjs';
import { fundId } from '../server/analysis/entities.mjs';
import { bm25Index, rrf, tfidfIndex } from '../server/analysis/lexical.mjs';

const mk = (startup, date, sector, stage, fund, role = 'lead', country = 'CO') => ({ id: `${startup}-${date}`, startup, startupKey: startup.toLowerCase(), sector, sectors: [sector], stage, country, date, title: `${startup} raises`, url: `https://news.example.com/${startup}`, quote: `${startup}, a ${sector} startup, raised a ${stage} round led by ${fund}.`, investors: [{ fundId: fundId(fund), name: fund, role }], partners: [], fieldStatus: {} });
const DEALS = [
  mk('Calma', '2025-11-01', 'mental health', 'seed', 'Mente Capital'),
  mk('Sereno', '2025-06-01', 'mental health', 'pre-seed', 'Mente Capital'),
  mk('Pagafacil', '2025-10-01', 'fintech', 'seed', 'Money Ventures'),
  mk('Cobro', '2025-09-01', 'fintech', 'seed', 'Money Ventures'),
  mk('Viejo', '2021-01-01', 'mental health', 'seed', 'Old Fund'),
  mk('Futuro', '2026-08-01', 'mental health', 'seed', 'Future Fund'),
];

test('tesis revelada: ordena por deals parecidos y respeta el corte temporal', async () => {
  const res = await rankRevealed('seed · mental health · Colombia · app de terapia', { deals: DEALS, asOf: '2026-03-01', env: {} });
  assert.equal(res.method.similarity, 'lexical (TF-IDF, no fleet)');
  assert.equal(res.funds[0].name, 'Mente Capital');
  assert.ok(!res.funds.some((f) => f.name === 'Future Fund'), 'deal posterior al corte excluido');
  assert.ok(!res.funds.some((f) => f.name === 'Old Fund'), 'fuera de la ventana de 24 meses');
  assert.match(res.funds[0].explanation[0].text, /^Led Calma \(mental health, seed, 2025-11\)/);
  assert.ok(res.funds[0].explanation[0].url.startsWith('https://'));
});

test('tesis revelada con flota: embeddings + rerank (formato vLLM)', async () => {
  const env = { VLLM_BASE: 'http://fleet.test', VLLM_EMBED_MODEL: 'baai', VLLM_RERANK_MODEL: 'mxbai' };
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/embeddings')) return new Response(JSON.stringify({ data: body.input.map((t, i) => ({ index: i, embedding: /fintech|pago/i.test(t) ? [1, 0] : [0, 1] })) }));
    if (url.endsWith('/rerank')) return new Response(JSON.stringify({ results: body.documents.map((d, i) => ({ index: i, relevance_score: /Money/.test(d) ? 0.9 : 0.1 })) }));
    throw new Error(url);
  };
  const res = await rankRevealed('fintech pagos seed', { deals: DEALS, asOf: '2026-03-01', env, fetcher });
  assert.equal(res.method.similarity, 'embeddings (baai)');
  assert.equal(res.method.rerank, 'mxbai');
  assert.equal(res.funds[0].name, 'Money Ventures');
});

test('momento: vehículo Form D, ritmo, inactividad', () => {
  // Nombres de emisores tal como aparecen en el dataset Form D 2026Q2 de la SEC.
  assert.deepEqual(vehicleSponsor('Pi SPV a Series of JSL Health Capital SPV LLC').kind, 'spv');
  assert.equal(vehicleSponsor('MC Healthcare Ventures II LP').kind, 'fund');
  const vehicles = indexVehicles([{ entityName: 'Mente Capital Fund II, L.P.', filingDate: '2026-01-15', isAmendment: false, totalOffering: 5e7, totalSold: 1e7, url: 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/' }]);
  const m = momentumSignals({ fundName: 'Mente Capital', deals: DEALS.filter((d) => d.investors[0].name === 'Mente Capital'), vehicles, asOf: '2026-03-01', sector: 'mental health' });
  assert.equal(m.newVehicle, true);
  const other = indexVehicles([{ entityName: 'True Equity III, L.P.', filingDate: '2026-01-15', isAmendment: false, url: 'https://www.sec.gov/Archives/edgar/data/2/000000000026000002/' }]);
  assert.equal(momentumSignals({ fundName: 'True Ventures', deals: [], vehicles: other, asOf: '2026-03-01' }).newVehicle, false, 'misma raíz, fondo distinto');
  assert.equal(m.pace, 1);
  assert.ok(m.signals.some((s) => s.type === 'sector' && /Calma/.test(s.label)));
  const old = momentumSignals({ fundName: 'Old Fund', deals: DEALS.filter((d) => d.investors[0].name === 'Old Fund'), vehicles, asOf: '2026-03-01' });
  assert.equal(old.inactive, true);
  assert.match(old.signals.at(-1).label, /No verifiable activity since 2021-01/);
});

test('línea base de la app (fit por palabras) y métricas del backtest', () => {
  const app = rankAppFit('mental health', { deals: DEALS, asOf: '2026-03-01', industry: 'mental health' });
  assert.ok(['Mente Capital', 'Old Fund'].includes(app[0].name));
  assert.equal(leadRank(['X', 'Kaszek', 'Y'], ['Kaszek Ventures']), 2);
  assert.equal(leadRank(['X'], ['Kaszek Ventures']), null);
  assert.deepEqual(metricsOf([1, null, 4, 20]), { n: 4, hitAtK: 0.5, mrr: (1 + 0.25 + 0.05) / 4 });
  const d = bootstrapDiff([1, 1, 1, 1], [null, null, null, null]);
  assert.equal(d.mean, 1);
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(fundIndex(DEALS, { asOf: '2026-03-01' }).length, 2);
});

test('runBacktest excluye la propia startup y reporta cobertura y decisión', async () => {
  const rounds = [{ id: 'r1', company: 'Calma', announced: '2025-11-01', stage: 'seed', sector: 'mental health', leads: ['Mente Capital'], profile_hint: 'seed mental health Colombia terapia' }];
  const res = await runBacktest(rounds, { allDeals: DEALS, vehicles: indexVehicles([]), env: {}, useFleet: false });
  assert.equal(res.rows[0].ranks.S1_revelada, 1, 'Sereno (jun-2025) sostiene a Mente Capital antes de T');
  assert.equal(res.coverage, 1);
  assert.match(res.decision, /Missing baseline/);
  assert.match(markdownReport(res), /hit@10/);
});

test('BM25, TF-IDF y RRF', () => {
  const docs = ['cognitive decline alzheimer agitation', 'fintech payments', 'alzheimer caregiver burden'];
  const b = bm25Index(docs).search('alzheimer agitation');
  assert.equal(b[0].index, 0);
  const t = tfidfIndex(docs);
  assert.ok(t.sim(t.query('payments'), t.vectors[1]) > 0.5);
  assert.equal(rrf([[{ index: 2 }, { index: 0 }], [{ index: 0 }, { index: 2 }]]).length, 2);
});
