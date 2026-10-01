/* Fase de expansión del motor: después de la primera ronda, lo VERIFICADO se usa como mapa.
   Devuelve candidatos (URLs) y consultas laterales para la ronda siguiente; el motor los lee y verifica igual que todo lo demás.
   Presupuesto fijo en código: semillas, enlaces por semilla y páginas totales (ENGINE_EXPAND_*). ENGINE_EXPAND=off la apaga. */
import { snowball, siteDive } from './discovery.mjs';
import { lateralQueries } from './lateral.mjs';
import { exaSimilar, searchProviders, urlKey } from './searchApis.mjs';
import { hostKind } from './verify.mjs';

export const expandLimits = (env = process.env, o = {}) => ({
  seeds: Math.max(0, Number(o.seeds ?? env.ENGINE_EXPAND_SEEDS ?? 4)), perSeed: Math.max(1, Number(env.ENGINE_EXPAND_LINKS ?? 6)),
  maxPages: Math.max(0, Number(o.maxPages ?? env.ENGINE_EXPAND_PAGES ?? 12)), dive: Math.max(0, Number(env.ENGINE_EXPAND_DIVE ?? 2)), similar: Math.max(0, Number(env.ENGINE_EXPAND_SIMILAR_SEEDS ?? 3)),
});

/** Reparte el cupo entre fuentes por turnos para que ninguna se coma las demás; une por URL los proveedores que traen lo mismo. */
export function mergeRows(lists, maxPages, exclude = new Set()) {
  const taken = new Map(); const skip = new Set([...exclude].map(urlKey));
  const queue = lists.map((l) => [...l]);
  while (taken.size < maxPages && queue.some((l) => l.length)) {
    for (const l of queue) {
      const r = l.shift(); if (!r) continue;
      const k = urlKey(r.url); if (skip.has(k) || hostKind(r.url) === 'social') continue;
      const had = taken.get(k);
      if (had) { if (!had.providers.includes(r.provider)) had.providers.push(r.provider); continue; }
      if (taken.size >= maxPages) break;
      taken.set(k, { ...r, providers: [r.provider] });
    }
  }
  return [...taken.values()];
}

export async function expandRound({ objective, brief, seeds = [], seen = new Set(), asked = [], env = process.env, fetcher = fetch, signal, chat, canRead = true, today = new Date(), limits = expandLimits(env), deps = {} }) {
  const { snow = snowball, dive = siteDive, similar = exaSimilar, lateral = lateralQueries } = deps;
  const stats = { seeds: seeds.length, snowball: 0, siteDive: 0, similar: 0, siteDiveVia: '', lateral: null, errors: [], pages: 0 };
  const use = seeds.slice(0, limits.seeds);
  const guard = async (name, fn, fallback) => { try { return await fn(); } catch (e) { if (signal?.aborted) throw e; stats.errors.push(`${name}: ${String(e?.message || e).slice(0, 120)}`); return fallback; } };
  const [linkRows, diveRows, simRows, lat] = await Promise.all([
    use.length && limits.perSeed ? guard('snowball', () => snow(use, { fetcher, signal, perSeed: limits.perSeed, exclude: seen }), []) : [],
    use.length && limits.dive && env.ENGINE_EXPAND_DIVE !== '0' ? guard('site-dive', async () => { const out = []; for (const s of use.slice(0, limits.dive)) { const r = await dive(s.url, { fetcher, signal, exclude: seen, max: 3 }); stats.siteDiveVia = r.via || stats.siteDiveVia; if (r.note) stats.errors.push(`site-dive: ${r.note}`); out.push(...r); } return out; }, []) : [],
    use.length && limits.similar && env.EXA_API_KEY && env.ENGINE_EXPAND_SIMILAR !== 'off' && searchProviders(env).includes('exa') ? guard('similar', async () => { const out = []; for (const s of use.slice(0, limits.similar)) out.push(...await similar(s.url, { env, fetcher, signal, limit: 6 })); return out; }, []) : [],
    guard('lateral', () => lateral(objective, brief, { names: seeds.map((s) => s.name).filter(Boolean), asked, env, fetcher, signal, chat, canRead, today }), { queries: [], stats: { errors: [] } }),
  ]);
  stats.snowball = linkRows.length; stats.siteDive = diveRows.length; stats.similar = simRows.length;
  stats.lateral = lat.stats; for (const e of lat.stats?.errors || []) stats.errors.push(e);
  const pages = mergeRows([linkRows, simRows, diveRows], limits.maxPages, seen);
  stats.pages = pages.length;
  return { pages, queries: lat.queries || [], stats };
}
