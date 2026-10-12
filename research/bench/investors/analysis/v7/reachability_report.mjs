#!/usr/bin/env node
// C4: escribe docs/benchmark/investors/ALCANZABILIDAD-ORO.md a partir de out/reachability-v7-2026-10-12/result.json.
// Regla fijada en V7-PREREGISTRO.md antes de ejecutar: caso P si el dominio del oro aparece en ≥ 1 de sus 3 consultas
// (10 resultados); caso D si no aparece en ninguna. Global: P si ≥ 4 de 6 casos son P; D si ≤ 2; mixto si 3.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT, INV } from './common.mjs';
const res = resolve(OUT, 'reachability-v7-2026-10-12/result.json');
const md = resolve(INV, '../../../docs/benchmark/investors/ALCANZABILIDAD-ORO.md');
if (!existsSync(res)) { console.error('sin result.json de la prueba de alcanzabilidad'); process.exit(1); }
const r = JSON.parse(readFileSync(res, 'utf8'));
const cases = Object.keys(r.by_case), P = cases.filter(c => r.by_case[c].with_gold > 0), D = cases.filter(c => !r.by_case[c].with_gold);
const global = P.length >= 4 ? 'P' : P.length <= 2 ? 'D' : 'mixto';
const ranks = r.rows.filter(x => x.gold_rank).map(x => `${x.case} puesto ${x.gold_rank}`);
const sentence = `El dominio del oro aparece en ${P.length} de 6 casos (${r.queries_with_gold} de ${r.rows.length} consultas${ranks.length ? `: ${ranks.join(', ')}` : ''}) y no aparece en ${D.length} (${D.join(', ') || 'ninguno'}): ` +
  (global === 'P' ? 'el problema es sobre todo de Exa con las consultas largas del planner (P), no del oro.' : global === 'D' ? 'con consultas cortas sin nombre Exa tampoco devuelve el oro, así que el problema es sobre todo del oro (D: poco recuperable con búsqueda abierta), no de las consultas.' : 'resultado mixto: P en los casos donde aparece y D en los demás.');
const lines = ['# Alcanzabilidad del oro (C4, H6)', '', `Ejecutada una vez el ${r.executed_at}. 18 consultas cortas sin nombre de firma (3 por caso; la 1.ª es la de la tabla P1 del diagnóstico), solo Exa (auto, 10 resultados, texto 4000, highlights). Llamadas pagadas: ${r.paid_calls}; errores: ${r.errors}; costo a 0.0089 USD por llamada: ${r.usd_at_0_0089} USD.`, '',
  `Regla (fijada en docs/handoff/V7-PREREGISTRO.md antes de ejecutar): un caso es P si el dominio del oro aparece en al menos 1 de sus 3 consultas; D si no aparece en ninguna. Global: P con 4 o más casos P; D con 2 o menos; mixto con 3.`, '',
  '| Caso | Oro | Consulta | Palabras | Resultados | Puesto del oro |', '|---|---|---|---|---|---|',
  ...r.rows.map(x => `| ${x.case} | ${x.gold} | ${x.query} | ${x.words} | ${x.results} | ${x.gold_rank ?? '—'} |`), '',
  '| Caso | Consultas con el oro | Clasificación |', '|---|---|---|', ...cases.map(c => `| ${c} | ${r.by_case[c].with_gold} de ${r.by_case[c].queries} | ${r.by_case[c].with_gold ? 'P' : 'D'} |`), '',
  `Global: ${global}.`, '', `Conclusión: ${sentence}`, ''];
writeFileSync(md, lines.join('\n'));
console.log(sentence);
