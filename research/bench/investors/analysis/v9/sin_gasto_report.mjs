#!/usr/bin/env node
// V9 pasos 0–2 sin gasto (solo relectura de cachés y eventos v7/v8): genera docs/benchmark/investors/V9-TECHOS-SIN-GASTO.md y .json.
// Uso, desde research/: node bench/investors/analysis/v9/sin_gasto_report.mjs --md ../docs/benchmark/investors/V9-TECHOS-SIN-GASTO.md --json ../docs/benchmark/investors/V9-TECHOS-SIN-GASTO.json
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { diagListRows, v8ListPages, v8events, loadCase, nameIn, CASES_A, CASES_B, OUT, readEvents, closeAll } from './data.v9.mjs';
import { rankVariant } from '../../list-names.v9.mjs';
import { isGold, GOLD_NAMES_V9 } from './ceiling_lists.mjs';
import { replicaRows } from './ceiling_replicas.mjs';
import { nameMatchesDomainV9, stripTypeTail } from '../../resolve-match.v9.mjs';
import { loadLabels, investorGain, median } from '../v7/common.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const ex = k => [k.fields.sector, ...(k.fields.subsectors ?? []), ...(k.fields.target_markets ?? [])];
const J = {};

// ── Paso 0: resoluciones v8 y búsquedas por nombre ya guardadas
const ev = v8events(), res = ev.filter(e => e.event === 'resolution_end');
J.resolutions_v8 = Object.fromEntries([...new Set(res.map(e => e.outcome))].map(o => [o, res.filter(e => e.outcome === o).length]));
const deny = ['pitchbook.com', 'app.dealroom.co', 'f4.fund', 'fundraisingfox.com', 'foundersuite.com', 'pipeseed.com', 'crunchbase.com'];
const nd = []; ev.forEach((e, i) => { if (e.event !== 'resolution_end' || e.outcome !== 'no_domain') return; let s = null; for (let j = i - 1; j >= 0; j--) { const x = ev[j]; if (x.run_id === e.run_id && x.event === 'search_end' && x.query.startsWith(`"${e.name}"`)) { s = x; break; } }
  const hosts = (s?.urls ?? []).map(host).filter(h => h && !deny.some(d => h === d || h.endsWith(`.${d}`))); nd.push({ name: e.name, tail: stripTypeTail(e.name) !== e.name.replace(/\s*\([^)]*\)\s*$/, '').trim(), pick: hosts.find(h => nameMatchesDomainV9(e.name, h)) ?? null }); });
J.no_domain = { resolutions: nd.length, names: new Set(nd.map(x => x.name)).size, type_tail: nd.filter(x => x.tail).length, v9_matcher_picks: nd.filter(x => x.pick).length, v9_matcher_names: new Set(nd.filter(x => x.pick).map(x => x.name)).size };
J.gold_resolution_attempts_v8 = CASES_A.reduce((a, c) => a + res.filter(e => e.run_id.includes(`syn-${c}__`) && nameIn(e.name, GOLD_NAMES_V9[c])).length, 0);
const nameSearches = [];
for (const d of ['investors-internal-2026-10-09-v5-pairs', 'investors-internal-2026-10-09-v6', 'investors-internal-2026-10-12-v7', 'investors-internal-2026-10-12-v8']) {
  if (!existsSync(resolve(OUT, d, 'events.jsonl'))) continue;
  for (const e of readEvents(resolve(OUT, d))) if (e.event === 'search_end') for (const c of [...CASES_A, ...CASES_B]) if (nameIn(e.query, GOLD_NAMES_V9[c])) { const k = loadCase(c), i = (e.urls ?? []).findIndex(u => host(u) === k.gold.domain || host(u)?.endsWith(`.${k.gold.domain}`)); nameSearches.push({ dir: d, case: c, query: e.query.slice(0, 70), provider: e.provider, gold_rank: i < 0 ? null : i + 1 }); }
}
J.name_searches_cached = [...new Map(nameSearches.map(x => [`${x.case}|${x.query}`, x])).values()];
// el oro aceptado en un intento fallido de v8 (descartado por la regla)
J.v8_failed_attempt_gold = ev.filter(e => e.event === 'extract_end' && e.accepted && /worldfund\.vc|magmapartners|lightrock|celesta\.vc|golden\.ventures|ecapital\.vc/.test(e.url)).map(e => ({ run: e.run_id.split('__').slice(1).join(' '), url: e.url }));

// ── Paso 1: páginas de listas y puesto del oro
J.cases = [];
for (const c of [...CASES_A, ...CASES_B]) {
  const k = loadCase(c), diag = [...new Map(diagListRows(c).map(r => [r.url, { url: r.url, text: `${r.title}\n${r.text}` }])).values()].filter(p => p.text.length > 50);
  const row = { case: c, gold: k.gold.domain, diag_pages: diag.length, diag_named: diag.filter(p => nameIn(p.text, GOLD_NAMES_V9[c])).length };
  const rk = (pages, mode) => { const r = rankVariant(pages, mode, { extraGeneric: ex(k) }); const i = r.findIndex(x => isGold(c, x.key)); return { names: r.length, rank: i < 0 ? null : i + 1 }; };
  Object.assign(row, { diag_pages_mode: rk(diag, 'pages'), diag_firm: rk(diag, 'firm_pages'), diag_position: rk(diag, 'position') });
  if (CASES_A.includes(c)) { const full = v8ListPages(c); Object.assign(row, { full_pages: full.length, full_named: full.filter(p => nameIn(p.text, GOLD_NAMES_V9[c])).length, full_pages_mode: rk(full, 'pages'), full_firm: rk(full, 'firm_pages'), full_position: rk(full, 'position') }); const m = new Map(diag.map(p => [p.url, p])); for (const p of full) m.set(p.url, p); row.union_firm = rk([...m.values()], 'firm_pages'); }
  J.cases.push(row);
}
J.replicas = replicaRows();
const selRep = K => CASES_A.filter(c => J.replicas.filter(r => r.case === c && r.rank && r.rank <= K).length >= 2);
J.selection_by_K = Object.fromEntries([8, 16, 32, 64, 128, 256].map(K => [K, selRep(K)]));
J.selection_B_diag_firm = Object.fromEntries([8, 16, 32, 64, 128].map(K => [K, CASES_B.filter(c => { const r = J.cases.find(x => x.case === c).diag_firm.rank; return r && r <= K; })]));

// ── (g) firmas con gain>=2
const L = loadLabels(), g2 = {}; for (const l of L.values()) if (investorGain(l) >= 2) (g2[l.case_id] ??= new Set()).add(l.stable_id);
const runs = dir => { const d = resolve(OUT, dir, 'runs'); return existsSync(d) ? readdirSync(d).map(n => resolve(d, n, 'result.json')).filter(existsSync).map(f => JSON.parse(readFileSync(f, 'utf8'))) : []; };
J.gain2 = CASES_A.map(c => { const id = `inv-case-syn-${c}`, set = g2[id] ?? new Set(); const row = { case: c, gain2: set.size };
  for (const [a, dir] of [['v7', 'investors-internal-2026-10-12-v7'], ['v8', 'investors-internal-2026-10-12-v8']]) { const rs = runs(dir).filter(r => r.case_id === id), ids = r => new Set((r.entities ?? []).map(e => e.stable_id)); row[`${a}_union`] = [...set].filter(x => rs.some(r => ids(r).has(x))).length; row[`${a}_median`] = median(rs.map(r => [...set].filter(x => ids(r).has(x)).length)); }
  return row; });
J.gain2_B = CASES_B.map(c => ({ case: c, gain2: (g2[`inv-case-syn-${c}`] ?? new Set()).size }));

// ── Presupuesto de Exa para resoluciones
const RATE = 0.0089, CAP = 5, diagUSD = 12 * RATE, planner = 152 * RATE;
J.budget = { cap_usd: CAP, diag_usd: +diagUSD.toFixed(3), planner_usd_v7_like: +planner.toFixed(3), left_usd: +(CAP - diagUSD - planner).toFixed(3), resolutions_total: Math.floor((CAP - diagUSD - planner) / RATE), resolutions_per_case: Math.floor((CAP - diagUSD - planner) / RATE / 6) };
closeAll();

const t = x => x == null ? '—' : x, rr = o => o ? `${t(o.rank)}/${o.names}` : '—';
const md = ['# V9 — Techos sin gasto (pasos 0 a 2 de PROMPT-v11)', '', `Generado: ${new Date().toISOString()}. Solo relectura de cachés y events.jsonl de v5–v8 (sin Exa, sin LLM, sin red). Script: research/bench/investors/analysis/v9/sin_gasto_report.mjs.`, '',
  '## Paso 0: separar la causa (parte sin gasto)', '',
  `Resoluciones por nombre de firma en events.jsonl de v8 (18 corridas más el intento descartado de p05 s202, que aporta 7): ${Object.entries(J.resolutions_v8).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '',
  `no_domain: ${J.no_domain.resolutions} resoluciones de ${J.no_domain.names} nombres. ${J.no_domain.type_tail} llevaban el tipo de la tabla del agregador pegado al nombre ("… VC Fund"); sus búsquedas devolvieron sobre todo páginas del agregador. En los resultados guardados, el emparejador v9 encuentra el sitio propio (o un subdominio del propio) en ${J.no_domain.v9_matcher_picks} resoluciones (${J.no_domain.v9_matcher_names} nombres). Revisión de los hosts: en unas 47 de las 109 el sitio propio o el de la matriz estaba en los resultados (dominios cortos, siglas, acentos, subdominios); el resto no lo traía.`, '',
  `Intentos de resolver el oro en v8: ${J.gold_resolution_attempts_v8}. Las no_domain no explican la pérdida del oro.`, '',
  'Búsquedas por el nombre del oro que ya están en las cachés (consultas de profundización, no la de resolución):', '', '| Carpeta | Caso | Consulta | Proveedor | Puesto del dominio del oro |', '|---|---|---|---|---|',
  ...J.name_searches_cached.map(x => `| ${x.dir} | ${x.case} | ${x.query} | ${x.provider} | ${t(x.gold_rank)} |`), '',
  `Oro aceptado en un intento de v8 que falló por infraestructura y se descartó por la regla: ${J.v8_failed_attempt_gold.map(x => `${x.run} (${x.url})`).join('; ') || 'ninguno'}.`, '',
  'Sin la medición con Exa por nombre (12 llamadas, go-v9-diagnostico.sh) queda abierto si (i) aplica a 10 de los 12 oros. Lo que sí está medido: la redacción de la consulta no cambia el alcance (6 formas, ≤ 1 de 6), las listas nombran al oro y el motor lo pierde en la extracción y la selección (iii).', '',
  '## Paso 1: páginas de listas y puesto del oro', '',
  'diag = texto Exa (≤ 10.000 caracteres) de las 2 consultas de listas del diagnóstico v8; full = páginas completas que abrió la fase de listas de v8 (unión de 3 réplicas); union = diag + full. Puesto = puesto del oro / nombres distintos. Órdenes: pages (páginas que citan el nombre), firm_pages (solo nombres con forma de firma, por páginas), position (mejor puesto dentro de una página).', '',
  '| Caso | Oro | Páginas diag | Con el oro | Páginas full | Con el oro | diag pages | diag firm_pages | diag position | full pages | full firm_pages | full position | union firm_pages |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...J.cases.map(r => `| ${r.case} | ${r.gold} | ${r.diag_pages} | ${r.diag_named} | ${t(r.full_pages)} | ${t(r.full_named)} | ${rr(r.diag_pages_mode)} | ${rr(r.diag_firm)} | ${rr(r.diag_position)} | ${rr(r.full_pages_mode)} | ${rr(r.full_firm)} | ${rr(r.full_position)} | ${rr(r.union_firm)} |`), '',
  'Por réplica v8 (O2 se cuenta por réplica; la regla pide ≥ 2 de 3):', '', '| Caso | Réplica | Páginas de lista | Con el oro | Nombres | Puesto del oro (firm_pages) |', '|---|---|---|---|---|---|',
  ...J.replicas.map(r => `| ${r.case} | ${r.rep} | ${r.pages} | ${r.named} | ${r.names} | ${t(r.rank)} |`), '',
  '| Cupo K de resoluciones por caso | 8 | 16 | 32 | 64 | 128 | 256 |', '|---|---|---|---|---|---|---|',
  `| p01–p06: casos con el oro ≤ K en ≥ 2 de 3 réplicas | ${[8, 16, 32, 64, 128, 256].map(K => J.selection_by_K[K].length).join(' | ')} |`,
  `| p07–p12 (diag, firm_pages, una lista por caso) | ${[8, 16, 32, 64, 128].map(K => J.selection_B_diag_firm[K].length).join(' | ')} | — |`, '',
  `Presupuesto de Exa: tope US$ ${J.budget.cap_usd} − diagnóstico US$ ${J.budget.diag_usd} − parte del planner como v7 (152 llamadas) US$ ${J.budget.planner_usd_v7_like} = US$ ${J.budget.left_usd} → ${J.budget.resolutions_total} resoluciones en total, ${J.budget.resolutions_per_case} por caso (las réplicas repiten nombres y salen de la caché). Con K ≤ ${J.budget.resolutions_per_case} el techo de selección es ${J.selection_by_K[64].length} de 6.`, '',
  '## (g) Firmas con gain ≥ 2 en las etiquetas', '', '| Caso | Firmas gain ≥ 2 | v7: unión de réplicas | v7: mediana | v8: unión | v8: mediana |', '|---|---|---|---|---|---|',
  ...J.gain2.map(r => `| ${r.case} | ${r.gain2} | ${r.v7_union} | ${r.v7_median} | ${r.v8_union} | ${r.v8_median} |`),
  `| Total | ${J.gain2.reduce((a, r) => a + r.gain2, 0)} | ${J.gain2.reduce((a, r) => a + r.v7_union, 0)} | | ${J.gain2.reduce((a, r) => a + r.v8_union, 0)} | |`, '',
  `p07–p12: ${J.gain2_B.map(r => `${r.case} ${r.gain2}`).join(', ')}. Las etiquetas salen del pool de resultados de los sistemas, así que el conjunto está sesgado hacia lo que ya se encontró.`];
if (arg('md')) writeFileSync(arg('md'), `${md.join('\n')}\n`);
if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify(J, null, 1)}\n`);
console.log(JSON.stringify({ no_domain: J.no_domain, gold_resolution_attempts_v8: J.gold_resolution_attempts_v8, selection_by_K: J.selection_by_K, selection_B: J.selection_B_diag_firm, budget: J.budget }));
