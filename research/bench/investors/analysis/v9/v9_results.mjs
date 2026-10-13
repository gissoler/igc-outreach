#!/usr/bin/env node
// Informe v9 (candidatos del modelo) frente a v8 y v7 (V9-PREREGISTRO.md §6, fijado antes de gastar). Solo cifras. Sin red ni LLM.
// O1 = dominio del oro en algún resultado de búsqueda; O2 = oro entre las entidades aceptadas; M1/M2 = definiciones de V7-PREREGISTRO.md.
// Uso (desde research/): node bench/investors/analysis/v9/v9_results.mjs --v9 <out v9> [--check <v5_check.json>] [--md f] [--json f]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeUrl } from '../../../../agent/docs.mjs';
import { isLiteralEvidence } from '../../extractor.mjs';
import { openReadOnlyCache } from '../../cache-layers.v7.mjs';
import { loadRuns, OUT, median, loadLabels, investorGain } from '../v7/common.mjs';
import { loadCase, sameSite, CASES_A } from '../v8/queries.v8.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const DIRS = { v7: resolve(OUT, 'investors-internal-2026-10-12-v7'), v8: resolve(OUT, 'investors-internal-2026-10-12-v8'), v9: arg('v9') ? resolve(arg('v9')) : resolve(OUT, 'investors-internal-2026-10-13-v9') };
const CASES = CASES_A, SEEDS = [101, 202, 303], RATE = 0.0089, L = loadLabels(), GOLD = Object.fromEntries(CASES.map(c => [c, loadCase(c).gold.domain]));
function textIndex(layer) {
  const f = new Map(), s = new Map();
  for (const r of layer.all('fetch')) if (r.value?.text && !f.has(r.key)) f.set(r.key, r.value.text);
  for (const r of layer.all('search')) for (const row of r.value ?? []) if (row.text) { const k = normalizeUrl(row.url); if (!s.has(k)) s.set(k, []); s.get(k).push(row.text); }
  return url => { const k = normalizeUrl(url); return [f.get(k), ...(s.get(k) ?? [])].filter(Boolean).join('\n␞\n'); };
}
function metrics(run, tf) {
  const r = run.r, ev = run.ev, gold = GOLD[run.case], ids = [...new Set(r.entities.map(e => e.stable_id))];
  const se = ev.filter(e => e.event === 'search_end'), fe = ev.filter(e => e.event === 'fetch_end'), mp = r.v2_stats?.model_phase ?? null;
  return { case: run.case, seed: run.seed, ids, firms: ids.length,
    gain2_labeled: ids.filter(id => { const l = L.get(`inv-case-syn-${run.case}|${id}`); return l && investorGain(l) >= 2; }).length,
    firms_verified_quote: r.entities.filter(e => e.sources.some(s => s.quote && isLiteralEvidence(tf(s.url), s.quote))).length,
    O1: se.some(e => (e.urls ?? []).some(u => sameSite(u, gold))) ? 1 : 0, O2: ids.includes(`inv:domain:${gold}`) ? 1 : 0,
    exa_paid: se.reduce((a, e) => a + (e.attempts ?? []).filter(x => x.provider === 'exa' && !x.cached).length, 0), fetches: fe.length, searches: r.totals.searches, stop_reason: r.stop_reason,
    model_proposed: mp?.proposed ?? 0, model_accepted: mp?.accepted ?? 0, model_searches: mp?.searches ?? 0, model_fetches: mp?.fetches ?? 0, model_name: mp?.model ?? null, model_provider: mp?.provider ?? null };
}
function arm(dir) {
  if (!existsSync(resolve(dir, 'cache.sqlite')) || !existsSync(resolve(dir, 'fingerprint.json'))) return [];
  const bench = JSON.parse(readFileSync(resolve(dir, 'fingerprint.json'), 'utf8')).bench_id, layer = openReadOnlyCache({ path: resolve(dir, 'cache.sqlite'), namespace: `investors-${bench}` }), tf = textIndex(layer);
  const rows = loadRuns(dir, [dir]).filter(r => r.cond === 'B2' && r.variant === 'A' && CASES.includes(r.case) && SEEDS.includes(r.seed)).map(run => metrics(run, tf)); layer.close(); return rows;
}
const R = Object.fromEntries(Object.entries(DIRS).map(([k, d]) => [k, arm(d)]));
const per = (rows, k) => Object.fromEntries(CASES.map(c => { const xs = rows.filter(r => r.case === c).map(r => r[k]); return [c, { median: median(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null }]; }));
const reps = (rows, k) => Object.fromEntries(CASES.map(c => [c, rows.filter(r => r.case === c && r[k]).length]));
const casesO2 = rows => CASES.filter(c => rows.filter(r => r.case === c && r.O2).length >= 2).length;
const rule = (base, arm, k) => { const B = per(base, k), V = per(arm, k), sB = CASES.reduce((a, c) => a + (B[c].median ?? 0), 0), sV = CASES.reduce((a, c) => a + (V[c].median ?? 0), 0);
  const geq = CASES.filter(c => (V[c].median ?? 0) >= (B[c].median ?? 0)).length, lt = CASES.filter(c => (V[c].median ?? 0) < (B[c].median ?? 0)).length;
  return { sum_base: sB, sum_v9: sV, cases_geq: geq, cases_lt: lt, improves: sV > sB && geq >= 4, worsens: sV < sB && lt >= 4 }; };
const check = arg('check') && existsSync(resolve(arg('check'))) ? JSON.parse(readFileSync(resolve(arg('check')), 'utf8')) : null;
const v9 = R.v9, complete = CASES.filter(c => v9.filter(r => r.case === c).length === 3).length;
const m1 = rule(R.v8, v9, 'gain2_labeled'), m2 = rule(R.v8, v9, 'firms_verified_quote'), cO2 = casesO2(v9);
const verdict = !v9.length ? 'SIN DATOS v9' : complete < 6 ? `INCOMPLETA (${complete}/6 casos con 3 réplicas)` : check && check.summary?.citations_verified_pct !== 100 ? 'NO VÁLIDA (citas verificadas < 100%)'
  : (m1.worsens || m2.worsens) ? 'EMPEORA M1 o M2' : cO2 >= 4 ? 'ORO' : cO2 >= 2 ? 'ORO PARCIAL' : 'SIN CAMBIO';
const fm = s => s.median == null ? '—' : `${s.median} (${s.min}-${s.max})`, sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const out = { verdict, citations_verified_pct: check?.summary?.citations_verified_pct ?? null, cases_O2: { v7: casesO2(R.v7), v8: casesO2(R.v8), v9: cO2 }, runs_O2: { v7: sum(R.v7, 'O2'), v8: sum(R.v8, 'O2'), v9: sum(v9, 'O2') }, rule_M1_vs_v8: m1, rule_M2_vs_v8: m2,
  per_case: Object.fromEntries(CASES.map(c => [c, { O2: { v7: reps(R.v7, 'O2')[c], v8: reps(R.v8, 'O2')[c], v9: reps(v9, 'O2')[c] }, M1: { v8: per(R.v8, 'gain2_labeled')[c], v9: per(v9, 'gain2_labeled')[c] }, M2: { v8: per(R.v8, 'firms_verified_quote')[c], v9: per(v9, 'firms_verified_quote')[c] }, model_accepted: per(v9, 'model_accepted')[c] }])),
  totals: Object.fromEntries(Object.entries(R).map(([k, rows]) => [k, { runs: rows.length, exa_paid: sum(rows, 'exa_paid'), exa_usd: +(sum(rows, 'exa_paid') * RATE).toFixed(3), fetches: sum(rows, 'fetches'), model_proposed: sum(rows, 'model_proposed'), model_accepted: sum(rows, 'model_accepted') }])),
  model: v9[0] ? { provider: v9[0].model_provider, model: v9[0].model_name } : null };
const md = ['# V9 — Resultados (candidatos del modelo frente a v8 y v7)', '', `Generado: ${new Date().toISOString()}. Regla de docs/handoff/V9-PREREGISTRO.md §6. Corridas válidas: v7 ${R.v7.length}, v8 ${R.v8.length}, v9 ${v9.length}. Citas verificadas v9: ${out.citations_verified_pct ?? 'sin dato'}%. Modelo de candidatos: ${out.model ? `${out.model.provider} (${out.model.model})` : '—'}.`, '',
  `Resultado: **${verdict}**.`, '', '| | v7 | v8 | v9 |', '|---|---|---|---|',
  `| Corridas con el oro aceptado (O2), de 18 | ${out.runs_O2.v7} | ${out.runs_O2.v8} | ${out.runs_O2.v9} |`, `| Casos con O2 en ≥ 2 de 3 réplicas | ${out.cases_O2.v7} | ${out.cases_O2.v8} | ${out.cases_O2.v9} |`,
  `| Exa pagadas (USD a 0.0089) | ${out.totals.v7.exa_paid} (${out.totals.v7.exa_usd}) | ${out.totals.v8.exa_paid} (${out.totals.v8.exa_usd}) | ${out.totals.v9.exa_paid} (${out.totals.v9.exa_usd}) |`, '',
  '| Caso | Oro | O2 v7 | O2 v8 | O2 v9 | M1 v8 | M1 v9 | M2 v8 | M2 v9 | Aceptadas por candidatos del modelo |', '|---|---|---|---|---|---|---|---|---|---|',
  ...CASES.map(c => { const p = out.per_case[c]; return `| ${c} | ${GOLD[c]} | ${p.O2.v7}/3 | ${p.O2.v8}/3 | ${p.O2.v9}/3 | ${fm(p.M1.v8)} | ${fm(p.M1.v9)} | ${fm(p.M2.v8)} | ${fm(p.M2.v9)} | ${fm(p.model_accepted)} |`; }), '',
  `M1 (firmas gain ≥ 2): suma de medianas v8 ${m1.sum_base} → v9 ${m1.sum_v9}; casos v9 ≥ v8 ${m1.cases_geq}, < ${m1.cases_lt}. M2 (firmas con cita verificada): ${m2.sum_base} → ${m2.sum_v9}; ≥ ${m2.cases_geq}, < ${m2.cases_lt}.`];
if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify(out, null, 1)}\n`);
if (arg('md')) writeFileSync(arg('md'), `${md.join('\n')}\n`);
console.log(JSON.stringify({ verdict, cases_O2: out.cases_O2, runs_O2: out.runs_O2, M1: [m1.sum_base, m1.sum_v9], M2: [m2.sum_base, m2.sum_v9] }));
