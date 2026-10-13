// Pruebas v8 (PROMPT-v10): consultas del diagnóstico sin nombre del oro, costo por unidades, cliente directo de Exa con
// category/numResults, guardia de saldo, regla de elección y corrección de v7_results.mjs. Sin red ni LLM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createBenchCache } from '../../agent/cache.mjs';
import { CASES_A, CASES_B, GOLD_ALIASES, loadCase, shortQueries, longQueries, companyQuery, listQueries, investorsOfQuery, nameIn, companyName } from '../../bench/investors/analysis/v8/queries.v8.mjs';
import { units, nominalUsd, exaSearchV8, spendAttempts, BALANCE_RE } from '../../bench/investors/exa-direct.v8.mjs';
import { staticCalls, pickCompanies, kindsFor, VARIANTS, reachCase, summarize, choose, confirm, expectedUnits } from '../../bench/investors/analysis/v8/diagnostico.v8.mjs';

const research = resolve(import.meta.dirname, '../..'), inv = resolve(research, 'bench/investors');
const tmp = () => mkdtempSync(resolve(tmpdir(), 'v8-'));
const ALL = [...CASES_A, ...CASES_B];

test('V8-1 consultas por plantilla: misma forma en los 12 casos y ninguna con el nombre o el dominio del oro', () => {
  for (const c of ALL) {
    const k = loadCase(c), qs = staticCalls(k, kindsFor(VARIANTS)).map(x => x.query);
    assert.equal(shortQueries(k.fields).length, 3); assert.equal(longQueries(k.fields).length, 3); assert.equal(listQueries(k.fields).length, 2);
    assert.equal(qs.length, 3 + 3 + 3 + 1 + 2, c);
    for (const q of [...qs, companyQuery(k.fields)]) {
      assert.ok(!nameIn(q, GOLD_ALIASES[c]), `${c}: ${q}`);
      assert.ok(!q.toLowerCase().includes(k.gold.domain.split('.')[0].toLowerCase()), `${c}: ${q}`);
      assert.ok(!/\(SYN\)/.test(q), q);
    }
    assert.ok(k.gold.domain && GOLD_ALIASES[c].length, c);
  }
});

test('V8-2 empresas de la variante c: comparables primero, nunca el oro, como mucho 3', () => {
  const k = loadCase('p01');
  const rows = [{ url: 'https://magmapartners.com/', title: 'Magma Partners | VC' }, { url: 'https://acme.mx/', title: 'Acme Pagos - B2B' }, { url: 'https://beta.com/', title: 'Beta' }, { url: 'https://gamma.com/', title: 'Gamma' }];
  assert.deepEqual(pickCompanies(k, rows), ['Konfio', 'Acme Pagos', 'Beta']);
  assert.equal(companyName({ url: 'https://www.zeta-pay.com/x', title: '' }), 'zeta-pay');
  assert.match(investorsOfQuery(k.fields, 'Konfio'), /^Konfio seed funding round investors$/);
});

test('V8-3 unidades de costo: ceil(nominal / 0.027), mínimo 1', () => {
  assert.equal(units({ numResults: 10 }), 1);
  assert.equal(units({ numResults: 10, textChars: 4000, highlights: true }), 1);
  assert.equal(+nominalUsd({ numResults: 10, textChars: 4000, highlights: true }).toFixed(3), 0.027);
  assert.equal(units({ numResults: 25 }), 1);
  assert.equal(units({ numResults: 50 }), 2);
  assert.equal(units({ numResults: 10, textChars: 10000 }), 1);
  assert.equal(expectedUnits(kindsFor(VARIANTS), 6), 108);
  assert.equal(expectedUnits(kindsFor(['base10']), 6), 36);
});

test('V8-4 cliente directo de Exa: category y numResults en el cuerpo, caché y unidades que mide exa_spend.mjs', async () => {
  const d = tmp(), cache = createBenchCache({ path: resolve(d, 'c.sqlite'), namespace: 't' });
  let body = null, n = 0;
  const fetcher = async (_u, o) => { n++; body = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ results: Array.from({ length: 50 }, (_, i) => ({ url: `https://f${i}.com/`, title: `F${i}` })), costDollars: { total: 0.047 } }) }; };
  const req = { query: 'seed venture capital Fintech Mexico', numResults: 50, category: 'company' };
  const r1 = await exaSearchV8(req, { env: { EXA_API_KEY: 'x'.repeat(20) }, fetcher, cache });
  assert.equal(body.numResults, 50); assert.equal(body.category, 'company'); assert.equal(body.type, 'auto'); assert.ok(!body.contents);
  assert.equal(r1.rows.length, 50); assert.equal(r1.units, 2); assert.equal(r1.exa_cost_usd, 0.047);
  const r2 = await exaSearchV8(req, { env: { EXA_API_KEY: 'x'.repeat(20) }, fetcher, cache });
  assert.equal(n, 1); assert.equal(r2.cached, true); assert.equal(r2.units, 0);
  cache.close();
  const ev = [r1, r2].map(r => JSON.stringify({ timestamp: new Date().toISOString(), event: 'search_end', attempts: spendAttempts(r) })).join('\n');
  writeFileSync(resolve(d, 'events.jsonl'), `${ev}\n`);
  const out = spawnSync(process.execPath, [resolve(inv, 'analysis/exa_spend.mjs'), '--dirs', d, '--usd-per-call', '0.0089', '--json'], { encoding: 'utf8' });
  const j = JSON.parse(out.stdout); assert.equal(j.paid_searches, 2); assert.equal(j.cached_searches, 1); assert.equal(j.estimated_usd, 0.018);
});

test('V8-5 guardia: 402/429 y mensajes de saldo se reconocen; sin clave no se llama', async () => {
  const fetcher = async () => ({ ok: false, status: 402, text: async () => 'insufficient credits' });
  const r = await exaSearchV8({ query: 'q', numResults: 10 }, { env: { EXA_API_KEY: 'k'.repeat(20) }, fetcher });
  assert.equal(r.status, 402); assert.ok(BALANCE_RE.test(r.error));
  assert.ok(BALANCE_RE.test('Exa HTTP 429: rate')); assert.ok(!BALANCE_RE.test('Exa HTTP 500: upstream'));
  let called = false; const r2 = await exaSearchV8({ query: 'q' }, { env: {}, fetcher: async () => { called = true; } });
  assert.equal(called, false); assert.match(r2.error, /EXA_API_KEY/);
});

test('V8-6 regla: alcance por ventana, elegida con ≥ base+2 en A, confirmada con ≥ base+1 en B, ventana menor si empata', () => {
  const call = (c, kind, gold_rank, name_hit = null) => ({ case: c, kind, gold_rank, name_hit });
  const calls = [call('p01', 'short', 25), call('p02', 'short', 40), call('p03', 'short', 5), call('p01', 'cat', 8), call('p02', 'cat', 20), call('p04', 'cat', 3),
    call('p05', 'list', null, true), call('p06', 'c2', null, true), call('p06', 'c1', null)];
  assert.deepEqual(reachCase(calls.filter(x => x.case === 'p01'), 'b30'), { domain: true, reached: true });
  assert.deepEqual(reachCase(calls.filter(x => x.case === 'p01'), 'base10'), { domain: false, reached: false });
  assert.deepEqual(reachCase(calls.filter(x => x.case === 'p05'), 'd'), { domain: false, reached: true });
  const s = summarize(calls, CASES_A, VARIANTS);
  assert.equal(s.base10.cases_reached, 1); assert.equal(s.b30.cases_reached, 2); assert.equal(s.b50.cases_reached, 3); assert.equal(s.a10.cases_reached, 2); assert.equal(s.a25.cases_reached, 3);
  assert.deepEqual(choose(s), ['b50', 'a25']);
  const tie = summarize([call('p01', 'cat', 2), call('p02', 'cat', 3), call('p03', 'cat', 4)], CASES_A, VARIANTS);
  assert.deepEqual(choose(tie), ['a10']);
  const sb = summarize([call('p07', 'cat', 9)], CASES_B, ['base10', 'a10']);
  assert.deepEqual(confirm(sb, ['a10']), ['a10']);
  assert.deepEqual(confirm(summarize([], CASES_B, ['base10', 'a10']), ['a10']), []);
});

test('V8-7 simulacro del diagnóstico: costo máximo ≤ 2 USD y sale sin gastar', () => {
  const r = spawnSync(process.execPath, [resolve(inv, 'analysis/v8/diagnostico.v8.mjs'), '--dry-run', '--cap-usd', '2'], { encoding: 'utf8', cwd: research, env: { ...process.env, EXA_API_KEY: '' } });
  assert.equal(r.status, 0, r.stderr); const d = JSON.parse(r.stdout);
  assert.ok(d.total_usd_max <= 2); assert.equal(d.phase_A.units, 108); assert.equal(Object.keys(d.queries).length, 12);
  assert.equal(spawnSync(process.execPath, [resolve(inv, 'analysis/v8/diagnostico.v8.mjs'), '--dry-run', '--cap-usd', '1'], { encoding: 'utf8', cwd: research }).status, 4);
});

const V7 = resolve(inv, 'out/investors-internal-2026-10-12-v7');
test('V8-8 v7_results.mjs lee los eventos de la carpeta v7 (antes salían en 0)', { skip: !existsSync(resolve(V7, 'events.jsonl')) && 'sin carpeta v7' }, () => {
  const d = tmp(), j = resolve(d, 'v7.json');
  const r = spawnSync(process.execPath, [resolve(inv, 'analysis/v7/v7_results.mjs'), '--v7', V7, '--check', resolve(V7, 'v5_check.json'), '--json', j], { encoding: 'utf8', cwd: research });
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(readFileSync(j, 'utf8')).totals_v7;
  assert.ok(t.fetches_events.total > 1300); assert.ok(t.exa_paid.total > 0); assert.ok(t.fetch_empty.total > 0); assert.ok(t.rejected_quote.total > 0);
  assert.equal(t.stop_rejected, 17); assert.equal(t.fetch_skipped_domain, 7);
});
