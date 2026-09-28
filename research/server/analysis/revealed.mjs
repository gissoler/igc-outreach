// Tesis revelada (Módulo 2): recomienda fondos por lo que HACEN (sus deals recientes parecidos al perfil),
// no por lo que dicen. Corte temporal estricto: solo deals con fecha < asOf.
//  1. Perfil de cada fondo = sus deals de los últimos 24 meses, ponderados por recencia exp(-Δt/τ).
//  2. Candidatos: similitud perfil↔deals (embeddings baai; sin flota, TF-IDF) → media de los k más cercanos.
//  3. Reordenamiento con el reranker (mixbread) sobre "perfil" vs "resumen de los 3 deals más cercanos".
//  4. Momento (Form D, ritmo, sector) y explicación con citas.
import { cosine, embed, fleetConfig, rerank } from './fleet.mjs';
import { dealText, sectorsIn, stageOf } from './deals.mjs';
import { tfidfIndex, tokens } from './lexical.mjs';
import { momentumAdjust, momentumSignals } from './momentum.mjs';

const DAY = 86400000;
export const REVEALED_PARAMS = { windowMonths: 24, tauMonths: 18, k: 3, leadWeight: 1, coWeight: 0.7, stageBonus: 0.05, rerankShare: 0.6, candidates: 50 };

/** Agrupa deals anteriores a asOf por fondo. */
export function fundIndex(deals, { asOf, windowMonths = REVEALED_PARAMS.windowMonths } = {}) {
  const min = new Date(Date.parse(asOf) - windowMonths * 30.44 * DAY).toISOString().slice(0, 10);
  const funds = new Map();
  for (const d of deals) {
    if (!d.date || d.date >= asOf || d.date < min) continue;
    for (const inv of d.investors || []) {
      if (!inv.fundId) continue;
      if (!funds.has(inv.fundId)) funds.set(inv.fundId, { fundId: inv.fundId, names: new Map(), deals: [] });
      const f = funds.get(inv.fundId);
      f.names.set(inv.name, (f.names.get(inv.name) || 0) + 1);
      f.deals.push({ deal: d, role: inv.role });
    }
  }
  return [...funds.values()].map((f) => ({ ...f, name: [...f.names.entries()].sort((a, b) => b[1] - a[1])[0][0], allDeals: f.deals.map((x) => x.deal) }));
}

/** Perfil de la startup a texto canónico comparable con dealText. */
export function profileText(p) {
  if (typeof p === 'string') return p;
  return [p.stage, ...(p.sectors || []), p.country, p.description, p.product].filter(Boolean).join(' · ');
}

const explain = (x) => {
  const d = x.deal;
  const what = [d.sector, d.stage, String(d.date || '').slice(0, 7)].filter(Boolean).join(', ');
  return { text: `${x.role === 'lead' ? 'Led' : 'Participated in'} ${d.startup} (${what})`, url: d.url, quote: d.quote, date: d.date, similarity: Math.round(x.sim * 1000) / 1000 };
};

/**
 * Ranking por tesis revelada.
 * opts: { deals, asOf, vehicles, sector, stage, env, fetcher, useFleet, useRerank, useMomentum, cache:Map(dealId→vec), params }
 */
export async function rankRevealed(profile, opts) {
  const P = { ...REVEALED_PARAMS, ...(opts.params || {}) };
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const text = profileText(profile);
  const stage = opts.stage || stageOf(text);
  const sector = opts.sector || sectorsIn(text)[0] || null;
  const funds = fundIndex(opts.deals, { asOf, windowMonths: P.windowMonths });
  const uniq = [...new Map(funds.flatMap((f) => f.deals.map((x) => [x.deal.id, x.deal]))).values()];
  const cfg = fleetConfig(opts.env || {});
  const method = { similarity: 'lexical (TF-IDF, no fleet)', rerank: 'no', momentum: opts.useMomentum !== false };
  let simOf;
  if (opts.useFleet !== false && cfg.roles.embed.ready && uniq.length) {
    const cache = opts.cache || new Map();
    const missing = uniq.filter((d) => !cache.has(d.id));
    if (missing.length) (await embed(missing.map(dealText), { env: opts.env, fetcher: opts.fetcher })).forEach((v, i) => { cache.set(missing[i].id, v); opts.onEmbedding?.(missing[i].id, v); });
    const [pv] = await embed([text], { env: opts.env, fetcher: opts.fetcher });
    simOf = (d) => cosine(pv, cache.get(d.id));
    method.similarity = `embeddings (${cfg.roles.embed.model})`;
  } else {
    const idx = tfidfIndex(uniq.map(dealText));
    const pos = new Map(uniq.map((d, i) => [d.id, i]));
    const q = idx.query(text);
    simOf = (d) => idx.sim(q, idx.vectors[pos.get(d.id)]);
  }
  let ranked = funds.map((f) => {
    const scored = f.deals.map((x) => {
      const months = (Date.parse(asOf) - Date.parse(x.deal.date)) / (30.44 * DAY);
      const sim = simOf(x.deal);
      return { ...x, sim, score: sim * Math.exp(-months / P.tauMonths) * (x.role === 'lead' ? P.leadWeight : P.coWeight) };
    }).sort((a, b) => b.score - a.score);
    const top = scored.slice(0, P.k);
    // Pesos decrecientes (1, ½, ¼…): más deals parecidos suman, pero un fondo con muchos deals poco
    // parecidos no supera a uno con un deal muy parecido.
    const norm = Array.from({ length: P.k }, (_, i) => 0.5 ** i).reduce((a, b) => a + b, 0);
    const revealed = top.reduce((n, x, i) => n + x.score * 0.5 ** i, 0) / norm + (stage && top.some((x) => x.deal.stage === stage) ? P.stageBonus : 0);
    return { fundId: f.fundId, name: f.name, revealed, top, dealsInWindow: f.deals.length, leads: f.deals.filter((x) => x.role === 'lead').length, allDeals: f.allDeals };
  }).sort((a, b) => b.revealed - a.revealed);

  const cand = ranked.slice(0, P.candidates);
  const rest = ranked.slice(P.candidates);
  if (opts.useRerank !== false && opts.useFleet !== false && cfg.roles.rerank.ready && cand.length) {
    const docs = cand.map((f) => `${f.name}. ${f.top.map((x) => dealText(x.deal)).join(' | ')}`);
    const scores = await rerank(text, docs, { env: opts.env, fetcher: opts.fetcher });
    const maxR = Math.max(...cand.map((f) => f.revealed)) || 1;
    const rs = new Map(scores.map((s) => [s.index, s.score]));
    cand.forEach((f, i) => { f.rerank = rs.get(i) ?? 0; f.base = P.rerankShare * f.rerank + (1 - P.rerankShare) * (f.revealed / maxR); });
    method.rerank = cfg.roles.rerank.model;
  } else {
    const maxR = Math.max(0, ...cand.map((f) => f.revealed)) || 1;
    cand.forEach((f) => { f.base = f.revealed / maxR; });
  }
  ranked = [...cand, ...rest.map((f) => ({ ...f, base: 0 }))];
  for (const f of ranked) {
    // Momento: todas las fuentes de actividad del fondo (no solo la ventana) para ritmo e inactividad.
    f.momentum = momentumSignals({ fundName: f.name, deals: f.allDeals, vehicles: opts.vehicles, asOf, sector });
    f.final = f.base + (opts.useMomentum === false ? 0 : momentumAdjust(f.momentum));
    f.explanation = f.top.filter((x) => x.sim > 0).map(explain);
  }
  ranked.sort((a, b) => b.final - a.final || b.revealed - a.revealed || a.name.localeCompare(b.name));
  return { asOf, method, stage, sector, funds: ranked.map(({ allDeals, top, ...f }, i) => ({ ...f, rank: i + 1 })) };
}

/**
 * Línea base (a): el ranking actual de la app aplicado al mismo universo de fondos.
 * Reproduce `fit` de core.evaluate(): proporción de palabras del sector del perfil presentes en el texto del candidato.
 */
export function rankAppFit(profile, { deals, asOf, industry }) {
  const funds = fundIndex(deals, { asOf, windowMonths: 1200 });
  const toks = [...new Set(tokens(industry || profileText(profile)).filter((t) => t.length > 2))];
  const scored = funds.map((f) => {
    const hay = new Set(tokens(f.deals.map((x) => `${x.deal.title} ${x.deal.quote}`).join(' ')));
    const hits = toks.filter((t) => hay.has(t)).length;
    return { fundId: f.fundId, name: f.name, fit: Math.min(1, hits / Math.max(2, Math.min(6, toks.length))), n: f.deals.length };
  }).sort((a, b) => b.fit - a.fit || b.n - a.n || a.name.localeCompare(b.name));
  return scored.map((f, i) => ({ ...f, rank: i + 1 }));
}
