// Perfil base de cuenta (espejo de blankConfig del frontend) para crear el perfil desde el prerregistro.
export const blankProfile = (user = {}) => ({
  project: { name: '', one_liner: '', description: '', sectors: [], keywords: [], stage: 'pre-seed', raise_usd: null, geo: [], funding_types: [] },
  founder: { name: user.name || '', title: '', email: user.email || '', linkedin_url: '', org: '' },
  comparables: [], team: [], contacts: [], affiliations: [], exclude_funds: [],
  filters: { stages_allowed: ['pre-seed', 'seed'], ticket_min_usd: 100000, ticket_max_usd: 1500000, geos: ['US', 'LATAM', 'GLOBAL'], require_known_stage: false },
  weights: { seed: 0.3, coinvest: 0.2, thesis: 0.25, path: 0.2, activity: 0.05 },
  top_n: 20, hop_penalty: 0.25, max_hops: 4,
});
