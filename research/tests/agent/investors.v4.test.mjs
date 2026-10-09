// Pruebas v4 del motor de inversionistas (FIX_SPEC-investors-v4). Fixtures sintéticos: ningún texto de firmas del pool v3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateInvestor } from '../../bench/investors/contracts.mjs';
import { loadInvestorPrompt } from '../../bench/investors/prompts.mjs';
import { runInvestorDiscovery, abstentionReason } from '../../bench/investors/engine.mjs';
import { describeInvestorExtraction, groundInvestorExtraction, extractFixtureInvestor } from '../../bench/investors/extractor.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { fixtureDeps, fixtureConfig } from './fixtures/investor-world-v0/world.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const F = resolve(import.meta.dirname, 'fixtures/investor-world-v0');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const profile = json(resolve(F, 'profile.json'));
const anchorCase = json(resolve(F, 'cases/case-anchor.json'));
const nullCase = json(resolve(F, 'cases/case-null.json'));
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const templates = loadInvestorPrompt('b0_templates').templates;

test('V4-FIX-13a engine_v2 result carries abstention_reason and validates investor_run_result.v2; engine_v1 unchanged', async () => {
  const logs = [];
  const deps = { ...fixtureDeps('B2'), log: row => logs.push(row) };
  const v2 = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B2', config: { ...fixtureConfig, engine_v: 2 }, templates, catalog, deps });
  assert.equal(v2.schema_version, 'investor_run_result/2');
  assert.ok(['no_candidates', 'all_hard_not_met', 'insufficient_evidence', null].includes(v2.abstention_reason));
  assert.equal(v2.abstention_reason === null, !v2.abstained);
  validateInvestor('investor_run_result.v2', v2);
  const opened = logs.filter(x => x.event === 'search_opened');
  assert.ok(opened.length > 0);
  for (const row of opened) { assert.ok(Array.isArray(row.urls)); assert.ok(row.opened.every(i => Number.isInteger(i) && i < row.urls.length)); }
  const v1 = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B2', config: fixtureConfig, templates, catalog, deps: fixtureDeps('B2') });
  assert.equal(v1.schema_version, 'investor_run_result/1'); assert.equal(Object.hasOwn(v1, 'abstention_reason'), false);
  const nul = await runInvestorDiscovery({ caseObj: nullCase, profile, condition: 'B1', config: { ...fixtureConfig, engine_v: 2 }, templates, catalog, deps: fixtureDeps('B1', { nullOnly: true }) });
  assert.equal(nul.abstention_reason, 'no_candidates');
});

test('V4-FIX-13b abstentionReason distinguishes hard failures from missing evidence', () => {
  assert.equal(abstentionReason([], []), 'no_candidates');
  assert.equal(abstentionReason([{ gain: 0 }], [{ hard_eligibility: 'ineligible', overall_relevance: 'irrelevant' }]), 'all_hard_not_met');
  assert.equal(abstentionReason([{ gain: 1 }], [{ hard_eligibility: 'undetermined', overall_relevance: 'weak' }]), 'insufficient_evidence');
  assert.equal(abstentionReason([{ gain: 2 }], [{ hard_eligibility: 'undetermined', overall_relevance: 'plausible' }]), null);
});

test('V4-FIX-13c extraction diagnostics report fields present/kept and quote/domain provenance', () => {
  const document = { url: 'https://kestrelfund.test/', title: 'Kestrel', text: 'Kestrel Fund is a venture capital firm. Kestrel Fund backs companies at seed in Chile. More text to pass the length guard of the gate here.' };
  const raw = { entity_kind: 'institutional_investor', canonical_name: 'Kestrel Fund', source_kind: 'official', aliases: [], canonical_url: null, contradictions: [], sectors: [], stages: ['seed'] };
  const grounded = groundInvestorExtraction({ document, extraction: raw });
  const { entity } = extractFixtureInvestor({ document, extraction: raw, today: '2026-10-08', firstSeen: { step: 0, search_index: 0, order: 0, query_id: 'q000' } });
  const d = describeInvestorExtraction({ document, raw, grounded, entity });
  assert.equal(d.kind, 'institutional_investor'); assert.equal(d.quote_source, 'fallback'); assert.equal(d.official_domain_source, 'host_match');
  assert.deepEqual(d.fields_present, ['canonical_name', 'stages']);
  assert.ok(d.fields_kept.includes('stages') && d.fields_kept.includes('quote') && d.fields_kept.includes('official_domain'));
  assert.equal(d.candidates, 0);
  const none = describeInvestorExtraction({ document, raw: { entity_kind: 'other', canonical_name: 'unknown' }, grounded: null, entity: null });
  assert.deepEqual(none.fields_kept, []); assert.equal(none.quote_source, 'none');
});

test('V4-FIX-13d fetch tool records each reader attempt without changing the outcome', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).startsWith('https://r.jina.ai/') ? new Response('{"code":402,"message":"Insufficient balance"}', { status: 402, headers: { 'content-type': 'application/json' } }) : new Response('<html><body><div id="root"></div></body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  try {
    const tool = createFetchTool({ env: { JINA_API_KEY: 'x' } });
    const page = await tool.fetch('https://spa-firm.test/');
    assert.equal(page.ok, false); assert.equal(page.error.code, 'FETCH_EMPTY');
    assert.deepEqual(page.reader_attempts.map(x => x.reader), ['direct', 'crawl4ai', 'jina']);
    assert.equal(page.reader_attempts[0].http_status, 200); assert.equal(page.reader_attempts[0].content_type, 'text/html');
    assert.equal(page.reader_attempts[1].skipped, 'CRAWL4AI_URL unset');
    assert.equal(page.reader_attempts[2].http_status, 402);
  } finally { globalThis.fetch = original; }
});

// ───────── FIX-01..04 extractor v2 ─────────
import { InvestorContractError } from '../../bench/investors/contracts.mjs';
import { groundFieldsV2, extractFixtureInvestorV2, investorExtractionRejectionV2, groundIdentityV2 } from '../../bench/investors/extractor.mjs';
import { investorExtractionRejection } from '../../bench/investors/extractor.mjs';

const EVIDENCE_NULL = { investor_type: null, sectors: null, stages: null, rounds: null, geographies: null, check_range_usd: null, lead_follow: null, business_models: null, active_status: null, published_on: null };
export function fullV2(overrides = {}) {
  return {
    entity_kind: 'institutional_investor', canonical_name: 'Zentro Capital', official_domain: null, aliases: [], investor_type: 'unknown', parent_firm: null, vehicles: [], active_status: 'unknown',
    sectors: [], stages: [], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, lead_follow: 'unknown', business_models: { accepted: [], excluded: [] },
    regulatory_restrictions: [], relevant_portfolio: [], potential_conflicts: [], recent_investment: false, source_kind: 'official', published_on: null, quote: null, regulatory_id: null,
    canonical_url: null, contradictions: [], evidence: { ...EVIDENCE_NULL }, candidates: [], ...overrides, evidence: { ...EVIDENCE_NULL, ...(overrides.evidence ?? {}) }
  };
}
const ZENTRO = 'Zentro Capital is a venture capital firm investing in seed-stage climate startups in Chile and Peru. We usually lead rounds and write tickets of USD 250k to 1M. Founded to back technical founders.';
const zdoc = { url: 'https://zentrocapital.test/', title: 'Zentro Capital', text: ZENTRO };
const fs0 = (order = 0) => ({ step: 0, search_index: 0, order, query_id: 'q000' });

test('V4-FIX-01 extraction v2 requires every key (quote, official_domain, evidence, candidates) and accepts explicit nulls', () => {
  const minimal = { entity_kind: 'institutional_investor', canonical_name: 'Zentro Capital', source_kind: 'official', aliases: [], canonical_url: null, contradictions: [] };
  assert.throws(() => validateInvestor('investor_extraction.v2', minimal), e => e instanceof InvestorContractError && /must have required property 'quote'/.test(e.message));
  assert.equal(validateInvestor('investor_extraction.v2', fullV2()).canonical_name, 'Zentro Capital');
  assert.throws(() => validateInvestor('investor_extraction.v2', { ...fullV2(), evidence: { sectors: null } }), /required property/);
});

test('V4-FIX-02 extractor v3 / planner v2 / judge v2 prompts are hash-verified in manifest.v4 and v1 manifest is untouched', () => {
  for (const [id, v] of [['extractor', 'v3'], ['planner', 'v2'], ['judge', 'v2'], ['extractor', 'v1'], ['b0_templates', 'v1']]) assert.match(loadInvestorPrompt(id, v, { manifest: 'manifest.v4.json' }).sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => loadInvestorPrompt('extractor', 'v3'), /Unknown investor prompt/);
  const p = loadInvestorPrompt('extractor', 'v3', { manifest: 'manifest.v4.json' });
  assert.match(p.system, /every key is required/); assert.equal(p.user, 'As of {{today}}. URL: {{url}}\n<page_data>{{page_text}}</page_data>\n');
});

test('V4-FIX-03 fields survive only with literal evidence', () => {
  const keep = groundFieldsV2({ document: zdoc, extraction: fullV2({ stages: ['seed'], evidence: { stages: 'seed-stage climate startups' } }) });
  assert.deepEqual(keep.stages, ['seed']); assert.equal(keep.field_evidence.stages, 'seed-stage climate startups');
  assert.deepEqual(groundFieldsV2({ document: zdoc, extraction: fullV2({ stages: ['seed'], evidence: { stages: 'Series C' } }) }).stages, []);
  assert.deepEqual(groundFieldsV2({ document: zdoc, extraction: fullV2({ geographies: ['Argentina'], evidence: { geographies: 'in Chile and Peru' } }) }).geographies, []);
  const g = groundFieldsV2({ document: zdoc, extraction: fullV2({ geographies: ['Chile', 'Peru'], investor_type: 'venture_capital', lead_follow: 'lead', active_status: 'active', evidence: { geographies: 'in Chile and Peru', investor_type: 'is a venture capital firm', lead_follow: 'We usually lead rounds' } }) });
  assert.deepEqual(g.geographies, ['Chile', 'Peru']); assert.equal(g.investor_type, 'venture_capital'); assert.equal(g.lead_follow, 'lead');
  assert.equal(g.active_status, 'unknown', 'activity is computed by FIX-09, not taken from the model');
  const noEv = groundFieldsV2({ document: zdoc, extraction: fullV2({ investor_type: 'venture_capital', sectors: ['climate'] }) });
  assert.equal(noEv.investor_type, 'unknown'); assert.deepEqual(noEv.sectors, []); assert.deepEqual(noEv.fields_dropped_by_grounding.sort(), ['investor_type', 'sectors']);
  const md = groundFieldsV2({ document: { ...zdoc, text: '### Seed and Series A **Only**\n\nZentro backs “deep-tech” founders.' }, extraction: fullV2({ stages: ['Seed and Series A'], evidence: { stages: 'Seed and Series A Only' } }) });
  assert.deepEqual(md.stages, ['Seed and Series A'], 'markdown markers are not part of the visible text');
});

test('V4-FIX-04 gate v2: adversarial identity cases', () => {
  const acme = { url: 'https://acmerobotics.test/news', title: 'Acme', text: 'Acme Robotics raised $5M led by Northwind Ventures. The round will fund hiring and new factories in the region over the next year.' };
  const a = investorExtractionRejectionV2({ document: acme, extraction: groundIdentityV2({ document: acme, extraction: fullV2({ canonical_name: 'Acme Robotics', source_kind: 'news', quote: 'Acme Robotics raised $5M led by Northwind Ventures.' }) }) });
  assert.ok(['identity_not_in_quote', 'no_investment_evidence'].includes(a.rejected_kind), a.rejected_kind);
  const b = investorExtractionRejectionV2({ document: acme, extraction: groundIdentityV2({ document: acme, extraction: fullV2({ canonical_name: 'Northwind Ventures', source_kind: 'news', quote: 'Acme Robotics raised $5M led by Northwind Ventures.' }) }) });
  assert.equal(b.rejected_kind, 'unresolved_firm_identity'); assert.equal(b.candidate.name, 'Northwind Ventures');
  const listDoc = { url: 'https://startupnews.test/top-seed-funds-peru', title: 'Top 20 seed funds in Peru', text: 'Top 20 seed funds in Peru. Andes Spark Ventures invests in pre-seed startups across Peru and Chile. Condor Seed Fund backs founders in Lima at seed stage.' };
  const c = investorExtractionRejectionV2({ document: listDoc, extraction: fullV2({ entity_kind: 'institutional_investor', canonical_name: 'Top 20 seed funds in Peru', source_kind: 'news', candidates: [{ name: 'Andes Spark Ventures', quote: 'Andes Spark Ventures invests in pre-seed startups across Peru and Chile.', domain_on_page: null }, { name: 'Ghost Fund', quote: 'Ghost Fund invests in everything everywhere.', domain_on_page: null }] }) });
  assert.equal(c.rejected_kind, 'collection_page'); assert.deepEqual(c.candidates.map(x => x.name), ['Andes Spark Ventures'], 'only candidates with a literal quote survive');
  const kdoc = { url: 'https://kestrelfund.test/', title: 'Kestrel Fund', text: 'Kestrel Fund backs founders from day one at pre-seed. We are a small team based in Lisbon and we answer every email within a week.' };
  const d = extractFixtureInvestorV2({ document: kdoc, extraction: fullV2({ canonical_name: 'Kestrel Fund', quote: null }), today: '2026-10-08', firstSeen: fs0() });
  assert.ok(d.entity, d.rejected_kind); assert.equal(d.entity.official_domain, 'kestrelfund.test'); assert.equal(d.meta.quote_source, 'fallback');
  const sdoc = { url: 'https://seafx.test/', title: 'SEAFX', text: 'SEAFX (South East Asia Fintech Exchange Facility) invests in innovative early-stage projects across the region with blended capital.' };
  const e = extractFixtureInvestorV2({ document: sdoc, extraction: fullV2({ canonical_name: 'South East Asia Fintech Exchange Facility', aliases: ['SEAFX'], quote: null }), today: '2026-10-08', firstSeen: fs0() });
  assert.ok(e.entity, e.rejected_kind); assert.equal(e.entity.official_domain, 'seafx.test'); assert.equal(e.meta.official_domain_source, 'alias_match');
  const own = { url: 'https://northwind.test/news/fund-ii', title: 'Northwind news', text: 'Northwind Ventures closes Fund II. Northwind Ventures invests in seed-stage companies building logistics software across Kenya.' };
  const f = extractFixtureInvestorV2({ document: own, extraction: fullV2({ canonical_name: 'Northwind Ventures', source_kind: 'news', quote: 'Northwind Ventures invests in seed-stage companies building logistics software across Kenya.' }), today: '2026-10-08', firstSeen: fs0() });
  assert.ok(f.entity, f.rejected_kind); assert.equal(f.entity.official_domain, 'northwind.test', 'own-domain press release is first party');
});

test('V4-FIX-04f v1 adversarial guards still hold under v2', () => {
  const seq = { url: 'https://news.test/a', title: 'n', text: 'Sequoia Capital was mentioned in an article about the weather in California this week, with no investing context at all here.' };
  assert.ok(investorExtractionRejectionV2({ document: seq, extraction: groundIdentityV2({ document: seq, extraction: fullV2({ canonical_name: 'Sequoia Capital', source_kind: 'news', quote: null }) }) }));
  const who = { url: 'https://who.test/', title: 'WHO', text: 'The World Health Organization and the European Investment Bank published a joint report on public health financing in 2026.' };
  assert.ok(investorExtractionRejectionV2({ document: who, extraction: groundIdentityV2({ document: who, extraction: fullV2({ canonical_name: 'European Investment Bank', source_kind: 'news', quote: null }) }) }));
  for (const name of ['null', 'unknown', 'N/A']) assert.equal(investorExtractionRejectionV2({ document: zdoc, extraction: fullV2({ canonical_name: name }) }).rejected_kind, 'missing_identity');
  assert.equal(investorExtractionRejection({ document: { url: zdoc.url, text: ZENTRO }, extraction: { entity_kind: 'institutional_investor', canonical_name: 'Zentro Capital', source_kind: 'official' } }), 'missing_literal_quote', 'v1 gate unchanged');
});

// ───────── FIX-06..08 juez v2 ─────────
import { typeState, stageState, geoState, leadState } from '../../bench/investors/normalize.mjs';
import { judgeInvestorV2, judgeInvestor, guardSectorFit, sectorQuotes } from '../../bench/investors/judge.mjs';
import { investorGain } from '../../bench/investors/ranking.mjs';

test('V4-FIX-06 normalization: type, stage, geo, lead', () => {
  assert.equal(typeState(['generalist_vc'], 'venture_capital'), 'met'); assert.equal(typeState(['generalist_vc'], 'accelerator'), 'not_met'); assert.equal(typeState(['foo_investor'], 'accelerator'), 'unknown');
  assert.equal(stageState('series_b', ['Series B']), 'met'); assert.equal(stageState('pre-seed', ['pre-Series A']), 'met');
  assert.equal(stageState('series_b', ['early-stage']), 'unknown'); assert.equal(stageState('series_b', ['Seed and Series A Only']), 'not_met');
  assert.equal(geoState(['Mexico'], ['Spanish-speaking Latin America']), 'met'); assert.equal(geoState(['Palau'], ['North America']), 'not_met'); assert.equal(geoState(['Palau'], ['global']), 'unknown');
  assert.equal(geoState(['Nauru'], ['Pacific Islands']), 'met'); assert.equal(geoState(['Chile'], ['Andean region']), 'unknown', 'unrecognised geography never becomes not_met');
  assert.equal(leadState('seeking lead', 'lead'), 'met'); assert.equal(leadState(null, 'lead'), 'not_applicable');
});

const v2Entity = (o = {}) => ({ schema_version: 'investor_entity/2', stable_id: 'inv:domain:zentrocapital.test', canonical_name: 'Zentro Capital', official_domain: 'zentrocapital.test', aliases: [], investor_type: 'venture_capital', parent_firm: null, vehicles: [], active_status: 'possibly_active', verified_on: '2026-10-08', sectors: ['Fintech'], stages: ['seed'], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, lead_follow: 'unknown', business_models: { accepted: [], excluded: [] }, regulatory_restrictions: [], relevant_portfolio: [], potential_conflicts: [], recent_investment_evidence: [], sources: [{ url: 'https://zentrocapital.test/', title: 'Zentro', source_kind: 'official', retrieved_on: '2026-10-08', published_on: null, quote: 'Zentro Capital invests in seed fintech startups.' }], first_seen: { step: 0, search_index: 0, order: 0, query_id: 'q000' }, query_ids: ['q000'], regulatory_id: null, canonical_url: 'https://zentrocapital.test/', contradictions: [], ...o });
const gainOf = j => investorGain({ ...j, identity_correct: true, entity_kind: 'institutional_investor' });
const fintechProfile = () => { const p = structuredClone(profile); p.fields.sector.value = 'Fintech'; p.fields.funding_stage.value = 'seed'; p.fields.accepted_investor_types.value = ['generalist_vc']; p.fields.incorporation_country.value = 'Mexico'; p.fields.operating_regions.value = ['Mexico']; p.fields.target_markets.value = ['Mexico']; p.fields.lead_preference.value = 'seeking lead'; return p; };

test('V4-FIX-07 plausible = sector on/partial + stage or geo met, no hard not_met', () => {
  const p = fintechProfile();
  const a = judgeInvestorV2({ entity: v2Entity(), profile: p, catalog });
  assert.equal(a.sector_fit, 'on'); assert.equal(a.stage_fit, 'met'); assert.equal(a.geography_fit, 'unknown'); assert.equal(a.overall_relevance, 'plausible'); assert.equal(gainOf(a), 2);
  const b = judgeInvestorV2({ entity: v2Entity({ stages: [] }), profile: p, catalog });
  assert.equal(b.overall_relevance, 'weak'); assert.equal(gainOf(b), 1);
  const c = judgeInvestorV2({ entity: v2Entity({ geographies: ['Kenya'] }), profile: p, catalog });
  assert.equal(c.hard_eligibility, 'ineligible'); assert.equal(c.overall_relevance, 'irrelevant'); assert.equal(gainOf(c), 0);
  const v1 = judgeInvestor({ entity: v2Entity(), profile: p, catalog });
  assert.equal(v1.overall_relevance, 'irrelevant', 'v1 judge unchanged: disjoint type vocabulary makes it ineligible');
});

test('V4-FIX-08 sector LLM guard: off needs exclusive language, quote must be literal, exact match skips LLM', () => {
  const quotes = 'Zentro Capital invests in climate and energy startups.\nWe focus on technology.';
  assert.equal(guardSectorFit({ sector_fit: 'off', quote: 'Zentro Capital invests in climate and energy startups.' }, quotes).sector_fit, 'unknown');
  assert.equal(guardSectorFit({ sector_fit: 'on', quote: 'Zentro invests in fintech' }, quotes).sector_fit, 'unknown');
  assert.equal(guardSectorFit({ sector_fit: 'partial', quote: 'We focus on technology.' }, quotes).sector_fit, 'partial');
  assert.equal(guardSectorFit({ sector_fit: 'off', quote: 'We invest only in climate' }, 'We invest only in climate').sector_fit, 'off');
  const p = fintechProfile();
  const j = judgeInvestorV2({ entity: v2Entity(), profile: p, catalog, sectorFit: { sector_fit: 'off', quote: 'x' } });
  assert.equal(j.sector_fit, 'on'); assert.equal(j.sector_fit_source, 'deterministic');
  const llm = judgeInvestorV2({ entity: v2Entity({ sectors: ['technology'] }), profile: p, catalog, sectorFit: { sector_fit: 'partial', quote: 'We focus on technology.' } });
  assert.equal(llm.sector_fit, 'partial'); assert.equal(llm.sector_fit_source, 'llm');
  assert.match(sectorQuotes(v2Entity()), /seed fintech/);
});

// ───────── FIX-05/09/10/11b/12/14 motor v2 ─────────
import { validatePlannerBatchV2 } from '../../bench/investors/conditions.mjs';
import { plannerCoverage, deriveActivity } from '../../bench/investors/engine.v2.mjs';
import { createFailoverSearchTool } from '../../bench/investors/search-failover.mjs';
import { validateInvestorWorkspace } from '../../bench/investors/cli.mjs';

const v4Config = () => ({ ...json(resolve(repo, 'research/bench/investors/config/v4-2026-10-09.json')), search: { provider: 'fixture', results_per_query: 10 }, judge: { max_llm_calls: 0 } });
// Mundo sintético: páginas → texto + extracción v2 que "devolvería" el modelo.
function world({ pages = {}, searches = {}, plans = {} } = {}) {
  const calls = { search: [], fetch: [] }; let adaptive = 0;
  return {
    calls,
    deps: {
      search: async q => { calls.search.push(q); return { results: (searches[q] ?? []).map((u, i) => (typeof u === 'string' ? { rank: i + 1, url: u, title: pages[u]?.title ?? u } : { rank: i + 1, ...u })), nominal_cost: 1 }; },
      fetch: async url => { calls.fetch.push(url); const p = pages[url]; return p ? { ok: true, text: p.text, title: p.title, nominal_cost: 1 } : { ok: false, text: '', error: { code: 'FETCH_EMPTY' }, nominal_cost: 1 }; },
      extract: async ({ document, today, firstSeen }) => extractFixtureInvestorV2({ document, extraction: pages[document.url]?.extraction ?? fullV2({ entity_kind: 'other', canonical_name: 'Unknown page' }), today, firstSeen }),
      plan: async ({ mode }) => mode === 'initial_batch' ? (plans.initial ?? { queries: [], stop: true, candidate_firms: [] }) : (plans.adaptive?.[adaptive++] ?? { queries: [], stop: true, candidate_firms: [] })
    }
  };
}
const firmPage = (domain, name, sentence, extra = {}) => ({ title: name, text: `${sentence} ${name} has a small team and publishes its portfolio on this website for founders who want to learn more about how the partnership works day to day.`, extraction: fullV2({ canonical_name: name, quote: sentence, ...extra }) });

test('V4-FIX-10 B1 runs all queries (no patience), same URL fetched once, denylisted hosts are not fetched, firm results are triaged first', async () => {
  const words = ['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima','mike','november','oscar','papa','quebec','romeo'];
  const queries = words.map(w => `${w} investors fintech`);
  const searches = Object.fromEntries(queries.map(q => [q, ['https://news.test/a']]));
  searches[queries[0]] = ['https://pitchbook.com/x', 'https://agg1.test/a', 'https://agg2.test/b', 'https://agg3.test/c', 'https://agg4.test/d', 'https://agg5.test/e', 'https://orca-ventures.test/'];
  const w = world({ searches, plans: { initial: { queries, stop: false, candidate_firms: [] } } });
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B1', config: v4Config(), templates, catalog, deps: w.deps });
  assert.equal(r.totals.searches, 18); assert.ok(['budget_searches', 'queries_exhausted'].includes(r.stop_reason));
  assert.equal(w.calls.fetch.filter(u => u === 'https://news.test/a').length, 1, 'dedupe by URL');
  assert.ok(!w.calls.fetch.includes('https://pitchbook.com/x'), 'denylist'); assert.ok(w.calls.fetch.includes('https://orca-ventures.test/'), 'triage opens firm result at position 7');
});

test('V4-FIX-10b B2 does not stop by patience when fetches are empty', async () => {
  const qs = ['q a one', 'q b two', 'q c three', 'q d four', 'q e five', 'q f six'];
  const searches = Object.fromEntries(qs.map((q, i) => [q, [`https://spa${i}.test/`]]));
  const w = world({ searches, plans: { initial: { queries: qs.slice(0, 6), stop: false, candidate_firms: [] } } });
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B2', config: { ...v4Config(), b2: { initial_batch: 6, max_searches_per_step: 3 } }, templates, catalog, deps: w.deps });
  assert.notEqual(r.stop_reason, 'patience');
});

test('V4-FIX-05 candidate from a third-party page is resolved to its official site; no budget → no resolution', async () => {
  const news = 'https://dailynews.test/round';
  const pages = {
    [news]: { title: 'Round news', text: 'Acme Robotics raised $5M led by Northwind Ventures. The round will fund hiring of engineers and expansion to new markets next year. Acme builds warehouse robots for mid-size distributors and plans to open an office in Monterrey.', extraction: fullV2({ entity_kind: 'other', canonical_name: 'Daily News', source_kind: 'news', candidates: [{ name: 'Northwind Ventures', quote: 'Acme Robotics raised $5M led by Northwind Ventures.', domain_on_page: null }] }) },
    'https://northwind.vc/': firmPage('northwind.vc', 'Northwind Ventures', 'Northwind Ventures invests in seed-stage robotics startups in Mexico.')
  };
  const searches = { 'robotics seed rounds mexico': [news], '"Northwind Ventures" venture capital': ['https://directory.test/northwind', 'https://northwind.vc/'] };
  const w = world({ pages, searches, plans: { initial: { queries: ['robotics seed rounds mexico'], stop: false, candidate_firms: [] } } });
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B1', config: v4Config(), templates, catalog, deps: w.deps });
  const e = r.entities.find(x => x.stable_id === 'inv:domain:northwind.vc');
  assert.ok(e, JSON.stringify(r.v2_stats.resolutions)); assert.equal(e.first_seen.origin, 'resolution');
  const w2 = world({ pages, searches, plans: { initial: { queries: ['robotics seed rounds mexico'], stop: false, candidate_firms: [] } } });
  const r2 = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B1', config: { ...v4Config(), budgets: { ...v4Config().budgets, searches: 1 } }, templates, catalog, deps: w2.deps });
  assert.equal(r2.entities.length, 0); assert.equal(r2.stop_reason, 'budget_searches');
});

test('V4-FIX-11b empty fetch falls back to search text ≥400 chars', async () => {
  const long = 'Lynx Seed Partners invests in pre-seed and seed startups in Chile and Peru. ' + 'We back founders building software for schools and universities across the Andean region. '.repeat(5);
  const url = 'https://lynxseed.test/';
  const w = world({ pages: {}, searches: { 'edtech seed fund chile': [{ url, title: 'Lynx Seed Partners', text: long }] }, plans: { initial: { queries: ['edtech seed fund chile'], stop: false, candidate_firms: [] } } });
  w.deps.extract = async ({ document, today, firstSeen }) => extractFixtureInvestorV2({ document, extraction: fullV2({ canonical_name: 'Lynx Seed Partners', quote: 'Lynx Seed Partners invests in pre-seed and seed startups in Chile and Peru.' }), today, firstSeen });
  const logs = []; w.deps.log = row => logs.push(row);
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile, condition: 'B1', config: v4Config(), templates, catalog, deps: w.deps });
  assert.ok(r.entities.some(e => e.stable_id === 'inv:domain:lynxseed.test'));
  assert.ok(logs.some(x => x.event === 'fetch_fallback' && x.via === 'search_contents'));
});

test('V4-FIX-11b failover keeps text only when exa_contents_chars is set', async () => {
  const fetcher = async () => new Response(JSON.stringify({ results: [{ url: 'https://a.test/', title: 'A', text: 'x'.repeat(5000) }] }), { status: 200 });
  const orig = globalThis.fetch; globalThis.fetch = fetcher;
  try {
    const withText = await createFailoverSearchTool({ providers: ['exa'], env: { EXA_API_KEY: 'k' }, exaContentsChars: 4000 }).search('q');
    assert.equal(withText.results[0].text.length, 4000);
    const without = await createFailoverSearchTool({ providers: ['exa'], env: { EXA_API_KEY: 'k' } }).search('q');
    assert.equal(Object.hasOwn(without.results[0], 'text'), false);
  } finally { globalThis.fetch = orig; }
});

test('V4-FIX-09 activity derived from sources', () => {
  const base = { official_domain: 'zentrocapital.test', active_status: 'unknown', sources: [{ url: 'https://zentrocapital.test/', source_kind: 'official', quote: 'Zentro Capital invests in seed startups.', published_on: null }] };
  assert.equal(deriveActivity(base, { today: '2026-10-08', recencyDays: 540 }).active_status, 'possibly_active');
  const press = { ...base, sources: [...base.sources, { url: 'https://zentrocapital.test/news/x', source_kind: 'news', quote: 'Zentro Capital led the seed round of Kite.', published_on: '2026-06-30' }] };
  const a = deriveActivity(press, { today: '2026-10-08', recencyDays: 540 }); assert.equal(a.active_status, 'active'); assert.equal(a.recent_investment_evidence.length, 1);
  assert.equal(deriveActivity({ ...base, active_status: 'inactive' }, { today: '2026-10-08', recencyDays: 540 }).active_status, 'inactive');
});

test('V4-FIX-12 near-duplicate queries rejected; coverage computed from executed queries', () => {
  const seen = new Set(['government backed funds fintech and payments mexico']);
  const b = validatePlannerBatchV2({ mode: 'adaptive_step', queries: ['government backed funds fintech payments Mexico seed stage', 'fintech seed fund Mexico'], stop: false, candidate_firms: [{ name: 'Kite', why: 'x' }] }, seen, 3);
  assert.equal(b.rejected[0].reason, 'near_duplicate'); assert.equal(b.accepted.length, 1); assert.equal(b.candidate_firms.length, 1);
  const p = structuredClone(profile); p.fields.comparable_companies.value = ['Konfio'];
  assert.equal(plannerCoverage(p, ['fintech seed fund mexico']).comparables, false);
  assert.equal(plannerCoverage(p, ['investors in Konfio']).comparables, true);
});

test('V4-FIX-14 config v4 validates; v3 config still uses engine v1', () => {
  const r = validateInvestorWorkspace({ configPath: resolve(repo, 'research/bench/investors/config/v4-2026-10-09.json'), casesDir: resolve(repo, 'research/bench/investors/cases') });
  assert.equal(r.config.engine_v, 2);
  const v3 = json(resolve(repo, 'research/bench/investors/config/v3-2026-10-08.json')); assert.equal(v3.engine_v, undefined);
});

test('V4-FIX-11 reader preflight fails with READER_UNAVAILABLE without reader variables', async () => {
  const { readerPreflight } = await import('../../bench/investors/preflight-reader.mjs');
  const out = await readerPreflight({ env: {}, fetcher: async () => new Response('<html><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  assert.equal(out.status, 'READER_UNAVAILABLE');
  const ok = await readerPreflight({ env: { JINA_API_KEY: 'k' }, fetcher: async url => String(url).startsWith('https://r.jina.ai/') ? new Response(JSON.stringify({ data: { content: 'x'.repeat(900), title: 't' } }), { status: 200 }) : new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  assert.equal(ok.status, 'passed');
});

test('V4-FIX-17 report has one row per entity and every non-unknown core criterion cites a literal quote from its source', async () => {
  const { renderInvestorReport, criterionCitation } = await import('../../bench/investors/find.mjs');
  const pages = {
    'https://condor-seed.test/': { title: 'Condor Seed', text: 'Condor Seed is a venture capital firm. Condor Seed invests in seed-stage fintech startups in Mexico and Colombia. We lead rounds and support founders with hiring and go-to-market across the region, from first check to Series A.', extraction: fullV2({ canonical_name: 'Condor Seed', quote: 'Condor Seed invests in seed-stage fintech startups in Mexico and Colombia.', investor_type: 'venture_capital', sectors: ['fintech'], stages: ['seed'], geographies: ['Mexico', 'Colombia'], evidence: { investor_type: 'Condor Seed is a venture capital firm.', sectors: 'seed-stage fintech startups', stages: 'invests in seed-stage', geographies: 'in Mexico and Colombia' } }) }
  };
  const w = world({ pages, searches: { 'fintech seed mexico fund': ['https://condor-seed.test/'] }, plans: { initial: { queries: ['fintech seed mexico fund'], stop: false, candidate_firms: [] } } });
  const p = fintechProfile();
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile: p, condition: 'B2', config: v4Config(), templates, catalog, deps: w.deps });
  assert.equal(r.ranked.length, 1); assert.ok(r.ranked[0].gain >= 2, JSON.stringify(r.judgments[0].criteria));
  const md = renderInvestorReport(r, p);
  assert.equal((md.match(/^\| \d+ \|/gm) ?? []).length, r.entities.length);
  const e = r.entities[0], j = r.judgments[0];
  for (const c of j.criteria.filter(c => ['INV-SECTOR', 'INV-STAGE', 'INV-GEO', 'INV-TYPE'].includes(c.criterion_id) && c.state !== 'unknown')) {
    const cit = criterionCitation(e, c); assert.ok(cit, c.criterion_id); assert.ok(pages[cit.url].text.includes(cit.quote), cit.quote); assert.ok(md.includes(cit.quote));
  }
});

// ───────── V4-DBG-1 (causas medidas en el smoke D1–D3) ─────────
import { isLiteralEvidence, attributedInvestmentV2, hasInvestmentEvidenceV2 as hasInv } from '../../bench/investors/extractor.mjs';

test('V4-DBG-1a evidence stitched with "..." counts only if every passage is literal', () => {
  const page = 'Lince Fund is an early-stage investor. Our team is in Santiago. We back seed-stage companies in Chile and Peru.';
  assert.equal(isLiteralEvidence(page, 'Lince Fund is an early-stage investor ... We back seed-stage companies in Chile and Peru'), true);
  assert.equal(isLiteralEvidence(page, 'Lince Fund is an early-stage investor ... We back seed-stage companies in Bolivia'), false);
  assert.equal(isLiteralEvidence(page, 'Lince … ok'), false, 'needs at least one long literal passage');
});

test('V4-DBG-1b third-party page never creates the entity; it becomes a candidate', () => {
  const doc = { url: 'https://startup-news.test/raise', title: 'Raise', text: 'Pizarra Labs raised USD 2M led by Mirlo Ventures (mirlo.test). The company sells to private schools and plans to hire twenty engineers in Lima this year.' };
  const r = extractFixtureInvestorV2({ document: doc, extraction: fullV2({ canonical_name: 'Mirlo Ventures', official_domain: 'mirlo.test', source_kind: 'news', quote: 'Pizarra Labs raised USD 2M led by Mirlo Ventures (mirlo.test).', stages: ['seed'], evidence: { stages: 'raised USD 2M' } }), today: '2026-10-09', firstSeen: fs0() });
  assert.equal(r.entity, null); assert.equal(r.rejected_kind, 'unresolved_firm_identity'); assert.equal(r.candidate.domain_on_page, 'mirlo.test');
});

test('V4-DBG-1c own homepage labelled "other" by the model is first party and official', () => {
  const doc = { url: 'https://www.lincefund.test/', title: 'Lince', text: 'Lince Fund es un fondo de venture capital que invierte en startups B2B de Chile y Perú en etapa semilla. Acompañamos a fundadores desde el primer cheque con un equipo cercano.' };
  const r = extractFixtureInvestorV2({ document: doc, extraction: fullV2({ canonical_name: 'Lince Fund', source_kind: 'other', quote: 'Lince Fund es un fondo de venture capital que invierte en startups B2B de Chile y Perú en etapa semilla.' }), today: '2026-10-09', firstSeen: fs0() });
  assert.ok(r.entity, r.rejected_kind); assert.equal(r.entity.sources[0].source_kind, 'official'); assert.equal(r.entity.official_domain, 'lincefund.test');
  assert.equal(deriveActivity(r.entity, { today: '2026-10-09', recencyDays: 540 }).active_status, 'possibly_active');
});

test('V4-DBG-1d participation lists attribute investing to the listed firm', () => {
  assert.ok(attributedInvestmentV2('Additional backing came from Chalk Ventures and Pine Capital.', ['Pine Capital']));
  assert.ok(attributedInvestmentV2('The round was led by Swedish deeptech investor Orbit Fund, with participation from Kite VC.', ['Orbit Fund']));
  assert.ok(attributedInvestmentV2('Other investors include Moss Ventures, Fern Capital.', ['Fern Capital']));
  assert.ok(attributedInvestmentV2('La ronda fue liderada por Cóndor Capital.', ['Cóndor Capital']));
  assert.ok(!attributedInvestmentV2('Pine Capital announced a new office in Oslo.', ['Pine Capital']));
  assert.ok(hasInv('Invertimos en startups B2B de Chile y Perú.')); assert.ok(!hasInv('Somos un equipo con oficinas en Lima.'));
});
