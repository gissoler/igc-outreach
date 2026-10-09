// Pruebas v5 del motor de inversionistas (PROMPT-v5): Exa auto + highlights, triage previo al fetch y ronda de profundización.
// Fixtures sintéticos con dependencias simuladas; sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateInvestor } from '../../bench/investors/contracts.mjs';
import { loadInvestorPrompt } from '../../bench/investors/prompts.mjs';
import { runInvestorDiscovery } from '../../bench/investors/engine.mjs';
import { extractFixtureInvestorV2 } from '../../bench/investors/extractor.mjs';
import { createFailoverSearchTool } from '../../bench/investors/search-failover.mjs';
import { exaSearchApi } from '../../server/research/searchApis.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const F = resolve(import.meta.dirname, 'fixtures/investor-world-v0');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const profile = json(resolve(F, 'profile.json'));
const anchorCase = json(resolve(F, 'cases/case-anchor.json'));
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const templates = loadInvestorPrompt('b0_templates').templates;
const cfgPath = v => resolve(repo, `research/bench/investors/config/${v}.json`);
const v4Config = () => ({ ...json(cfgPath('v4-2026-10-09')), search: { provider: 'fixture', results_per_query: 10 }, judge: { max_llm_calls: 0 } });
const v5Config = (o = {}) => ({ ...json(cfgPath('v5-2026-10-09')), search: { provider: 'fixture', results_per_query: 10 }, judge: { max_llm_calls: 0 }, ...o });

const EVIDENCE_NULL = { investor_type: null, sectors: null, stages: null, rounds: null, geographies: null, check_range_usd: null, lead_follow: null, business_models: null, active_status: null, published_on: null };
const fullV2 = (overrides = {}) => ({
  entity_kind: 'institutional_investor', canonical_name: 'Zentro Capital', official_domain: null, aliases: [], investor_type: 'unknown', parent_firm: null, vehicles: [], active_status: 'unknown',
  sectors: [], stages: [], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, lead_follow: 'unknown', business_models: { accepted: [], excluded: [] },
  regulatory_restrictions: [], relevant_portfolio: [], potential_conflicts: [], recent_investment: false, source_kind: 'official', published_on: null, quote: null, regulatory_id: null,
  canonical_url: null, contradictions: [], evidence: { ...EVIDENCE_NULL }, candidates: [], ...overrides, evidence: { ...EVIDENCE_NULL, ...(overrides.evidence ?? {}) }
});
const fintechProfile = () => { const p = structuredClone(profile); p.fields.sector.value = 'Fintech'; p.fields.funding_stage.value = 'seed'; p.fields.accepted_investor_types.value = ['generalist_vc']; p.fields.incorporation_country.value = 'Mexico'; p.fields.operating_regions.value = ['Mexico']; p.fields.target_markets.value = ['Mexico']; p.fields.lead_preference.value = 'seeking lead'; return p; };
// Mundo sintético: páginas → texto + extracción v2 que "devolvería" el modelo. La búsqueda registra las opciones recibidas.
function world({ pages = {}, searches = {}, plans = {} } = {}) {
  const calls = { search: [], fetch: [] }; let adaptive = 0;
  return {
    calls,
    deps: {
      search: async (q, options = {}) => { calls.search.push({ q, options }); return { results: (searches[q] ?? []).map((u, i) => (typeof u === 'string' ? { rank: i + 1, url: u, title: pages[u]?.title ?? u } : { rank: i + 1, ...u })), nominal_cost: 1 }; },
      fetch: async url => { calls.fetch.push(url); const p = pages[url]; return p ? { ok: true, text: p.text, title: p.title, nominal_cost: 1 } : { ok: false, text: '', error: { code: 'FETCH_EMPTY' }, nominal_cost: 1 }; },
      extract: async ({ document, today, firstSeen }) => extractFixtureInvestorV2({ document, extraction: pages[document.url]?.extraction ?? fullV2({ entity_kind: 'other', canonical_name: 'Unknown page' }), today, firstSeen }),
      plan: async ({ mode }) => mode === 'initial_batch' ? (plans.initial ?? { queries: [], stop: true, candidate_firms: [] }) : (plans.adaptive?.[adaptive++] ?? { queries: [], stop: true, candidate_firms: [] })
    }
  };
}
const filler = name => `${name} has a small team and publishes its portfolio on this website for founders who want to learn more about how the partnership works day to day.`;
const firmPage = (name, sentence, extra = {}) => ({ title: name, text: `${sentence} ${filler(name)}`, extraction: fullV2({ canonical_name: name, quote: sentence, ...extra }) });

// ───────── V5-1 — Exa según la guía de buenas prácticas ─────────
const captureExa = async (fn) => {
  const bodies = []; const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ results: [{ url: 'https://a.test/', title: 'A', text: 'x'.repeat(5000), highlights: ['A invests in seed fintech in Mexico.'] }] }), { status: 200 }); };
  try { const out = await fn(); return { out, bodies }; } finally { globalThis.fetch = orig; }
};

test('V5-1a exaSearchApi: sin flags la petición es idéntica a la anterior; con flags pide highlights e includeDomains', async () => {
  const { bodies } = await captureExa(async () => {
    await exaSearchApi('q', { env: { EXA_API_KEY: 'k' }, limit: 5 });
    await exaSearchApi('q', { env: { EXA_API_KEY: 'k', EXA_HIGHLIGHTS: '1', EXA_TEXT_CHARS: '4000' }, limit: 5, includeDomains: ['zentro.test'] });
  });
  assert.deepEqual(bodies[0], { query: 'q', type: 'auto', numResults: 5, contents: { text: { maxCharacters: 20000 } } });
  assert.deepEqual(bodies[1], { query: 'q', type: 'auto', numResults: 5, contents: { text: { maxCharacters: 4000 }, highlights: true }, includeDomains: ['zentro.test'] });
  for (const b of bodies) { assert.ok(!('livecrawl' in b) && !('livecrawl' in (b.contents ?? {}))); assert.ok(!('maxAgeHours' in (b.contents ?? {}))); assert.ok(!('category' in b)); }
});

test('V5-1b failover: v4 sigue en instant sin highlights; v5 usa auto + highlights y pasa includeDomains solo a Exa', async () => {
  const { bodies, out } = await captureExa(async () => {
    const v4 = await createFailoverSearchTool({ providers: ['exa'], env: { EXA_API_KEY: 'k', EXA_HIGHLIGHTS: '1' }, exaContentsChars: 4000 }).search('q');
    const v5 = await createFailoverSearchTool({ providers: ['exa'], env: { EXA_API_KEY: 'k' }, exaContentsChars: 4000, exaType: 'auto', exaHighlights: true }).search('venture capital firm investing in seed fintech in Mexico', { includeDomains: ['zentro.test'] });
    return { v4, v5 };
  });
  assert.equal(bodies[0].type, 'instant'); assert.equal(bodies[0].contents.highlights, undefined); assert.equal(bodies[0].includeDomains, undefined);
  assert.equal(bodies[1].type, 'auto'); assert.equal(bodies[1].contents.highlights, true); assert.deepEqual(bodies[1].includeDomains, ['zentro.test']);
  assert.ok(!/site:/.test(bodies[1].query));
  assert.equal(out.v5.results[0].highlights, 'A invests in seed fintech in Mexico.'); assert.equal(out.v5.results[0].text.length, 4000);
  assert.equal(Object.hasOwn(out.v4.results[0], 'highlights'), false);
});

test('V5-1c config v5 valida (frozen desde V6-1), usa manifest.v5 con planner v3 y b0 v2 verificados; v4 no cambia', () => {
  const v5 = validateInvestor('investor_run_config.v3', json(cfgPath('v5-2026-10-09')));
  assert.equal(v5.status, 'frozen'); assert.equal(v5.search.exa_type, 'auto'); assert.equal(v5.search.exa_highlights, true);
  assert.deepEqual(v5.deepening, { enabled: true, max_firms_per_run: 16, max_queries_per_firm: 2, max_fetches_per_firm: 4 });
  assert.deepEqual(v5.budgets, json(cfgPath('v4-2026-10-09')).budgets);
  const planner = loadInvestorPrompt('planner', 'v3', { manifest: 'manifest.v5.json' });
  assert.match(planner.system, /natural-language description of the page/); assert.match(planner.system, /no site:/);
  const b0 = loadInvestorPrompt('b0_templates', 'v2', { manifest: 'manifest.v5.json' }).templates;
  assert.ok(b0.every(t => !/site:|"/.test(t.template)));
  for (const [id, v] of [['planner', 'v2'], ['extractor', 'v3'], ['judge', 'v2']]) assert.equal(loadInvestorPrompt(id, v, { manifest: 'manifest.v5.json' }).sha256, loadInvestorPrompt(id, v, { manifest: 'manifest.v4.json' }).sha256);
  assert.equal(json(cfgPath('v4-2026-10-09')).schema_version, 'investor_run_config/2');
});

// ───────── V5-2 — Triage previo al fetch ─────────
import { triageResult, triageSearchResults } from '../../bench/investors/triage.mjs';

test('V5-2a una lista "Top 20 VCs in Chile" no se abre; el sitio de la firma sí; el descarte no cuenta como fetch ni como rechazada', async () => {
  const list = 'https://vcblog.test/top-20-vcs-in-chile', firm = 'https://andesfund.test/';
  const pages = {
    [list]: { title: 'Top 20 VCs in Chile (2026)', text: 'Top 20 VCs in Chile. Andes Fund invests in seed fintech startups in Mexico. '.repeat(5), extraction: fullV2({ entity_kind: 'other', canonical_name: 'VC blog' }) },
    [firm]: firmPage('Andes Fund', 'Andes Fund invests in seed fintech startups in Mexico.', { investor_type: 'venture_capital', sectors: ['fintech'], stages: ['seed'], geographies: ['Mexico'], evidence: { sectors: 'invests in seed fintech startups', stages: 'invests in seed', geographies: 'startups in Mexico', investor_type: 'Andes Fund invests' } })
  };
  const q = 'venture capital firm investing in seed fintech startups in Mexico';
  const w = world({ pages, searches: { [q]: [list, firm] }, plans: { initial: { queries: [q], stop: false, candidate_firms: [] } } });
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B1', config: v5Config({ deepening: { ...v5Config().deepening, enabled: false } }), templates, catalog, deps: w.deps });
  assert.ok(!w.calls.fetch.includes(list), 'la lista no se abre'); assert.ok(w.calls.fetch.includes(firm), 'la firma sí');
  assert.equal(r.totals.fetches, 1); assert.equal(r.totals.rejected_non_investors, 0);
  assert.equal(r.v2_stats.triage.discarded, 1); assert.equal(r.v2_stats.triage.by_reason.list_or_directory, 1);
  // El motor entrega la función de triage al buscador para que quede en search_end, con qué se descartó y por qué.
  const call = w.calls.search.find(c => c.q === q); assert.equal(typeof call.options.triage, 'function');
  const logged = call.options.triage([{ url: list, title: 'Top 20 VCs in Chile (2026)' }, { url: firm, title: 'Andes Fund' }]);
  assert.deepEqual(logged.discarded, [{ i: 0, url: list, reason: 'list_or_directory' }]); assert.equal(logged.demoted.length, 0);
});

test('V5-2b reglas: agregadores y directorios se descartan; noticias se bajan; host de firma conocida nunca se descarta', () => {
  assert.equal(triageResult({ url: 'https://shizune.co/investors/edtech-vc-funds-chile', title: 'Edtech VC funds in Chile' }).action, 'discard');
  assert.equal(triageResult({ url: 'https://www.vcbacked.co/company/lirmi', title: 'Lirmi' }).action, 'discard');
  assert.equal(triageResult({ url: 'https://news.test/best-edtech-investors', title: 'Best edtech investors' }).action, 'discard');
  assert.equal(triageResult({ url: 'https://dailynews.test/2026/05/acme-raises-5m', title: 'Acme raises $5M seed' }).action, 'demote');
  assert.equal(triageResult({ url: 'https://zentrocapital.test/strategy', title: 'Strategy' }).action, 'keep');
  assert.equal(triageResult({ url: 'https://zentrocapital.test/news/top-10-lessons', title: 'Top 10 lessons' }, { knownFirmHosts: ['zentrocapital.test'] }).action, 'keep');
  const t = triageSearchResults([{ url: 'https://zentrocapital.test/', title: 'Zentro Capital' }, { url: 'https://zentrocapital.test/about', title: 'About' }]);
  assert.ok(t.scores[0] >= 2 && t.scores[1] >= 1);
});

test('V5-2c sin triage (config v4) el motor no pasa la función al buscador y abre como antes', async () => {
  const list = 'https://vcblog.test/top-20-vcs-in-chile';
  const w = world({ pages: { [list]: { title: 'Top 20 VCs in Chile', text: 'x'.repeat(400), extraction: fullV2({ entity_kind: 'other', canonical_name: 'VC blog' }) } }, searches: { 'q fintech': [list] }, plans: { initial: { queries: ['q fintech'], stop: false, candidate_firms: [] } } });
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B1', config: v4Config(), templates, catalog, deps: w.deps });
  assert.ok(w.calls.fetch.includes(list)); assert.equal(w.calls.search[0].options.triage, undefined); assert.equal(r.v2_stats.triage, undefined);
});

// ───────── V5-3 — Ronda de profundización ─────────
import { deepeningQuery, mergeDeepening } from '../../bench/investors/deepening.mjs';
import { isLiteralEvidence } from '../../bench/investors/extractor.mjs';

const QUILL_HOME = 'https://quillfund.test/', QUILL_STRATEGY = 'https://quillfund.test/strategy';
const quillHome = (extraLinks = '') => ({ title: 'Quill Fund', text: `Quill Fund invests at seed in startups in Mexico. Read [Our strategy](/strategy) and [Team](/team).${extraLinks} ${filler('Quill Fund')}`,
  extraction: fullV2({ canonical_name: 'Quill Fund', quote: 'Quill Fund invests at seed in startups in Mexico.', investor_type: 'venture_capital', stages: ['seed'], geographies: ['Mexico'], evidence: { investor_type: 'Quill Fund invests', stages: 'invests at seed', geographies: 'startups in Mexico' } }) });
const quillStrategy = (sentence, extra) => ({ title: 'Strategy', text: `${sentence} ${filler('Quill Fund')}`, extraction: fullV2({ canonical_name: 'Quill Fund', quote: sentence, ...extra }) });
const runQuill = async (pages, { config = v5Config(), searches = {} } = {}) => {
  const q = 'venture capital firm investing at seed in Mexico';
  const w = world({ pages, searches: { [q]: [QUILL_HOME], ...searches }, plans: { initial: { queries: [q], stop: false, candidate_firms: [] } } });
  const logs = []; w.deps.log = row => logs.push(row);
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile: fintechProfile(), condition: 'B1', config, templates, catalog, deps: w.deps });
  return { r, w, logs, e: r.entities.find(x => x.stable_id === 'inv:domain:quillfund.test'), j: r.judgments.find(x => x.stable_id === 'inv:domain:quillfund.test') };
};
const st = (j, id) => j.criteria.find(c => c.criterion_id === id).state;

test('V5-3a sector desconocido en la portada y publicado en /strategy → el campo se llena con cita literal de esa página', async () => {
  const strategy = quillStrategy('Quill Fund invests in fintech companies that serve small businesses.', { sectors: ['fintech'], evidence: { sectors: 'invests in fintech companies' } });
  // La portada no enlaza a la estrategia: la página se descubre con Exa dentro del dominio (con enlaces, la ronda se ahorra la consulta; ver V5-DBG-1c).
  const home = { ...quillHome(), text: `Quill Fund invests at seed in startups in Mexico. ${filler('Quill Fund')}` };
  const { r, w, logs, e, j } = await runQuill({ [QUILL_HOME]: home, [QUILL_STRATEGY]: strategy }, { searches: { [deepeningQuery('Quill Fund', ['INV-SECTOR'], 1)]: [QUILL_STRATEGY] } });
  assert.equal(r.schema_version, 'investor_run_result/3'); validateInvestor('investor_run_result.v3', r);
  assert.ok(e.sectors.includes('fintech')); assert.equal(st(j, 'INV-SECTOR'), 'met');
  const src = e.sources.find(s => s.url === QUILL_STRATEGY);
  assert.equal(src.source_kind, 'official'); assert.equal(src.field_evidence.sectors, 'invests in fintech companies');
  assert.ok(isLiteralEvidence(strategy.text, src.field_evidence.sectors));
  const s1 = w.calls.search.find(c => c.options.includeDomains); assert.deepEqual(s1.options.includeDomains, ['quillfund.test']); assert.ok(!/site:/.test(s1.q));
  assert.equal(s1.q, deepeningQuery('Quill Fund', ['INV-SECTOR'], 1));
  const start = logs.find(x => x.event === 'deepening_start'), end = logs.find(x => x.event === 'deepening_end');
  assert.ok(start.missing_before.includes('INV-SECTOR')); assert.ok(!end.missing_after.includes('INV-SECTOR'));
  assert.ok(end.urls.some(u => u.url === QUILL_STRATEGY && u.outcome === 'merged'));
  const d = r.v2_stats.deepening; assert.equal(d.firms, 1); assert.equal(d.fields_filled['INV-SECTOR'], 1);
  // Presupuesto aparte: los fetches de la ronda no suman a los del descubrimiento.
  assert.equal(r.totals.fetches, 1); assert.ok(d.fetches >= 1); assert.equal(r.totals.searches, 1); assert.equal(d.searches, 1);
});

test('V5-3b una página propia sin el dato deja el campo en unknown (nunca not_met inventado)', async () => {
  const strategy = quillStrategy('Quill Fund partners with founders for the long term.', {});
  const { e, j, r } = await runQuill({ [QUILL_HOME]: quillHome(), [QUILL_STRATEGY]: strategy });
  assert.deepEqual(e.sectors, []); assert.equal(st(j, 'INV-SECTOR'), 'unknown');
  assert.ok(!e.sources.some(s => s.url === QUILL_STRATEGY));
  assert.ok(r.v2_stats.deepening.per_firm[0].missing_after.includes('INV-SECTOR'));
});

test('V5-3c el tope por firma se respeta (≤ 4 fetches y ≤ 2 consultas aunque haya más páginas)', async () => {
  const links = ' ' + ['about', 'approach', 'focus', 'thesis', 'portfolio', 'funds', 'what-we-do', 'invest'].map(p => `[${p}](/${p})`).join(' ');
  const pages = { [QUILL_HOME]: quillHome(links) };
  for (const p of ['strategy', 'team', 'about', 'approach', 'focus', 'thesis', 'portfolio', 'funds', 'what-we-do', 'invest']) pages[`https://quillfund.test/${p}`] = quillStrategy(`Quill Fund ${p} page with general text.`, {});
  const { r, w } = await runQuill(pages);
  const deepFetches = w.calls.fetch.filter(u => u !== QUILL_HOME);
  assert.equal(deepFetches.length, 4); assert.equal(r.v2_stats.deepening.per_firm[0].fetches, 4);
  assert.ok(r.v2_stats.deepening.per_firm[0].queries <= 2);
  assert.equal(w.calls.search.filter(c => c.options.includeDomains).length, r.v2_stats.deepening.per_firm[0].queries);
  const r2 = (await runQuill(pages, { config: v5Config({ deepening: { enabled: true, max_firms_per_run: 0, max_queries_per_firm: 2, max_fetches_per_firm: 4 } }) })).r;
  assert.equal(r2.v2_stats.deepening.firms, 0);
});

test('V5-3d un campo ya conocido no se sobrescribe; la contradicción se registra', () => {
  const entity = { canonical_name: 'Quill Fund', aliases: [], official_domain: 'quillfund.test', investor_type: 'venture_capital', sectors: [], stages: ['seed'], geographies: ['Mexico'], contradictions: [], sources: [{ url: QUILL_HOME, title: 'Q', source_kind: 'official', retrieved_on: '2026-10-09', published_on: null, quote: 'x', field_evidence: { geographies: 'startups in Mexico' } }] };
  const text = 'Quill Fund invests in Brazil only, in fintech companies. More text here to make the page long enough.';
  const extracted = { deepening_fields: { entity_kind: 'institutional_investor', canonical_name: 'Quill Fund', aliases: [], investor_type: 'unknown', sectors: ['fintech'], stages: [], geographies: ['Brazil'], published_on: null, field_evidence: { geographies: 'invests in Brazil only', sectors: 'in fintech companies' }, quote: null } };
  const out = mergeDeepening(entity, { url: QUILL_STRATEGY, title: 'S', text, extracted, today: '2026-10-09' }, ['INV-SECTOR']);
  assert.deepEqual(entity.geographies, ['Mexico']); assert.deepEqual(entity.sectors, ['fintech']);
  assert.equal(out.contradictions.length, 1); assert.match(entity.contradictions[0], /Brazil/);
  // Evidencia que no es literal en la página: no llena nada.
  const e2 = { ...structuredClone(entity), sectors: [] };
  const bad = mergeDeepening(e2, { url: QUILL_STRATEGY, title: 'S', text, extracted: { deepening_fields: { ...extracted.deepening_fields, field_evidence: { sectors: 'invests in fintech and edtech' } } }, today: '2026-10-09' }, ['INV-SECTOR']);
  assert.deepEqual(e2.sectors, []); assert.equal(bad.outcome, 'no_new_data');
  // Otra firma en el mismo dominio: se rechaza.
  assert.equal(mergeDeepening(structuredClone(entity), { url: QUILL_STRATEGY, title: 'S', text, extracted: { deepening_fields: { ...extracted.deepening_fields, canonical_name: 'Acme Robotics' } }, today: '2026-10-09' }, ['INV-SECTOR']).outcome, 'rejected:different_firm');
});

test('V5-3e sin deepening.enabled (ni triage) el resultado es idéntico al de v4', async () => {
  const strategy = quillStrategy('Quill Fund invests in fintech companies that serve small businesses.', { sectors: ['fintech'], evidence: { sectors: 'invests in fintech companies' } });
  const pages = { [QUILL_HOME]: quillHome(), [QUILL_STRATEGY]: strategy };
  const v4 = (await runQuill(pages, { config: v4Config() })).r;
  const off = (await runQuill(pages, { config: v5Config({ deepening: { ...v5Config().deepening, enabled: false }, triage: { enabled: false }, enrichment: v4Config().enrichment }) })).r;
  assert.deepEqual(off, v4); assert.equal(off.schema_version, 'investor_run_result/2');
});

// ───────── V5-DBG-1 — correcciones medidas en el smoke v5dbg1 ─────────
import { rankDeepUrl } from '../../bench/investors/deepening.mjs';

test('V5-DBG-1a una fuente que respalda solo un campo no guarda published_on (no cuenta como inversión reciente sin cita)', () => {
  const base = () => ({ canonical_name: 'Quill Fund', aliases: [], official_domain: 'quillfund.test', investor_type: 'venture_capital', sectors: [], stages: ['seed'], geographies: ['Mexico'], contradictions: [], sources: [] });
  const text = 'Quill Fund invests in fintech companies that serve small businesses. More text here to make the page long enough.';
  const fields = quote => ({ deepening_fields: { entity_kind: 'institutional_investor', canonical_name: 'Quill Fund', aliases: [], investor_type: 'unknown', sectors: ['fintech'], stages: [], geographies: [], published_on: '2026-02-26', field_evidence: { sectors: 'invests in fintech companies' }, quote } });
  const e1 = base(); mergeDeepening(e1, { url: 'https://quillfund.test/press', title: 'P', text, extracted: fields(null), today: '2026-10-09' }, ['INV-SECTOR']);
  assert.equal(e1.sources.at(-1).published_on, null); assert.equal(e1.sources.at(-1).quote, null);
  const e2 = base(); mergeDeepening(e2, { url: 'https://quillfund.test/press', title: 'P', text, extracted: fields('Quill Fund invests in fintech companies that serve small businesses.'), today: '2026-10-09' }, ['INV-SECTOR', 'INV-ACTIVE']);
  assert.equal(e2.sources.at(-1).published_on, '2026-02-26'); assert.ok(e2.sources.at(-1).quote);
});

test('V5-DBG-1b ranking: estrategia/acerca arriba; notas de prensa, insights y URLs con fecha fuera (salvo que solo falte actividad)', () => {
  const miss = ['INV-STAGE', 'INV-GEO'];
  assert.ok(rankDeepUrl('https://x.test/strategy', miss) > 0); assert.ok(rankDeepUrl('https://x.test/about', miss) > 0);
  for (const u of ['https://x.test/press-release/fund-invests-in-acme', 'https://x.test/insights/some-story', 'https://x.test/2018/10/02/danone-invests-in-acme/', 'https://x.test/news/acme-raises'])
    assert.ok(rankDeepUrl(u, miss) < 0, u);
  assert.ok(rankDeepUrl('https://x.test/news/acme-raises', ['INV-ACTIVE']) > 0);
});

test('V5-DBG-1c sin página propia leída, la ronda abre la portada y sigue sus enlaces (no gasta lecturas en notas de prensa)', async () => {
  const strategy = quillStrategy('Quill Fund invests in fintech companies that serve small businesses.', { sectors: ['fintech'], evidence: { sectors: 'invests in fintech companies' } });
  const news = quillStrategy('Quill Fund announces an investment.', {});
  const homeNoLinks = { ...quillHome(), text: `Quill Fund invests at seed in startups in Mexico. [Our strategy](/strategy) ${filler('Quill Fund')}` };
  const pages = { [QUILL_HOME]: homeNoLinks, [QUILL_STRATEGY]: strategy, 'https://quillfund.test/press-release/quill-invests-in-acme': news };
  const { w, e } = await runQuill(pages, { searches: { 'Quill Fund investment criteria: sectors they invest in': ['https://quillfund.test/press-release/quill-invests-in-acme'] } });
  assert.ok(e.sectors.includes('fintech'));
  assert.ok(!w.calls.fetch.includes('https://quillfund.test/press-release/quill-invests-in-acme'));
});
