// Pruebas v9 (PROMPT-v11): extractor determinista de nombres de listas, emparejamiento nombre–dominio v9, resolución v9,
// regla del diagnóstico, prueba de no-fuga del oro, huellas v5/v7/v8 y techos sin gasto reproducibles. Sin red ni LLM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cleanName, extractListNames, rankVariant, nameKey } from '../../bench/investors/list-names.v9.mjs';
import { nameMatchesDomainV9, registrableLabel, stripTypeTail } from '../../bench/investors/resolve-match.v9.mjs';
import { resolveCandidateV9, resolutionQuery } from '../../bench/investors/resolve.v9.mjs';
import { resolveCandidate } from '../../bench/investors/resolve.mjs';
import { nameMatchesDomain } from '../../bench/investors/extractor.mjs';
import { decide, listUrlsToOpen, expectedExaUnits, GOLD_QUERY_NAME, CFG } from '../../bench/investors/analysis/v9/diagnostico.v9.mjs';
import { GOLD_ALIASES, loadCase, CASES_A, CASES_B } from '../../bench/investors/analysis/v8/queries.v8.mjs';

const research = resolve(import.meta.dirname, '../..'), inv = resolve(research, 'bench/investors');
const ALL = [...CASES_A, ...CASES_B];

test('V9-1 no-fuga: ningún nombre ni dominio del oro en los módulos v9 del motor ni en la config v9', () => {
  const files = ['list-names.v9.mjs', 'resolve-match.v9.mjs', 'resolve.v9.mjs', 'config/v9-diagnostico-2026-10-12.json'].map(f => [f, readFileSync(resolve(inv, f), 'utf8').toLowerCase()]);
  for (const c of ALL) {
    const k = loadCase(c), anchor = JSON.parse(readFileSync(resolve(inv, `cases/inv-case-syn-${c}.json`), 'utf8')).anchors[0];
    const needles = [...GOLD_ALIASES[c], GOLD_QUERY_NAME[c], anchor.canonical_name.replace(/\s*\(.*$/, ''), k.gold.domain, k.gold.domain.split('.')[0]].map(s => s.toLowerCase()).filter(s => s.length >= 4);
    for (const [f, text] of files) for (const n of needles) assert.ok(!new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text), `${c}: "${n}" aparece en ${f}`);
  }
});

test('V9-2 nombres de listas: tablas con tipo pegado, iniciales de avatar, encabezados numerados, listas de inversores y texto', () => {
  const page = ['| Investor | Relevant Deals | Geography |', '| --- | --- | --- |', '| Alfa Beta VC Fund | 34 | Mexico |', '| Gamma Angel | 3 | Chile |',
    'QU Quanta Xylo Partners', 'Venture Capital View profile ↗', '### 4. Delta Growth Partners', 'Investors', 'Epsilon Capital, Zeta, Eta Ventures',
    'In 2024 the round was led by Theta Ventures and Iota Capital Group with others.', '## Top investors in Mexico', 'Mexico City', 'Seed, Series A'].join('\n');
  const names = extractListNames(page, { extraGeneric: ['Mexico'] }).map(x => x.name);
  for (const n of ['Alfa Beta', 'Gamma', 'Quanta Xylo Partners', 'Delta Growth Partners', 'Epsilon Capital', 'Zeta', 'Eta Ventures', 'Theta Ventures', 'Iota Capital Group']) assert.ok(names.includes(n), `${n} en ${names}`);
  for (const n of ['Investor', 'Top investors in Mexico', 'Seed, Series A']) assert.ok(!names.includes(n), n);
  assert.equal(cleanName('| ---'), null); assert.equal(cleanName('Series B'), null); assert.equal(cleanName('Fund'), null);
  assert.equal(cleanName('7. Kappa Fund'), 'Kappa Fund');
});

test('V9-3 orden firm_pages: más páginas que la citan primero; empate por primera aparición; solo nombres con forma de firma', () => {
  const pages = [{ url: 'a', text: '| Uno Capital | 1 |\n| Dos Ventures | 2 |\nTres' }, { url: 'b', text: 'Dos Ventures backs startups.\n| Cuatro Partners | 3 |' }, { url: 'c', text: 'Dos Ventures and Uno Capital.' }];
  const r = rankVariant(pages, 'firm_pages');
  assert.deepEqual(r.map(x => [x.name, x.pages]), [['Dos Ventures', 3], ['Uno Capital', 2], ['Cuatro Partners', 1]]);
  assert.ok(!r.some(x => x.name === 'Tres'));
  assert.equal(nameKey('Café & Co.'), 'cafe and co');
});

test('V9-4 emparejamiento v9: dominios cortos, siglas, etiqueta registrable, sin tipo pegado; la regla v8 sigue valiendo', () => {
  for (const [n, h] of [['Hi Ventures', 'hi.vc'], ['Community Investment Management', 'cim-llc.com'], ['EQT Ventures – Climate Tech', 'v3.eqtventures.com'], ['Qbic Fund', 'qbic.be'], ['New Enterprise Associates', 'nea.com'], ['Advanced Technology Ventures (ATV)', 'atvcapital.com'], ['Bessemer Venture Partners', 'bvp.com']]) assert.ok(nameMatchesDomainV9(n, h), `${n} ~ ${h}`);
  for (const [n, h] of [['Hi Ventures', 'hightail.com'], ['Omega Fund', 'worldbank.org'], ['Sigma Capital', 'linkedin.com'], ['Rho Partners', 'shizune.co'], ['Nu Ventures', 'en.wikipedia.org']]) assert.ok(!nameMatchesDomainV9(n, h), `${n} !~ ${h}`);
  for (const [n, h] of [['Alpha Partners', 'alphapartners.com'], ['Betafund', 'betafund.vc']]) { assert.ok(nameMatchesDomain(n, h)); assert.ok(nameMatchesDomainV9(n, h)); }
  assert.equal(registrableLabel('www.x.co.uk'), 'x'); assert.equal(registrableLabel('group.bank'), 'group');
  assert.equal(stripTypeTail('Kappa Ventures VC Fund'), 'Kappa Ventures'); assert.equal(stripTypeTail('Lambda Capital'), 'Lambda Capital');
});

test('V9-5 resolución v9: con el emparejador y la consulta por defecto da lo mismo que resolve.mjs; con v9 encuentra hosts cortos', async () => {
  const mk = (rows, extracted) => {
    const log = { queries: [] };
    return { log, ctx: { deps: { search: async q => { log.queries.push(q); return { results: rows }; } }, config: { resolution: { suffix: 'venture capital' } }, canSearch: () => true, canFetch: () => true, remainingSearches: () => 5, onSearch: () => {}, denied: () => false, seenUrl: () => false, fetchPage: async () => ({ text: 'x'.repeat(300) }), extract: async () => extracted } };
  };
  const ent = d => ({ entity: { canonical_name: 'Hi Ventures', aliases: [], official_domain: d } });
  const rows = [{ url: 'https://www.linkedin.com/company/x' }, { url: 'https://hi.vc/' }];
  const a = mk(rows, ent('hi.vc')), b = mk(rows, ent('hi.vc')), c = mk(rows, ent('hi.vc'));
  const r0 = await resolveCandidate({ name: 'Hi Ventures' }, a.ctx), r1 = await resolveCandidateV9({ name: 'Hi Ventures' }, b.ctx), r2 = await resolveCandidateV9({ name: 'Hi Ventures VC Fund' }, c.ctx, { matcher: nameMatchesDomainV9, stripTail: true });
  assert.equal(r0.outcome, 'no_domain'); assert.equal(r1.outcome, 'no_domain'); assert.deepEqual(a.log.queries, b.log.queries);
  assert.equal(r2.outcome, 'accepted'); assert.equal(c.log.queries[0], '"Hi Ventures" venture capital');
  assert.equal(resolutionQuery('Mu Capital VC Fund', 'venture capital', { stripTail: true }), '"Mu Capital" venture capital');
  const d = mk([{ url: 'https://hi.vc/' }], ent('other.com'));
  assert.equal((await resolveCandidateV9({ name: 'Hi Ventures' }, d.ctx, { matcher: nameMatchesDomainV9 })).outcome, 'rejected:not_first_party');   // la regla de primera parte no cambia
});

test('V9-6 regla del diagnóstico: límite Exa con ≥4 de 12 sin el sitio; GO condicional solo con ≥4 de 6 en A y en B por Serper', () => {
  const row = (c, o) => ({ case: c, exa_top10: true, sel: true, acc_exa: false, acc_serper: true, ...o });
  const good = [...CASES_A, ...CASES_B].map(c => row(c));
  assert.equal(decide(good).go_L128_serper, true); assert.equal(decide(good).limit_is_exa, false);
  const badA = good.map(r => CASES_A.slice(0, 3).includes(r.case) ? { ...r, acc_serper: false } : r);
  assert.equal(decide(badA).A_pass_serper, 3); assert.equal(decide(badA).verdict, 'NO-GO');
  const exaMiss = good.map((r, i) => i < 4 ? { ...r, exa_top10: false } : r);
  assert.equal(decide(exaMiss).limit_is_exa, true);
  const notSel = good.map(r => CASES_B.slice(0, 3).includes(r.case) ? { ...r, sel: false } : r);
  assert.equal(decide(notSel).go_L128_serper, false);
});

test('V9-7 política de apertura de listas (la de v8): por puesto, ≤2 por sitio, 6 por consulta, lista negra', () => {
  const rows = [['q1', 1, 'https://a.com/1'], ['q1', 2, 'https://a.com/2'], ['q1', 3, 'https://a.com/3'], ['q1', 4, 'https://crunchbase.com/x'], ['q1', 5, 'https://b.com/'], ['q1', 6, 'https://c.com/'], ['q1', 7, 'https://d.com/'], ['q1', 8, 'https://e.com/'], ['q1', 9, 'https://f.com/'], ['q2', 1, 'https://a.com/1'], ['q2', 2, 'https://g.com/']].map(([query, rank, url]) => ({ query, rank, url }));
  assert.deepEqual(listUrlsToOpen(rows), ['https://a.com/1', 'https://a.com/2', 'https://b.com/', 'https://c.com/', 'https://d.com/', 'https://e.com/', 'https://g.com/']);
  assert.equal(expectedExaUnits(), 12); assert.ok(12 * CFG.caps.exa_usd_per_call <= CFG.caps.exa_usd);
});

test('V9-8 huellas: v5 (89), v7 (110) y v8 (111) idénticas; la config v9 es aparte y frozen', () => {
  for (const [cfg, n] of [['v5-2026-10-09', 89], ['v7-2026-10-12', 110], ['v8-2026-10-12', 111]]) {
    const out = spawnSync(process.execPath, ['bench/investors/freeze.mjs', '--config', `bench/investors/config/${cfg}.json`, '--check'], { cwd: research, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stdout + out.stderr); const j = JSON.parse(out.stdout.trim().split('\n').at(-1));
    assert.equal(j.fingerprint_files, n, cfg); assert.equal(j.identical, n, cfg);
  }
  assert.equal(CFG.status, 'frozen'); assert.notEqual(CFG.bench_id, JSON.parse(readFileSync(resolve(inv, 'config/v8-2026-10-12.json'), 'utf8')).bench_id);
});

const caches = existsSync(resolve(inv, 'out/investors-internal-2026-10-12-v8/cache.sqlite')) && existsSync(resolve(inv, 'out/v8-diagnostico-2026-10-12/cache.sqlite'));
test('V9-9 techos sin gasto reproducibles desde las cachés (selección por réplica: K=64 → 2 casos, K=128 → 4 casos)', { skip: !caches && 'sin cachés v8' }, async () => {
  const { replicaRows } = await import('../../bench/investors/analysis/v9/ceiling_replicas.mjs');
  const rows = replicaRows(), sel = K => CASES_A.filter(c => rows.filter(r => r.case === c && r.rank && r.rank <= K).length >= 2);
  assert.deepEqual(sel(64), ['p01', 'p06']); assert.deepEqual(sel(128), ['p01', 'p02', 'p03', 'p06']);
  assert.equal(rows.length, 18);
});

test('V9-10 diagnóstico de punta a punta en modo simulado (sin red ni LLM): 12 unidades medidas por exa_spend, decisión y no repite', { skip: !caches && 'sin cachés v8' }, () => {
  const d = mkdtempSync(resolve(tmpdir(), 'v9d-'));
  const env = { ...process.env, V9_DIAG_MOCK: '1', V9_DIAG_OUT: d };
  const run = spawnSync(process.execPath, ['--no-warnings', 'bench/investors/analysis/v9/diagnostico.v9.mjs', '--cap-usd', '0.25', '--stop-file', resolve(d, '.stop')], { cwd: research, env, encoding: 'utf8', timeout: 240000 });
  assert.equal(run.status, 0, run.stderr.slice(-500));
  const r = JSON.parse(readFileSync(resolve(d, 'result.json'), 'utf8'));
  assert.equal(r.rows.length, 12); assert.equal(r.paid_units, 12); assert.equal(r.decision.A_selected_k, 4);
  const sp = spawnSync(process.execPath, ['bench/investors/analysis/exa_spend.mjs', '--dirs', d, '--usd-per-call', '0.0089'], { cwd: research, encoding: 'utf8' });
  assert.equal(sp.stdout.trim(), '0.107');
  const again = spawnSync(process.execPath, ['--no-warnings', 'bench/investors/analysis/v9/diagnostico.v9.mjs'], { cwd: research, env, encoding: 'utf8' });
  assert.match(again.stdout, /ya ejecutado/);
  const tight = spawnSync(process.execPath, ['--no-warnings', 'bench/investors/analysis/v9/diagnostico.v9.mjs', '--dry-run', '--cap-usd', '0.05'], { cwd: research, env, encoding: 'utf8' });
  assert.equal(tight.status, 4);   // costo esperado 0.107 > tope: no se ejecuta
});

// ───────── Motor v9: candidatos del modelo ─────────
import { validateInvestor } from '../../bench/investors/contracts.mjs';
import { loadInvestorPrompt } from '../../bench/investors/prompts.mjs';
import { runInvestorDiscoveryV8 } from '../../bench/investors/engine.v8.mjs';
import { runInvestorDiscoveryV9 } from '../../bench/investors/engine.v9.mjs';
import { extractFixtureInvestorV7 } from '../../bench/investors/extractor.v7.mjs';
import { validateWorkspaceV9 } from '../../bench/investors/workspace.v9.mjs';
import { createNameCandidates, normalizeFirms, briefFor, availableProviders } from '../../bench/investors/name-candidates.v9.mjs';
import { createBenchCache } from '../../agent/cache.mjs';
const repo = resolve(research, '..'), F = resolve(import.meta.dirname, 'fixtures/investor-world-v0');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const cfg8 = () => json(resolve(inv, 'config/v8-2026-10-12.json')), cfg9 = () => json(resolve(inv, 'config/v9-2026-10-13.json'));
const fprofile = json(resolve(F, 'profile.json')), anchorCase = json(resolve(F, 'cases/case-anchor.json'));
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const templates = loadInvestorPrompt('b0_templates', 'v2', { manifest: 'manifest.v7.json' }).templates;
const engineCfg = (base, o = {}) => ({ ...base, search: { provider: 'fixture', results_per_query: 10 }, judge: { max_llm_calls: 0 }, deepening: { ...base.deepening, enabled: false }, ...o });
const EV0 = { investor_type: null, sectors: null, stages: null, rounds: null, geographies: null, check_range_usd: null, lead_follow: null, business_models: null, active_status: null, published_on: null };
const fullV2 = (o = {}) => ({ entity_kind: 'institutional_investor', canonical_name: 'X', official_domain: null, aliases: [], investor_type: 'unknown', parent_firm: null, vehicles: [], active_status: 'unknown',
  sectors: [], stages: [], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, lead_follow: 'unknown', business_models: { accepted: [], excluded: [] },
  regulatory_restrictions: [], relevant_portfolio: [], potential_conflicts: [], recent_investment: false, source_kind: 'official', published_on: null, quote: null, regulatory_id: null,
  canonical_url: null, contradictions: [], evidence: { ...EV0 }, candidates: [], ...o, evidence: { ...EV0, ...(o.evidence ?? {}) } });
const fintech = () => { const p = structuredClone(fprofile); p.fields.sector.value = 'Fintech'; p.fields.funding_stage.value = 'seed'; p.fields.accepted_investor_types.value = ['generalist_vc']; p.fields.incorporation_country.value = 'Mexico'; p.fields.operating_regions.value = ['Mexico']; p.fields.target_markets.value = ['Mexico']; p.fields.subsectors.value = ['B2B payments']; return p; };
const filler = n => `${n} has a small team and publishes its portfolio on this website for founders who want to learn more about how the partnership works day to day.`;
const firmPage = (name, dom) => ({ title: name, text: `${name} invests in seed fintech startups in Mexico. ${filler(name)}`, extraction: fullV2({ canonical_name: name, official_domain: dom, quote: `${name} invests in seed fintech startups in Mexico.` }) });
function world({ pages = {}, searchFn = () => [], plans = {}, firms = null }) {
  const calls = { search: [], fetch: [], plan: [], names: 0 };
  return { calls, deps: {
    search: async q => { calls.search.push(q); return { results: searchFn(q).map((u, i) => ({ rank: i + 1, url: u, title: u })), nominal_cost: 1 }; },
    fetch: async url => { calls.fetch.push(url); const p = pages[url]; return p ? { ok: true, text: p.text, title: p.title, nominal_cost: 1 } : { ok: false, text: '', error: { code: 'FETCH_HTTP' }, nominal_cost: 1 }; },
    extract: async ({ document, today, firstSeen }) => extractFixtureInvestorV7({ document, extraction: pages[document.url]?.extraction ?? fullV2({ entity_kind: 'other', canonical_name: 'Unknown page' }), today, firstSeen }),
    plan: async input => { calls.plan.push(input.mode); return input.mode === 'initial_batch' ? (plans.initial ?? { queries: [], stop: true, candidate_firms: [] }) : { queries: [], stop: true, candidate_firms: [] }; },
    ...(firms ? { nameCandidates: async () => { calls.names++; return { provider: 'test', model: 'm', web: false, cached: false, firms, tokens: 10 }; } } : {})
  } };
}

test('V9-11 config v9: igual a v8 salvo bench_id, manifest v9, lista apagada, b2.model_candidates y dos capas de caché; el workspace la valida', () => {
  const c = cfg9(), b = cfg8();
  assert.equal(c.status, 'frozen'); assert.equal(c.bench_id, 'investors-internal-2026-10-13-v9'); assert.equal(c.prompts.manifest, 'manifest.v7.json'); assert.equal(c.b2.model_candidates.manifest, 'manifest.v9.json');
  assert.equal(c.b2.list_discovery.enabled, false); assert.equal(c.b2.model_candidates.enabled, true); assert.equal(c.b2.model_candidates.provider, 'auto');
  const { model_candidates, list_discovery, ...b2 } = c.b2; const { list_discovery: l8, ...b28 } = b.b2; assert.deepEqual(b2, b28);
  const strip = x => { const { bench_id, b2, cache_layers, ...r } = x; return r; }; assert.deepEqual(strip(c), strip(b));
  assert.deepEqual(c.cache_layers.slice(0, b.cache_layers.length), b.cache_layers);
  const { model_candidates: _m, ...b2v } = c.b2; validateInvestor('investor_run_config.v6', { ...c, b2: b2v });
  assert.equal(validateWorkspaceV9({ configPath: resolve(inv, 'config/v9-2026-10-13.json'), casesDir: resolve(inv, 'cases') }).config.bench_id, 'investors-internal-2026-10-13-v9');
});

test('V9-12 sin b2.model_candidates el motor v9 da lo mismo que el v8 sin fase de listas', async () => {
  const z = 'https://zentro.test/', qs = ['alpha bravo charlie'];
  const mk = () => world({ pages: { [z]: firmPage('Zentro Capital', 'zentro.test') }, searchFn: q => q === qs[0] ? [z] : [], plans: { initial: { queries: qs, stop: false, candidate_firms: [] } } });
  const off8 = engineCfg(cfg8(), { b2: { ...cfg8().b2, list_discovery: { ...cfg8().b2.list_discovery, enabled: false } } });
  const off9 = engineCfg(cfg9(), { b2: { ...cfg9().b2, model_candidates: { ...cfg9().b2.model_candidates, enabled: false } } });
  const a = await runInvestorDiscoveryV8({ caseObj: anchorCase, profile: fintech(), condition: 'B2', config: off8, templates, catalog, deps: mk().deps });
  const b = await runInvestorDiscoveryV9({ caseObj: anchorCase, profile: fintech(), condition: 'B2', config: off9, templates, catalog, deps: mk().deps });
  assert.deepEqual(b.entities.map(e => e.stable_id), a.entities.map(e => e.stable_id)); assert.deepEqual(b.totals, a.totals); assert.equal(b.v2_stats.model_phase, undefined);
});

test('V9-13 candidatos del modelo: dominio propuesto, respaldo por búsqueda, inventados fuera, regla de cita intacta y planner con su presupuesto', async () => {
  const pages = { 'https://alfa.test/': firmPage('Alfa Ventures', 'alfa.test'), 'https://beta.test/': firmPage('Beta Capital', 'beta.test'), 'https://gamma.test/': { title: 'Gamma', text: `Gamma Partners is a company. ${filler('Gamma')}`, extraction: fullV2({ canonical_name: 'Gamma Partners', official_domain: 'gamma.test', quote: 'Gamma Partners is a company.' }) } };
  const firms = [{ name: 'Alfa Ventures', domain: 'alfa.test' }, { name: 'Beta Capital', domain: 'wrong-beta.test' }, { name: 'Ghost Fund', domain: null }, { name: 'Gamma Partners', domain: 'gamma.test' }];
  const pq = ['pq one', 'pq two', 'pq three', 'pq four'];
  const w = world({ pages, firms, plans: { initial: { queries: pq, stop: false, candidate_firms: [] } }, searchFn: q => q === '"Beta Capital" venture capital' ? ['https://www.linkedin.com/x', 'https://beta.test/'] : [] });
  const cfg = engineCfg(cfg9(), { budgets: { ...cfg9().budgets, searches: 4 } });
  const r = await runInvestorDiscoveryV9({ caseObj: anchorCase, profile: fintech(), condition: 'B2', config: cfg, templates, catalog, deps: w.deps });
  const doms = r.entities.map(e => e.official_domain).sort();
  assert.deepEqual(doms, ['alfa.test', 'beta.test'], JSON.stringify(r.v2_stats.model_phase));
  const mp = r.v2_stats.model_phase; assert.equal(mp.proposed, 4); assert.equal(mp.accepted, 2); assert.equal(mp.via_domain, 1); assert.equal(mp.via_search, 1);
  assert.ok(r.entities.every(e => e.sources.every(s => s.quote && pages[s.url]?.text.includes(s.quote))));
  assert.equal(Object.entries(mp.outcomes).filter(([k]) => k.startsWith('rejected:')).reduce((a, [, v]) => a + v, 0), 1, `Gamma sin verbo de inversión no entra: ${JSON.stringify(mp.outcomes)}`);
  assert.equal(r.totals.searches, mp.searches + 4, 'el planner conserva sus 4 búsquedas');
  assert.ok(w.calls.search.indexOf(pq[0]) > w.calls.search.indexOf('"Ghost Fund" venture capital'));
  assert.equal(w.calls.names, 1); assert.ok(r.entities.every(e => e.first_seen.origin === 'resolution'));
});

test('V9-14 no-fuga del brazo v9: ni nombres ni dominios del oro en engine.v9, name-candidates.v9, prompt candidates, runner, workspace ni config v9', () => {
  const files = ['engine.v9.mjs', 'name-candidates.v9.mjs', 'run-experiment.v9.mjs', 'workspace.v9.mjs', 'config/v9-2026-10-13.json', '../../../prompts/investor/candidates/v1/system.md', '../../../prompts/investor/candidates/v1/user.md'].map(f => [f, readFileSync(resolve(inv, f), 'utf8').toLowerCase()]);
  for (const c of ALL) {
    const k = loadCase(c), anchor = JSON.parse(readFileSync(resolve(inv, `cases/inv-case-syn-${c}.json`), 'utf8')).anchors[0];
    const needles = [...GOLD_ALIASES[c], GOLD_QUERY_NAME[c], anchor.canonical_name.replace(/\s*\(.*$/, ''), k.gold.domain, k.gold.domain.split('.')[0]].map(s => s.toLowerCase()).filter(s => s.length >= 4);
    for (const [f, text] of files) for (const n of needles) assert.ok(!new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text), `${c}: "${n}" aparece en ${f}`);
  }
});

test('V9-15 proveedores de nombres: Anthropic y Gemini (con y sin búsqueda web), caché entre réplicas, errores de clave', async () => {
  const p = JSON.parse(readFileSync(resolve(inv, 'cases/profiles/inv-case-syn-p01.json'), 'utf8'));
  assert.ok(!JSON.stringify(briefFor(p)).includes('(SYN)'));
  assert.deepEqual(normalizeFirms({ firms: [{ name: 'A Capital', domain: 'https://www.a.vc/x' }, { name: 'a capital', domain: null }, { name: 'B', domain: 'not a domain' }] }, 40).map(f => [f.name, f.domain]), [['A Capital', 'a.vc'], ['B', null]]);
  const d = mkdtempSync(resolve(tmpdir(), 'v9n-')), cache = createBenchCache({ path: resolve(d, 'c.sqlite'), namespace: 't' });
  let n = 0, bodies = [];
  const anth = async (u, o) => { n++; const b = JSON.parse(o.body); bodies.push(b); if (b.tools) return { ok: false, status: 400, text: async () => 'tool not allowed' }; return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'claude-x', content: [{ type: 'text', text: '{"firms":[{"name":"Uno VC","domain":"uno.vc","reason":"r"}]}' }], usage: { input_tokens: 5, output_tokens: 5 } }) }; };
  const nc = createNameCandidates({ provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'k'.repeat(20) }, cache, fetcher: anth, models: ['m1'] });
  const r1 = await nc({ profile: p }); assert.equal(r1.firms[0].domain, 'uno.vc'); assert.equal(r1.web, false); assert.equal(n, 2, 'con búsqueda web da 400 → sin búsqueda');
  const r2 = await nc({ profile: p }); assert.equal(r2.cached, true); assert.equal(n, 2);
  const gem = async (u, o) => { assert.match(u, /models\/g1:generateContent$/); const b = JSON.parse(o.body); assert.ok(b.tools?.[0]?.google_search); return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n{"firms":[{"name":"Dos Capital","domain":null,"reason":"r"}]}\n```' }] } }] }) }; };
  assert.equal((await createNameCandidates({ provider: 'gemini', env: { GEMINI_API_KEY: 'g'.repeat(20) }, fetcher: gem, models: ['g1'] })({ profile: p })).firms[0].name, 'Dos Capital');
  const bad = async () => ({ ok: false, status: 401, text: async () => 'invalid x-api-key' });
  await assert.rejects(createNameCandidates({ provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'k'.repeat(20) }, fetcher: bad, models: ['m1', 'm2'] })({ profile: p }), /401/);
  assert.deepEqual(availableProviders({ ENGINE_LLM_URL: 'http://x:1/v1', GEMINI_API_KEY: 'g'.repeat(20) }), ['fleet', 'gemini']);
  cache.close();
});

test('V9-16 prueba de nombres: puntuación por nombre o dominio y elección del proveedor (GO con ≥ 4 de 6 en p01–p06)', async () => {
  const { scoreCase, choose } = await import('../../bench/investors/analysis/v9/names_check.mjs');
  const k = loadCase('p01');
  assert.equal(scoreCase('p01', [{ name: 'Otra Capital', domain: 'otra.vc' }, { name: 'X', domain: k.gold.domain }]).gold_rank, 2);
  assert.equal(scoreCase('p01', [{ name: `${GOLD_QUERY_NAME.p01} LLC`, domain: null }]).gold_rank, 1);
  assert.equal(scoreCase('p01', [{ name: 'Otra Capital', domain: null }]).gold_rank, null);
  const s = { fleet: { A_gold: 2, B_gold: 3, gain2_named: 5 }, anthropic: { A_gold: 5, B_gold: 4, gain2_named: 9 }, gemini: { error: 'x', A_gold: 0, B_gold: 0, gain2_named: 0 } };
  assert.deepEqual(choose(s), { provider: 'anthropic', go: true, A_gold: 5, B_gold: 4 });
  assert.equal(choose({ fleet: { A_gold: 3, B_gold: 6, gain2_named: 1 } }).go, false);
  assert.equal(choose({ fleet: { A_gold: 4, B_gold: 1, gain2_named: 1 }, anthropic: { A_gold: 4, B_gold: 1, gain2_named: 1 } }).provider, 'fleet', 'empate: el propio, que es gratis');
});
