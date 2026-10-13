// V8 (PROMPT-v10, variante d confirmada): consultas de páginas de listas a partir del perfil del caso. Misma plantilla que usó el
// diagnóstico (analysis/v8/queries.v8.mjs la importa de aquí): no hay dos copias. Sin nombres de firma.
export const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const clean = s => String(s).replace(/\s+/g, ' ').trim();
export const STAGE = { 'pre-seed': 'pre-seed', seed: 'seed', series_a: 'Series A', series_b: 'Series B', series_c: 'Series C', growth: 'growth stage' };
export const list = xs => (xs ?? []).filter(Boolean);
export const region = f => list(f.target_markets).slice(0, 3).join(' ');
export const regionAnd = f => { const r = list(f.target_markets).slice(0, 3); return r.length > 1 ? `${r.slice(0, -1).join(', ')} and ${r.at(-1)}` : r[0] ?? ''; };
export const stage = f => STAGE[f.funding_stage] ?? String(f.funding_stage ?? '').replace(/_/g, ' ');
/** Perfil con {value} por campo → valores planos. */
export const flattenProfile = profile => Object.fromEntries(Object.entries(profile.fields ?? {}).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? v.value : v]));
/** Variante d: 2 consultas de listas ("top ... firms", "list of <etapa> investors ..."). */
export const listQueries = f => [
  clean(`top venture capital firms investing in ${f.sector} in ${regionAnd(f)}`),
  clean(`list of ${stage(f)} investors ${f.sector} ${list(f.subsectors)[0]} ${region(f)}`)
];
export const listDiscoveryQueries = (profile, n = 2) => listQueries(flattenProfile(profile)).slice(0, n);
