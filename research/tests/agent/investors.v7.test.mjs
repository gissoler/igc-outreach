// Pruebas v7 (PROMPT-v9): extractor v7 (C2), salto de dominios que fallan (C3), mínimo de búsquedas antes de stop (C5),
// lote inicial fijo (C6), caché por capas, config v7 y medidor de gasto con costo real por llamada. Sin red ni LLM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validateInvestor } from '../../bench/investors/contracts.mjs';
import { loadInvestorPrompt } from '../../bench/investors/prompts.mjs';
import { runInvestorDiscoveryV2 } from '../../bench/investors/engine.v2.mjs';
import { runInvestorDiscoveryV7 } from '../../bench/investors/engine.v7.mjs';
import { extractFixtureInvestorV2, isLiteralIn } from '../../bench/investors/extractor.mjs';
import { extractFixtureInvestorV7, literalSpan, literalSegments } from '../../bench/investors/extractor.v7.mjs';
import { createBenchCache } from '../../agent/cache.mjs';
import { createLayeredCache } from '../../bench/investors/cache-layers.v7.mjs';
import { QUERIES } from '../../bench/investors/analysis/v7/reachability.mjs';

const repo = resolve(import.meta.dirname, '../../..'), research = resolve(repo, 'research');
const F = resolve(import.meta.dirname, 'fixtures/investor-world-v0');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const cfgPath = v => resolve(repo, `research/bench/investors/config/${v}.json`);
const profile = json(resolve(F, 'profile.json')), anchorCase = json(resolve(F, 'cases/case-anchor.json'));
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const templates = loadInvestorPrompt('b0_templates').templates;
const v5 = () => json(cfgPath('v5-2026-10-09')), v7 = () => json(cfgPath('v7-2026-10-12'));
const engineCfg = (o = {}) => ({ ...v7(), search: { provider: 'fixture', results_per_query: 10 }, judge: { max_llm_calls: 0 }, deepening: { ...v7().deepening, enabled: false }, ...o });
const TODAY = '2026-10-09', FS = { step: 0, search_index: 0, order: 0, query_id: null };

const EVIDENCE_NULL = { investor_type: null, sectors: null, stages: null, rounds: null, geographies: null, check_range_usd: null, lead_follow: null, business_models: null, active_status: null, published_on: null };
const fullV2 = (o = {}) => ({
  entity_kind: 'institutional_investor', canonical_name: 'Zentro Capital', official_domain: null, aliases: [], investor_type: 'unknown', parent_firm: null, vehicles: [], active_status: 'unknown',
  sectors: [], stages: [], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, lead_follow: 'unknown', business_models: { accepted: [], excluded: [] },
  regulatory_restrictions: [], relevant_portfolio: [], potential_conflicts: [], recent_investment: false, source_kind: 'official', published_on: null, quote: null, regulatory_id: null,
  canonical_url: null, contradictions: [], evidence: { ...EVIDENCE_NULL }, candidates: [], ...o, evidence: { ...EVIDENCE_NULL, ...(o.evidence ?? {}) }
});
const fintechProfile = () => { const p = structuredClone(profile); p.fields.sector.value = 'Fintech'; p.fields.funding_stage.value = 'seed'; p.fields.accepted_investor_types.value = ['generalist_vc']; p.fields.incorporation_country.value = 'Mexico'; p.fields.operating_regions.value = ['Mexico']; p.fields.target_markets.value = ['Mexico']; p.fields.lead_preference.value = 'seeking lead'; return p; };
const filler = name => `${name} has a small team and publishes its portfolio on this website for founders who want to learn more about how the partnership works day to day.`;
function world({ pages = {}, searches = {}, plans = {}, extract = extractFixtureInvestorV7 } = {}) {
  const calls = { search: [], fetch: [], plan: [] }; let adaptive = 0;
  return { calls, deps: {
    search: async (q, options = {}) => { calls.search.push({ q, options }); return { results: (searches[q] ?? []).map((u, i) => ({ rank: i + 1, url: u, title: pages[u]?.title ?? u })), nominal_cost: 1 }; },
    fetch: async url => { calls.fetch.push(url); const p = pages[url]; return p ? { ok: true, text: p.text, title: p.title, nominal_cost: 1 } : { ok: false, text: '', error: { code: 'FETCH_HTTP' }, nominal_cost: 1 }; },
    extract: async ({ document, today, firstSeen }) => extract({ document, extraction: pages[document.url]?.extraction ?? fullV2({ entity_kind: 'other', canonical_name: 'Unknown page' }), today, firstSeen }),
    plan: async input => { calls.plan.push(structuredClone({ mode: input.mode, state: input.state, limit: input.limit })); return input.mode === 'initial_batch' ? (plans.initial ?? { queries: [], stop: true, candidate_firms: [] }) : (plans.adaptive?.[adaptive++] ?? { queries: [], stop: true, candidate_firms: [] }); }
  } };
}

// ───────── Config y congelado ─────────
test('V7-1 config v7: esquema v5, solo cambian las claves declaradas, manifest v7 con los mismos prompts que v5', () => {
  const c = validateInvestor('investor_run_config.v5', v7()), b = v5();
  assert.equal(c.status, 'frozen'); assert.notEqual(c.bench_id, b.bench_id); assert.equal(c.today, b.today);
  assert.deepEqual(c.budgets, b.budgets); assert.deepEqual(c.search, b.search); assert.equal(c.patience_n, b.patience_n); assert.deepEqual(c.resolution, b.resolution);
  assert.deepEqual(c.b2, { initial_batch: 6, max_searches_per_step: 3, min_searches_before_stop: 14, fixed_initial_batch: 'v7-initial-batches.json' });
  assert.deepEqual(c.deepening, { ...b.deepening, max_firms_per_run: 8 });
  assert.deepEqual(c.fetch_domain_skip, { enabled: true, after_failures: 2 }); assert.equal(c.extractor_impl, 'v7');
  const { schema_version, bench_id, status, b2, deepening, prompts, fetch_domain_skip, extractor_impl, cache_layers, ...rest7 } = c;
  const { schema_version: s5, bench_id: id5, status: st5, b2: b25, deepening: d5, prompts: p5, ...rest5 } = b;
  assert.deepEqual(rest7, rest5, 'el resto de la config es idéntico a v5');
  assert.deepEqual({ ...prompts, manifest: null }, { ...p5, manifest: null });
  for (const [id, v] of [['planner', 'v3'], ['extractor', 'v3'], ['judge', 'v2'], ['b0_templates', 'v2']]) assert.equal(loadInvestorPrompt(id, v, { manifest: 'manifest.v7.json' }).sha256, loadInvestorPrompt(id, v, { manifest: 'manifest.v5.json' }).sha256);
});

test('V7-2 freeze --check reproduce el fingerprint v5 (89 archivos originales idénticos) sin escribir', { skip: !existsSync(resolve(repo, 'research/bench/investors/out/investors-internal-2026-10-09-v5/fingerprint.json')) }, () => {
  const fp = resolve(repo, 'research/bench/investors/out/investors-internal-2026-10-09-v5/fingerprint.json'), before = sha(fp);
  const r = spawnSync(process.execPath, ['bench/investors/freeze.mjs', '--config', 'bench/investors/config/v5-2026-10-09.json', '--check'], { cwd: research, encoding: 'utf8' });
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(out.fingerprint_files, 89); assert.equal(out.identical, 89); assert.deepEqual(out.changed, []); assert.equal(sha(fp), before);
});

test('V7-3 lote inicial fijo: 6 casos, 6 consultas cada uno, del prompt planner v3, y coincide con las cachés v5 si están', () => {
  const f = json(cfgPath('v7-initial-batches'));
  assert.equal(f.schema_version, 'investor_fixed_initial_batch/1'); assert.equal(f.prompt_sha256, loadInvestorPrompt('planner', 'v3', { manifest: 'manifest.v5.json' }).sha256);
  assert.deepEqual(Object.keys(f.cases).sort(), ['p01', 'p02', 'p03', 'p04', 'p05', 'p06'].map(p => `inv-case-syn-${p}`));
  for (const [id, c] of Object.entries(f.cases)) { validateInvestor('investor_planner_output.v2', c.output); assert.equal(c.output.queries.length, 6); assert.equal(c.source_run_id, `investors-internal-2026-10-09-v5__${id}__B2__s101`); }
  if (existsSync(resolve(repo, 'research/bench/investors/out/investors-internal-2026-10-09-v5-pairs/cache.sqlite'))) {
    const r = spawnSync(process.execPath, ['bench/investors/analysis/v7/make_initial_batches.mjs', '--check'], { cwd: research, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
});

// ───────── C2 — extractor v7 ─────────
const page = (sentences) => sentences.join(' ');
test('V7-4 extractor v7 no cambia una página que v5 acepta', () => {
  const text = page(['Zentro Capital invests in seed fintech startups in Mexico.', filler('Zentro Capital')]);
  const ex = fullV2({ official_domain: 'zentro.test', quote: 'Zentro Capital invests in seed fintech startups in Mexico.' });
  const doc = { url: 'https://zentro.test/', title: 'Zentro', text };
  const a = extractFixtureInvestorV2({ document: doc, extraction: ex, today: TODAY, firstSeen: FS }), b = extractFixtureInvestorV7({ document: doc, extraction: ex, today: TODAY, firstSeen: FS });
  assert.ok(a.entity); assert.deepEqual(b.entity, a.entity); assert.equal(b.meta.quote_source, a.meta.quote_source);
});

test('V7-5 cita unida con "…": se guarda solo el tramo literal que prueba la inversión, y sigue siendo literal para v5', () => {
  const text = page(['Cherry Lane is based in Lisbon and works closely with its community.', 'Our office is open on weekdays.', 'We invest in seed startups before they have revenue.', filler('Cherry Lane')]);
  const ex = fullV2({ canonical_name: 'Cherry Lane', official_domain: 'cherrylane.test', quote: 'Cherry Lane is based in Lisbon and works closely with its community … We invest in seed startups before they have revenue.' });
  const doc = { url: 'https://cherrylane.test/about', title: 'About', text };
  assert.equal(extractFixtureInvestorV2({ document: doc, extraction: ex, today: TODAY, firstSeen: FS }).rejected_kind, 'missing_literal_quote');
  const r = extractFixtureInvestorV7({ document: doc, extraction: ex, today: TODAY, firstSeen: FS });
  assert.ok(r.entity, r.rejected_kind); assert.equal(r.meta.quote_source, 'model_segment');
  const q = r.entity.sources[0].quote; assert.ok(isLiteralIn(text, q)); assert.ok(!/…/.test(q));
});

test('V7-6 una cita parafraseada sigue rechazada: no hay firma sin cita literal', () => {
  const text = page(['Zentro Capital was founded in 2010 in Lima.', filler('Zentro Capital')]);
  const ex = fullV2({ official_domain: 'zentro.test', quote: 'Zentro Capital invests in seed-stage fintech startups in Mexico and Peru.' });
  const r = extractFixtureInvestorV7({ document: { url: 'https://zentro.test/', title: 'Z', text }, extraction: ex, today: TODAY, firstSeen: FS });
  assert.equal(r.entity, null); assert.equal(r.rejected_kind, 'missing_literal_quote');
  const n = extractFixtureInvestorV7({ document: { url: 'https://zentro.test/', title: 'Z', text }, extraction: fullV2({ official_domain: 'zentro.test', quote: null }), today: TODAY, firstSeen: FS });
  assert.equal(n.entity, null);
});

test('V7-7 normalización permitida: invisibles, espacio antes del punto, escapes de markdown, comillas, guiones y mayúsculas; devuelve el tramo de la página', () => {
  const text = 'Intro text. Rif​ Ventures invests in seed\\-stage startups across Europe . More text follows here for padding purposes only.';
  const span = literalSpan(text, 'RIF Ventures invests in seed–stage startups across Europe.');
  assert.ok(span); assert.ok(isLiteralIn(text, span)); assert.match(span, /Rif/);
  assert.equal(literalSpan(text, 'Rif Ventures invests in growth companies in Asia.'), null);
  assert.deepEqual(literalSegments(text, 'Rif Ventures invests in seed-stage startups across Europe ... totally invented sentence that is not on the page'), [span]);
});

// ───────── C3 — dominios que fallan ─────────
test('V7-8 C3: tras 2 fallos sin ningún fetch bueno, el dominio no se vuelve a pedir (se usa el texto del buscador) y el salto no cuenta como fetch', async () => {
  const bad = ['https://bad.test/a', 'https://bad.test/b', 'https://bad.test/c'];
  const qs = ['alpha bravo charlie', 'delta echo foxtrot', 'golf hotel india'];
  const mk = () => { const w = world({ searches: { [qs[0]]: [bad[0]], [qs[1]]: [bad[1]], [qs[2]]: [bad[2]] }, plans: { initial: { queries: qs, stop: false, candidate_firms: [] } } });
    const s0 = w.deps.search; w.deps.search = async (q, o) => { const r = await s0(q, o); r.results = r.results.map(x => ({ ...x, text: 'Search engine text about this page. '.repeat(20) })); return r; }; return w; };
  const w = mk();
  const r = await runInvestorDiscoveryV7({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B1', config: engineCfg(), templates, catalog, deps: w.deps });
  assert.deepEqual(w.calls.fetch, bad.slice(0, 2)); assert.equal(r.totals.fetches, 2);
  assert.equal(r.v2_stats.fetch_skipped_domain, 1); assert.equal(r.v2_stats.fetch_fallback_search_contents, 3); assert.equal(r.v2_stats.failed_domains['bad.test'], 2);
  const off = mk();
  const r2 = await runInvestorDiscoveryV7({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B1', config: engineCfg({ fetch_domain_skip: { enabled: false, after_failures: 2 } }), templates, catalog, deps: off.deps });
  assert.deepEqual(off.calls.fetch, bad); assert.equal(r2.totals.fetches, 3);
});

test('V7-9 C3: un dominio con un fetch bueno no se salta aunque falle dos veces', async () => {
  const ok = 'https://zentro.test/', f = ['https://zentro.test/x', 'https://zentro.test/y', 'https://zentro.test/z'];
  const pages = { [ok]: { title: 'Zentro', text: `Zentro Capital invests in seed fintech startups in Mexico. ${filler('Zentro Capital')}`, extraction: fullV2({ official_domain: 'zentro.test', quote: 'Zentro Capital invests in seed fintech startups in Mexico.' }) } };
  const qs = ['alpha bravo charlie', 'delta echo foxtrot', 'golf hotel india', 'juliet kilo lima'];
  const w = world({ pages, searches: { [qs[0]]: [ok], [qs[1]]: [f[0]], [qs[2]]: [f[1]], [qs[3]]: [f[2]] }, plans: { initial: { queries: qs, stop: false, candidate_firms: [] } } });
  const s0 = w.deps.search; w.deps.search = async (q, o) => { const r = await s0(q, o); r.results = r.results.map(x => (x.url === ok ? x : { ...x, text: 'Search engine text about this page. '.repeat(20) })); return r; };
  const r = await runInvestorDiscoveryV7({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B1', config: engineCfg(), templates, catalog, deps: w.deps });
  assert.deepEqual(w.calls.fetch, [ok, ...f]); assert.equal(r.v2_stats.fetch_skipped_domain, 0);
});

// ───────── C5 — mínimo de búsquedas antes de stop ─────────
const WORDS = 'amber basil cedar dune ember fjord grove heath iris jade kelp lotus maple nectar olive pearl quartz raven sage tulip umber violet willow xenon yarrow zinnia birch coral delta eagle flint garnet'.split(' ');
const uniq = i => `${WORDS[(i * 3) % WORDS.length]} ${WORDS[(i * 3 + 1) % WORDS.length]} ${WORDS[(i * 3 + 2) % WORDS.length]} n${i}x${i * 13}`;
const plainWorld = (n, adaptive) => { const qs = Array.from({ length: n }, (_, i) => uniq(i)); return world({ searches: {}, plans: { initial: { queries: qs, stop: false, candidate_firms: [] }, adaptive } }); };
test('V7-10 C5: en B2 un stop antes de 14 búsquedas se rechaza y se pide un paso más con el aviso en el estado', async () => {
  const more = i => ({ queries: [0, 1, 2].map(k => uniq(100 + i * 10 + k)), stop: false, candidate_firms: [] });
  const w = plainWorld(6, [{ queries: [], stop: true, candidate_firms: [] }, more(1), { queries: [], stop: true, candidate_firms: [] }, more(2), { queries: [], stop: true, candidate_firms: [] }]);
  const r = await runInvestorDiscoveryV7({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: engineCfg({ patience_n: 99 }), templates, catalog, deps: w.deps });
  const adaptive = w.calls.plan.filter(p => p.mode === 'adaptive_step');
  assert.equal(adaptive[0].state.stop_not_accepted, undefined); assert.equal(adaptive[1].state.stop_not_accepted.min_searches_before_stop, 14);
  assert.equal(r.totals.searches, 12 + 0); assert.equal(r.stop_reason, 'no_more_actions');
  assert.equal(r.v2_stats.stop_rejected, 3); assert.equal(r.totals.planner_calls, 7);
});

test('V7-11 C5: con 14 búsquedas o más el stop se acepta; sin la clave el motor v7 da lo mismo que engine.v2', async () => {
  const w = plainWorld(14, [{ queries: [], stop: true, candidate_firms: [] }]);
  const cfg = engineCfg({ patience_n: 99, budgets: { ...v7().budgets } });
  const r = await runInvestorDiscoveryV7({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: { ...cfg, b2: { ...cfg.b2, initial_batch: 14 } }, templates, catalog, deps: w.deps });
  assert.equal(r.totals.searches, 14); assert.equal(r.v2_stats.stop_rejected, undefined);
  const mk = () => plainWorld(6, [{ queries: [], stop: true, candidate_firms: [] }]);
  const base = { ...engineCfg(), b2: { ...v7().b2, min_searches_before_stop: 0 }, fetch_domain_skip: { enabled: false, after_failures: 2 } };
  const a = await runInvestorDiscoveryV7({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: base, templates, catalog, deps: mk().deps });
  const b = await runInvestorDiscoveryV2({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B2', config: base, templates, catalog, deps: mk().deps });
  assert.deepEqual(a, b);
});

test('V7-12 C5 no toca B1', async () => {
  const w = plainWorld(4, []);
  const r = await runInvestorDiscoveryV7({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B1', config: engineCfg({ patience_n: 99 }), templates, catalog, deps: w.deps });
  assert.equal(r.totals.searches, 4); assert.equal(r.stop_reason, 'queries_exhausted'); assert.equal(w.calls.plan.length, 1);
});

// ───────── Caché por capas ─────────
test('V7-13 caché por capas: lee la capa en solo lectura, copia el acierto a la propia y no modifica la capa', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'v7-cache-')), layer = resolve(dir, 'layer.sqlite'), own = resolve(dir, 'own.sqlite');
  const l = createBenchCache({ path: layer, namespace: 'old' }); l.put('llm', 'k1', { json: { a: 1 } }, { tokens: 5 }); l.close();
  const before = sha(layer);
  const c = createLayeredCache({ primary: { path: own, namespace: 'new' }, readLayers: [{ path: layer, namespace: 'old' }, { path: resolve(dir, 'no-existe.sqlite'), namespace: 'x' }] });
  assert.deepEqual(c.get('llm', 'k1').value, { json: { a: 1 } }); assert.equal(c.get('llm', 'k2'), null);
  c.put('llm', 'k3', { json: { b: 2 } }); c.close();
  assert.equal(sha(layer), before);
  const o = createBenchCache({ path: own, namespace: 'new' }); assert.deepEqual(o.get('llm', 'k1').value, { json: { a: 1 } }); assert.deepEqual(o.get('llm', 'k3').value, { json: { b: 2 } }); o.close();
});

// ───────── Gasto y prueba de alcanzabilidad ─────────
test('V7-14 exa_spend --usd-per-call cuenta solo llamadas pagadas de Exa al costo real', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'v7-spend-'));
  const ev = [{ event: 'search_end', timestamp: '2026-10-12T00:00:00Z', attempts: [{ provider: 'exa', cached: false, results: 10 }] }, { event: 'search_end', timestamp: '2026-10-12T00:00:01Z', attempts: [{ provider: 'exa', cached: true, results: 10 }] }, { event: 'search_end', timestamp: '2026-10-12T00:00:02Z', attempts: [{ provider: 'exa', cached: false, results: 10 }, { provider: 'serper', cached: false, results: 10 }] }];
  writeFileSync(resolve(dir, 'events.jsonl'), ev.map(e => JSON.stringify(e)).join('\n') + '\n');
  const run = extra => spawnSync(process.execPath, ['bench/investors/analysis/exa_spend.mjs', '--dirs', dir, ...extra], { cwd: research, encoding: 'utf8' }).stdout.trim();
  assert.equal(run(['--usd-per-call', '0.0089']), '0.018'); assert.equal(run([]), '0.05');
});

test('V7-15 C4: 18 consultas cortas (3 por caso), sin el nombre de la firma del oro', () => {
  assert.equal(Object.values(QUERIES).flatMap(x => x.q).length, 18);
  for (const [c, { gold, q }] of Object.entries(QUERIES)) {
    const anchor = json(resolve(repo, `research/bench/investors/cases/inv-case-syn-${c}.json`)).anchors[0];
    assert.equal(anchor.stable_id, `inv:domain:${gold}`);
    const nameWords = anchor.canonical_name.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4 && !['ventures', 'capital', 'partners', 'fund'].includes(w));
    for (const query of q) { assert.ok(query.split(/\s+/).length <= 14, query); for (const w of nameWords) assert.ok(!query.toLowerCase().includes(w), `${query} contiene ${w}`); }
  }
});

test('V7-16 runner v7 en DRY_RUN: 18 corridas B2 (p01–p06 × 3 réplicas) con el lote inicial de v5 s101; rechaza otras condiciones', () => {
  const base = ['bench/investors/run-experiment.v7.mjs', '--config', 'bench/investors/config/v7-2026-10-12.json', '--cases', 'bench/investors/cases', '--out', resolve(tmpdir(), 'v7-dry-out'), '--only-cases', 'p01,p02,p03,p04,p05,p06'];
  if (!json(cfgPath('v7-2026-10-12')).cache_layers.every(l => existsSync(resolve(repo, 'research/bench/investors', l.path)))) return;
  const r = spawnSync(process.execPath, [...base, '--dry-run'], { cwd: research, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); const d = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(d.scheduled, 18); assert.ok(d.runs.every(x => /__B2__s(101|202|303)$/.test(x.run_id) && /__B2__s101$/.test(x.fixed_initial_from)));
  const bad = spawnSync(process.execPath, [...base, '--conditions', 'B1', '--dry-run'], { cwd: research, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});
