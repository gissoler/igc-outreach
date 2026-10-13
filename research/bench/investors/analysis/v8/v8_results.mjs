#!/usr/bin/env node
// Informe comparativo v8 frente a v7 (V8-PREREGISTRO.md §2, fijado antes de gastar). Solo cifras. Sin red ni LLM.
// O1 = el dominio del oro aparece en algún resultado de búsqueda de la corrida; O2 = el oro está entre las entidades aceptadas.
// M1/M2 = definiciones de V7-PREREGISTRO.md. Línea base: las 18 corridas B2 v7 (no se regeneran). Mediana y rango por caso.
// Uso (desde research/): node bench/investors/analysis/v8/v8_results.mjs --v8 <out v8> [--v7 <out v7>] [--check <v5_check.json>] [--md f] [--json f]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeUrl } from '../../../../agent/docs.mjs';
import { isLiteralEvidence } from '../../extractor.mjs';
import { openReadOnlyCache } from '../../cache-layers.v7.mjs';
import { loadRuns, OUT, readEvents, median, loadLabels, investorGain } from '../v7/common.mjs';
import { loadCase, sameSite, CASES_A } from './queries.v8.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const V8 = arg('v8') ? resolve(arg('v8')) : null, V7 = resolve(arg('v7') ?? resolve(OUT, 'investors-internal-2026-10-12-v7'));
const CASES = CASES_A, SEEDS = [101, 202, 303], RATE = 0.0089, L = loadLabels();
const GOLD = Object.fromEntries(CASES.map(c => [c, loadCase(c).gold.domain]));

function textIndex(layer) {
  const fetchText = new Map(), searchText = new Map();
  for (const r of layer.all('fetch')) if (r.value?.text && !fetchText.has(r.key)) fetchText.set(r.key, r.value.text);
  for (const r of layer.all('search')) for (const row of r.value ?? []) if (row.text) { const k = normalizeUrl(row.url); if (!searchText.has(k)) searchText.set(k, []); searchText.get(k).push(row.text); }
  return url => { const k = normalizeUrl(url); return [fetchText.get(k), ...(searchText.get(k) ?? [])].filter(Boolean).join('\n␞\n'); };
}
function metrics(run, textFor) {
  const r = run.r, ev = run.ev, labelCase = `inv-case-syn-${run.case}`, gold = GOLD[run.case];
  const ids = [...new Set(r.entities.map(e => e.stable_id))];
  const gain2 = ids.filter(id => { const l = L.get(`${labelCase}|${id}`); return l && investorGain(l) >= 2; }).length;
  const verified = r.entities.filter(e => e.sources.some(s => s.quote && isLiteralEvidence(textFor(s.url), s.quote))).length;
  const se = ev.filter(e => e.event === 'search_end'), fe = ev.filter(e => e.event === 'fetch_end'), ex = ev.filter(e => e.event === 'extract_end');
  const o1 = se.some(e => (e.urls ?? []).some(u => sameSite(u, gold))), o2 = ids.includes(`inv:domain:${gold}`);
  const lp = r.v2_stats?.list_phase ?? null;
  return { run_id: r.run_id, case: run.case, seed: run.seed, stop_reason: r.stop_reason, firms: ids.length, gain2_labeled: gain2, firms_verified_quote: verified, O1: o1 ? 1 : 0, O2: o2 ? 1 : 0,
    searches_discovery: r.totals.searches, searches_deepening: r.v2_stats?.deepening?.searches ?? 0, fetches_events: fe.length, exa_paid: se.reduce((a, e) => a + (e.attempts ?? []).filter(x => x.provider === 'exa' && !x.cached).length, 0),
    fetch_empty: fe.filter(e => !e.ok || (e.text_chars ?? 0) < 200).length, rejected_quote: ex.filter(e => ['missing_literal_quote', 'identity_not_in_quote'].includes(e.rejected_kind)).length,
    list_searches: lp?.searches ?? 0, list_fetches: lp?.fetches ?? 0, list_resolutions: lp?.resolutions ?? 0, list_entities: lp?.entities_found ?? 0, list_candidates: lp?.candidates_seen ?? 0, ids };
}
function arm(dir) {
  if (!dir || !existsSync(resolve(dir, 'cache.sqlite'))) return [];
  const bench = JSON.parse(readFileSync(resolve(dir, 'fingerprint.json'), 'utf8')).bench_id ?? null;
  const layer = openReadOnlyCache({ path: resolve(dir, 'cache.sqlite'), namespace: `investors-${bench}` }), tf = textIndex(layer);
  const rows = loadRuns(dir, [dir]).filter(r => r.cond === 'B2' && r.variant === 'A' && CASES.includes(r.case) && SEEDS.includes(r.seed)).map(run => metrics(run, tf)); layer.close(); return rows;
}
const v7 = arm(V7), v8 = arm(V8);
const KEYS = ['gain2_labeled', 'firms_verified_quote', 'firms', 'O1', 'O2', 'searches_discovery', 'searches_deepening', 'fetches_events', 'exa_paid', 'fetch_empty', 'rejected_quote', 'list_entities'];
const jac = (a, b) => { const A = new Set(a), B = new Set(b), u = new Set([...A, ...B]).size; return u ? [...A].filter(x => B.has(x)).length / u : 1; };
const perCase = rows => Object.fromEntries(CASES.map(c => { const rs = rows.filter(r => r.case === c), o = { runs: rs.length, O1_reps: rs.reduce((a, r) => a + r.O1, 0), O2_reps: rs.reduce((a, r) => a + r.O2, 0) };
  for (const k of KEYS) { const xs = rs.map(r => r[k]); o[k] = { median: median(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null }; }
  const p = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) p.push(jac(rs[i].ids, rs[j].ids)); o.jaccard = { median: median(p), min: p.length ? Math.min(...p) : null, max: p.length ? Math.max(...p) : null };
  return [c, o]; }));
const B = perCase(v7), V = perCase(v8);
const check = arg('check') && existsSync(resolve(arg('check'))) ? JSON.parse(readFileSync(resolve(arg('check')), 'utf8')) : null;
const citations100 = check ? check.summary?.citations_verified_pct === 100 : null, complete = CASES.filter(c => V[c].runs === 3).length;
const rule = k => { const sB = CASES.reduce((a, c) => a + (B[c][k].median ?? 0), 0), sV = CASES.reduce((a, c) => a + (V[c][k].median ?? 0), 0);
  const geq = CASES.filter(c => V[c].runs && (V[c][k].median ?? 0) >= (B[c][k].median ?? 0)).length, lt = CASES.filter(c => V[c].runs && (V[c][k].median ?? 0) < (B[c][k].median ?? 0)).length;
  return { sum_medians_v7: sB, sum_medians_v8: sV, cases_v8_geq: geq, cases_v8_lt: lt, improves: sV > sB && geq >= 4, worsens: sV < sB && lt >= 4 }; };
const m1 = rule('gain2_labeled'), m2 = rule('firms_verified_quote');
const casesO2 = rows => CASES.filter(c => rows[c].O2_reps >= 2).length, casesO1 = rows => CASES.filter(c => rows[c].O1_reps >= 2).length;
const g = { cases_O2_v7: casesO2(B), cases_O2_v8: casesO2(V), cases_O1_v7: casesO1(B), cases_O1_v8: casesO1(V), runs_O1_v7: v7.reduce((a, r) => a + r.O1, 0), runs_O1_v8: v8.reduce((a, r) => a + r.O1, 0), runs_O2_v7: v7.reduce((a, r) => a + r.O2, 0), runs_O2_v8: v8.reduce((a, r) => a + r.O2, 0) };
const verdict = !V8 || !v8.length ? 'SIN DATOS v8' : complete < 6 ? `INCOMPLETA (${complete}/6 casos con 3 réplicas)` : citations100 === false ? 'NO VÁLIDA (citas verificadas < 100%)'
  : g.cases_O2_v8 >= 2 && g.cases_O2_v8 > g.cases_O2_v7 && !m1.worsens && !m2.worsens ? 'MEJORA EN ORO' : g.cases_O1_v8 >= 2 && g.cases_O1_v8 > g.cases_O1_v7 ? 'SOLO ALCANCE (el oro aparece en resultados, no se acepta)' : 'SIN CAMBIO';
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0), mean = (rows, k) => rows.length ? +(sum(rows, k) / rows.length).toFixed(2) : null;
const totals = rows => ({ runs: rows.length, ...Object.fromEntries([...KEYS, 'list_searches', 'list_fetches', 'list_resolutions', 'list_candidates'].map(k => [k, { total: sum(rows, k), per_run_mean: mean(rows, k) }])), exa_usd_at_0_0089: +(sum(rows, 'exa_paid') * RATE).toFixed(3), stop_reason: rows.reduce((a, r) => (a[r.stop_reason] = (a[r.stop_reason] ?? 0) + 1, a), {}), unique_firms: new Set(rows.flatMap(r => r.ids.map(id => `${r.case}|${id}`))).size, unlabeled_unique_firms: new Set(rows.flatMap(r => r.ids.filter(id => !L.has(`inv-case-syn-${r.case}|${id}`)).map(id => `${r.case}|${id}`))).size });
const out = { baseline: 'v7 B2 p01–p06 variante A s101/202/303 (investors-internal-2026-10-12-v7)', v8_dir: V8, citations_verified_pct_v8: check?.summary?.citations_verified_pct ?? null, verdict, gold: g, rule_M1: m1, rule_M2: m2, totals_v7: totals(v7), totals_v8: totals(v8), per_case_v7: B, per_case_v8: V, runs_v8: v8.map(({ ids, ...x }) => x), runs_v7: v7.map(({ ids, ...x }) => x) };
const r3 = x => x == null ? '—' : +Number(x).toFixed(3), fm = s => s == null ? '—' : `${r3(s.median)} (${r3(s.min)}-${r3(s.max)})`;
const md = ['# V8 — Resultados (v8 frente a v7)', '', `Generado: ${new Date().toISOString()}. Métricas y regla de docs/handoff/V8-PREREGISTRO.md. Solo cifras.`, '',
  `Línea base: ${out.baseline}. Brazo v8: ${V8 ? V8.split('/research/').at(-1) : '—'}. Corridas válidas: v7 ${v7.length}, v8 ${v8.length}. Citas verificadas v8 (v5_check): ${out.citations_verified_pct_v8 ?? 'sin dato'}%.`, '',
  `Resultado de la regla: **${verdict}**.`, '', '## Objetivo: el oro', '', '| | v7 | v8 |', '|---|---|---|',
  `| Corridas con el dominio del oro en resultados (O1), de ${v8.length || 18} | ${g.runs_O1_v7} | ${g.runs_O1_v8} |`, `| Corridas con el oro aceptado (O2) | ${g.runs_O2_v7} | ${g.runs_O2_v8} |`,
  `| Casos con O1 en ≥ 2 de 3 réplicas | ${g.cases_O1_v7} | ${g.cases_O1_v8} |`, `| Casos con O2 en ≥ 2 de 3 réplicas | ${g.cases_O2_v7} | ${g.cases_O2_v8} |`, '',
  '| Caso | Oro | O1 v7 | O1 v8 | O2 v7 | O2 v8 |', '|---|---|---|---|---|---|', ...CASES.map(c => `| ${c} | ${GOLD[c]} | ${B[c].O1_reps}/3 | ${V[c].O1_reps}/3 | ${B[c].O2_reps}/3 | ${V[c].O2_reps}/3 |`), '',
  '## Regla de decisión M1/M2 (v8 frente a v7)', '', '| Métrica | Suma de medianas v7 | v8 | Casos v8 ≥ v7 | Casos v8 < v7 | Mejora | Empeora |', '|---|---|---|---|---|---|---|',
  `| M1 firmas únicas con etiqueta gain>=2 | ${m1.sum_medians_v7} | ${m1.sum_medians_v8} | ${m1.cases_v8_geq} | ${m1.cases_v8_lt} | ${m1.improves ? 'sí' : 'no'} | ${m1.worsens ? 'sí' : 'no'} |`,
  `| M2 firmas aceptadas con cita verificada | ${m2.sum_medians_v7} | ${m2.sum_medians_v8} | ${m2.cases_v8_geq} | ${m2.cases_v8_lt} | ${m2.improves ? 'sí' : 'no'} | ${m2.worsens ? 'sí' : 'no'} |`, '',
  '## Por caso (mediana y rango sobre 3 réplicas)', '', '| Caso | M1 v7 | M1 v8 | M2 v7 | M2 v8 | Firmas de la fase de listas v8 | Jaccard v7 | v8 |', '|---|---|---|---|---|---|---|---|',
  ...CASES.map(c => `| ${c} | ${fm(B[c].gain2_labeled)} | ${fm(V[c].gain2_labeled)} | ${fm(B[c].firms_verified_quote)} | ${fm(V[c].firms_verified_quote)} | ${fm(V[c].list_entities)} | ${fm(B[c].jaccard)} | ${fm(V[c].jaccard)} |`), '',
  '## Secundarias por caso (mediana y rango)', '', '| Caso | Búsq. desc. v7 | v8 | Fetches v7 | v8 | Exa pagadas v7 | v8 | FETCH_EMPTY v7 | v8 | Rechazos por cita v7 | v8 |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...CASES.map(c => `| ${c} | ${fm(B[c].searches_discovery)} | ${fm(V[c].searches_discovery)} | ${fm(B[c].fetches_events)} | ${fm(V[c].fetches_events)} | ${fm(B[c].exa_paid)} | ${fm(V[c].exa_paid)} | ${fm(B[c].fetch_empty)} | ${fm(V[c].fetch_empty)} | ${fm(B[c].rejected_quote)} | ${fm(V[c].rejected_quote)} |`)];
const T7 = out.totals_v7, T8 = out.totals_v8;
md.push('## Totales', '', '| Concepto | v7 | v8 |', '|---|---|---|', `| Corridas | ${T7.runs} | ${T8.runs} |`, `| Firmas únicas caso-firma | ${T7.unique_firms} | ${T8.unique_firms} |`, `| De ellas sin etiqueta | ${T7.unlabeled_unique_firms} | ${T8.unlabeled_unique_firms} |`);
for (const k of [...KEYS, 'list_searches', 'list_fetches', 'list_resolutions', 'list_candidates']) md.push(`| ${k} (total / media por corrida) | ${T7[k].total} / ${T7[k].per_run_mean} | ${T8[k].total} / ${T8[k].per_run_mean} |`);
md.push(`| Exa USD a 0.0089 por llamada pagada | ${T7.exa_usd_at_0_0089} | ${T8.exa_usd_at_0_0089} |`, `| stop_reason | ${JSON.stringify(T7.stop_reason)} | ${JSON.stringify(T8.stop_reason)} |`, '',
  'Notas: M1 solo cuenta firmas con etiqueta existente (adjudicator v3). Las páginas de lista que abre la fase de listas cuentan como rechazadas (no son firmas). Las semillas son etiquetas de réplica (H1).');
console.log(JSON.stringify({ verdict, gold: g, rule_M1: m1, rule_M2: m2, runs_v7: v7.length, runs_v8: v8.length }));
if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify(out, null, 1)}\n`);
if (arg('md')) writeFileSync(arg('md'), `${md.join('\n')}\n`);
