#!/usr/bin/env node
// C4 (H6): prueba de alcanzabilidad del oro. 18 consultas cortas sin nombre de firma (3 por caso; la 1.ª de cada caso es la
// de la tabla P1 del diagnóstico), solo Exa (sin serper/tavily), 10 resultados, mismos parámetros que v5 (auto, texto 4000,
// highlights). Se ejecuta UNA vez: si ya existe el resultado, no vuelve a llamar a Exa. Registra si el dominio del oro aparece
// y en qué puesto. Uso (desde research/): node --env-file=.env bench/investors/analysis/v7/reachability.mjs
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBenchCache } from '../../../../agent/cache.mjs';
import { createFailoverSearchTool } from '../../search-failover.mjs';
import { OUT, host } from './common.mjs';
export const QUERIES = {
  p01: { gold: 'magmapartners.com', q: ['Latin America seed venture capital fintech marketplaces', 'seed stage venture capital firm investing in Latin American fintech startups', 'early stage VC fund fintech insurtech marketplaces Latin America'] },
  p02: { gold: 'lightrock.com', q: ['growth equity impact investor Brazil Latin America mobility Series B', 'impact growth fund investing in efficient mobility and renewable energy companies in emerging markets', 'growth stage impact investor Brazil climate mobility logistics'] },
  p03: { gold: 'celesta.vc', q: ['deep tech venture capital hardware building blocks compute memory power delivery', 'venture capital firm investing in semiconductor and hardware startups Series A', 'deep tech venture fund semiconductors systems infrastructure early stage'] },
  p04: { gold: 'golden.ventures', q: ['Toronto pre-seed seed venture capital Canadian founders', 'Canadian seed stage venture capital firm enterprise software', 'pre-seed venture fund backing Canadian founders building software companies'] },
  p05: { gold: 'worldfund.vc', q: ['European climate tech venture capital Series B buildings energy', 'climate venture capital fund investing in decarbonisation of buildings energy manufacturing transport', 'European climate tech VC fund Series A Series B Netherlands Germany'] },
  p06: { gold: 'ecapital.vc', q: ['German venture capital cybersecurity defense tech seed', 'venture capital firm investing in cybersecurity and defense tech startups Germany', 'early stage VC Germany Austria Switzerland cybersecurity industrial security'] }
};
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const dir = resolve(OUT, 'reachability-v7-2026-10-12'), resultPath = resolve(dir, 'result.json');
  if (existsSync(resultPath)) { console.log(`ya ejecutada: ${resultPath} (no se vuelve a llamar a Exa)`); process.exit(0); }
  mkdirSync(dir, { recursive: true });
  const cache = createBenchCache({ path: resolve(dir, 'cache.sqlite'), namespace: 'reachability-v7' });
  const search = createFailoverSearchTool({ providers: ['exa'], env: process.env, cache, resultsPerQuery: 10, exaContentsChars: 4000, exaType: 'auto', exaHighlights: true });
  const rows = []; let paid = 0, errors = 0;
  for (const [c, { gold, q }] of Object.entries(QUERIES)) for (const query of q) {
    const v = await search.search(query, { remainingSearches: 1 });
    for (const a of v.attempts ?? []) if (!a.cached) { paid++; if (a.error) errors++; }
    appendFileSync(resolve(dir, 'events.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), event: 'search_end', run_id: `reachability__${c}`, query, results: v.results?.length ?? 0, urls: (v.results ?? []).map(r => r.url), provider: v.provider ?? null, attempts: v.attempts ?? [], error: v.error ?? null })}\n`);
    const urls = (v.results ?? []).map(r => r.url), idx = urls.findIndex(u => { const h = host(u); return h === gold || h?.endsWith(`.${gold}`); });
    rows.push({ case: c, gold, query, words: query.split(/\s+/).length, results: urls.length, gold_rank: idx < 0 ? null : idx + 1, gold_url: idx < 0 ? null : urls[idx], error: v.error?.message ?? null, top_domains: urls.map(host) });
    if (v.error && /\b40[123]\b|\b429\b|credit|balance|quota/i.test(v.error.message ?? '')) { console.error('Exa: error de saldo/autorización; se para.'); break; }
  }
  cache.close();
  const byCase = Object.fromEntries(Object.keys(QUERIES).map(c => { const r = rows.filter(x => x.case === c); return [c, { queries: r.length, with_gold: r.filter(x => x.gold_rank).length, ranks: r.map(x => x.gold_rank) }]; }));
  const out = { executed_at: new Date().toISOString(), paid_calls: paid, errors, usd_at_0_0089: +(paid * 0.0089).toFixed(3), cases_with_gold_in_any_query: Object.values(byCase).filter(x => x.with_gold > 0).length, queries_with_gold: rows.filter(r => r.gold_rank).length, by_case: byCase, rows };
  // Solo una ejecución completa (18 respuestas de Exa sin error) deja result.json. Si hubo errores (p. ej. red sin acceso a
  // api.exa.ai), queda result-incompleto.json y se puede repetir: las consultas que sí respondieron salen de la caché (no se pagan).
  if (errors) { writeFileSync(resolve(dir, 'result-incompleto.json'), `${JSON.stringify(out, null, 2)}\n`); console.error(`INCOMPLETA: ${errors} de ${rows.length} consultas con error (${rows.find(r => r.error)?.error}); no se escribe result.json`); process.exit(1); }
  writeFileSync(resultPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ ...out, rows: rows.map(r => ({ case: r.case, gold_rank: r.gold_rank, q: r.query })) }, null, 1));
}
