// Módulo 1: verificación literal, parsing, entidades, evaluación y cliente de la flota.
// Los textos de prueba son construidos para el test (no son afirmaciones sobre empresas reales).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/research/store.mjs';
import { verifyDeal, parseAmount, parseDate, stageOf, plainText, ruleExtract, dealText, mergeDeals } from '../server/analysis/deals.mjs';
import { normOrg, fundKey, matchFunds, resolveFundNames, jaroWinkler } from '../server/analysis/entities.mjs';
import { comparePerField, smallModelWins, precisionFromReview, parseCsv, toCsv, wilson } from '../server/analysis/extractEval.mjs';
import { chatJSON, embed, rerank, fleetConfig, extractorTarget } from '../server/analysis/fleet.mjs';
import { processPage, quarterPeriods, dealQueries } from '../server/analysis/dealIngest.mjs';

const PAGE = {
  url: 'https://news.example.com/acme-raises',
  title: 'Acme Mind raises seed',
  published: '2025-03-04T10:00:00Z',
  text: `# Funding\n\n**Acme Mind**, a Colombian mental health startup, raised a $2.5M seed round led by [Kaszek Ventures](https://kaszek.com) with participation from Magma Partners and Seedstars. "We back founders early," said Jane Roe, partner at Kaszek. The company was founded in 2023.`,
};
const RAW = { startup: 'Acme Mind', sector: 'mental health', country: 'Colombian', stage: 'seed', amount_text: '$2.5M', lead_investors: ['Kaszek Ventures'], co_investors: ['Magma Partners', 'Seedstars', 'SoftBank'], partners: [{ name: 'Jane Roe', fund: 'Kaszek' }], quote: 'Acme Mind, a Colombian mental health startup, raised a $2.5M seed round led by Kaszek Ventures with participation from Magma Partners and Seedstars.' };

test('verifyDeal acepta solo campos presentes en la cita y la cita solo si es literal', () => {
  const { deal, status } = verifyDeal(RAW, PAGE, { extractor: 'test', now: '2026-09-27T00:00:00Z' });
  assert.ok(deal);
  assert.equal(deal.stage, 'seed');
  assert.equal(deal.amountUsd, 2_500_000);
  assert.equal(deal.country, 'CO');
  assert.equal(deal.sector, 'mental health');
  assert.equal(deal.date, '2025-03-04');
  assert.equal(deal.dateBasis, 'publication date');
  assert.deepEqual(deal.investors.filter((i) => i.role === 'lead').map((i) => i.name), ['Kaszek Ventures']);
  assert.deepEqual(deal.investors.filter((i) => i.role === 'co').map((i) => i.name), ['Magma Partners', 'Seedstars']);
  assert.equal(status.co_investors, 'parcial', 'SoftBank no aparece en la cita: se descarta');
  assert.equal(deal.partners.length, 0, 'Jane Roe no está en la cita elegida');
  const bad = verifyDeal({ ...RAW, quote: 'Acme Mind raised a $3M seed round led by Kaszek Ventures.' }, PAGE);
  assert.equal(bad.deal, null);
  assert.match(bad.reason, /literal/);
});

test('verifyDeal degrada "líder" a co-inversionista si la cita no dice quién lidera', () => {
  const page = { ...PAGE, text: 'Acme Mind closed a seed round with Kaszek Ventures and Magma Partners this week in Bogotá.' };
  const { deal } = verifyDeal({ startup: 'Acme Mind', lead_investors: ['Kaszek Ventures'], quote: 'Acme Mind closed a seed round with Kaszek Ventures and Magma Partners this week in Bogotá.' }, page);
  assert.deepEqual(deal.investors.map((i) => i.role), ['co']);
});

test('parseAmount, parseDate, stageOf', () => {
  assert.deepEqual(parseAmount('$14M'), { value: 14e6, currency: 'USD' });
  assert.deepEqual(parseAmount('US$ 9 million'), { value: 9e6, currency: 'USD' });
  assert.deepEqual(parseAmount('R$ 5 milhões'), { value: 5e6, currency: 'BRL' });
  assert.deepEqual(parseAmount('1,2 millones de dólares'), { value: 1.2e6, currency: 'USD' });
  assert.deepEqual(parseAmount('$500K'), { value: 5e5, currency: 'USD' });
  assert.equal(parseAmount('undisclosed'), null);
  assert.equal(parseDate('Dec 17, 2025'), '2025-12-17');
  assert.equal(parseDate('17 de diciembre de 2025'), '2025-12-17');
  assert.equal(parseDate('2025-10-20T08:00:00Z'), '2025-10-20');
  assert.equal(stageOf('a pre-seed round'), 'pre-seed');
  assert.equal(stageOf('su ronda Serie A'), 'series-a');
  assert.equal(stageOf('seed round'), 'seed');
  assert.equal(plainText('**a** [b](https://x.y)  c'), 'a b c');
});

test('ruleExtract (línea base sin LLM) produce candidatos que pasan la verificación', () => {
  const raw = ruleExtract(PAGE.text);
  assert.equal(raw.deals.length, 1);
  const { deal } = verifyDeal(raw.deals[0], PAGE);
  assert.equal(deal.startup, 'Acme Mind');
  assert.deepEqual(deal.investors.filter((i) => i.role === 'lead').map((i) => i.name), ['Kaszek Ventures']);
  assert.match(dealText(deal), /seed · mental health/);
});

test('entidades: paridad con normalize.py y fusiones', () => {
  assert.equal(normOrg('Acme Ventures Fund III, L.P.'), 'acme ventures');
  assert.equal(normOrg('Acme Capital Partners LLC'), 'acme capital partners');
  assert.equal(normOrg('CompOne Inc'), normOrg('CompOne, Inc.'));
  assert.ok(jaroWinkler('martha', 'marhta') > 0.96);
  assert.equal(fundKey('a16z'), fundKey('Andreessen Horowitz'));
  assert.equal(matchFunds('Kaszek', 'Kaszek Ventures').decision, 'auto');
  assert.equal(matchFunds('Magma Partners', 'Magma Capital').decision, 'review');
  assert.equal(matchFunds('Seedstars', 'Kaszek').decision, 'no');
  const { ids } = resolveFundNames(['Magma Partners', 'Magma Capital', 'Kaszek', 'Kaszek Ventures']);
  assert.notEqual(ids.get('Magma Partners'), ids.get('Magma Capital'));
  assert.equal(ids.get('Kaszek'), ids.get('Kaszek Ventures'));
});

test('mergeDeals conserva todas las fuentes y no duplica inversionistas', () => {
  const a = verifyDeal(RAW, PAGE).deal;
  const b = { ...a, url: 'https://other.example.com/x', quote: 'otra', investors: [{ fundId: a.investors[0].fundId, name: 'Kaszek', role: 'co' }] };
  const m = mergeDeals(a, b);
  assert.equal(m.sources.length, 2);
  assert.equal(m.investors.filter((i) => i.fundId === a.investors[0].fundId).length, 1);
});

test('processPage guarda deal, índice por fondo y la extracción para entrenamiento', async () => {
  const store = createStore(':memory:');
  const env = { VLLM_BASE: 'http://fleet.test', VLLM_CHAT_MODEL: 'qwen-30b' };
  const fetcher = async (url, init) => {
    assert.match(url, /:8000\/v1\/chat\/completions$/);
    const body = JSON.parse(init.body);
    assert.equal(body.response_format.type, 'json_schema');
    return new Response(JSON.stringify({ model: 'qwen-30b', choices: [{ message: { content: JSON.stringify({ deals: [RAW] }) } }] }), { status: 200 });
  };
  const { accepted } = await processPage({ ...PAGE, markdown: PAGE.text, date: PAGE.published }, { store: store.analysis, env, fetcher });
  assert.equal(accepted.length, 1);
  assert.equal(store.analysis.dealCount(), 1);
  const fid = accepted[0].investors[0].fundId;
  assert.equal(store.analysis.dealsByFund(fid).length, 1);
  assert.equal(store.analysis.dealsByFund(fid, { before: '2025-01-01' }).length, 0, 'corte temporal estricto');
  const ex = store.analysis.extractions();
  assert.equal(ex.length, 1);
  assert.equal(ex[0].extractor, 'vllm:qwen-30b');
  store.close();
});

test('evaluación por campo, regla de 3 puntos, Wilson y CSV', () => {
  const g = verifyDeal(RAW, PAGE).deal;
  const p = { ...g, stage: 'series-a', investors: g.investors.filter((i) => i.role === 'lead') };
  const s = comparePerField([{ url: PAGE.url, deals: [p] }], [{ url: PAGE.url, deals: [g] }]);
  assert.equal(s.startup.precision, 1);
  assert.equal(s.stage.precision, 0);
  assert.equal(s.co_investors.recall, 0);
  assert.equal(smallModelWins(s, s).wins, true);
  const [lo, hi] = wilson(90, 100);
  assert.ok(lo > 0.82 && hi < 0.95);
  const csv = toCsv([{ a: 'x, "y"', ok_startup: 'si', ok_stage: 'no' }], ['a', 'ok_startup', 'ok_stage']);
  const rows = parseCsv(csv);
  assert.equal(rows[0].a, 'x, "y"');
  const prec = precisionFromReview(rows);
  assert.equal(prec.startup.precision, 1);
  assert.equal(prec.stage.precision, 0);
});

test('cliente de la flota: formatos de embeddings y rerank según la documentación de vLLM', async () => {
  const env = { VLLM_BASE: 'http://fleet.test', VLLM_EMBED_MODEL: 'baai', VLLM_RERANK_MODEL: 'mxbai', VLLM_SMALL_MODEL: 'qwen-4b', VLLM_EXTRACT_ROLE: 'deals-lora' };
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith(':8003/v1/embeddings')) return new Response(JSON.stringify({ data: body.input.map((_, i) => ({ index: i, embedding: [i, 1] })).reverse() }));
    // Respuesta de ejemplo de docs/models/pooling_models/scoring.md (vLLM).
    if (url.endsWith(':8004/v1/rerank')) return new Response(JSON.stringify({ id: 'rerank-x', model: 'mxbai', usage: { total_tokens: 56 }, results: [{ index: 1, document: { text: 'b' }, relevance_score: 0.99853515625 }, { index: 0, document: { text: 'a' }, relevance_score: 0.0005860328674316406 }] }));
    if (url.endsWith(':8001/v1/chat/completions')) { assert.equal(body.model, 'deals-lora'); return new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think>{"ok":true}' } }] })); }
    return new Response('no', { status: 404 });
  };
  assert.deepEqual(await embed(['a', 'b'], { env, fetcher }), [[0, 1], [1, 1]]);
  assert.deepEqual((await rerank('q', ['a', 'b'], { env, fetcher })).map((r) => r.index), [1, 0]);
  const cfg = fleetConfig(env);
  assert.equal(extractorTarget(cfg).model, 'deals-lora');
  assert.deepEqual((await chatJSON({ system: 's', user: 'u', role: 'small', model: 'deals-lora' }, { env, fetcher })).json, { ok: true });
  assert.equal(fleetConfig({}).roles.chat.ready, false);
});

test('periodos trimestrales en formato tbs y consultas por sector × etapa × región', () => {
  const p = quarterPeriods('2025-01-01', '2025-07-01');
  assert.equal(p.length, 2);
  assert.equal(p[0].tbs, 'cdr:1,cd_min:01/01/2025,cd_max:03/31/2025');
  const q = dealQueries({ sectors: ['mental health'], stages: ['seed'], regions: ['LATAM'] });
  assert.ok(q.some((x) => /salud mental/.test(x)));
});
