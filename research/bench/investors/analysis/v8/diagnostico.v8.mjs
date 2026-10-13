#!/usr/bin/env node
// V8 (PROMPT-v10) paso 1: diagnóstico de alcanzabilidad del oro por variante. Regla y cifras en docs/handoff/V8-PREREGISTRO.md.
// Fase A (p01–p06): todas las variantes. Regla de elección aplicada en el propio script. Fase B (p07–p12): base + variantes elegidas.
// Solo Exa (llamada directa, exa-direct.v8.mjs). Tope: --cap-usd (2) en unidades de 0.0089 USD; antes de cada llamada no
// cacheada se comprueba que no se pasa. Error de saldo/autorización (401/402/403/429, credits, balance, quota) o 3 errores
// seguidos: crea el archivo de parada y sale con código 3 sin result.json. Reanudable: lo ya pagado sale de la caché.
// Uso (desde research/): node --env-file=.env bench/investors/analysis/v8/diagnostico.v8.mjs [--dry-run] [--cap-usd 2] [--stop-file f]
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exaSearchV8, exaKey, spendAttempts, units, USD_PER_UNIT, BALANCE_RE } from '../../exa-direct.v8.mjs';
import { CASES_A, CASES_B, INV, loadCase, shortQueries, longQueries, companyQuery, investorsOfQuery, listQueries, companyName, sameSite, nameIn, host } from './queries.v8.mjs';

export const OUT_DIR = resolve(INV, 'out/v8-diagnostico-2026-10-12');
// Parámetros de cada tipo de llamada (fijados en el pre-registro).
export const REQ = {
  short: { numResults: 50 },                                   // base (≤10) y b (≤30, ≤50)
  cat: { numResults: 25, category: 'company' },                // a (≤10, ≤25)
  long: { numResults: 25 },                                    // e (≤10, ≤25)
  c1: { numResults: 10, category: 'company' },                 // c paso 1: empresas parecidas
  c2: { numResults: 10, textChars: 3000 },                     // c paso 2: inversores de cada empresa
  list: { numResults: 10, textChars: 10000 }                   // d: páginas de listas
};
export const C_COMPANIES = 3;
export const VARIANTS = ['base10', 'b30', 'b50', 'a10', 'a25', 'e10', 'e25', 'c', 'd'];
const NEEDS = { base10: ['short'], b30: ['short'], b50: ['short'], a10: ['cat'], a25: ['cat'], e10: ['long'], e25: ['long'], c: ['c1', 'c2'], d: ['list'] };
const PAIRS = [['b30', 'b50'], ['a10', 'a25'], ['e10', 'e25']];   // si empatan, se queda la ventana menor (más barata)

/** Llamadas fijas de un caso por tipo (c2 depende de c1 y se arma en ejecución). */
export function staticCalls(kase, kinds) {
  const f = kase.fields, out = [];
  if (kinds.has('short')) for (const q of shortQueries(f)) out.push({ kind: 'short', query: q });
  if (kinds.has('cat')) for (const q of shortQueries(f)) out.push({ kind: 'cat', query: q });
  if (kinds.has('long')) for (const q of longQueries(f)) out.push({ kind: 'long', query: q });
  if (kinds.has('c1')) out.push({ kind: 'c1', query: companyQuery(f) });
  if (kinds.has('list')) for (const q of listQueries(f)) out.push({ kind: 'list', query: q });
  return out;
}
/** Empresas para c paso 2: comparables del perfil primero, luego las de c paso 1; nunca el oro. */
export function pickCompanies(kase, c1rows) {
  const out = [], seen = new Set();
  const add = (name, dom) => { const k = (dom ?? name).toLowerCase(); if (!name || seen.has(k) || out.length >= C_COMPANIES) return; if (nameIn(name, kase.gold.aliases) || (dom && dom === kase.gold.domain)) return; seen.add(k); out.push(name); };
  for (const n of kase.fields.comparable_companies ?? []) add(n, null);
  for (const r of c1rows ?? []) add(companyName(r), host(r.url));
  return out;
}
export const expectedUnits = (kinds, nCases) => { const k = new Set(kinds); let u = 0; for (const [kind, n] of [['short', 3], ['cat', 3], ['long', 3], ['c1', 1], ['list', 2]]) if (k.has(kind)) u += n * units(REQ[kind]); if (k.has('c2')) u += C_COMPANIES * units(REQ.c2); return u * nCases; };
export const kindsFor = vs => new Set(vs.flatMap(v => NEEDS[v]));

/** ¿Alcanza la variante el oro en un caso? reached (métrica de la regla) y domain (solo dominio). */
export function reachCase(calls, variant) {
  const by = k => calls.filter(c => c.kind === k), win = (k, n) => by(k).some(c => c.gold_rank && c.gold_rank <= n);
  switch (variant) {
    case 'base10': return { domain: win('short', 10), reached: win('short', 10) };
    case 'b30': return { domain: win('short', 30), reached: win('short', 30) };
    case 'b50': return { domain: win('short', 50), reached: win('short', 50) };
    case 'a10': return { domain: win('cat', 10), reached: win('cat', 10) };
    case 'a25': return { domain: win('cat', 25), reached: win('cat', 25) };
    case 'e10': return { domain: win('long', 10), reached: win('long', 10) };
    case 'e25': return { domain: win('long', 25), reached: win('long', 25) };
    case 'c': { const d = [...by('c1'), ...by('c2')].some(c => c.gold_rank); return { domain: d, reached: d || by('c2').some(c => c.name_hit) }; }
    case 'd': { const d = by('list').some(c => c.gold_rank); return { domain: d, reached: d || by('list').some(c => c.name_hit) }; }
  }
}
export function summarize(calls, cases, variants) {
  return Object.fromEntries(variants.map(v => {
    const per = Object.fromEntries(cases.map(c => [c, reachCase(calls.filter(x => x.case === c), v)]));
    return [v, { cases_reached: cases.filter(c => per[c].reached).length, cases_reached_domain: cases.filter(c => per[c].domain).length, per_case: per }];
  }));
}
/** Regla del pre-registro. Fase A: elegida si alcanza ≥ base10 + 2 casos. Fase B: confirmada si alcanza ≥ base10 + 1 casos. */
export function choose(sumA) {
  const base = sumA.base10.cases_reached;
  let sel = VARIANTS.filter(v => v !== 'base10' && sumA[v] && sumA[v].cases_reached >= base + 2);
  for (const [small, big] of PAIRS) if (sel.includes(small) && sel.includes(big) && sumA[small].cases_reached >= sumA[big].cases_reached) sel = sel.filter(v => v !== big);
  return sel;
}
export const confirm = (sumB, selected) => selected.filter(v => sumB[v] && sumB[v].cases_reached >= sumB.base10.cases_reached + 1);

function paidUnitsSoFar(dir) {
  const f = resolve(dir, 'events.jsonl'); if (!existsSync(f)) return 0;
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).reduce((a, l) => { try { const e = JSON.parse(l); return a + (e.event === 'search_end' ? (e.attempts ?? []).filter(x => x.provider === 'exa' && !x.cached).length : 0); } catch { return a; } }, 0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
  const CAP = Number(arg('cap-usd') ?? 2), DRY = process.argv.includes('--dry-run'), STOP = arg('stop-file') ? resolve(arg('stop-file')) : resolve(OUT_DIR, '.stop');
  const capUnits = Math.floor(CAP / USD_PER_UNIT + 1e-9);
  const allKinds = kindsFor(VARIANTS);
  const uA = expectedUnits(allKinds, CASES_A.length), uBmax = expectedUnits(allKinds, CASES_B.length), uBmin = expectedUnits(kindsFor(['base10']), CASES_B.length);
  const plan = { cap_usd: CAP, cap_units: capUnits, usd_per_unit: USD_PER_UNIT, phase_A: { cases: CASES_A, units: uA, usd: +(uA * USD_PER_UNIT).toFixed(3) }, phase_B: { cases: CASES_B, units_min: uBmin, units_max: uBmax, usd_min: +(uBmin * USD_PER_UNIT).toFixed(3), usd_max: +(uBmax * USD_PER_UNIT).toFixed(3) }, total_usd_max: +((uA + uBmax) * USD_PER_UNIT).toFixed(3), requests: REQ };
  if (DRY) {
    const queries = Object.fromEntries([...CASES_A, ...CASES_B].map(c => { const k = loadCase(c); return [c, { gold_domain: k.gold.domain, calls: staticCalls(k, allKinds).map(x => `${x.kind}: ${x.query}`), c2_companies_from_profile: (k.fields.comparable_companies ?? []).length }]; }));
    console.log(JSON.stringify({ dry_run: true, already_paid_units: paidUnitsSoFar(OUT_DIR), ...plan, queries }, null, 1));
    process.exit(plan.total_usd_max <= CAP ? 0 : 4);
  }
  if (existsSync(resolve(OUT_DIR, 'result.json'))) { console.log(`ya ejecutado: ${resolve(OUT_DIR, 'result.json')} (no se vuelve a llamar a Exa)`); process.exit(0); }
  if (plan.total_usd_max > CAP) { console.error(`costo máximo ${plan.total_usd_max} > tope ${CAP}: no se ejecuta`); process.exit(4); }
  mkdirSync(OUT_DIR, { recursive: true });
  const { createBenchCache } = await import('../../../../agent/cache.mjs');
  const cache = createBenchCache({ path: resolve(OUT_DIR, 'cache.sqlite'), namespace: 'v8-diagnostico' });
  let spent = paidUnitsSoFar(OUT_DIR), consecutive = 0, errors = 0;
  const calls = [];
  const halt = (code, msg) => { writeFileSync(STOP, `${msg}\n`); cache.close(); writeFileSync(resolve(OUT_DIR, 'result-incompleto.json'), `${JSON.stringify({ stopped: msg, spent_units: spent, usd: +(spent * USD_PER_UNIT).toFixed(3), calls }, null, 1)}\n`); console.error(msg); process.exit(code); };
  async function run(kase, phase, call) {
    if (existsSync(STOP)) halt(3, `parada activa: ${readFileSync(STOP, 'utf8').trim()}`);
    const req = { query: call.query, ...REQ[call.kind] };
    const willPay = !cache.get('exa_v8', exaKey(req));
    if (willPay && spent + units(req) > capUnits) halt(3, `tope: ${spent} unidades pagadas + ${units(req)} > ${capUnits} (US$ ${CAP})`);
    const res = await exaSearchV8(req, { cache });
    spent += res.cached ? 0 : res.units;
    const gi = res.rows.findIndex(r => sameSite(r.url, kase.gold.domain));
    const rec = { case: kase.case, phase, kind: call.kind, company: call.company ?? null, query: call.query, request: REQ[call.kind], cached: res.cached, units: res.units, usd: +(res.units * USD_PER_UNIT).toFixed(4), nominal_usd: res.nominal_usd, exa_cost_usd: res.exa_cost_usd, results: res.rows.length, gold_rank: gi < 0 ? null : gi + 1, gold_url: gi < 0 ? null : res.rows[gi].url, name_hit: REQ[call.kind].textChars ? res.rows.some(r => nameIn(`${r.title}\n${r.text}`, kase.gold.aliases)) : null, name_hit_urls: REQ[call.kind].textChars ? res.rows.filter(r => nameIn(`${r.title}\n${r.text}`, kase.gold.aliases)).map(r => r.url) : [], error: res.error, top: res.rows.slice(0, 50).map(r => ({ rank: r.rank, url: r.url, title: r.title.slice(0, 120) })) };
    appendFileSync(resolve(OUT_DIR, 'events.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), event: 'search_end', run_id: `v8diag__${kase.case}__${call.kind}`, query: call.query, request: REQ[call.kind], results: res.rows.length, urls: res.rows.map(r => r.url), attempts: spendAttempts(res), units: res.units, nominal_usd: res.nominal_usd, exa_cost_usd: res.exa_cost_usd, error: res.error })}\n`);
    calls.push(rec);
    if (res.error) { errors++; consecutive++; if ((res.status && [401, 402, 403, 429].includes(res.status)) || BALANCE_RE.test(res.error)) halt(3, `Exa: error de saldo/autorización (${res.error.slice(0, 80)}); se para`); if (consecutive >= 3) halt(3, 'Exa: 3 errores seguidos; se para'); }
    else consecutive = 0;
    return res;
  }
  async function runCase(c, phase, kinds) {
    const kase = loadCase(c);
    for (const call of staticCalls(kase, kinds)) {
      const res = await run(kase, phase, call);
      if (call.kind === 'c1' && kinds.has('c2')) for (const company of pickCompanies(kase, res.rows)) await run(kase, phase, { kind: 'c2', query: investorsOfQuery(kase.fields, company), company });
    }
  }
  for (const c of CASES_A) await runCase(c, 'A', allKinds);
  const sumA = summarize(calls.filter(x => x.phase === 'A'), CASES_A, VARIANTS), selected = choose(sumA);
  const kindsB = kindsFor(['base10', ...selected]);
  for (const c of CASES_B) await runCase(c, 'B', kindsB);
  const sumB = summarize(calls.filter(x => x.phase === 'B'), CASES_B, ['base10', ...selected]), confirmed = confirm(sumB, selected);
  cache.close();
  const out = { executed_at: new Date().toISOString(), cap_usd: CAP, paid_units: calls.reduce((a, x) => a + (x.cached ? 0 : x.units), 0), usd_at_0_0089: +(calls.reduce((a, x) => a + (x.cached ? 0 : x.units), 0) * USD_PER_UNIT).toFixed(3), exa_cost_usd_reported: +calls.reduce((a, x) => a + x.exa_cost_usd, 0).toFixed(4), nominal_usd: +calls.reduce((a, x) => a + (x.cached ? 0 : x.nominal_usd), 0).toFixed(4), errors, summary_A: sumA, selected_A: selected, summary_B: sumB, confirmed_B: confirmed, calls };
  if (errors) { writeFileSync(resolve(OUT_DIR, 'result-incompleto.json'), `${JSON.stringify(out, null, 1)}\n`); console.error(`INCOMPLETO: ${errors} llamadas con error; se puede repetir (lo pagado sale de la caché)`); process.exit(1); }
  writeFileSync(resolve(OUT_DIR, 'result.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify({ paid_units: out.paid_units, usd: out.usd_at_0_0089, selected_A: selected, confirmed_B: confirmed, A: Object.fromEntries(Object.entries(sumA).map(([k, v]) => [k, v.cases_reached])), B: Object.fromEntries(Object.entries(sumB).map(([k, v]) => [k, v.cases_reached])) }));
}
