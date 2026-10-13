#!/usr/bin/env node
// V9: informe del diagnóstico (docs/benchmark/investors/V9-DIAGNOSTICO.md) desde out/v9-diagnostico-2026-10-12/result.json.
// Uso, desde research/: node bench/investors/analysis/v9/diagnostico_report.v9.mjs --md ../docs/benchmark/investors/V9-DIAGNOSTICO.md
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR, CFG } from './diagnostico.v9.mjs';
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const f = resolve(OUT_DIR, 'result.json');
if (!existsSync(f)) { console.error(`falta ${f}`); process.exit(1); }
const r = JSON.parse(readFileSync(f, 'utf8')), d = r.decision, yn = v => v === true ? 'sí' : v === false ? 'no' : (v ?? '—');
const cal = r.panel ? `Panel de Exa: antes US$ ${r.panel.before ?? '—'}, después US$ ${r.panel.after ?? '—'}, diferencia US$ ${r.panel.delta ?? '—'} para ${r.paid_units} unidades.` : 'Panel de Exa: no anotado.';
const md = ['# V9 — Diagnóstico: búsqueda por nombre del oro y techo del diseño L128', '',
  `Ejecutado: ${r.executed_at}. Pre-registro: docs/handoff/V9-PREREGISTRO.md. Config: research/bench/investors/config/v9-diagnostico-2026-10-12.json.`, '',
  `Costo Exa: ${r.paid_units} unidades × 0.0089 = US$ ${r.usd_at_0_0089}; costDollars de Exa (suma) US$ ${r.exa_cost_usd_reported}. ${cal} LLM: ${r.llm_calls} llamadas no cacheadas. Descargas no cacheadas: ${r.fetches}.`, '',
  '## Paso 0: búsqueda por el nombre del oro (consulta de resolución del motor)', '',
  '| Caso | Oro | Consulta | Puesto Exa | Exa: host elegido (v8) | Exa: host elegido (v9) | Puesto Serper | Serper: host elegido (v9) |', '|---|---|---|---|---|---|---|---|',
  ...r.rows.map(x => `| ${x.case} | ${x.gold} | ${x.query} | ${x.exa_rank ?? '—'} | ${x.exa_pick_v8 ?? '—'} | ${x.exa_pick_v9 ?? '—'} | ${x.serper_rank ?? '—'} | ${x.serper_pick_v9 ?? '—'} |`), '',
  `Sitio del oro ausente de los 10 primeros de Exa: ${d.exa_gold_missing_top10} de 12. Regla del paso 0 (≥ 4 de 12 → el límite es Exa): ${d.limit_is_exa ? 'SÍ, el límite es Exa' : 'no'}.`, '',
  '## Resolución completa y aceptación en el sitio del oro (extractor v7, prompt v3, regla de cita sin cambios)', '',
  '| Caso | Exa: resultado | Exa: oro aceptado | Serper: resultado | Serper: oro aceptado | URL del ancla: resultado | Ancla aceptada |', '|---|---|---|---|---|---|---|',
  ...r.rows.map(x => `| ${x.case} | ${x.exa_resolution} | ${yn(x.acc_exa)} | ${x.serper_resolution} | ${yn(x.acc_serper)} | ${x.anchor_outcome} | ${yn(x.acc_anchor)} |`), '',
  `## Selección dentro del cupo K = ${CFG.lists.cupo_k} (diseño L128)`, '',
  '| Caso | Fuente de las páginas | Puesto del oro (por réplica o único) | Seleccionado |', '|---|---|---|---|',
  ...r.rows.map(x => `| ${x.case} | ${x.list_source} | ${x.gold_rank ?? '—'} | ${yn(x.sel)} |`), '',
  '## Regla pre-registrada', '',
  `| | p01–p06 | p07–p12 |`, '|---|---|---|',
  `| Oro seleccionado (≤ K) | ${d.A_selected_k} | ${d.B_selected_k} |`,
  `| Seleccionado y aceptado, resolución por Exa | ${d.A_pass_exa} | ${d.B_pass_exa} |`,
  `| Seleccionado y aceptado, resolución por Serper | ${d.A_pass_serper} | ${d.B_pass_serper} |`, '',
  `Resultado: **${d.verdict}**. (GO condicional exige ≥ 4 de 6 en p01–p06 y ≥ 4 de 6 en p07–p12 con resolución por Serper; los diseños solo con Exa quedan en NO-GO por el cupo, ver V9-PREREGISTRO.md §2.)`];
writeFileSync(arg('md') ?? resolve(OUT_DIR, 'V9-DIAGNOSTICO.md'), `${md.join('\n')}\n`);
console.log(JSON.stringify(d));
