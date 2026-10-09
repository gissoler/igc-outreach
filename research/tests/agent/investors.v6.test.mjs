// Pruebas v6 (PROMPT-v6 sección 2): config v6 draft derivada de v5, filtro de relevancia por embeddings (B2E, apagado por defecto)
// y campo sparse_after_round_2. Dependencias simuladas; sin red ni modelo descargado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validateInvestor } from '../../bench/investors/contracts.mjs';
import { loadInvestorPrompt } from '../../bench/investors/prompts.mjs';
import { runInvestorDiscovery } from '../../bench/investors/engine.mjs';
import { extractFixtureInvestorV2 } from '../../bench/investors/extractor.mjs';
import { createRelevanceFilter, withRelevance, sparseAfterRound2, resultDocument, intentText, cosine } from '../../bench/investors/relevance-embeddings.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const F = resolve(import.meta.dirname, 'fixtures/investor-world-v0');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const cfgPath = v => resolve(repo, `research/bench/investors/config/${v}.json`);
const profile = json(resolve(F, 'profile.json')), anchorCase = json(resolve(F, 'cases/case-anchor.json'));
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const templates = loadInvestorPrompt('b0_templates').templates;
const v6 = () => json(cfgPath('v6-2026-10-09'));

// Embedder simulado: bolsa de palabras hasheada y normalizada (determinista).
const fakeEmbedder = { calls: [], async embed(texts, kind) { this.calls.push({ n: texts.length, kind }); return texts.map(t => { const v = new Array(64).fill(0); for (const w of String(t).toLowerCase().match(/[a-z]{3,}/g) ?? []) { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 64; v[h]++; } const n = Math.hypot(...v) || 1; return v.map(x => x / n); }); } };
// LLM simulado: "habla de inversión" si el texto contiene invest/fund/capital.
const fakeLlm = { calls: 0, async call({ user }) { this.calls++; const items = [...user.matchAll(/^\[(\d+)\] (.*)$/gm)].map(m => ({ i: Number(m[1]), about_investment: /invest|fund|capital/i.test(m[2]) })); return { json: { items }, tokens_nominal: 100, latency: { actual_ms: 5, nominal_ms: 5 } }; } };
const prompt = loadInvestorPrompt('relevance', 'v1', { manifest: 'manifest.v6.json' });

test('V6-1 config v6 es draft, valida con el esquema v4, tiene el filtro apagado y no toca el fingerprint de v5', () => {
  const c = validateInvestor('investor_run_config.v4', v6());
  assert.equal(c.status, 'draft'); assert.equal(c.schema_version, 'investor_run_config/4'); assert.notEqual(c.bench_id, json(cfgPath('v5-2026-10-09')).bench_id);
  assert.equal(c.relevance.embeddings.enabled, false); assert.equal(c.relevance.embeddings.top_k, 10); assert.equal(c.relevance.embeddings.block_size, 10);
  assert.deepEqual(c.deepening, json(cfgPath('v5-2026-10-09')).deepening); assert.deepEqual(c.budgets, json(cfgPath('v5-2026-10-09')).budgets);
  const fp = resolve(repo, 'research/bench/investors/out/investors-internal-2026-10-09-v5/fingerprint.json');
  if (existsSync(fp)) for (const f of json(fp).files) assert.equal(sha(resolve(repo, f.path)), f.sha256, `fingerprint de v5 cambió: ${f.path}`);
});

test('V6-2 manifest v6: el prompt de relevancia carga con integridad y los demás prompts son idénticos a v5', () => {
  assert.match(prompt.system, /INVESTMENT/); assert.match(prompt.user, /\{\{intent\}\}/);
  for (const [id, v] of [['planner', 'v3'], ['extractor', 'v3'], ['judge', 'v2'], ['b0_templates', 'v2']]) assert.equal(loadInvestorPrompt(id, v, { manifest: 'manifest.v6.json' }).sha256, loadInvestorPrompt(id, v, { manifest: 'manifest.v5.json' }).sha256);
  validateInvestor('investor_relevance.v1', { items: [{ i: 0, about_investment: true }] });
  assert.throws(() => validateInvestor('investor_relevance.v1', { items: [{ i: 0 }] }));
});

test('V6-3 resultDocument usa título + primer párrafo; intentText usa solo el texto del brief y el sector', () => {
  const d = resultDocument({ title: 'Titulo', text: 'x\n\nPrimer párrafo largo que describe una inversión en baterías en Australia.\n\nSegundo párrafo que no debe aparecer.' });
  assert.match(d, /^Titulo\. Primer párrafo largo/); assert.ok(!/Segundo/.test(d));
  assert.match(resultDocument({ title: 'T', snippet: 'solo snippet' }), /solo snippet/);
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  const p = structuredClone(profile); p.fields.description = { value: 'DESCRIPCION-X' }; p.fields.product = { value: 'PRODUCTO-Y' };
  const t = intentText(p); assert.match(t, /DESCRIPCION-X/); assert.match(t, /PRODUCTO-Y/);
});

const mkResults = () => [
  { url: 'https://a.test/baterias', title: 'Baterías de fosfato en Australia', text: 'Australia expande la producción de baterías de fosfato de hierro para almacenamiento de energía en la red.' },
  { url: 'https://b.test/fondo', title: 'Fondo de inversión en baterías', text: 'El fondo invest capital en startups de baterías de fosfato en Australia con tickets seed.' },
  { url: 'https://c.test/clima', title: 'Clima y energía', text: 'Una nota sobre clima y política energética sin ninguna mención financiera.' }
];
const relCfg = (o = {}) => { const c = v6(); Object.assign(c.relevance.embeddings, o); return c; };

test('V6-4 filtro: ordena por similitud, deja solo los que hablan de inversión y pasa al siguiente bloque si el primero queda vacío', async () => {
  fakeEmbedder.calls.length = 0; fakeLlm.calls = 0;
  const p = structuredClone(profile); p.fields.product = { value: 'baterías de fosfato en Australia' };
  const rel = createRelevanceFilter({ embedder: fakeEmbedder, llm: fakeLlm, prompt, config: relCfg({ top_k: 1, block_size: 1 }), profile: p, log: () => {} });
  const kept = await rel.filter(mkResults());
  assert.deepEqual(kept.map(r => r.url), ['https://b.test/fondo']);
  assert.ok(fakeLlm.calls >= 1 && fakeLlm.calls <= 3); assert.equal(rel.stats.results_kept, 1); assert.equal(rel.stats.results_in, 3); assert.equal(rel.stats.embedded_texts, 4);
  // ninguno habla de inversión → vacío tras recorrer todos los bloques
  const none = createRelevanceFilter({ embedder: fakeEmbedder, llm: fakeLlm, prompt, config: relCfg({ top_k: 2, block_size: 2 }), profile: p, log: () => {} });
  assert.deepEqual(await none.filter([mkResults()[0], mkResults()[2]]), []); assert.equal(none.stats.empty_queries, 1);
  assert.deepEqual(await none.filter([]), []);
});

// Mundo sintético mínimo para el motor B2.
const EV = { investor_type: null, sectors: null, stages: null, rounds: null, geographies: null, check_range_usd: null, lead_follow: null, business_models: null, active_status: null, published_on: null };
const fullV2 = (o = {}) => ({ entity_kind: 'institutional_investor', canonical_name: 'Zentro Capital', official_domain: null, aliases: [], investor_type: 'unknown', parent_firm: null, vehicles: [], active_status: 'unknown', sectors: [], stages: [], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, lead_follow: 'unknown', business_models: { accepted: [], excluded: [] }, regulatory_restrictions: [], relevant_portfolio: [], potential_conflicts: [], recent_investment: false, source_kind: 'official', published_on: null, quote: null, regulatory_id: null, canonical_url: null, contradictions: [], evidence: { ...EV }, candidates: [], ...o, evidence: { ...EV, ...(o.evidence ?? {}) } });
const firm = (name, url) => ({ url, title: name, text: `${name} invests in seed fintech startups in Mexico. ${name} has a small team and publishes its portfolio on this website for founders who want to learn more about how the partnership works day to day.`, extraction: fullV2({ canonical_name: name, quote: `${name} invests in seed fintech startups in Mexico.`, investor_type: 'venture_capital', sectors: ['fintech'], stages: ['seed'], geographies: ['Mexico'] }) });

function world(searches, pages, plans) {
  const calls = { search: [], fetch: [], plan: [] }; let adaptive = 0;
  return { calls, deps: {
    search: async q => { calls.search.push(q); return { results: (searches[q] ?? []).map((r, i) => ({ rank: i + 1, ...r })), nominal_cost: 1 }; },
    fetch: async url => { calls.fetch.push(url); const p = pages[url]; return p ? { ok: true, text: p.text, title: p.title, nominal_cost: 1 } : { ok: false, text: '', nominal_cost: 1 }; },
    extract: async ({ document, today, firstSeen }) => extractFixtureInvestorV2({ document, extraction: pages[document.url]?.extraction ?? fullV2({ entity_kind: 'other', canonical_name: 'Unknown page' }), today, firstSeen }),
    plan: async ({ mode, state }) => { calls.plan.push({ mode, entities: state.entities.length }); return mode === 'initial_batch' ? plans.initial : (plans.adaptive[adaptive++] ?? { queries: [], stop: true, candidate_firms: [] }); }
  } };
}

test('V6-5 integración con el motor B2: el filtro quita lo que no es inversión sin consumir fetches; sparse_after_round_2 se calcula al empezar la 3.ª llamada del planner', async () => {
  const pages = { 'https://zentro.test/': firm('Zentro Capital', 'https://zentro.test/'), 'https://andes.test/': firm('Andes Fund', 'https://andes.test/') };
  const news = { url: 'https://news.test/mercado', title: 'Mercado fintech en Mexico', text: 'Crecimiento del mercado fintech mexicano segun analistas del sector bancario.' };
  const searches = { 'venture capital firm seed fintech Mexico': [news, { url: 'https://zentro.test/', title: 'Zentro Capital', text: 'Zentro Capital invests in seed fintech startups in Mexico.' }], 'angel network fund early stage payments Colombia': [{ url: 'https://andes.test/', title: 'Andes Fund', text: 'Andes Fund invests capital in seed fintech in Mexico.' }] };
  const w = world(searches, pages, { initial: { queries: ['venture capital firm seed fintech Mexico'], stop: false, candidate_firms: [] }, adaptive: [{ queries: ['angel network fund early stage payments Colombia'], stop: false, candidate_firms: [] }, { queries: [], stop: true, candidate_firms: [] }] });
  const config = { ...v6(), search: { provider: 'fixture', results_per_query: 10 }, judge: { max_llm_calls: 0 }, deepening: { enabled: false, max_firms_per_run: 0, max_queries_per_firm: 0, max_fetches_per_firm: 0 } };
  const p = structuredClone(profile); p.fields.sector.value = 'Fintech'; p.fields.funding_stage.value = 'seed'; p.fields.incorporation_country.value = 'Mexico'; p.fields.operating_regions.value = ['Mexico']; p.fields.target_markets.value = ['Mexico'];
  const rel = createRelevanceFilter({ embedder: fakeEmbedder, llm: fakeLlm, prompt, config, profile: p, log: () => {} });
  const wrapped = withRelevance(w.deps, rel);
  const r = await runInvestorDiscovery({ caseObj: anchorCase, profile: p, condition: 'B2', config, templates, catalog, deps: wrapped.deps });
  assert.ok(!w.calls.fetch.includes('https://news.test/mercado'), 'la nota de mercado no se abre');
  assert.deepEqual([...new Set(w.calls.fetch)].sort(), ['https://andes.test/', 'https://zentro.test/']);
  assert.equal(r.totals.rejected_non_investors, 0); assert.equal(r.totals.fetches, 2); assert.equal(rel.stats.results_in, 3); assert.equal(rel.stats.results_kept, 2);
  assert.equal(wrapped.round.plan_calls, 3); assert.equal(wrapped.round.accepted_at_round_3_start, 2);
  assert.equal(sparseAfterRound2(wrapped.round, r.entities.length), true, '2 firmas < 3');
  assert.equal(sparseAfterRound2({ accepted_at_round_3_start: 3 }, 9), false); assert.equal(sparseAfterRound2({ accepted_at_round_3_start: null }, 1), true); assert.equal(sparseAfterRound2({ accepted_at_round_3_start: null }, 5), false);
});

test('V6-6 el runner v6 se niega a correr B2E si el filtro está apagado y no se pasó --enable-embeddings', () => {
  const out = mkdtempSync(resolve(tmpdir(), 'v6-'));
  const res = spawnSync(process.execPath, [resolve(repo, 'research/bench/investors/run-experiment.v6.mjs'), '--config', cfgPath('v6-2026-10-09'), '--cases', resolve(repo, 'research/bench/investors/cases'), '--out', out, '--conditions', 'B2E', '--seeds', '101'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.notEqual(res.status, 0); assert.match(res.stderr, /B2E requiere relevance\.embeddings\.enabled=true/);
});
