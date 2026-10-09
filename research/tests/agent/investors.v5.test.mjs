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

test('V5-1c config v5 valida (draft), usa manifest.v5 con planner v3 y b0 v2 verificados; v4 no cambia', () => {
  const v5 = validateInvestor('investor_run_config.v3', json(cfgPath('v5-2026-10-09')));
  assert.equal(v5.status, 'draft'); assert.equal(v5.search.exa_type, 'auto'); assert.equal(v5.search.exa_highlights, true);
  assert.deepEqual(v5.deepening, { enabled: true, max_firms_per_run: 8, max_queries_per_firm: 2, max_fetches_per_firm: 4 });
  assert.deepEqual(v5.budgets, json(cfgPath('v4-2026-10-09')).budgets);
  const planner = loadInvestorPrompt('planner', 'v3', { manifest: 'manifest.v5.json' });
  assert.match(planner.system, /natural-language description of the page/); assert.match(planner.system, /no site:/);
  const b0 = loadInvestorPrompt('b0_templates', 'v2', { manifest: 'manifest.v5.json' }).templates;
  assert.ok(b0.every(t => !/site:|"/.test(t.template)));
  for (const [id, v] of [['planner', 'v2'], ['extractor', 'v3'], ['judge', 'v2']]) assert.equal(loadInvestorPrompt(id, v, { manifest: 'manifest.v5.json' }).sha256, loadInvestorPrompt(id, v, { manifest: 'manifest.v4.json' }).sha256);
  assert.equal(json(cfgPath('v4-2026-10-09')).schema_version, 'investor_run_config/2');
});
