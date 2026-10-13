#!/usr/bin/env node
// V9 paso 0 y techo del diseño L128 (PROMPT-v11). Solo mide; no es el motor. Desde research/:
//   node --env-file=.env bench/investors/analysis/v9/diagnostico.v9.mjs [--dry-run] [--cap-usd 0.25] [--stop-file f]
// Fases, con la config frozen config/v9-diagnostico-2026-10-12.json:
//  N  búsqueda por el nombre del oro de los 12 casos con la consulta de resolución del motor ("<nombre>" venture capital):
//     Exa (12 llamadas, 1 unidad cada una, 0.107 USD) y Serper (12 consultas; no cuenta para el tope de Exa). Métricas:
//     dominio del oro en los 10 primeros y si la resolución (emparejador v8 y v9) elegiría el sitio del oro.
//  S  sitio del oro: descarga + extractor v7 (prompt v3, sin cambios) sobre la URL que eligiría la resolución y sobre la URL
//     oficial del ancla; "aceptado" = resolveCandidateV9 devuelve accepted con el dominio del oro. LLM ≤ 60 llamadas.
//  L  selección dentro del cupo K=128. p01–p06: páginas de lista que abrió cada réplica v8 (caché, sin red); sel = oro ≤ K en ≥ 2
//     de 3 réplicas. p07–p12 (sin corrida del motor): URL de las 2 consultas de listas del diagnóstico v8 (caché, sin Exa) con la
//     política de apertura de v8 (puesto, ≤2 por sitio, 6 por consulta, lista negra), descarga y puesto del oro.
// Los nombres y dominios del oro solo están en este archivo de medición (GOLD_QUERY_NAME) y en cases/; nunca en el motor.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exaSearchV8, units, spendAttempts, BALANCE_RE, USD_PER_UNIT } from '../../exa-direct.v8.mjs';
import { nameMatchesDomain } from '../../extractor.mjs';
import { nameMatchesDomainV9 } from '../../resolve-match.v9.mjs';
import { resolveCandidateV9, resolutionQuery } from '../../resolve.v9.mjs';
import { rankVariant } from '../../list-names.v9.mjs';
import { diagListRows, loadCase, sameSite, host, CASES_A, CASES_B } from './data.v9.mjs';
import { isGold } from './ceiling_lists.mjs';
import { replicaRows } from './ceiling_replicas.mjs';
export const INV = resolve(import.meta.dirname, '../..');
export const CFG = JSON.parse(readFileSync(resolve(INV, 'config/v9-diagnostico-2026-10-12.json'), 'utf8'));
export const OUT_DIR = process.env.V9_DIAG_OUT ? resolve(process.env.V9_DIAG_OUT) : resolve(INV, 'out', CFG.bench_id);
const MOCK = process.env.V9_DIAG_MOCK === '1';   // solo para probar el flujo sin red ni LLM (tests); nunca en go-v9-diagnostico.sh
export const ALL = [...CASES_A, ...CASES_B];
// Nombre del oro tal como lo escriben las páginas de listas (medición; no entra al motor).
export const GOLD_QUERY_NAME = { p01: 'Magma Partners', p02: 'Lightrock', p03: 'Celesta Capital', p04: 'Golden Ventures', p05: 'World Fund', p06: 'eCAPITAL ENTREPRENEURIAL PARTNERS', p07: 'Novastar Ventures', p08: 'Ventures Platform', p09: 'A91 Partners', p10: 'Endiya Partners', p11: 'SEACEF', p12: 'SGInnovate' };
const denied = h => CFG.fetch_denylist.some(d => h === d || h?.endsWith(`.${d}`));
export const pick = (rows, name, matcher) => rows.find(r => { const h = host(r.url); return h && !denied(h) && matcher(name, h); }) ?? null;
/** Política de apertura de las consultas de listas de v8 (engine.v8 V8-D): por puesto, ≤2 por sitio, N por consulta. */
export function listUrlsToOpen(rows, { perQuery = CFG.lists.fetch_per_query, perHost = CFG.lists.max_per_host } = {}) {
  const out = [];
  for (const q of [...new Set(rows.map(r => r.query))]) {
    const n = new Map(); let k = 0;
    for (const r of rows.filter(x => x.query === q).sort((a, b) => a.rank - b.rank)) {
      const h = host(r.url); if (!h || denied(h) || out.includes(r.url)) continue;
      if ((n.get(h) ?? 0) >= perHost) continue; n.set(h, (n.get(h) ?? 0) + 1);
      out.push(r.url); if (++k >= perQuery) break;
    }
  }
  return out;
}
export const expectedExaUnits = () => ALL.length * units(CFG.names.exa);
/** Regla pre-registrada (V9-PREREGISTRO.md §3). rows: por caso {case, sel, acc_exa, acc_serper, exa_top10}. */
export function decide(rows) {
  const A = rows.filter(r => CASES_A.includes(r.case)), B = rows.filter(r => CASES_B.includes(r.case));
  const pass = (rs, p) => rs.filter(r => r.sel && r[`acc_${p}`]).length;
  const exaMissing = rows.filter(r => !r.exa_top10).length;
  const out = { exa_gold_missing_top10: exaMissing, limit_is_exa: exaMissing >= 4, A_selected_k: A.filter(r => r.sel).length, B_selected_k: B.filter(r => r.sel).length,
    A_pass_exa: pass(A, 'exa'), B_pass_exa: pass(B, 'exa'), A_pass_serper: pass(A, 'serper'), B_pass_serper: pass(B, 'serper') };
  out.go_L128_serper = out.A_pass_serper >= 4 && out.B_pass_serper >= 4;
  out.verdict = out.go_L128_serper ? 'GO condicional: L128 con resolución por Serper (requiere aprobar ese gasto antes de la corrida formal)' : 'NO-GO';
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
  const CAP = Number(arg('cap-usd') ?? CFG.caps.exa_usd), DRY = process.argv.includes('--dry-run'), STOP = arg('stop-file') ? resolve(arg('stop-file')) : resolve(OUT_DIR, '.stop');
  const capUnits = Math.floor(CAP / USD_PER_UNIT + 1e-9), exp = expectedExaUnits();
  const plan = { cap_usd: CAP, cap_units: capUnits, exa_units_expected: exp, exa_usd_expected: +(exp * USD_PER_UNIT).toFixed(3), serper_queries: ALL.length, llm_calls_max: CFG.caps.llm_calls, fetches_max: CFG.caps.fetches,
    queries: Object.fromEntries(ALL.map(c => [c, resolutionQuery(GOLD_QUERY_NAME[c], CFG.resolution.suffix, { stripTail: CFG.resolution.strip_type_tail })])),
    list_urls: Object.fromEntries(ALL.map(c => [c, listUrlsToOpen(diagListRows(c)).length])) };
  if (DRY) { console.log(JSON.stringify({ dry_run: true, ...plan }, null, 1)); process.exit(plan.exa_usd_expected <= CAP ? 0 : 4); }
  if (existsSync(resolve(OUT_DIR, 'result.json'))) { console.log(`ya ejecutado: ${resolve(OUT_DIR, 'result.json')} (no se vuelve a llamar a Exa)`); process.exit(0); }
  if (plan.exa_usd_expected > CAP) { console.error(`costo esperado ${plan.exa_usd_expected} > tope ${CAP}`); process.exit(4); }
  mkdirSync(OUT_DIR, { recursive: true });
  const { createLayeredCache } = await import('../../cache-layers.v7.mjs');
  const { createFetchTool } = await import('../../../../agent/tools/fetch.mjs');
  const { createInvestorLlm } = await import('../../external.mjs');
  const { createLiveInvestorDepsV7 } = await import('../../external.v7.mjs');
  const { loadInvestorPrompt } = await import('../../prompts.mjs');
  const cache = createLayeredCache({ primary: { path: resolve(OUT_DIR, 'cache.sqlite'), namespace: 'investors-v9-diagnostico' }, readLayers: CFG.cache_layers.map(l => ({ path: resolve(INV, l.path), namespace: l.namespace })) });
  const ev = row => appendFileSync(resolve(OUT_DIR, 'events.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), ...row })}\n`);
  const paidSoFar = () => { const f = resolve(OUT_DIR, 'events.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).reduce((a, l) => { const e = JSON.parse(l); return a + (e.event === 'search_end' ? (e.attempts ?? []).filter(x => x.provider === 'exa' && !x.cached).length : 0); }, 0) : 0; };
  let spent = paidSoFar(), llmCalls = 0, fetches = 0, exaCostReported = (() => { const f = resolve(OUT_DIR, 'events.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).reduce((a, l) => { const e = JSON.parse(l); return a + (e.event === 'search_end' ? Number(e.exa_cost_usd) || 0 : 0); }, 0) : 0; })();   // tope: el mayor de medidor (0.0089/unidad) y costDollars de Exa
  const halt = (code, msg) => { writeFileSync(STOP, `${msg}\n`); try { cache.close(); } catch {} writeFileSync(resolve(OUT_DIR, 'result-incompleto.json'), `${JSON.stringify({ stopped: msg, spent_units: spent }, null, 1)}\n`); console.error(msg); process.exit(code); };
  // Exa con caché propia (kind exa_v8 en la caché de esta carpeta).
  const { createBenchCache } = await import('../../../../agent/cache.mjs');
  const exaCache = createBenchCache({ path: resolve(OUT_DIR, 'exa.sqlite'), namespace: 'v9-diagnostico' });
  const mockFetch = k => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ results: [{ url: 'https://www.linkedin.com/company/x', title: 'x' }, { url: `https://${k.gold.domain}/`, title: 'home' }], costDollars: { total: 0.012 } }) });
  const serperKey = MOCK ? 'mock' : String(process.env.SERPER_API_KEY ?? '').trim();
  let serperOff = serperKey ? null : 'SERPER_API_KEY ausente';
  async function serper(q) {
    const hit = exaCache.get('serper_v9', q); if (hit) return { rows: hit.value, cached: true, error: null };
    if (serperOff) return { rows: [], cached: false, error: serperOff };
    try {
      const r = await (MOCK ? async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ organic: [{ link: 'https://shizune.co/x', title: 'x' }] }) }) : fetch)('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ q, num: CFG.names.serper.num }), signal: AbortSignal.timeout(30000) });
      const t = await r.text(); if (!r.ok) { if ([401, 402, 403, 429].includes(r.status)) serperOff = `Serper HTTP ${r.status}`; return { rows: [], cached: false, error: `Serper HTTP ${r.status}` }; }
      const rows = (JSON.parse(t).organic ?? []).slice(0, CFG.names.serper.num).map((x, i) => ({ rank: i + 1, url: x.link, title: x.title ?? '', text: x.snippet ?? '' }));
      exaCache.put('serper_v9', q, rows, {}); return { rows, cached: false, error: null };
    } catch (e) { return { rows: [], cached: false, error: `Serper ${String(e.message).slice(0, 120)}` }; }
  }
  const config = { ...JSON.parse(readFileSync(resolve(INV, 'config', CFG.base_config), 'utf8')), extraction_schema: CFG.extraction_schema, extractor_max_tokens: CFG.extractor_max_tokens, extractor_impl: CFG.extractor_impl, resolution: { enabled: true, per_query: 1, max_per_run: 1, suffix: CFG.resolution.suffix } };
  const fetchTool = MOCK ? { fetch: async url => ({ ok: true, cached: false, title: url, text: `Mock page for ${url}. `.repeat(20) }) } : createFetchTool({ env: process.env, cache });
  const llm = createInvestorLlm({ env: process.env, cache, family: config.agent_model.family });
  const P = n => loadInvestorPrompt(n, config.prompts[n], { manifest: CFG.prompts.manifest });
  const liveDeps = () => createLiveInvestorDepsV7({ search: null, fetch: fetchTool, llm, plannerPrompt: P('planner'), extractorPrompt: P('extractor'), judgePrompt: P('judge'), config, seed: 0 });
  const deps = MOCK ? { extract: async ({ document }) => ({ entity: { canonical_name: GOLD_QUERY_NAME[ALL.find(c => document.url.includes(loadCase(c).gold.domain))] ?? 'Otra', aliases: [], official_domain: host(document.url), sources: [{ quote: 'mock' }] }, rejected_kind: null, tokens_nominal: 1, latency: { actual_ms: 1 } }) } : liveDeps();
  const doFetch = async url => { if (fetches >= CFG.caps.fetches) halt(3, `tope de descargas ${CFG.caps.fetches}`); const p = await fetchTool.fetch(url); if (!p.cached) fetches++; ev({ event: 'fetch_end', url, ok: p.ok !== false, text_chars: p.text?.length ?? 0, cached: p.cached ?? false }); return p; };
  const doExtract = async document => { if (llmCalls >= CFG.caps.llm_calls) halt(3, `tope de llamadas LLM ${CFG.caps.llm_calls}`); const x = await deps.extract({ document, today: config.today, firstSeen: { step: 0, search_index: 0, order: 0, query_id: null, origin: 'resolution' } }); if (x.tokens_nominal && x.latency?.actual_ms) llmCalls++; ev({ event: 'extract_end', url: document.url, accepted: Boolean(x.entity), rejected_kind: x.rejected_kind ?? null, official_domain: x.entity?.official_domain ?? null, quote: x.entity?.sources?.[0]?.quote?.slice(0, 200) ?? null }); return x; };
  const resolveWith = async (c, rows, matcher) => {
    const k = loadCase(c);
    const ctx = { deps: { search: async () => ({ results: rows }) }, config, canSearch: () => true, canFetch: () => true, remainingSearches: () => 1, onSearch: () => {}, denied, seenUrl: () => false,
      fetchPage: async url => { const p = await doFetch(url); return { ...p, text: p.text ?? '' }; }, extract: doExtract };
    const out = await resolveCandidateV9({ name: GOLD_QUERY_NAME[c], quote: null, domain_on_page: null }, ctx, { matcher, stripTail: CFG.resolution.strip_type_tail });
    return { outcome: out.outcome, url: out.url ?? null, gold: out.outcome === 'accepted' && sameSite(`https://${out.entity.official_domain}/`, k.gold.domain), entity_domain: out.entity?.official_domain ?? null };
  };
  const REPS = replicaRows();
  const rowsOut = [];
  for (const c of ALL) {
    if (existsSync(STOP)) halt(3, `parada activa: ${readFileSync(STOP, 'utf8').trim()}`);
    const k = loadCase(c), q = plan.queries[c], req = { query: q, ...CFG.names.exa };
    // N: Exa
    const willPay = !exaCache.get('exa_v8', (await import('../../exa-direct.v8.mjs')).exaKey(req));
    if (willPay && spent + units(req) > capUnits) halt(3, `tope: ${spent} + ${units(req)} > ${capUnits} unidades (US$ ${CAP})`);
    if (willPay && exaCostReported + 0.03 > CAP) halt(3, `tope por costDollars de Exa: US$ ${exaCostReported.toFixed(4)} (+0.03 de la siguiente) > ${CAP}`);
    const ex = await exaSearchV8(req, { cache: exaCache, ...(MOCK ? { env: { EXA_API_KEY: 'mock-key-0000' }, fetcher: mockFetch(k) } : {}) }); spent += ex.cached ? 0 : ex.units; exaCostReported += ex.exa_cost_usd ?? 0;
    ev({ event: 'search_end', run_id: `v9diag__${c}__name`, query: q, provider: 'exa', results: ex.rows.length, urls: ex.rows.map(r => r.url), attempts: spendAttempts(ex), units: ex.units, exa_cost_usd: ex.exa_cost_usd, error: ex.error });
    if (ex.error && ((ex.status && [401, 402, 403, 429].includes(ex.status)) || BALANCE_RE.test(ex.error))) halt(3, `Exa: error de saldo/autorización (${ex.error.slice(0, 80)}); se para`);
    if (ex.error) halt(1, `Exa: ${ex.error.slice(0, 120)}; se para (lo pagado queda en caché)`);
    // N: Serper
    const se = await serper(q); ev({ event: 'serper_end', run_id: `v9diag__${c}__name`, query: q, results: se.rows.length, urls: se.rows.map(r => r.url), cached: se.cached, error: se.error });
    const rank = rows => { const i = rows.findIndex(r => sameSite(r.url, k.gold.domain)); return i < 0 ? null : i + 1; };
    const nm = GOLD_QUERY_NAME[c];
    const row = { case: c, gold: k.gold.domain, query: q, exa_rank: rank(ex.rows), serper_rank: se.error ? 'n/a' : rank(se.rows), exa_cost_usd: ex.exa_cost_usd, serper_error: se.error,
      exa_pick_v8: host(pick(ex.rows, nm, nameMatchesDomain)?.url), exa_pick_v9: host(pick(ex.rows, nm, nameMatchesDomainV9)?.url), serper_pick_v9: se.error ? null : host(pick(se.rows, nm, nameMatchesDomainV9)?.url) };
    row.exa_top10 = row.exa_rank != null;
    // S: resolución completa (descarga + extractor v7) con cada proveedor, y la URL oficial del ancla
    const rx = await resolveWith(c, ex.rows, nameMatchesDomainV9), rs = se.error ? { outcome: 'n/a', gold: false } : await resolveWith(c, se.rows, nameMatchesDomainV9);
    const anchor = k.gold && JSON.parse(readFileSync(resolve(INV, `cases/inv-case-syn-${c}.json`), 'utf8')).anchors[0].official_url;
    const ra = await resolveWith(c, [{ url: anchor, title: '' }], () => true);
    Object.assign(row, { exa_resolution: rx.outcome, exa_resolution_url: rx.url, acc_exa: rx.gold, serper_resolution: rs.outcome, serper_resolution_url: rs.url ?? null, acc_serper: rs.gold, anchor_url: anchor, anchor_outcome: ra.outcome, acc_anchor: ra.gold });
    // L: páginas de listas completas y puesto del oro (sin Exa)
    if (CASES_A.includes(c)) {
      const reps = REPS.filter(r => r.case === c);
      Object.assign(row, { list_source: 'v8_replicas', gold_rank: reps.map(r => r.rank ?? '—').join('/'), sel: reps.filter(r => r.rank && r.rank <= CFG.lists.cupo_k).length >= 2 });
    } else {
      const urls = listUrlsToOpen(diagListRows(c)), pages = [];
      for (const u of urls) { const p = await doFetch(u); if ((p.text ?? '').length >= 200) pages.push({ url: u, text: p.text }); }
      const ranked = rankVariant(pages, CFG.lists.rank_mode, { extraGeneric: [k.fields.sector, ...(k.fields.subsectors ?? []), ...(k.fields.target_markets ?? [])] });
      const gi = ranked.findIndex(r => isGold(c, r.key));
      Object.assign(row, { list_source: 'diag_urls', list_urls: urls.length, list_pages: pages.length, list_names: ranked.length, gold_rank: gi < 0 ? null : gi + 1, sel: gi >= 0 && gi < CFG.lists.cupo_k });
    }
    rowsOut.push(row); console.log(JSON.stringify(row));
  }
  cache.close(); exaCache.close();
  const out = { executed_at: new Date().toISOString(), cap_usd: CAP, paid_units: spent, usd_at_0_0089: +(spent * USD_PER_UNIT).toFixed(3), exa_cost_usd_reported: +rowsOut.reduce((a, r) => a + (r.exa_cost_usd ?? 0), 0).toFixed(4), llm_calls: llmCalls, fetches, decision: decide(rowsOut), rows: rowsOut };
  writeFileSync(resolve(OUT_DIR, 'result.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify({ paid_units: out.paid_units, usd: out.usd_at_0_0089, exa_cost_usd_reported: out.exa_cost_usd_reported, llm_calls: llmCalls, fetches, decision: out.decision }));
}
