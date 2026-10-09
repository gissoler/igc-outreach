const src = (name, overrides = {}) => ({
  entity_kind: 'institutional_investor', canonical_name: name, official_domain: `${name.toLowerCase().replaceAll(' ', '-')}.test`, aliases: [], investor_type: 'venture_capital', parent_firm: null, vehicles: [], active_status: 'active',
  sectors: ['Healthtech'], stages: ['seed'], rounds: ['seed'], geographies: ['Latin America'], check_range_usd: { min: 500000, max: 3000000, source_url: `https://${name.toLowerCase().replaceAll(' ', '-')}.test/thesis` },
  lead_follow: 'lead', business_models: { accepted: ['SaaS'], excluded: [] }, regulatory_restrictions: [], relevant_portfolio: [], potential_conflicts: [], recent_investment: true,
  source_kind: 'official', published_on: '2026-08-01', quote: `${name} is making new seed investments.`, regulatory_id: null, contradictions: [], ...overrides
});
const page = (url, title, extraction) => [url, { title, text: extraction.quote ? `${extraction.quote} ${extraction.quote} ${extraction.quote}` : `${title}. ${title}. ${title}. This page does not describe an investment firm.`, extraction }];

export const pages = Object.fromEntries([
  page('https://alpha-ventures.test/thesis', 'Alpha Ventures thesis', src('Alpha Ventures', { official_domain: 'alpha-ventures.test', regulatory_id: 'REG-ALPHA', aliases: ['Alpha Health Ventures'], canonical_url: 'https://alpha-ventures.test/', vehicles: [{ name: 'Alpha Seed I', url: 'https://alpha-ventures.test/seed-i' }] })),
  page('https://alpha-ventures.test/seed-i', 'Alpha Seed I', src('Alpha Seed I', { official_domain: 'alpha-ventures.test', regulatory_id: 'REG-ALPHA', canonical_url: 'https://alpha-ventures.test/seed-i', vehicles: [{ name: 'Alpha Seed I', url: 'https://alpha-ventures.test/seed-i' }] })),
  page('https://alpha-health.test/about', 'Renamed Alpha Health Ventures', src('Alpha Health Ventures', { official_domain: 'alpha-health.test', regulatory_id: 'REG-ALPHA', canonical_url: 'https://alpha-health.test/about', aliases: ['Alpha Ventures'] })),
  page('https://legacy-fund.test/closed', 'Legacy Fund closure', src('Legacy Fund', { active_status: 'inactive', recent_investment: false, published_on: '2026-01-01', quote: 'Legacy Fund no longer makes new investments.' })),
  page('https://late-growth.test/thesis', 'Late Growth thesis', src('Late Growth', { stages: ['series C'], rounds: ['growth'] })),
  page('https://euro-only.test/thesis', 'Euro Only thesis', src('Euro Only', { geographies: ['Europe'] })),
  page('https://micro-check.test/thesis', 'Micro Check thesis', src('Micro Check', { check_range_usd: { min: 50000, max: 250000, source_url: 'https://micro-check.test/thesis' } })),
  page('https://broad-impact.test/thesis', 'Broad Impact thesis', src('Broad Impact', { sectors: ['Healthcare'], stages: [], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, active_status: 'possibly_active', recent_investment: false })),
  page('https://rival-health.test/about', 'Rival Health startup', { entity_kind: 'portfolio_company', canonical_name: 'Rival Health' }),
  page('https://alex-angel.test/bio', 'Alex Angel biography', { entity_kind: 'individual', canonical_name: 'Alex Angel' }),
  page('https://launch-school.test/program', 'Launch School', { entity_kind: 'accelerator_no_capital', canonical_name: 'Launch School' }),
  page('https://alpha-capital.test/thesis', 'Alpha Capital thesis', src('Alpha Capital', { official_domain: 'alpha-capital.test', regulatory_id: 'REG-ALPHA-CAPITAL' })),
  page('https://conflict-fund.test/thesis', 'Conflict Fund thesis', src('Conflict Fund', { relevant_portfolio: ['Rival Health'], potential_conflicts: ['Rival Health'] })),
  page('https://contradictory.test/thesis', 'Contradictory Fund thesis', src('Contradictory Fund', { contradictions: ['Official thesis says seed; recent release says growth only.'], stages: ['seed', 'growth'] })),
  page('https://unknown-fund.test/about', 'Unknown Fund about', src('Unknown Fund', { active_status: 'unknown', recent_investment: false, sectors: [], stages: [], rounds: [], geographies: [], check_range_usd: { min: null, max: null, source_url: null }, lead_follow: 'unknown', business_models: { accepted: [], excluded: [] }, published_on: null }))
]);

export const searches = {
  'healthtech venture capital investors': ['https://broad-impact.test/thesis','https://rival-health.test/about','https://alex-angel.test/bio'],
  'seed healthtech institutional investor': ['https://late-growth.test/thesis','https://micro-check.test/thesis','https://launch-school.test/program'],
  'latin america healthtech venture fund': ['https://euro-only.test/thesis','https://legacy-fund.test/closed','https://unknown-fund.test/about'],
  'investment thesis digital health saas': ['https://conflict-fund.test/thesis','https://contradictory.test/thesis','https://alpha-capital.test/thesis'],
  'healthtech investors new investments 2026': ['https://alpha-ventures.test/thesis','https://alpha-ventures.test/seed-i','https://alpha-health.test/about'],
  'health seed vc': ['https://broad-impact.test/thesis','https://legacy-fund.test/closed'],
  'latam digital health investors': ['https://euro-only.test/thesis','https://micro-check.test/thesis'],
  'active health investors 2026': ['https://alpha-ventures.test/thesis','https://conflict-fund.test/thesis','https://contradictory.test/thesis'],
  'alpha follow up identity': ['https://alpha-ventures.test/seed-i','https://alpha-health.test/about','https://alpha-capital.test/thesis'],
  'fictional null one': ['https://rival-health.test/about','https://alex-angel.test/bio','https://launch-school.test/program']
};

export const plans = {
  B1: { initial_batch: [{ queries: ['health seed vc','latam digital health investors'], stop: false }] },
  B2: { initial_batch: [{ queries: ['health seed vc'], stop: false }], adaptive_step: [{ queries: ['active health investors 2026'], stop: false }, { queries: ['alpha follow up identity'], stop: false }, { queries: [], stop: true }] }
};

export function fixtureDeps(condition, { nullOnly = false } = {}) {
  let adaptive = 0;
  return {
    search: async query => ({ results: (nullOnly ? searches['fictional null one'] : searches[query.toLowerCase()] ?? []).map((url, i) => ({ rank: i + 1, url, title: pages[url].title })), nominal_cost: 1 }),
    fetch: async url => ({ ...pages[url], nominal_cost: 1 }),
    plan: async ({ mode }) => mode === 'initial_batch' ? (nullOnly ? { queries: ['fictional null one'], stop: false } : plans[condition].initial_batch[0]) : (plans[condition].adaptive_step[adaptive++] ?? { queries: [], stop: true })
  };
}

export const fixtureConfig = {
  schema_version: 'investor_run_config/1', bench_id: 'investors-fixture', status: 'frozen', today: '2026-10-07', search: { provider: 'fixture', results_per_query: 10 },
  agent_model: { family: 'fixture-a', model_id: 'fixture-a-1' }, preannotator_model: { family: 'fixture-b', model_id: 'fixture-b-1' },
  budgets: { searches: 8, fetches: 30, planner_calls: 5, tokens_nominal: 10000, seconds_nominal: 60 }, patience_n: 3, default_fetch_per_search: 3,
  b2: { initial_batch: 1, max_searches_per_step: 1 }, seeds: [101,202,303], prompts: { b0_templates: 'v1', planner: 'v1', extractor: 'v1', judge: 'v1', preannotator: 'v1' }, catalog: 'criteria_catalog.investor@v1',
  decision_rule: { status: 'proposed', min_recall_gain: 0.05, alpha: 0.05, max_ndcg_drop: 0.03, max_hard_false_positive_rate: 0.1, min_correct_null_abstentions: 1 }
};
