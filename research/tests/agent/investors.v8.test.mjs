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

// ───────── Motor v8: fase de listas (variante d) ─────────
import { createHash } from 'node:crypto';
import { validateInvestor } from '../../bench/investors/contracts.mjs';
import { loadInvestorPrompt } from '../../bench/investors/prompts.mjs';
import { runInvestorDiscoveryV7 } from '../../bench/investors/engine.v7.mjs';
import { runInvestorDiscoveryV8 } from '../../bench/investors/engine.v8.mjs';
import { extractFixtureInvestorV7 } from '../../bench/investors/extractor.v7.mjs';
import { listDiscoveryQueries } from '../../bench/investors/list-discovery.v8.mjs';

const repo = resolve(research, '..'), F = resolve(import.meta.dirname, 'fixtures/investor-world-v0');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const cfgPath = v => resolve(inv, `config/${v}.json`);
const v5 = () => json(cfgPath('v5-2026-10-09')), v7 = () => json(cfgPath('v7-2026-10-12')), v8 = () => json(cfgPath('v8-2026-10-12'));
const profile = json(resolve(F, 'profile.json')), anchorCase = json(resolve(F, 'cases/case-anchor.json'));
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const templates = loadInvestorPrompt('b0_templates', 'v2', { manifest: 'manifest.v7.json' }).templates;
const engineCfg = (base, o = {}) => ({ ...base, search: { provider: 'fixture', results_per_query: 10 }, judge: { max_llm_calls: 0 }, deepening: { ...base.deepening, enabled: false }, ...o });
const TODAY = '2026-10-09';
const EV0 = { investor_type: null, sectors: null, stages: null, rounds: null, geographies: null, check_range_usd: null, lead_follow: null, business_models: null, active_status: null, published_on: null };
const fullV2 = (o = {}) => ({
  entity_kind: 'institutional_investor', canonical_name: 'Zentro Capital', official_domain: null, aliases: [], investor_type: 'unknown', parent_firm: null, vehicles: [], active_status: 'unknown',
  sectors: [], stages: [], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, lead_follow: 'unknown', business_models: { accepted: [], excluded: [] },
  regulatory_restrictions: [], relevant_portfolio: [], potential_conflicts: [], recent_investment: false, source_kind: 'official', published_on: null, quote: null, regulatory_id: null,
  canonical_url: null, contradictions: [], evidence: { ...EV0 }, candidates: [], ...o, evidence: { ...EV0, ...(o.evidence ?? {}) }
});
const fintechProfile = () => { const p = structuredClone(profile); p.fields.sector.value = 'Fintech'; p.fields.funding_stage.value = 'seed'; p.fields.accepted_investor_types.value = ['generalist_vc']; p.fields.incorporation_country.value = 'Mexico'; p.fields.operating_regions.value = ['Mexico']; p.fields.target_markets.value = ['Mexico']; p.fields.subsectors.value = ['B2B payments']; return p; };
const filler = name => `${name} has a small team and publishes its portfolio on this website for founders who want to learn more about how the partnership works day to day.`;
function world({ pages = {}, searches = {}, plans = {}, searchFn = null } = {}) {
  const calls = { search: [], fetch: [], plan: [] }; let adaptive = 0;
  return { calls, deps: {
    search: async (q, options = {}) => { calls.search.push(q); const urls = searchFn ? searchFn(q) : (searches[q] ?? []); return { results: urls.map((u, i) => ({ rank: i + 1, url: u, title: pages[u]?.title ?? u })), nominal_cost: 1 }; },
    fetch: async url => { calls.fetch.push(url); const p = pages[url]; return p ? { ok: true, text: p.text, title: p.title, nominal_cost: 1 } : { ok: false, text: '', error: { code: 'FETCH_HTTP' }, nominal_cost: 1 }; },
    extract: async ({ document, today, firstSeen }) => extractFixtureInvestorV7({ document, extraction: pages[document.url]?.extraction ?? fullV2({ entity_kind: 'other', canonical_name: 'Unknown page' }), today, firstSeen }),
    plan: async input => { calls.plan.push(input.mode); return input.mode === 'initial_batch' ? (plans.initial ?? { queries: [], stop: true, candidate_firms: [] }) : (plans.adaptive?.[adaptive++] ?? { queries: [], stop: true, candidate_firms: [] }); }
  } };
}
const firmPage = (name, dom) => ({ title: name, text: `${name} invests in seed fintech startups in Mexico. ${filler(name)}`, extraction: fullV2({ canonical_name: name, official_domain: dom, quote: `${name} invests in seed fintech startups in Mexico.` }) });
const listPage = names => ({ title: 'Top VC firms', text: `${names.map(n => `${n} invests in seed fintech startups in Mexico.`).join(' ')} ${filler('Directory')}`,
  extraction: fullV2({ entity_kind: 'other', canonical_name: 'VC Directory', candidates: names.map(n => ({ name: n, quote: `${n} invests in seed fintech startups in Mexico.`, domain_on_page: null })) }) });
const LQ = () => listDiscoveryQueries(fintechProfile());

test('V8-9 config v8: esquema v6, igual a v7 salvo b2.list_discovery, bench_id, schema y una capa de caché más', () => {
  const c = validateInvestor('investor_run_config.v6', v8()), b = v7();
  assert.equal(c.status, 'frozen'); assert.notEqual(c.bench_id, b.bench_id); assert.equal(c.schema_version, 'investor_run_config/6');
  assert.deepEqual(c.budgets, b.budgets); assert.deepEqual(c.search, b.search); assert.deepEqual(c.resolution, b.resolution); assert.deepEqual(c.deepening, b.deepening); assert.deepEqual(c.prompts, b.prompts);
  const { list_discovery, ...b2 } = c.b2; assert.deepEqual(b2, b.b2);
  assert.deepEqual(list_discovery, { enabled: true, queries: 2, fetch_per_query: 6, max_searches: 10, max_fetches: 20, max_resolutions: 8, resolve_per_query: 4 });
  assert.deepEqual(c.cache_layers.slice(0, -1), b.cache_layers); assert.match(c.cache_layers.at(-1).path, /investors-internal-2026-10-12-v7\/cache.sqlite$/);
  const { schema_version, bench_id, b2: x, cache_layers, ...r8 } = c; const { schema_version: s7, bench_id: i7, b2: y, cache_layers: l7, ...r7 } = b;
  assert.deepEqual(r8, r7, 'el resto de la config es idéntico a v7 (y por tanto a v5 salvo lo declarado en V7)');
  assert.equal(list_discovery.max_searches, list_discovery.queries + list_discovery.max_resolutions); assert.equal(list_discovery.max_fetches, list_discovery.queries * list_discovery.fetch_per_query + list_discovery.max_resolutions);
});

test('V8-10 freeze: huella v5 (89) y v7 (110) siguen idénticas y la v8 se genera aparte', { skip: !existsSync(resolve(inv, 'out/investors-internal-2026-10-09-v5/fingerprint.json')) }, () => {
  const out = c => { const r = spawnSync(process.execPath, ['bench/investors/freeze.mjs', '--config', `bench/investors/config/${c}.json`, '--check'], { cwd: research, encoding: 'utf8' }); return { status: r.status, j: JSON.parse(r.stdout.trim().split('\n').at(-1)) }; };
  const a = out('v5-2026-10-09'); assert.equal(a.status, 0); assert.equal(a.j.fingerprint_files, 89); assert.equal(a.j.identical, 89);
  if (existsSync(resolve(inv, 'out/investors-internal-2026-10-12-v7/fingerprint.json'))) { const b = out('v7-2026-10-12'); assert.equal(b.status, 0); assert.equal(b.j.identical, b.j.fingerprint_files); }
  if (existsSync(resolve(inv, 'out/investors-internal-2026-10-12-v8/fingerprint.json'))) { const c = out('v8-2026-10-12'); assert.equal(c.status, 0, JSON.stringify(c.j)); assert.equal(c.j.bench_id, 'investors-internal-2026-10-12-v8'); assert.ok(c.j.fingerprint_files > 110); }
});

test('V8-11 sin b2.list_discovery el motor v8 da el mismo resultado que el v7', async () => {
  const qs = ['alpha bravo charlie', 'delta echo foxtrot'], z = 'https://zentro.test/';
  const mk = () => world({ pages: { [z]: firmPage('Zentro Capital', 'zentro.test') }, searches: { [qs[0]]: [z], [qs[1]]: [] }, plans: { initial: { queries: qs, stop: false, candidate_firms: [] } } });
  const base = engineCfg(v7()), off = engineCfg(v8(), { b2: { ...v8().b2, list_discovery: { ...v8().b2.list_discovery, enabled: false } } });
  const a = await runInvestorDiscoveryV7({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: base, templates, catalog, deps: mk().deps });
  const b = await runInvestorDiscoveryV8({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: off, templates, catalog, deps: mk().deps });
  assert.deepEqual(b.entities.map(e => e.stable_id), a.entities.map(e => e.stable_id)); assert.deepEqual(b.totals, a.totals); assert.equal(b.stop_reason, a.stop_reason); assert.equal(b.v2_stats.list_phase, undefined);
});

test('V8-12 fase de listas: una firma que solo sale de una página de lista entra por su sitio oficial y con cita literal', async () => {
  const lq = LQ(), L = 'https://lists.test/top-vcs', z = 'https://zentro.test/';
  const w = world({ pages: { [L]: listPage(['Zentro Capital']), [z]: firmPage('Zentro Capital', 'zentro.test') },
    searchFn: q => q === lq[0] ? [L] : q === lq[1] ? [] : q === '"Zentro Capital" venture capital' ? [z] : [], plans: { initial: { queries: [], stop: true, candidate_firms: [] } } });
  const r = await runInvestorDiscoveryV8({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: engineCfg(v8()), templates, catalog, deps: w.deps });
  assert.deepEqual(w.calls.search.filter(q => lq.includes(q)), lq); assert.equal(w.calls.search[0], lq[0]); assert.equal(w.calls.plan[0], 'initial_batch');
  const e = r.entities.find(x => x.official_domain === 'zentro.test'); assert.ok(e, JSON.stringify(r.v2_stats.resolutions));
  assert.ok(e.sources.every(s => s.quote && s.url.startsWith(z))); assert.equal(r.entities.some(x => x.official_domain === 'lists.test'), false, 'la página de lista no cuenta como firma');
  assert.deepEqual(r.v2_stats.resolutions.map(x => [x.name, x.outcome]), [['Zentro Capital', 'accepted']]);
  assert.equal(r.v2_stats.list_phase.searches, 3); assert.equal(r.v2_stats.list_phase.resolutions, 1); assert.equal(r.v2_stats.list_phase.entities_found, 1);
});

test('V8-13 la fase de listas tiene presupuesto propio: el planner conserva el suyo y la fase no supera su tope', async () => {
  const lq = LQ(), names = Array.from({ length: 14 }, (_, i) => `Firm${String.fromCharCode(97 + i)} Capital`);
  const pages = { 'https://lists.test/a': listPage(names.slice(0, 7)), 'https://lists.test/b': listPage(names.slice(7)) };
  for (const n of names) pages[`https://${n.split(' ')[0].toLowerCase()}.test/`] = firmPage(n, `${n.split(' ')[0].toLowerCase()}.test`);
  const pq = ['pq one alpha', 'pq two bravo', 'pq three charlie', 'pq four delta'];
  const w = world({ pages, plans: { initial: { queries: pq, stop: false, candidate_firms: [] } },
    searchFn: q => q === lq[0] ? ['https://lists.test/a'] : q === lq[1] ? ['https://lists.test/b'] : q.startsWith('"') ? [`https://${q.slice(1).split(' ')[0].toLowerCase()}.test/`] : [] });
  const cfg = engineCfg(v8(), { budgets: { ...v8().budgets, searches: 4, fetches: 54 } });
  const r = await runInvestorDiscoveryV8({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: cfg, templates, catalog, deps: w.deps });
  const lp = r.v2_stats.list_phase; assert.ok(lp.searches <= 10 && lp.fetches <= 20, JSON.stringify(lp)); assert.equal(lp.resolutions, 8);
  // Tras la fase, el descubrimiento dispone de los mismos 4 de búsquedas que con v7 (planner + resolución, que ya gastaba de ese tope).
  assert.equal(r.totals.searches, lp.searches + 4); assert.equal(r.stop_reason, 'budget_searches');
  assert.ok(w.calls.search.includes(pq[0])); assert.equal(w.calls.search.indexOf(pq[0]) > w.calls.search.indexOf(lq[1]), true);
  assert.ok(r.v2_stats.resolutions.length <= 8 + 6, 'resoluciones: cupo de la fase + máximo de v7');
  // Misma situación sin la fase: 4 búsquedas y nada más.
  const off = world({ pages, plans: { initial: { queries: pq, stop: false, candidate_firms: [] } }, searchFn: () => [] });
  const r0 = await runInvestorDiscoveryV8({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: engineCfg(v8(), { budgets: { ...v8().budgets, searches: 4, fetches: 54 }, b2: { ...v8().b2, list_discovery: { ...v8().b2.list_discovery, enabled: false } } }), templates, catalog, deps: off.deps });
  assert.equal(r0.totals.searches, 4); assert.equal(r0.v2_stats.list_phase, undefined);
});

test('V8-14 las consultas de listas del motor son las que midió el diagnóstico (p01–p12)', { skip: !existsSync(resolve(inv, 'out/v8-diagnostico-2026-10-12/result.json')) && 'sin resultado del diagnóstico' }, () => {
  const R = json(resolve(inv, 'out/v8-diagnostico-2026-10-12/result.json'));
  for (const c of ALL) { const k = loadCase(c), measured = R.calls.filter(x => x.case === c && x.kind === 'list').map(x => x.query); if (!measured.length) continue; assert.deepEqual(listQueries(k.fields), measured, c); }
});
