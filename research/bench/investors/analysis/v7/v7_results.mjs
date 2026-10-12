#!/usr/bin/env node
// Informe comparativo v7 frente a v5 con las métricas y la regla de V7-PREREGISTRO.md (fijadas antes de gastar). Solo cifras.
// Línea base: corridas v5 B2 de p01–p06 variante A, semillas 101/202/303 en investors-internal-2026-10-09-v5-pairs
// (p01 s101 reutilizada de quick-v5-2026-10-09). Brazo: <out v7>, mismas etiquetas de réplica. Sin red ni LLM.
// Uso (desde research/): node bench/investors/analysis/v7/v7_results.mjs --v7 <out v7> [--check <v5_check.json>] [--md f] [--json f]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeUrl } from '../../../../agent/docs.mjs';
import { isLiteralEvidence } from '../../extractor.mjs';
import { openReadOnlyCache } from '../../cache-layers.v7.mjs';
import { loadRuns, DIRS, READ_LAYERS, readEvents, lastAttempts, median, loadLabels, investorGain } from './common.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const V7 = arg('v7') ? resolve(arg('v7')) : null;
const CASES = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06'], SEEDS = [101, 202, 303], RATE = 0.0089;
const L = loadLabels();

function textIndex(layers) {
  const fetchText = new Map(), searchText = new Map();
  for (const l of layers) {
    for (const r of l.all('fetch')) if (r.value?.text && !fetchText.has(r.key)) fetchText.set(r.key, r.value.text);
    for (const r of l.all('search')) for (const row of r.value ?? []) if (row.text) { const k = normalizeUrl(row.url); if (!searchText.has(k)) searchText.set(k, []); searchText.get(k).push(row.text); }
  }
  return url => { const k = normalizeUrl(url); return [fetchText.get(k), ...(searchText.get(k) ?? [])].filter(Boolean).join('\n␞\n'); };
}
function metrics(run, textFor) {
  const r = run.r, ev = run.ev, labelCase = `inv-case-syn-${run.case}`;
  const ids = [...new Set(r.entities.map(e => e.stable_id))];
  const gain2 = ids.filter(id => { const l = L.get(`${labelCase}|${id}`); return l && investorGain(l) >= 2; }).length;
  const verified = r.entities.filter(e => e.sources.some(s => s.quote && isLiteralEvidence(textFor(s.url), s.quote))).length;
  const se = ev.filter(e => e.event === 'search_end'), fe = ev.filter(e => e.event === 'fetch_end'), ex = ev.filter(e => e.event === 'extract_end');
  return {
    run_id: r.run_id, case: run.case, seed: run.seed, stop_reason: r.stop_reason, firms: ids.length, gain2_labeled: gain2, labeled: ids.filter(id => L.has(`${labelCase}|${id}`)).length,
    firms_verified_quote: verified, searches_discovery: r.totals.searches, searches_deepening: r.v2_stats?.deepening?.searches ?? 0, searches_all_events: se.length,
    fetches_events: fe.length, exa_paid: se.reduce((a, e) => a + (e.attempts ?? []).filter(x => x.provider === 'exa' && !x.cached).length, 0),
    fetch_empty: fe.filter(e => !e.ok || (e.text_chars ?? 0) < 200).length, rejected_quote: ex.filter(e => ['missing_literal_quote', 'identity_not_in_quote'].includes(e.rejected_kind)).length,
    stop_rejected: ev.filter(e => e.event === 'planner_stop_rejected').length, fetch_skipped_domain: ev.filter(e => e.event === 'fetch_skipped_domain').length, ids
  };
}
const arm = (dir, filter, layers) => { const tf = textIndex(layers); return loadRuns(dir).filter(filter).map(run => metrics(run, tf)); };
const v5Layers = READ_LAYERS.slice(0, 3).map(openReadOnlyCache);
const base = arm(DIRS.pairs, r => r.cond === 'B2' && r.variant === 'A' && CASES.includes(r.case) && SEEDS.includes(r.seed), v5Layers);
const v7Layers = V7 && existsSync(resolve(V7, 'cache.sqlite')) ? [openReadOnlyCache({ path: resolve(V7, 'cache.sqlite'), namespace: 'investors-investors-internal-2026-10-12-v7' })] : [];
const v7 = V7 ? arm(V7, r => r.cond === 'B2' && r.variant === 'A' && CASES.includes(r.case) && SEEDS.includes(r.seed), v7Layers) : [];
const jac = (a, b) => { const A = new Set(a), B = new Set(b); const u = new Set([...A, ...B]).size; return u ? [...A].filter(x => B.has(x)).length / u : 1; };
const KEYS = ['gain2_labeled', 'firms_verified_quote', 'firms', 'searches_discovery', 'searches_deepening', 'fetches_events', 'exa_paid', 'fetch_empty', 'rejected_quote'];
const perCase = rows => Object.fromEntries(CASES.map(c => { const rs = rows.filter(r => r.case === c); const o = { runs: rs.length };
  for (const k of KEYS) { const xs = rs.map(r => r[k]); o[k] = { median: median(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null }; }
  const pairs = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) pairs.push(jac(rs[i].ids, rs[j].ids)); o.jaccard_between_replicates = { median: median(pairs), min: pairs.length ? Math.min(...pairs) : null, max: pairs.length ? Math.max(...pairs) : null };
  return [c, o]; }));
const B = perCase(base), V = perCase(v7);
// Regla de decisión (V7-PREREGISTRO.md §2, fijada antes de gastar).
const check = arg('check') && existsSync(resolve(arg('check'))) ? JSON.parse(readFileSync(resolve(arg('check')), 'utf8')) : null;
const citations100 = check ? check.summary?.citations_verified_pct === 100 : null;
const casesComplete = CASES.filter(c => V[c].runs === 3).length;
const rule = k => { const sumB = CASES.reduce((a, c) => a + (B[c][k].median ?? 0), 0), sumV = CASES.reduce((a, c) => a + (V[c][k].median ?? 0), 0);
  const geq = CASES.filter(c => V[c].runs && (V[c][k].median ?? 0) >= (B[c][k].median ?? 0)).length, gt = CASES.filter(c => V[c].runs && (V[c][k].median ?? 0) > (B[c][k].median ?? 0)).length, lt = CASES.filter(c => V[c].runs && (V[c][k].median ?? 0) < (B[c][k].median ?? 0)).length;
  return { sum_medians_v5: sumB, sum_medians_v7: sumV, cases_v7_geq: geq, cases_v7_gt: gt, cases_v7_lt: lt, improves: sumV > sumB && geq >= 4, worsens: sumV < sumB && lt >= 4 }; };
const r1 = rule('gain2_labeled'), r2 = rule('firms_verified_quote');
const verdict = !V7 || !v7.length ? 'SIN DATOS v7' : casesComplete < 6 ? `INCOMPLETA (${casesComplete}/6 casos con 3 réplicas)` : citations100 === false ? 'NO VÁLIDA (citas verificadas < 100%)'
  : r1.improves && !r2.worsens ? 'MEJORA' : r2.improves && !r1.improves && !r1.worsens ? 'MEJORA SOLO EN M2 (volumen con cita)' : (r1.worsens || r2.worsens) && !r1.improves ? 'EMPEORA' : 'SIN CAMBIO';
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0), mean = (rows, k) => rows.length ? +(sum(rows, k) / rows.length).toFixed(2) : null;
const totals = rows => ({ runs: rows.length, ...Object.fromEntries(KEYS.map(k => [k, { total: sum(rows, k), per_run_mean: mean(rows, k), per_run_median: median(rows.map(r => r[k])) }])), exa_usd_at_0_0089: +(sum(rows, 'exa_paid') * RATE).toFixed(3), stop_reason: rows.reduce((a, r) => (a[r.stop_reason] = (a[r.stop_reason] ?? 0) + 1, a), {}), stop_rejected: sum(rows, 'stop_rejected'), fetch_skipped_domain: sum(rows, 'fetch_skipped_domain'), unique_firms: new Set(rows.flatMap(r => r.ids.map(id => `${r.case}|${id}`))).size, unlabeled_unique_firms: new Set(rows.flatMap(r => r.ids.filter(id => !L.has(`inv-case-syn-${r.case}|${id}`)).map(id => `${r.case}|${id}`))).size });
const out = { baseline: 'v5 B2 p01–p06 variante A s101/202/303 (investors-internal-2026-10-09-v5-pairs)', v7_dir: V7, citations_verified_pct_v7: check?.summary?.citations_verified_pct ?? null, verdict, rule_M1: r1, rule_M2: r2, totals_v5: totals(base), totals_v7: totals(v7), per_case_v5: B, per_case_v7: V, runs_v5: base.map(({ ids, ...x }) => x), runs_v7: v7.map(({ ids, ...x }) => x) };
for (const l of [...v5Layers, ...v7Layers]) l.close();
const r3 = x => x == null ? '—' : +Number(x).toFixed(3);
const fm = s => s == null ? '—' : `${r3(s.median)} (${r3(s.min)}-${r3(s.max)})`;
const md = [];
md.push('# V7 — Resultados (v7 frente a v5)', '', `Generado: ${new Date().toISOString()}. Métricas y regla de decisión de docs/handoff/V7-PREREGISTRO.md. Solo cifras.`, '',
  `Línea base: ${out.baseline}. Brazo v7: ${V7 ? V7.split('/research/').at(-1) : '—'}. Corridas válidas: v5 ${base.length}, v7 ${v7.length}.`, '',
  `Resultado de la regla: **${verdict}**. Citas verificadas v7 (v5_check): ${out.citations_verified_pct_v7 ?? 'sin dato'}%.`, '',
  '## Regla de decisión', '', '| Métrica | Suma de medianas v5 | Suma de medianas v7 | Casos v7 ≥ v5 | Casos v7 > v5 | Casos v7 < v5 | Mejora | Empeora |', '|---|---|---|---|---|---|---|---|',
  `| M1 firmas únicas con etiqueta gain>=2 | ${r1.sum_medians_v5} | ${r1.sum_medians_v7} | ${r1.cases_v7_geq} | ${r1.cases_v7_gt} | ${r1.cases_v7_lt} | ${r1.improves ? 'sí' : 'no'} | ${r1.worsens ? 'sí' : 'no'} |`,
  `| M2 firmas aceptadas con cita verificada | ${r2.sum_medians_v5} | ${r2.sum_medians_v7} | ${r2.cases_v7_geq} | ${r2.cases_v7_gt} | ${r2.cases_v7_lt} | ${r2.improves ? 'sí' : 'no'} | ${r2.worsens ? 'sí' : 'no'} |`, '',
  '## Por caso (mediana y rango sobre 3 réplicas)', '', '| Caso | M1 v5 | M1 v7 | M2 v5 | M2 v7 | Firmas v5 | Firmas v7 | Jaccard entre réplicas v5 | v7 |', '|---|---|---|---|---|---|---|---|---|');
for (const c of CASES) md.push(`| ${c} | ${fm(B[c].gain2_labeled)} | ${fm(V[c].gain2_labeled)} | ${fm(B[c].firms_verified_quote)} | ${fm(V[c].firms_verified_quote)} | ${fm(B[c].firms)} | ${fm(V[c].firms)} | ${fm(B[c].jaccard_between_replicates)} | ${fm(V[c].jaccard_between_replicates)} |`);
md.push('', '## Secundarias por caso (mediana y rango)', '', '| Caso | Búsquedas desc. v5 | v7 | Búsq. profundización v5 | v7 | Fetches v5 | v7 | Exa pagadas v5 | v7 | FETCH_EMPTY v5 | v7 | Rechazos por cita v5 | v7 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of CASES) md.push(`| ${c} | ${fm(B[c].searches_discovery)} | ${fm(V[c].searches_discovery)} | ${fm(B[c].searches_deepening)} | ${fm(V[c].searches_deepening)} | ${fm(B[c].fetches_events)} | ${fm(V[c].fetches_events)} | ${fm(B[c].exa_paid)} | ${fm(V[c].exa_paid)} | ${fm(B[c].fetch_empty)} | ${fm(V[c].fetch_empty)} | ${fm(B[c].rejected_quote)} | ${fm(V[c].rejected_quote)} |`);
const T5 = out.totals_v5, T7 = out.totals_v7;
md.push('', '## Totales', '', '| Concepto | v5 | v7 |', '|---|---|---|', `| Corridas | ${T5.runs} | ${T7.runs} |`, `| Firmas únicas caso-firma | ${T5.unique_firms} | ${T7.unique_firms} |`, `| De ellas sin etiqueta | ${T5.unlabeled_unique_firms} | ${T7.unlabeled_unique_firms} |`);
for (const k of KEYS) md.push(`| ${k} (total / media por corrida) | ${T5[k].total} / ${T5[k].per_run_mean} | ${T7[k].total} / ${T7[k].per_run_mean} |`);
md.push(`| Exa USD a 0.0089 por llamada pagada | ${T5.exa_usd_at_0_0089} | ${T7.exa_usd_at_0_0089} |`, `| stop_reason | ${JSON.stringify(T5.stop_reason)} | ${JSON.stringify(T7.stop_reason)} |`, `| Stops rechazados (C5) | ${T5.stop_rejected} | ${T7.stop_rejected} |`, `| Fetches saltados por dominio (C3) | ${T5.fetch_skipped_domain} | ${T7.fetch_skipped_domain} |`, '',
  'Notas: M1 solo cuenta firmas con etiqueta existente (adjudicator v3); las firmas nuevas sin etiqueta no suman a M1 y se cuentan aparte. Las semillas son etiquetas de réplica: el proveedor del LLM no aplica la semilla como control (H1).');
console.log(JSON.stringify({ verdict, rule_M1: r1, rule_M2: r2, runs_v5: base.length, runs_v7: v7.length }));
if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify(out, null, 1)}\n`);
if (arg('md')) writeFileSync(arg('md'), `${md.join('\n')}\n`);
